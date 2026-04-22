/**
 * Sales Orders service.
 *
 * Responsibilities on top of the repo:
 *
 *   1. Compute subtotal/tax/grand-total from line items on every write.
 *      Values are decimal STRINGS end-to-end (Rule #1 — never Number()).
 *   2. Enforce the fulfillment status transition graph:
 *        DRAFT       → CONFIRMED | CANCELLED
 *        CONFIRMED   → PROCESSING | CANCELLED
 *        PROCESSING  → DISPATCHED | CANCELLED
 *        DISPATCHED  → IN_TRANSIT
 *        IN_TRANSIT  → DELIVERED
 *        DELIVERED   → (terminal)
 *        CANCELLED   → (terminal)
 *   3. Block header edits once an order leaves DRAFT/CONFIRMED — once an
 *      order is being fulfilled, header edits are dangerous (shipping
 *      addresses, line items racing with warehouse picks).
 *   4. Finance approval is an orthogonal flag, not a status step. An order
 *      can progress through fulfillment while finance signs off in parallel.
 *
 * Sales orders are also created by quotations.service.convertToSalesOrder
 * which calls salesOrdersRepo.create directly inside the quotation's tx.
 * That path is NOT covered by this service's `create` method — the
 * quotation's service layer is responsible for feeding the repo the
 * pre-computed totals, which is why ComputedSalesOrderLineItem exists in
 * the repo (shared contract).
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import { Decimal } from "@instigenie/money";
import type {
  CreateSalesOrder,
  CreateSalesOrderLineItem,
  FinanceApproveSalesOrder,
  SalesOrder,
  SalesOrderListQuerySchema,
  SalesOrderStatus,
  TransitionSalesOrderStatus,
  UpdateSalesOrder,
} from "@instigenie/contracts";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
} from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import {
  salesOrdersRepo,
  type ComputedSalesOrderLineItem,
} from "./sales-orders.repository.js";
import { requireUser } from "../../context/request-context.js";

type SalesOrderListQuery = z.infer<typeof SalesOrderListQuerySchema>;

const SALES_ORDER_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  orderNumber: "order_number",
  grandTotal: "grand_total",
  expectedDelivery: "expected_delivery",
};

const ALLOWED_STATUS_TRANSITIONS: Record<
  SalesOrderStatus,
  SalesOrderStatus[]
> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["IN_TRANSIT"],
  IN_TRANSIT: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

const HEADER_EDITABLE_STATES: ReadonlySet<SalesOrderStatus> = new Set([
  "DRAFT",
  "CONFIRMED",
]);

interface ComputedTotals {
  subtotal: string;
  taxAmount: string;
  grandTotal: string;
  lineItems: ComputedSalesOrderLineItem[];
}

/**
 * Compute line_total and tax_amount per line, then roll up header totals.
 * All math is in Decimal to avoid float drift.
 */
function computeTotals(items: CreateSalesOrderLineItem[]): ComputedTotals {
  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);
  const out: ComputedSalesOrderLineItem[] = items.map((it) => {
    const qty = new Decimal(it.quantity);
    const price = new Decimal(it.unitPrice);
    const discount = new Decimal(it.discountPct);
    const tax = new Decimal(it.taxPct);
    const lineSubtotal = qty
      .mul(price)
      .mul(new Decimal(100).minus(discount).div(100));
    const lineTax = lineSubtotal.mul(tax).div(100);
    const lineTotal = lineSubtotal.plus(lineTax);
    subtotal = subtotal.plus(lineSubtotal);
    taxAmount = taxAmount.plus(lineTax);
    return {
      ...it,
      lineTotal: lineTotal.toFixed(2),
      taxAmount: lineTax.toFixed(2),
    };
  });
  const grandTotal = subtotal.plus(taxAmount);
  return {
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    lineItems: out,
  };
}

export class SalesOrdersService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: SalesOrderListQuery,
  ): Promise<ReturnType<typeof paginated<SalesOrder>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, SALES_ORDER_SORTS, "createdAt");
      const { data, total } = await salesOrdersRepo.list(
        client,
        {
          status: query.status,
          accountId: query.accountId,
          quotationId: query.quotationId,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<SalesOrder> {
    return withRequest(req, this.pool, async (client) => {
      const row = await salesOrdersRepo.getById(client, id);
      if (!row) throw new NotFoundError("sales order");
      return row;
    });
  }

  /**
   * Standalone sales order creation. Distinct from the convertToSalesOrder
   * path in quotations.service.ts, which skips this method entirely and
   * calls salesOrdersRepo.create directly.
   */
  async create(
    req: FastifyRequest,
    input: CreateSalesOrder,
  ): Promise<SalesOrder> {
    const user = requireUser(req);
    const totals = computeTotals(input.lineItems);
    return withRequest(req, this.pool, async (client) => {
      return salesOrdersRepo.create(client, user.orgId, {
        quotationId: input.quotationId ?? null,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        company: input.company,
        contactName: input.contactName,
        expectedDelivery: input.expectedDelivery ?? null,
        notes: input.notes ?? null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        grandTotal: totals.grandTotal,
        lineItems: totals.lineItems,
      });
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateSalesOrder,
  ): Promise<SalesOrder> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await salesOrdersRepo.getById(client, id);
      if (!cur) throw new NotFoundError("sales order");
      if (!HEADER_EDITABLE_STATES.has(cur.status)) {
        throw new StateTransitionError(
          `cannot edit a sales order in status ${cur.status}`,
        );
      }

      let replaceLineItems: ComputedSalesOrderLineItem[] | undefined;
      let subtotal: string | undefined;
      let taxAmount: string | undefined;
      let grandTotal: string | undefined;
      if (input.lineItems) {
        const totals = computeTotals(input.lineItems);
        replaceLineItems = totals.lineItems;
        subtotal = totals.subtotal;
        taxAmount = totals.taxAmount;
        grandTotal = totals.grandTotal;
      }

      const result = await salesOrdersRepo.updateWithVersion(client, id, {
        ...input,
        ...(subtotal !== undefined ? { subtotal } : {}),
        ...(taxAmount !== undefined ? { taxAmount } : {}),
        ...(grandTotal !== undefined ? { grandTotal } : {}),
        ...(replaceLineItems !== undefined ? { replaceLineItems } : {}),
      });
      if (result === null) throw new NotFoundError("sales order");
      if (result === "version_conflict") {
        throw new ConflictError(
          "sales order was modified by someone else",
        );
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await salesOrdersRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("sales order");
    });
  }

  async transitionStatus(
    req: FastifyRequest,
    id: string,
    input: TransitionSalesOrderStatus,
  ): Promise<SalesOrder> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await salesOrdersRepo.getById(client, id);
      if (!cur) throw new NotFoundError("sales order");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError(
          "sales order was modified by someone else",
        );
      }
      const allowed = ALLOWED_STATUS_TRANSITIONS[cur.status];
      if (!allowed.includes(input.status)) {
        throw new StateTransitionError(
          `cannot transition sales order from ${cur.status} to ${input.status}`,
        );
      }
      const result = await salesOrdersRepo.transitionStatus(client, id, {
        status: input.status,
        expectedVersion: input.expectedVersion,
      });
      if (result === null) throw new NotFoundError("sales order");
      if (result === "version_conflict") {
        throw new ConflictError(
          "sales order was modified by someone else",
        );
      }
      return result;
    });
  }

  /**
   * Finance approval. Orthogonal to fulfillment status — stamps
   * finance_approved_by/finance_approved_at without changing status.
   * Requires the dedicated `sales_orders:approve_finance` permission.
   */
  async financeApprove(
    req: FastifyRequest,
    id: string,
    input: FinanceApproveSalesOrder,
  ): Promise<SalesOrder> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await salesOrdersRepo.getById(client, id);
      if (!cur) throw new NotFoundError("sales order");
      if (cur.financeApprovedBy) {
        throw new StateTransitionError(
          "sales order is already finance-approved",
        );
      }
      const result = await salesOrdersRepo.financeApprove(client, id, {
        approverId: user.id,
        expectedVersion: input.expectedVersion,
      });
      if (result === null) throw new NotFoundError("sales order");
      if (result === "version_conflict") {
        throw new ConflictError(
          "sales order was modified by someone else",
        );
      }
      return result;
    });
  }
}
