/**
 * Gate 26 — QuotationsService + SalesOrdersService integration.
 *
 * Goes beyond gate-8's RLS-focused checks by exercising the actual
 * service methods against the dev Postgres:
 *
 *   1. computeTotals (Decimal-only math, Rule #1) produces the right
 *      subtotal/tax/grand-total for both under- and over-threshold inputs.
 *   2. Over-threshold quotations (grand_total > ₹5 lakh) auto-promote to
 *      AWAITING_APPROVAL on create; under-threshold land in DRAFT.
 *   3. Status-transition graph is enforced for both quotations and sales
 *      orders. Illegal transitions raise StateTransitionError; stale
 *      expectedVersion raises ConflictError.
 *   4. REJECTED transitions require a reason (ValidationError otherwise).
 *   5. approve() stamps approved_by/approved_at and flips
 *      AWAITING_APPROVAL → APPROVED; refuses from any other state.
 *   6. convertToSalesOrder() runs in a single tx: creates the SO from the
 *      ACCEPTED quotation and flips the quotation to CONVERTED with
 *      converted_to_order_id populated; totals are copied verbatim.
 *   7. financeApprove() stamps finance_approved_by/finance_approved_at
 *      orthogonally to fulfillment status; refuses double-approve.
 *   8. getById() on an unknown id raises NotFoundError.
 *
 * Construction: we build the services directly against makeTestPool() and
 * hand-roll a minimal FastifyRequest stub with a RequestUser populated from
 * the dev seed user (SALES_MANAGER). No HTTP layer, so we don't need Fastify
 * running and any regression lands close to the failure site (same pattern
 * gate-23 uses for AuthService).
 *
 * Cleanup: each describe block owns rows by `company LIKE 'gate-26 %'`; the
 * beforeEach hook deletes them so reruns stay idempotent without leaking
 * fixtures into other gates that scan the quotations / sales_orders tables.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import pg from "pg";
import { QuotationsService } from "@mobilab/api/crm/quotations";
import { SalesOrdersService } from "@mobilab/api/crm/sales-orders";
import {
  AUDIENCE,
  type CreateQuotation,
  type CreateSalesOrder,
  type Permission,
  type Role,
} from "@mobilab/contracts";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@mobilab/errors";
import { withOrg } from "@mobilab/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

// Seed dev Sales Manager (has quotations:approve in the default role map).
// Matches 03-dev-org-users.sql.
const DEV_USER_ID = "00000000-0000-0000-0000-00000000b004";

/**
 * Minimal FastifyRequest stub good enough for withRequest + requireUser.
 * The services we exercise only read req.user — they don't touch headers,
 * URL, or any other fastify state. We shape the stub as a structural
 * RequestUser carrier and pass it in as Parameters<…>[0] of whichever
 * method we're calling. That lets us avoid a `fastify` dep on the gates
 * package (which is only an @mobilab/api dep transitively).
 */
type ServiceReq = Parameters<QuotationsService["create"]>[0];

function makeRequest(
  orgId: string = DEV_ORG_ID,
  userId: string = DEV_USER_ID,
): ServiceReq {
  return {
    user: {
      id: userId,
      orgId,
      email: "salesmgr@mobilab.local",
      roles: ["SALES_MANAGER"] as Role[],
      permissions: new Set<Permission>(),
      audience: AUDIENCE.internal,
    },
  } as unknown as ServiceReq;
}

/** Minimal line-item payload — 100 INR line, no discount/tax. */
const TRIVIAL_LINE = {
  productCode: "GATE26-SKU",
  productName: "Gate 26 Widget",
  quantity: 1,
  unitPrice: "100.00",
  discountPct: "0",
  taxPct: "0",
} as const;

describe("gate-26: quotations + sales-orders service integration", () => {
  let pool: pg.Pool;
  let quotations: QuotationsService;
  let salesOrders: SalesOrdersService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    quotations = new QuotationsService(pool);
    salesOrders = new SalesOrdersService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Scoped cleanup — only this gate's fixtures. The `company` column is
  // the stable handle; all fixtures below prefix with "gate-26 ".
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM quotations WHERE company LIKE 'gate-26 %'`,
      );
      await client.query(
        `DELETE FROM sales_orders WHERE company LIKE 'gate-26 %'`,
      );
    });
  });

  // ─── QuotationsService.create ───────────────────────────────────────────────

  describe("QuotationsService.create", () => {
    it("under-threshold quotation lands in DRAFT with computed totals", async () => {
      const input: CreateQuotation = {
        company: "gate-26 under-threshold",
        contactName: "Test Contact",
        lineItems: [
          {
            productCode: "SKU-UND",
            productName: "Under Widget",
            quantity: 10,
            unitPrice: "1000.00",
            discountPct: "0",
            taxPct: "18",
          },
        ],
      };
      const q = await quotations.create(makeRequest(), input);

      expect(q.status).toBe("DRAFT");
      expect(q.requiresApproval).toBe(false);
      // 10 × 1000 = 10000 subtotal; 18% tax = 1800; grand = 11800.
      expect(q.subtotal).toBe("10000.00");
      expect(q.taxAmount).toBe("1800.00");
      expect(q.grandTotal).toBe("11800.00");
      expect(q.lineItems).toHaveLength(1);
      expect(q.lineItems[0]!.lineTotal).toBe("11800.00");
      expect(q.lineItems[0]!.taxAmount).toBe("1800.00");
      expect(q.version).toBe(1);
    });

    it("over-threshold quotation auto-promotes to AWAITING_APPROVAL", async () => {
      const input: CreateQuotation = {
        company: "gate-26 over-threshold",
        contactName: "Big Contact",
        lineItems: [
          {
            productCode: "SKU-BIG",
            productName: "Enterprise Widget",
            quantity: 1,
            // Single line above the 500_000 INR threshold.
            unitPrice: "600000.00",
            discountPct: "0",
            taxPct: "0",
          },
        ],
      };
      const q = await quotations.create(makeRequest(), input);

      expect(q.status).toBe("AWAITING_APPROVAL");
      expect(q.requiresApproval).toBe(true);
      expect(q.grandTotal).toBe("600000.00");
    });

    it("handles discount + tax in computeTotals", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 discount+tax",
        contactName: "T",
        lineItems: [
          {
            productCode: "SKU-DT",
            productName: "Discount Widget",
            quantity: 5,
            unitPrice: "2000.00",
            // 10% off → line subtotal 9000; 18% tax on 9000 = 1620; total 10620.
            discountPct: "10",
            taxPct: "18",
          },
        ],
      });
      expect(q.subtotal).toBe("9000.00");
      expect(q.taxAmount).toBe("1620.00");
      expect(q.grandTotal).toBe("10620.00");
    });
  });

  // ─── QuotationsService.transitionStatus ─────────────────────────────────────

  describe("QuotationsService.transitionStatus", () => {
    it("allows DRAFT → SENT and bumps version", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 draft→sent",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      const sent = await quotations.transitionStatus(makeRequest(), q.id, {
        status: "SENT",
        expectedVersion: q.version,
      });
      expect(sent.status).toBe("SENT");
      expect(sent.version).toBe(q.version + 1);
    });

    it("rejects DRAFT → ACCEPTED as an illegal transition", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 illegal-tx",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      await expect(
        quotations.transitionStatus(makeRequest(), q.id, {
          status: "ACCEPTED",
          expectedVersion: q.version,
        }),
      ).rejects.toBeInstanceOf(StateTransitionError);
    });

    it("rejects stale expectedVersion with ConflictError", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 stale-version",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      await expect(
        quotations.transitionStatus(makeRequest(), q.id, {
          status: "SENT",
          expectedVersion: q.version + 99,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("requires a reason when transitioning to REJECTED", async () => {
      // Above threshold so it lands in AWAITING_APPROVAL, which allows
      // REJECTED.
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 reject-no-reason",
        contactName: "T",
        lineItems: [
          {
            productCode: "SKU-R",
            productName: "Reject Widget",
            quantity: 1,
            unitPrice: "600000.00",
            discountPct: "0",
            taxPct: "0",
          },
        ],
      });
      expect(q.status).toBe("AWAITING_APPROVAL");
      await expect(
        quotations.transitionStatus(makeRequest(), q.id, {
          status: "REJECTED",
          expectedVersion: q.version,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("accepts REJECTED transition when reason is supplied", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 reject-with-reason",
        contactName: "T",
        lineItems: [
          {
            productCode: "SKU-R2",
            productName: "Reject Widget 2",
            quantity: 1,
            unitPrice: "600000.00",
            discountPct: "0",
            taxPct: "0",
          },
        ],
      });
      const rejected = await quotations.transitionStatus(
        makeRequest(),
        q.id,
        {
          status: "REJECTED",
          expectedVersion: q.version,
          reason: "Customer decided against the order.",
        },
      );
      expect(rejected.status).toBe("REJECTED");
    });
  });

  // ─── QuotationsService.approve ──────────────────────────────────────────────

  describe("QuotationsService.approve", () => {
    it("stamps approvedBy/approvedAt and moves AWAITING_APPROVAL → APPROVED", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 approve-happy",
        contactName: "T",
        lineItems: [
          {
            productCode: "SKU-A",
            productName: "Approve Widget",
            quantity: 1,
            unitPrice: "600000.00",
            discountPct: "0",
            taxPct: "0",
          },
        ],
      });
      expect(q.status).toBe("AWAITING_APPROVAL");

      const approved = await quotations.approve(makeRequest(), q.id, {
        expectedVersion: q.version,
      });
      expect(approved.status).toBe("APPROVED");
      expect(approved.approvedBy).toBe(DEV_USER_ID);
      expect(approved.approvedAt).not.toBeNull();
      expect(approved.version).toBe(q.version + 1);
    });

    it("refuses to approve a DRAFT quotation", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 approve-wrong-status",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      expect(q.status).toBe("DRAFT");
      await expect(
        quotations.approve(makeRequest(), q.id, {
          expectedVersion: q.version,
        }),
      ).rejects.toBeInstanceOf(StateTransitionError);
    });
  });

  // ─── QuotationsService.convertToSalesOrder ──────────────────────────────────

  describe("QuotationsService.convertToSalesOrder", () => {
    it("creates a SO and flips the quotation to CONVERTED in one tx", async () => {
      const req = makeRequest();
      let q = await quotations.create(req, {
        company: "gate-26 convert-happy",
        contactName: "T",
        lineItems: [
          {
            productCode: "SKU-CONV",
            productName: "Convertible Widget",
            quantity: 5,
            unitPrice: "2000.00",
            discountPct: "10",
            taxPct: "18",
          },
        ],
      });
      expect(q.status).toBe("DRAFT");

      // DRAFT → SENT → ACCEPTED → CONVERTED
      q = await quotations.transitionStatus(req, q.id, {
        status: "SENT",
        expectedVersion: q.version,
      });
      q = await quotations.transitionStatus(req, q.id, {
        status: "ACCEPTED",
        expectedVersion: q.version,
      });
      expect(q.status).toBe("ACCEPTED");

      const { quotation, salesOrder } = await quotations.convertToSalesOrder(
        req,
        q.id,
        { expectedVersion: q.version },
      );
      expect(quotation.status).toBe("CONVERTED");
      expect(quotation.convertedToOrderId).toBe(salesOrder.id);
      expect(salesOrder.quotationId).toBe(quotation.id);
      expect(salesOrder.status).toBe("DRAFT");
      expect(salesOrder.company).toBe(quotation.company);
      expect(salesOrder.contactName).toBe(quotation.contactName);
      expect(salesOrder.lineItems).toHaveLength(1);
      // Totals are copied verbatim — grand_total must match to the paise.
      expect(salesOrder.subtotal).toBe(quotation.subtotal);
      expect(salesOrder.taxAmount).toBe(quotation.taxAmount);
      expect(salesOrder.grandTotal).toBe(quotation.grandTotal);
    });

    it("refuses to convert a DRAFT quotation", async () => {
      const q = await quotations.create(makeRequest(), {
        company: "gate-26 convert-wrong-status",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      await expect(
        quotations.convertToSalesOrder(makeRequest(), q.id, {
          expectedVersion: q.version,
        }),
      ).rejects.toBeInstanceOf(StateTransitionError);
    });
  });

  // ─── SalesOrdersService.create ──────────────────────────────────────────────

  describe("SalesOrdersService.create", () => {
    it("creates a sales order in DRAFT with computed totals", async () => {
      const input: CreateSalesOrder = {
        company: "gate-26 so-create",
        contactName: "Ship To",
        lineItems: [
          {
            productCode: "SKU-SO",
            productName: "SO Widget",
            quantity: 3,
            unitPrice: "500.00",
            discountPct: "0",
            taxPct: "18",
          },
        ],
      };
      const so = await salesOrders.create(makeRequest(), input);

      expect(so.status).toBe("DRAFT");
      expect(so.financeApprovedBy).toBeNull();
      expect(so.financeApprovedAt).toBeNull();
      // 3 × 500 = 1500 subtotal; 18% tax = 270; grand = 1770.
      expect(so.subtotal).toBe("1500.00");
      expect(so.taxAmount).toBe("270.00");
      expect(so.grandTotal).toBe("1770.00");
      expect(so.version).toBe(1);
    });
  });

  // ─── SalesOrdersService.transitionStatus ────────────────────────────────────

  describe("SalesOrdersService.transitionStatus", () => {
    it("walks DRAFT → CONFIRMED → PROCESSING", async () => {
      const req = makeRequest();
      let so = await salesOrders.create(req, {
        company: "gate-26 so-walk",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      so = await salesOrders.transitionStatus(req, so.id, {
        status: "CONFIRMED",
        expectedVersion: so.version,
      });
      expect(so.status).toBe("CONFIRMED");
      so = await salesOrders.transitionStatus(req, so.id, {
        status: "PROCESSING",
        expectedVersion: so.version,
      });
      expect(so.status).toBe("PROCESSING");
    });

    it("rejects DRAFT → DELIVERED as an illegal transition", async () => {
      const so = await salesOrders.create(makeRequest(), {
        company: "gate-26 so-illegal-tx",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      await expect(
        salesOrders.transitionStatus(makeRequest(), so.id, {
          status: "DELIVERED",
          expectedVersion: so.version,
        }),
      ).rejects.toBeInstanceOf(StateTransitionError);
    });

    it("rejects stale expectedVersion with ConflictError", async () => {
      const so = await salesOrders.create(makeRequest(), {
        company: "gate-26 so-stale-version",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      await expect(
        salesOrders.transitionStatus(makeRequest(), so.id, {
          status: "CONFIRMED",
          expectedVersion: so.version + 99,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // ─── SalesOrdersService.financeApprove ──────────────────────────────────────

  describe("SalesOrdersService.financeApprove", () => {
    it("stamps finance fields without changing fulfillment status", async () => {
      const so = await salesOrders.create(makeRequest(), {
        company: "gate-26 so-fin-approve",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      expect(so.status).toBe("DRAFT");

      const approved = await salesOrders.financeApprove(
        makeRequest(),
        so.id,
        { expectedVersion: so.version },
      );
      expect(approved.status).toBe("DRAFT"); // orthogonal to status
      expect(approved.financeApprovedBy).toBe(DEV_USER_ID);
      expect(approved.financeApprovedAt).not.toBeNull();
      expect(approved.version).toBe(so.version + 1);
    });

    it("refuses to double-finance-approve", async () => {
      const req = makeRequest();
      let so = await salesOrders.create(req, {
        company: "gate-26 so-dbl-approve",
        contactName: "T",
        lineItems: [TRIVIAL_LINE],
      });
      so = await salesOrders.financeApprove(req, so.id, {
        expectedVersion: so.version,
      });
      await expect(
        salesOrders.financeApprove(req, so.id, {
          expectedVersion: so.version,
        }),
      ).rejects.toBeInstanceOf(StateTransitionError);
    });
  });

  // ─── NotFound handling ──────────────────────────────────────────────────────

  describe("NotFound handling", () => {
    const FAKE_ID = "00000000-0000-0000-0000-00000000dead";

    it("quotations.getById raises NotFoundError for an unknown id", async () => {
      await expect(
        quotations.getById(makeRequest(), FAKE_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("salesOrders.getById raises NotFoundError for an unknown id", async () => {
      await expect(
        salesOrders.getById(makeRequest(), FAKE_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
