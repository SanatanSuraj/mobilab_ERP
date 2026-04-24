/**
 * Gate 70 — POST /finance/payments: full HTTP axis matrix.
 *
 * Payments are the point where money actually moves on the ledger —
 * CUSTOMER_RECEIPT bumps a sales_invoice.amount_paid and drops a
 * customer_ledger row; VENDOR_PAYMENT does the symmetric thing for
 * purchase_invoice / vendor_ledger. A regression here can double-post,
 * silently drop an allocation, or let a unauthorised role trigger the
 * settle flow — every one of which corrupts AR/AP and is hard to
 * unwind without forensic work.
 *
 * Gate 59 covers the Track-1 emit/handler chain at the service layer;
 * this gate layers the HTTP axes (auth, Zod, framework errors,
 * concurrency) on top and is the only one that exercises the
 * preHandler pipeline (authGuard + requirePermission("payments:create")).
 *
 * Pipeline:
 *   authGuard → requirePermission("payments:create")
 *   → CreatePaymentSchema.parse() → payments.create()
 *
 * Roles with payments:create: SUPER_ADMIN, FINANCE.
 * Roles without: MANAGEMENT, SALES_REP, SALES_MANAGER, PRODUCTION_MANAGER,
 *                QC_INSPECTOR.
 *
 * Axes covered:
 *   1. happy paths       201 — on-account receipt, on-account vendor payment,
 *                        receipt applied to sales_invoice, vendor payment
 *                        applied to purchase_invoice, auto-numbered number,
 *                        explicit paymentNumber respected.
 *   2. missing fields    400 — empty body, each required field omitted,
 *                        CUSTOMER_RECEIPT sans customerId (zod .refine),
 *                        VENDOR_PAYMENT sans vendorId.
 *   3. invalid input     400 — bad enum values, bad UUID, bad ISO date,
 *                        bad money string.
 *   4. wrong types       400 — amount as number, appliedTo as string, etc.
 *   5. auth              401/403 — no token, expired, portal audience,
 *                        each of 5 internal roles without payments:create.
 *   6. boundary values   201/400 — empty appliedTo, max-length notes,
 *                        unicode, SQL-shape, notes>2000, amount=0 rejected.
 *   7. business rules    404/409 — non-existent invoice, allocation>balance,
 *                        total alloc>amount, type mismatch, paymentNumber
 *                        collision.
 *   8. concurrency       5 parallel distinct-number receipts all 201,
 *                        2 parallel receipts fighting for one paymentNumber
 *                        settle to exactly one 201 + one 409.
 *   9. response contract 201 returns full Payment shape, errors are
 *                        application/problem+json.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { withOrg } from "@instigenie/db";
import {
  createHttpHarness,
  type HttpHarness,
} from "./_http-harness.js";
import { AUDIENCE, type Role } from "@instigenie/contracts";
import { DEV_ORG_ID } from "./_helpers.js";

// Dev seed references (ops/sql/seed/04-crm-dev-data.sql,
// ops/sql/seed/09-procurement-dev-data.sql).
const SEED_CUSTOMER_APOLLO = "00000000-0000-0000-0000-0000000ac001";
const SEED_CUSTOMER_FORTIS = "00000000-0000-0000-0000-0000000ac002";
const SEED_VENDOR_ECM = "00000000-0000-0000-0000-000000fe0001";
const DEV_ADMIN_ID = "00000000-0000-0000-0000-00000000b001";

let harness: HttpHarness;

beforeAll(async () => {
  harness = await createHttpHarness();
}, 30_000);

afterAll(async () => {
  await harness.close();
});

const NOTES_PREFIX = "gate70-";
const INV_PREFIX = "GATE70-";

/**
 * Clean up payments / ledger / outbox / seeded invoices created by this
 * gate. The strategy mirrors gate-59:
 *   1. outbox.handler_runs → outbox.events (FK cascade keyed off the
 *      aggregate_id of our gate70 payments)
 *   2. customer_ledger / vendor_ledger rows (no FK from ledger → payment,
 *      so we match reference_id explicitly)
 *   3. payments tagged by `notes LIKE 'gate70-%'`
 *   4. sales_invoice_lines / purchase_invoice_lines cascade on parent
 *   5. sales_invoices / purchase_invoices tagged by `notes LIKE 'gate70-%'`
 */
async function purge(): Promise<void> {
  await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      DEV_ADMIN_ID,
    ]);
    const { rows: payIds } = await client.query<{ id: string }>(
      `SELECT id FROM payments WHERE notes LIKE 'gate70-%'`,
    );
    const ids = payIds.map((r) => r.id);
    if (ids.length > 0) {
      await client.query(
        `DELETE FROM outbox.handler_runs
          WHERE outbox_id IN (
            SELECT id FROM outbox.events
             WHERE event_type = 'payment.received'
               AND aggregate_id = ANY($1::uuid[])
          )`,
        [ids],
      );
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'payment.received'
            AND aggregate_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        `DELETE FROM customer_ledger
          WHERE reference_type = 'PAYMENT' AND reference_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        `DELETE FROM vendor_ledger
          WHERE reference_type = 'PAYMENT' AND reference_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(
        `DELETE FROM payments WHERE id = ANY($1::uuid[])`,
        [ids],
      );
    }
    await client.query(
      `DELETE FROM sales_invoices WHERE notes LIKE 'gate70-%'`,
    );
    await client.query(
      `DELETE FROM purchase_invoices WHERE notes LIKE 'gate70-%'`,
    );
  });
}

beforeEach(purge);
afterEach(purge);

/**
 * Seed a POSTED sales_invoice for a test that needs an allocation
 * target. Direct SQL (bypassing the SalesInvoicesService) because we
 * don't care about line-items HSN/SAC completeness — we just need a
 * POSTED row the payments endpoint can apply against.
 */
async function seedPostedSalesInvoice(
  tag: string,
  grandTotal: string = "1000.0000",
): Promise<{ id: string; invoiceNumber: string; grandTotal: string }> {
  return withOrg(harness.pool, DEV_ORG_ID, async (client) => {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const invoiceNumber = `${INV_PREFIX}SI-${suffix}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO sales_invoices
         (org_id, invoice_number, status, customer_id, customer_name,
          invoice_date, currency, subtotal, tax_total, grand_total,
          amount_paid, notes, posted_at, posted_by, created_by)
       VALUES ($1, $2, 'POSTED', $3, 'gate70 Apollo', current_date,
               'INR', $4::numeric, '0', $4::numeric,
               '0', $5, now(), $6, $6)
       RETURNING id`,
      [
        DEV_ORG_ID,
        invoiceNumber,
        SEED_CUSTOMER_APOLLO,
        grandTotal,
        `${NOTES_PREFIX}${tag}`,
        DEV_ADMIN_ID,
      ],
    );
    await client.query(
      `INSERT INTO sales_invoice_lines
         (org_id, invoice_id, sequence_number, description,
          quantity, uom, unit_price, line_subtotal, line_tax, line_total)
       VALUES ($1, $2, 1, 'gate70 test line', '1', 'EA',
               $3::numeric, $3::numeric, '0', $3::numeric)`,
      [DEV_ORG_ID, rows[0]!.id, grandTotal],
    );
    return { id: rows[0]!.id, invoiceNumber, grandTotal };
  });
}

async function seedPostedPurchaseInvoice(
  tag: string,
  grandTotal: string = "500.0000",
): Promise<{ id: string; invoiceNumber: string; grandTotal: string }> {
  return withOrg(harness.pool, DEV_ORG_ID, async (client) => {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const invoiceNumber = `${INV_PREFIX}PI-${suffix}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO purchase_invoices
         (org_id, invoice_number, status, vendor_id, vendor_name,
          invoice_date, currency, subtotal, tax_total, grand_total,
          amount_paid, notes, posted_at, posted_by, created_by)
       VALUES ($1, $2, 'POSTED', $3, 'gate70 Elcon', current_date,
               'INR', $4::numeric, '0', $4::numeric,
               '0', $5, now(), $6, $6)
       RETURNING id`,
      [
        DEV_ORG_ID,
        invoiceNumber,
        SEED_VENDOR_ECM,
        grandTotal,
        `${NOTES_PREFIX}${tag}`,
        DEV_ADMIN_ID,
      ],
    );
    await client.query(
      `INSERT INTO purchase_invoice_lines
         (org_id, invoice_id, sequence_number, description,
          quantity, uom, unit_price, line_subtotal, line_tax, line_total)
       VALUES ($1, $2, 1, 'gate70 purchase line', '1', 'EA',
               $3::numeric, $3::numeric, '0', $3::numeric)`,
      [DEV_ORG_ID, rows[0]!.id, grandTotal],
    );
    return { id: rows[0]!.id, invoiceNumber, grandTotal };
  });
}

/**
 * Build a minimal valid CUSTOMER_RECEIPT body. Tests override individual
 * keys to probe single axes.
 */
function baseCustomerReceipt(tag: string): Record<string, unknown> {
  return {
    paymentType: "CUSTOMER_RECEIPT",
    customerId: SEED_CUSTOMER_APOLLO,
    amount: "100.00",
    mode: "BANK_TRANSFER",
    appliedTo: [],
    notes: `${NOTES_PREFIX}${tag}`,
  };
}

function baseVendorPayment(tag: string): Record<string, unknown> {
  return {
    paymentType: "VENDOR_PAYMENT",
    vendorId: SEED_VENDOR_ECM,
    amount: "50.00",
    mode: "BANK_TRANSFER",
    appliedTo: [],
    notes: `${NOTES_PREFIX}${tag}`,
  };
}

describe("gate-70: POST /finance/payments — HTTP axis matrix", () => {
  // ══════════════════════════════════════════════════════════════════
  // 1. Happy paths
  // ══════════════════════════════════════════════════════════════════
  describe("1. happy paths", () => {
    it("FINANCE: on-account CUSTOMER_RECEIPT (no appliedTo) → 201", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post<{
        id: string;
        paymentNumber: string;
        paymentType: string;
        status: string;
      }>("/finance/payments", {
        token: tok,
        body: baseCustomerReceipt("a1"),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.paymentType).toBe("CUSTOMER_RECEIPT");
      expect(res.body.status).toBe("RECORDED");
      expect(res.body.paymentNumber).toMatch(/^PAY-\d{4}-\d+$/);
    });

    it("FINANCE: on-account VENDOR_PAYMENT (no appliedTo) → 201", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post<{
        paymentType: string;
        status: string;
      }>("/finance/payments", {
        token: tok,
        body: baseVendorPayment("a2"),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.paymentType).toBe("VENDOR_PAYMENT");
      expect(res.body.status).toBe("RECORDED");
    });

    it("SUPER_ADMIN: CUSTOMER_RECEIPT applied to sales_invoice → 201", async () => {
      const tok = await harness.tokenForRole("SUPER_ADMIN");
      const inv = await seedPostedSalesInvoice("a3-inv", "1000.00");
      const res = await harness.post<{
        appliedTo: Array<{ invoiceId: string; amountApplied: string }>;
      }>("/finance/payments", {
        token: tok,
        body: {
          ...baseCustomerReceipt("a3"),
          amount: "1000.00",
          appliedTo: [
            {
              invoiceId: inv.id,
              invoiceType: "SALES_INVOICE",
              amountApplied: "1000.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.appliedTo).toHaveLength(1);
      expect(res.body.appliedTo[0]!.invoiceId).toBe(inv.id);
    });

    it("FINANCE: VENDOR_PAYMENT applied to purchase_invoice → 201", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const inv = await seedPostedPurchaseInvoice("a4-inv", "500.00");
      const res = await harness.post<{
        appliedTo: Array<{ invoiceId: string }>;
      }>("/finance/payments", {
        token: tok,
        body: {
          ...baseVendorPayment("a4"),
          amount: "500.00",
          appliedTo: [
            {
              invoiceId: inv.id,
              invoiceType: "PURCHASE_INVOICE",
              amountApplied: "500.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.appliedTo).toHaveLength(1);
    });

    it("explicit paymentNumber respected", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const explicit = `PAY-${NOTES_PREFIX}a5-${Date.now()}`;
      const res = await harness.post<{ paymentNumber: string }>(
        "/finance/payments",
        {
          token: tok,
          body: { ...baseCustomerReceipt("a5"), paymentNumber: explicit },
        },
      );
      expect(res.statusCode).toBe(201);
      // Note: CreatePaymentSchema caps paymentNumber at 32 chars — so the
      // above assertion only holds when our generated number is ≤32.
      if (explicit.length <= 32) {
        expect(res.body.paymentNumber).toBe(explicit);
      }
    });

    it("auto-numbered receipt returns a PAY-YYYY-NNNN number", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post<{ paymentNumber: string }>(
        "/finance/payments",
        { token: tok, body: baseCustomerReceipt("a6") },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.paymentNumber).toMatch(/^PAY-\d{4}-\d+$/);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 2. Missing fields
  // ══════════════════════════════════════════════════════════════════
  describe("2. missing fields", () => {
    it("empty body → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing paymentType → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const body = baseCustomerReceipt("b2");
      delete body.paymentType;
      const res = await harness.post("/finance/payments", {
        token: tok,
        body,
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing amount → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const body = baseCustomerReceipt("b3");
      delete body.amount;
      const res = await harness.post("/finance/payments", {
        token: tok,
        body,
      });
      expect(res.statusCode).toBe(400);
    });

    it("missing mode → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const body = baseCustomerReceipt("b4");
      delete body.mode;
      const res = await harness.post("/finance/payments", {
        token: tok,
        body,
      });
      expect(res.statusCode).toBe(400);
    });

    it("CUSTOMER_RECEIPT without customerId → 400 (zod .refine)", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const body = baseCustomerReceipt("b5");
      delete body.customerId;
      const res = await harness.post("/finance/payments", {
        token: tok,
        body,
      });
      expect(res.statusCode).toBe(400);
    });

    it("VENDOR_PAYMENT without vendorId → 400 (zod .refine)", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const body = baseVendorPayment("b6");
      delete body.vendorId;
      const res = await harness.post("/finance/payments", {
        token: tok,
        body,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 3. Invalid input
  // ══════════════════════════════════════════════════════════════════
  describe("3. invalid input", () => {
    it("invalid paymentType enum → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("c1"), paymentType: "DONATION" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("invalid mode enum → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("c2"), mode: "BITCOIN" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("invalid currency (too long) → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("c3"), currency: "INDIANRUPEE" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("non-UUID customerId → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("c4"), customerId: "not-a-uuid" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("bad paymentDate format → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("c5"), paymentDate: "yesterday" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("bad money string (alphabetic amount) → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("c6"), amount: "lots" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("negative amountApplied in allocation → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const inv = await seedPostedSalesInvoice("c7-inv", "1000.00");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: {
          ...baseCustomerReceipt("c7"),
          amount: "100.00",
          appliedTo: [
            {
              invoiceId: inv.id,
              invoiceType: "SALES_INVOICE",
              amountApplied: "-10.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 4. Wrong types
  // ══════════════════════════════════════════════════════════════════
  describe("4. wrong types", () => {
    it("amount as number → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("d1"), amount: 100 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("paymentType as boolean → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("d2"), paymentType: true },
      });
      expect(res.statusCode).toBe(400);
    });

    it("appliedTo as string → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("d3"), appliedTo: "none" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("paymentDate as number → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("d4"), paymentDate: 20260415 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 5. Auth failures
  // ══════════════════════════════════════════════════════════════════
  describe("5. auth failures", () => {
    it("no Authorization header → 401", async () => {
      const res = await harness.post("/finance/payments", {
        body: baseCustomerReceipt("e1"),
      });
      expect(res.statusCode).toBe(401);
    });

    it("expired token → 401", async () => {
      const tok = await harness.tokenWith({
        roles: ["FINANCE"],
        ttlSecOverride: -1,
      });
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: baseCustomerReceipt("e2"),
      });
      expect(res.statusCode).toBe(401);
    });

    it("portal audience → 401/403", async () => {
      const tok = await harness.tokenWith({
        roles: ["FINANCE"],
        audience: AUDIENCE.portal,
      });
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: baseCustomerReceipt("e3"),
      });
      expect([401, 403]).toContain(res.statusCode);
    });

    const rolesWithoutPerm: Role[] = [
      "MANAGEMENT",
      "SALES_REP",
      "SALES_MANAGER",
      "PRODUCTION_MANAGER",
      "QC_INSPECTOR",
    ];
    for (const role of rolesWithoutPerm) {
      it(`role ${role} (no payments:create) → 403`, async () => {
        const tok = await harness.tokenForRole(role as Parameters<
          typeof harness.tokenForRole
        >[0]);
        const res = await harness.post("/finance/payments", {
          token: tok,
          body: baseCustomerReceipt(`e-${role}`),
        });
        expect(res.statusCode).toBe(403);
      });
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // 6. Boundary values
  // ══════════════════════════════════════════════════════════════════
  describe("6. boundary values", () => {
    it("empty appliedTo array → 201", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("f1"), appliedTo: [] },
      });
      expect(res.statusCode).toBe(201);
    });

    it("unicode in notes → 201, stored verbatim", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const uni = `${NOTES_PREFIX}f2 — 日本語 ✓ €`;
      const res = await harness.post<{ notes: string }>(
        "/finance/payments",
        {
          token: tok,
          body: { ...baseCustomerReceipt("f2"), notes: uni },
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.notes).toBe(uni);
    });

    it("SQL-shape in notes → 201, stored as literal text", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const sqlish = `${NOTES_PREFIX}f3 '; DROP TABLE payments; --`;
      const res = await harness.post<{ notes: string; id: string }>(
        "/finance/payments",
        {
          token: tok,
          body: { ...baseCustomerReceipt("f3"), notes: sqlish },
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.body.notes).toBe(sqlish);
      // Confirm payments table still exists.
      await withOrg(harness.pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM payments WHERE id = $1`,
          [res.body.id],
        );
        expect(rows[0]!.c).toBe("1");
      });
    });

    it("notes > 2000 chars → 400", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("f4"), notes: "x".repeat(2001) },
      });
      expect(res.statusCode).toBe(400);
    });

    it("amount = 0 → 400 or 409 (business rule: must be positive)", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("f5"), amount: "0.00" },
      });
      expect([400, 409]).toContain(res.statusCode);
    });

    it("huge numeric amount string (12 digits) → 201", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("f6"), amount: "999999999999.00" },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 7. Business rules
  // ══════════════════════════════════════════════════════════════════
  describe("7. business rules", () => {
    it("allocation references non-existent invoice → 404", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const ghost = "00000000-0000-0000-0000-0000deadbeef";
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: {
          ...baseCustomerReceipt("g1"),
          amount: "100.00",
          appliedTo: [
            {
              invoiceId: ghost,
              invoiceType: "SALES_INVOICE",
              amountApplied: "100.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("amountApplied > invoice remaining balance → 409", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const inv = await seedPostedSalesInvoice("g2-inv", "100.00");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: {
          ...baseCustomerReceipt("g2"),
          amount: "500.00",
          appliedTo: [
            {
              invoiceId: inv.id,
              invoiceType: "SALES_INVOICE",
              amountApplied: "500.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it("total allocations > payment amount → 409", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const inv = await seedPostedSalesInvoice("g3-inv", "1000.00");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: {
          ...baseCustomerReceipt("g3"),
          amount: "50.00",
          appliedTo: [
            {
              invoiceId: inv.id,
              invoiceType: "SALES_INVOICE",
              amountApplied: "100.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it("SALES_INVOICE allocation with VENDOR_PAYMENT type → 409", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const inv = await seedPostedSalesInvoice("g4-inv", "100.00");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: {
          ...baseVendorPayment("g4"),
          amount: "100.00",
          appliedTo: [
            {
              invoiceId: inv.id,
              invoiceType: "SALES_INVOICE",
              amountApplied: "100.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it("PURCHASE_INVOICE allocation with CUSTOMER_RECEIPT type → 409", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const inv = await seedPostedPurchaseInvoice("g5-inv", "100.00");
      const res = await harness.post("/finance/payments", {
        token: tok,
        body: {
          ...baseCustomerReceipt("g5"),
          amount: "100.00",
          appliedTo: [
            {
              invoiceId: inv.id,
              invoiceType: "PURCHASE_INVOICE",
              amountApplied: "100.00",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it("explicit paymentNumber collision → 409", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const dup = `PAY-GT70-DUP-${Date.now().toString(36).slice(-6)}`;
      const first = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("g6a"), paymentNumber: dup },
      });
      expect(first.statusCode).toBe(201);
      const second = await harness.post("/finance/payments", {
        token: tok,
        body: { ...baseCustomerReceipt("g6b"), paymentNumber: dup },
      });
      expect(second.statusCode).toBe(409);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 7. Concurrency
  // ══════════════════════════════════════════════════════════════════
  describe("8. concurrency", () => {
    it("5 parallel on-account receipts (auto-numbered) → all 201 distinct numbers", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          harness.post<{ paymentNumber: string }>("/finance/payments", {
            token: tok,
            body: baseCustomerReceipt(`h1-${i}`),
          }),
        ),
      );
      const ok = results.filter((r) => r.statusCode === 201);
      expect(ok).toHaveLength(5);
      const numbers = new Set(ok.map((r) => r.body.paymentNumber));
      expect(numbers.size).toBe(5);
    });

    it("2 parallel receipts fighting for one paymentNumber → one 201, one 409", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const dup = `PAY-GT70-RACE-${Date.now().toString(36).slice(-5)}`;
      const results = await Promise.all([
        harness.post("/finance/payments", {
          token: tok,
          body: { ...baseCustomerReceipt("h2a"), paymentNumber: dup },
        }),
        harness.post("/finance/payments", {
          token: tok,
          body: { ...baseCustomerReceipt("h2b"), paymentNumber: dup },
        }),
      ]);
      const ok = results.filter((r) => r.statusCode === 201);
      const conflict = results.filter((r) => r.statusCode === 409);
      expect(ok).toHaveLength(1);
      expect(conflict).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // 9. Response contract
  // ══════════════════════════════════════════════════════════════════
  describe("9. response contract", () => {
    it("201 response carries full Payment shape", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post<{
        id: string;
        orgId: string;
        paymentNumber: string;
        paymentType: string;
        status: string;
        customerId: string | null;
        vendorId: string | null;
        amount: string;
        mode: string;
        appliedTo: unknown[];
        recordedBy: string;
        createdAt: string;
        updatedAt: string;
      }>("/finance/payments", {
        token: tok,
        body: baseCustomerReceipt("i1"),
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.body.orgId).toBe(DEV_ORG_ID);
      expect(res.body.paymentType).toBe("CUSTOMER_RECEIPT");
      expect(res.body.status).toBe("RECORDED");
      expect(res.body.customerId).toBe(SEED_CUSTOMER_APOLLO);
      expect(res.body.mode).toBe("BANK_TRANSFER");
      expect(Array.isArray(res.body.appliedTo)).toBe(true);
      expect(typeof res.body.createdAt).toBe("string");
      expect(typeof res.body.updatedAt).toBe("string");
    });

    it("validation error is application/problem+json", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const res = await harness.post<{ code: string; status: number }>(
        "/finance/payments",
        { token: tok, body: {} },
      );
      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(typeof res.body.code).toBe("string");
      expect(res.body.status).toBe(400);
    });

    it("conflict response is application/problem+json", async () => {
      const tok = await harness.tokenForRole("FINANCE");
      const inv = await seedPostedSalesInvoice("i3-inv", "50.00");
      const res = await harness.post<{ code: string; status: number }>(
        "/finance/payments",
        {
          token: tok,
          body: {
            ...baseCustomerReceipt("i3"),
            amount: "500.00",
            appliedTo: [
              {
                invoiceId: inv.id,
                invoiceType: "SALES_INVOICE",
                amountApplied: "500.00",
              },
            ],
          },
        },
      );
      expect(res.statusCode).toBe(409);
      expect(res.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(res.body.status).toBe(409);
    });
  });
});
