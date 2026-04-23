/**
 * Gate 59 — Track 1 Phase 1 emit #11 (E2E): `payment.received` →
 * `finance.observeSettlement`.
 *
 * Emit site: apps/api/src/modules/finance/payments.service.ts. Every
 * successful `PaymentsService.create()` writes a `payment.received`
 * outbox row in the same transaction as the payment + ledger rows.
 * The payload's `amount` is signed — positive for CUSTOMER_RECEIPT
 * (money in) and negated for VENDOR_PAYMENT (money out) — so a
 * downstream GL poster can key debits/credits off the sign without
 * consulting paymentType.
 *
 * Handler: `finance.observeSettlement` (apps/worker/src/handlers/
 * payment-received.ts). Deliberately read-only — it logs whether each
 * applied sales-invoice is now fully settled, but never mutates. The
 * file header explains why the "apply to ledger" + "flip to PAID"
 * rewrites-in-place were backed out: the service is already
 * authoritative for the ledger appends, and sales_invoices.status has
 * no PAID value to flip to yet (ops/sql/init/07-finance.sql:62 CHECK
 * allows DRAFT | POSTED | CANCELLED only; PAID lands in Track 2).
 *
 * This gate pins:
 *
 *   - CUSTOMER_RECEIPT payment with a single allocation:
 *       * outbox row lands with idempotency_key `payment.received:${id}`
 *       * payload shape matches PaymentReceivedPayload (amount positive,
 *         customerId set, vendorId null, appliedInvoiceIds populated)
 *       * sales_invoices.amount_paid bumped by the SERVICE (not the
 *         handler) — this is a sanity check that we're wiring the emit
 *         to the right place in the txn
 *       * customer_ledger has one PAYMENT row appended — again by the
 *         service, not the handler (the whole point of observeSettlement
 *         being read-only)
 *       * handler_runs ledger has one COMPLETED row for
 *         finance.observeSettlement
 *       * Redelivery: handler returns SKIPPED, customer_ledger row
 *         count stays at 1, amount_paid unchanged
 *
 *   - On-account payment (no allocations): service still emits; handler
 *     takes the "no invoices to observe" short-circuit and returns
 *     COMPLETED without touching sales_invoices.
 *
 *   - VENDOR_PAYMENT: amount is negated to a leading-minus string;
 *     handler takes the outbound branch (AP settlement observer is
 *     Track 2) and returns COMPLETED without a sales_invoices query.
 *
 *   - HANDLER_CATALOGUE registers exactly `["finance.observeSettlement"]`
 *     for `payment.received` — tripwire if a Track 2 handler slips in
 *     without a matching gate.
 *
 * Fixture strategy: each test creates a fresh POSTED sales_invoices
 * (or purchase_invoices) row via direct SQL with `notes LIKE 'gate-59
 * %'` tagging. We deliberately do NOT reuse seeded SI-2026-0001 / 0002
 * from ops/sql/seed/12-finance-dev-data.sql — mutating those would
 * break /finance/overview fixtures other tests depend on.
 *
 * Customer = seeded Apollo account (ac001). Vendor = seeded Elcon Mart
 * (fe0001). Both are stable UUIDs that survive `pnpm db:migrate`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type { CreatePayment, Payment } from "@instigenie/contracts";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";
import {
  DEV_ADMIN_ID,
  HANDLER_CATALOGUE,
  loadApiService,
  makeAdminRequest,
  registeredHandlerNames,
  runHandlersForEvent,
  silentLog,
  type ServiceRequest,
  waitForOutboxRow,
} from "./_phase3-helpers.js";

const SEED_CUSTOMER_APOLLO = "00000000-0000-0000-0000-0000000ac001";
const SEED_VENDOR_ECM = "00000000-0000-0000-0000-000000fe0001";

interface PaymentsServiceLike {
  create(req: ServiceRequest, input: CreatePayment): Promise<Payment>;
}

interface PaymentsServiceCtor {
  new (pool: pg.Pool): PaymentsServiceLike;
}

describe("gate-59: track 1 — payment.received → finance.observeSettlement E2E", () => {
  let pool: pg.Pool;
  let payments: PaymentsServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{
      PaymentsService: PaymentsServiceCtor;
    }>("apps/api/src/modules/finance/payments.service.ts");
    payments = new mod.PaymentsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Cleanup order:
  //   1. outbox.events + handler_runs (FK: handler_runs → outbox.events)
  //      keyed by gate-59 payment ids.
  //   2. customer_ledger / vendor_ledger rows referencing gate-59 payments
  //      (no FK from ledger to payments; link is via reference_id).
  //   3. payments tagged `notes LIKE 'gate-59 %'`.
  //   4. sales_invoice_lines / purchase_invoice_lines cascade from the
  //      parent invoice rows, so deleting the invoices is enough.
  //   5. sales_invoices / purchase_invoices tagged `notes LIKE 'gate-59
  //      %'`.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows: payIds } = await client.query<{ id: string }>(
        `SELECT id FROM payments WHERE notes LIKE 'gate-59 %'`,
      );
      const ids = payIds.map((r) => r.id);
      if (ids.length > 0) {
        // outbox.handler_runs cascades on outbox.events PK delete.
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
        `DELETE FROM sales_invoices WHERE notes LIKE 'gate-59 %'`,
      );
      await client.query(
        `DELETE FROM purchase_invoices WHERE notes LIKE 'gate-59 %'`,
      );
    });
  });

  /**
   * Seed a fresh POSTED sales_invoices row + single line via direct SQL.
   * We bypass SalesInvoicesService.create/post because (a) that service
   * requires a full line-items payload with HSN/SAC codes we don't care
   * about here, and (b) direct SQL keeps the fixture tag surgical.
   */
  async function seedPostedSalesInvoice(
    tag: string,
    grandTotal: string = "1000.0000",
  ): Promise<{ id: string; invoiceNumber: string; grandTotal: string }> {
    return withOrg(pool, DEV_ORG_ID, async (client) => {
      const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
      const invoiceNumber = `GATE59-SI-${suffix}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO sales_invoices
           (org_id, invoice_number, status, customer_id, customer_name,
            invoice_date, currency, subtotal, tax_total, grand_total,
            amount_paid, notes, posted_at, posted_by, created_by)
         VALUES ($1, $2, 'POSTED', $3, 'gate-59 Apollo', current_date,
                 'INR', $4::numeric, '0', $4::numeric,
                 '0', $5, now(), $6, $6)
         RETURNING id`,
        [
          DEV_ORG_ID,
          invoiceNumber,
          SEED_CUSTOMER_APOLLO,
          grandTotal,
          `gate-59 ${tag}`,
          DEV_ADMIN_ID,
        ],
      );
      await client.query(
        `INSERT INTO sales_invoice_lines
           (org_id, invoice_id, sequence_number, description,
            quantity, uom, unit_price, line_subtotal, line_tax, line_total)
         VALUES ($1, $2, 1, 'gate-59 test line', '1', 'EA',
                 $3::numeric, $3::numeric, '0', $3::numeric)`,
        [DEV_ORG_ID, rows[0]!.id, grandTotal],
      );
      return {
        id: rows[0]!.id,
        invoiceNumber,
        grandTotal,
      };
    });
  }

  async function seedPostedPurchaseInvoice(
    tag: string,
    grandTotal: string = "500.0000",
  ): Promise<{ id: string; invoiceNumber: string; grandTotal: string }> {
    return withOrg(pool, DEV_ORG_ID, async (client) => {
      const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
      const invoiceNumber = `GATE59-PI-${suffix}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO purchase_invoices
           (org_id, invoice_number, status, vendor_id, vendor_name,
            invoice_date, currency, subtotal, tax_total, grand_total,
            amount_paid, notes, posted_at, posted_by, created_by)
         VALUES ($1, $2, 'POSTED', $3, 'gate-59 Elcon', current_date,
                 'INR', $4::numeric, '0', $4::numeric,
                 '0', $5, now(), $6, $6)
         RETURNING id`,
        [
          DEV_ORG_ID,
          invoiceNumber,
          SEED_VENDOR_ECM,
          grandTotal,
          `gate-59 ${tag}`,
          DEV_ADMIN_ID,
        ],
      );
      await client.query(
        `INSERT INTO purchase_invoice_lines
           (org_id, invoice_id, sequence_number, description,
            quantity, uom, unit_price, line_subtotal, line_tax, line_total)
         VALUES ($1, $2, 1, 'gate-59 purchase line', '1', 'EA',
                 $3::numeric, $3::numeric, '0', $3::numeric)`,
        [DEV_ORG_ID, rows[0]!.id, grandTotal],
      );
      return {
        id: rows[0]!.id,
        invoiceNumber,
        grandTotal,
      };
    });
  }

  it("handler catalogue registers only finance.observeSettlement for payment.received", () => {
    expect(registeredHandlerNames("payment.received")).toEqual([
      "finance.observeSettlement",
    ]);
  });

  it("CUSTOMER_RECEIPT with single allocation: service emits + bumps invoice + appends ledger; handler COMPLETED; idempotent redelivery", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const invoice = await seedPostedSalesInvoice("happy", "1000.0000");
    const input: CreatePayment = {
      paymentType: "CUSTOMER_RECEIPT",
      customerId: SEED_CUSTOMER_APOLLO,
      amount: "1000.00",
      mode: "BANK_TRANSFER",
      appliedTo: [
        {
          invoiceId: invoice.id,
          invoiceType: "SALES_INVOICE",
          amountApplied: "1000.00",
        },
      ],
      notes: "gate-59 happy",
    };
    const payment = await payments.create(req, input);
    expect(payment.status).toBe("RECORDED");
    expect(payment.paymentType).toBe("CUSTOMER_RECEIPT");

    const outbox = await waitForOutboxRow(
      pool,
      `payment.received:${payment.id}`,
    );
    expect(outbox.payload).toEqual({
      orgId: DEV_ORG_ID,
      paymentId: payment.id,
      paymentNumber: payment.paymentNumber,
      customerId: SEED_CUSTOMER_APOLLO,
      vendorId: null,
      amount: "1000.00",
      currency: "INR",
      appliedInvoiceIds: [invoice.id],
      actorId: DEV_ADMIN_ID,
    });

    const { rows: evt } = await pool.query<{
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
    }>(
      `SELECT aggregate_type, aggregate_id, event_type
         FROM outbox.events WHERE id = $1`,
      [outbox.id],
    );
    expect(evt[0]).toMatchObject({
      aggregate_type: "payment",
      aggregate_id: payment.id,
      event_type: "payment.received",
    });

    // Service-side state. These are pinned because someone "simplifying"
    // payments.service.ts to offload the ledger writes onto the handler
    // would break double-booking invariants — and that refactor is the
    // exact one payment-received.ts's file header warns against.
    // sales_invoices + customer_ledger are RLS-gated on org_id, so we
    // read inside withOrg (mirrors gate-53's pattern).
    const preSnapshot = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const inv = await client.query<{
        amount_paid: string;
        status: string;
      }>(
        `SELECT amount_paid::text AS amount_paid, status
           FROM sales_invoices WHERE id = $1`,
        [invoice.id],
      );
      const ledger = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM customer_ledger
          WHERE reference_type = 'PAYMENT' AND reference_id = $1`,
        [payment.id],
      );
      return { inv: inv.rows[0]!, ledgerCount: ledger.rows[0]!.count };
    });
    expect(preSnapshot.inv.status).toBe("POSTED");
    expect(Number(preSnapshot.inv.amount_paid)).toBeCloseTo(1000, 2);
    expect(preSnapshot.ledgerCount).toBe("1");

    // Drive the handler.
    const firstRun = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "payment.received",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(firstRun.map((r) => r.handlerName)).toEqual([
      "finance.observeSettlement",
    ]);
    expect(firstRun.map((r) => r.status)).toEqual(["COMPLETED"]);

    const runs = await pool.query<{ handler_name: string; status: string }>(
      `SELECT handler_name, status FROM outbox.handler_runs
        WHERE outbox_id = $1`,
      [outbox.id],
    );
    expect(runs.rows).toEqual([
      { handler_name: "finance.observeSettlement", status: "COMPLETED" },
    ]);

    // Redelivery: SKIPPED. Crucial correctness check — if the handler
    // ever graduates to a writer, this pin forces the author to add a
    // proper idempotency layer rather than rely on the handler_runs
    // slot alone.
    const secondRun = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "payment.received",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(secondRun.map((r) => r.status)).toEqual(["SKIPPED"]);

    // No duplicate state. Handler is read-only — counts and totals
    // must be identical after redelivery.
    const postSnapshot = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const ledger = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM customer_ledger
          WHERE reference_type = 'PAYMENT' AND reference_id = $1`,
        [payment.id],
      );
      const inv = await client.query<{
        amount_paid: string;
        status: string;
      }>(
        `SELECT amount_paid::text AS amount_paid, status
           FROM sales_invoices WHERE id = $1`,
        [invoice.id],
      );
      return {
        ledgerCount: ledger.rows[0]!.count,
        inv: inv.rows[0]!,
      };
    });
    expect(postSnapshot.ledgerCount).toBe("1");
    expect(Number(postSnapshot.inv.amount_paid)).toBeCloseTo(1000, 2);
    // Status stays POSTED — the handler observed the fully-settled
    // invoice but did NOT flip to PAID (the file header calls this out
    // explicitly; the CHECK constraint wouldn't allow it today anyway).
    expect(postSnapshot.inv.status).toBe("POSTED");
  });

  it("on-account deposit (empty appliedTo): handler takes short-circuit and returns COMPLETED without reading sales_invoices", async () => {
    // No invoice seeded — pure deposit. The service emits with
    // appliedInvoiceIds=[] (empty). The handler sees zero length and
    // returns early with a log.info. The handler_runs row still lands
    // as COMPLETED so redelivery dedupes correctly.
    const req = makeAdminRequest(DEV_ORG_ID);
    const input: CreatePayment = {
      paymentType: "CUSTOMER_RECEIPT",
      customerId: SEED_CUSTOMER_APOLLO,
      amount: "500.00",
      mode: "UPI",
      appliedTo: [],
      notes: "gate-59 on-account",
    };
    const payment = await payments.create(req, input);

    const outbox = await waitForOutboxRow(
      pool,
      `payment.received:${payment.id}`,
    );
    expect(outbox.payload).toMatchObject({
      paymentId: payment.id,
      amount: "500.00",
      appliedInvoiceIds: [],
    });

    const results = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "payment.received",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(results.map((r) => r.status)).toEqual(["COMPLETED"]);

    // Customer ledger still has exactly one row — the service appends
    // an on-account PAYMENT row even when there are no invoice
    // allocations. The handler doesn't touch it.
    const { count } = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const r = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM customer_ledger
          WHERE reference_type = 'PAYMENT' AND reference_id = $1`,
        [payment.id],
      );
      return { count: r.rows[0]!.count };
    });
    expect(count).toBe("1");
  });

  it("VENDOR_PAYMENT: payload.amount is negated; handler takes outbound branch and COMPLETED", async () => {
    // Outward payout. The service negates the amount in the payload so
    // downstream consumers can key debits/credits by sign. The handler
    // detects `signedAmount < 0` and returns before querying
    // sales_invoices — an AP settlement observer is Track 2 work.
    const req = makeAdminRequest(DEV_ORG_ID);
    const bill = await seedPostedPurchaseInvoice("vendor-pay", "500.0000");
    const input: CreatePayment = {
      paymentType: "VENDOR_PAYMENT",
      vendorId: SEED_VENDOR_ECM,
      amount: "500.00",
      mode: "BANK_TRANSFER",
      appliedTo: [
        {
          invoiceId: bill.id,
          invoiceType: "PURCHASE_INVOICE",
          amountApplied: "500.00",
        },
      ],
      notes: "gate-59 vendor-pay",
    };
    const payment = await payments.create(req, input);

    const outbox = await waitForOutboxRow(
      pool,
      `payment.received:${payment.id}`,
    );
    expect(outbox.payload).toMatchObject({
      paymentId: payment.id,
      customerId: null,
      vendorId: SEED_VENDOR_ECM,
      amount: "-500.00",
      appliedInvoiceIds: [bill.id],
    });

    const results = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "payment.received",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(results.map((r) => r.status)).toEqual(["COMPLETED"]);

    // Service appended one vendor_ledger row; handler didn't touch it.
    const { count } = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const r = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM vendor_ledger
          WHERE reference_type = 'PAYMENT' AND reference_id = $1`,
        [payment.id],
      );
      return { count: r.rows[0]!.count };
    });
    expect(count).toBe("1");
  });

  it("partial allocation on a larger invoice: handler observes partial settlement without flipping status", async () => {
    // Sanity check on the observer's "partiallyPaid" path. Invoice
    // grand_total=2000, payment applies 500 → amount_paid=500 (< total),
    // handler should classify the invoice as partiallyPaid and return
    // COMPLETED. Status stays POSTED.
    const req = makeAdminRequest(DEV_ORG_ID);
    const invoice = await seedPostedSalesInvoice("partial", "2000.0000");
    const input: CreatePayment = {
      paymentType: "CUSTOMER_RECEIPT",
      customerId: SEED_CUSTOMER_APOLLO,
      amount: "500.00",
      mode: "CHEQUE",
      appliedTo: [
        {
          invoiceId: invoice.id,
          invoiceType: "SALES_INVOICE",
          amountApplied: "500.00",
        },
      ],
      notes: "gate-59 partial",
    };
    const payment = await payments.create(req, input);

    const outbox = await waitForOutboxRow(
      pool,
      `payment.received:${payment.id}`,
    );
    const results = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "payment.received",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(results.map((r) => r.status)).toEqual(["COMPLETED"]);

    const inv = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const r = await client.query<{
        amount_paid: string;
        status: string;
      }>(
        `SELECT amount_paid::text AS amount_paid, status
           FROM sales_invoices WHERE id = $1`,
        [invoice.id],
      );
      return r.rows[0]!;
    });
    expect(Number(inv.amount_paid)).toBeCloseTo(500, 2);
    expect(inv.status).toBe("POSTED");
  });
});
