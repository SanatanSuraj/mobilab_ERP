/**
 * Quotations service.
 *
 * Responsibilities on top of the repo:
 *
 *   1. Compute subtotal/tax/grand-total from line items on every write.
 *      Values are decimal STRINGS end-to-end (Rule #1 — never Number()).
 *   2. Decide `requires_approval` = grandTotal > APPROVAL_THRESHOLD_INR.
 *      Quotations over threshold land in AWAITING_APPROVAL on create;
 *      under-threshold land in DRAFT.
 *   3. Enforce the status transition graph:
 *        DRAFT             → AWAITING_APPROVAL | APPROVED | SENT
 *                              (auto-promote to APPROVED when under threshold
 *                               on a re-send; manual for now)
 *        AWAITING_APPROVAL → APPROVED | REJECTED
 *        APPROVED          → SENT | EXPIRED
 *        SENT              → ACCEPTED | REJECTED | EXPIRED
 *        ACCEPTED          → CONVERTED         (via `convertToSalesOrder`)
 *        REJECTED | EXPIRED | CONVERTED → (terminal)
 *   4. Block header edits once a quotation leaves DRAFT/AWAITING_APPROVAL —
 *      late edits would invalidate customer-facing content. Clone-to-new
 *      is the Phase 3 escape hatch.
 *
 * Convert flow: `convertToSalesOrder` accepts an expectedVersion + optional
 * expectedDelivery, creates a SalesOrder with the exact line items, then
 * flips the quotation to CONVERTED stamped with the new order id. Both
 * writes happen in the same transaction.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import { Decimal } from "@instigenie/money";
import type {
  ApproveQuotation,
  ConvertQuotation,
  CreateQuotation,
  CreateQuotationLineItem,
  Quotation,
  QuotationListQuerySchema,
  QuotationStatus,
  SalesOrder,
  TransitionQuotationStatus,
  UpdateQuotation,
} from "@instigenie/contracts";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { enqueueOutbox } from "@instigenie/db";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import {
  quotationsRepo,
  type ComputedLineItem,
} from "./quotations.repository.js";
import { salesOrdersRepo } from "./sales-orders.repository.js";
import { requireUser } from "../../context/request-context.js";

type QuotationListQuery = z.infer<typeof QuotationListQuerySchema>;

const QUOTATION_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  quotationNumber: "quotation_number",
  grandTotal: "grand_total",
  validUntil: "valid_until",
};

/**
 * Any quotation with grand_total above this triggers AWAITING_APPROVAL on
 * create. Phase 2 constant; Phase 3 will pull from tenant settings.
 * 500_000 INR ≈ ₹5 lakh.
 */
const APPROVAL_THRESHOLD_INR = new Decimal("500000");

const ALLOWED_STATUS_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: ["AWAITING_APPROVAL", "APPROVED", "SENT", "EXPIRED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["SENT", "EXPIRED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: ["CONVERTED"],
  REJECTED: [],
  EXPIRED: [],
  CONVERTED: [],
};

const HEADER_EDITABLE_STATES: ReadonlySet<QuotationStatus> = new Set([
  "DRAFT",
  "AWAITING_APPROVAL",
]);

interface ComputedTotals {
  subtotal: string;
  taxAmount: string;
  grandTotal: string;
  requiresApproval: boolean;
  lineItems: ComputedLineItem[];
}

/**
 * Compute line_total and tax_amount per line, then roll up header totals.
 * All math is in Decimal to avoid float drift.
 */
function computeTotals(items: CreateQuotationLineItem[]): ComputedTotals {
  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);
  const out: ComputedLineItem[] = items.map((it) => {
    const qty = new Decimal(it.quantity);
    const price = new Decimal(it.unitPrice);
    const discount = new Decimal(it.discountPct);
    const tax = new Decimal(it.taxPct);
    // line subtotal BEFORE tax: qty × price × (1 - discount/100)
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
    requiresApproval: grandTotal.greaterThan(APPROVAL_THRESHOLD_INR),
    lineItems: out,
  };
}

export class QuotationsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: QuotationListQuery,
  ): Promise<ReturnType<typeof paginated<Quotation>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, QUOTATION_SORTS, "createdAt");
      const { data, total } = await quotationsRepo.list(
        client,
        {
          status: query.status,
          accountId: query.accountId,
          dealId: query.dealId,
          requiresApproval: query.requiresApproval,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Quotation> {
    return withRequest(req, this.pool, async (client) => {
      const row = await quotationsRepo.getById(client, id);
      if (!row) throw new NotFoundError("quotation");
      return row;
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateQuotation,
  ): Promise<Quotation> {
    const user = requireUser(req);
    const totals = computeTotals(input.lineItems);
    return withRequest(req, this.pool, async (client) => {
      return quotationsRepo.create(client, user.orgId, {
        dealId: input.dealId ?? null,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        company: input.company,
        contactName: input.contactName,
        validUntil: input.validUntil ?? null,
        notes: input.notes ?? null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        grandTotal: totals.grandTotal,
        requiresApproval: totals.requiresApproval,
        status: totals.requiresApproval ? "AWAITING_APPROVAL" : "DRAFT",
        lineItems: totals.lineItems,
      });
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateQuotation,
  ): Promise<Quotation> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await quotationsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("quotation");
      if (!HEADER_EDITABLE_STATES.has(cur.status)) {
        throw new StateTransitionError(
          `cannot edit a quotation in status ${cur.status}; clone it instead`,
        );
      }

      // If line items are part of this update, recompute totals and pass
      // them through as a replacement set.
      let replaceLineItems: ComputedLineItem[] | undefined;
      let subtotal: string | undefined;
      let taxAmount: string | undefined;
      let grandTotal: string | undefined;
      let requiresApproval: boolean | undefined;
      if (input.lineItems) {
        const totals = computeTotals(input.lineItems);
        replaceLineItems = totals.lineItems;
        subtotal = totals.subtotal;
        taxAmount = totals.taxAmount;
        grandTotal = totals.grandTotal;
        requiresApproval = totals.requiresApproval;
      }

      const result = await quotationsRepo.updateWithVersion(client, id, {
        ...input,
        ...(subtotal !== undefined ? { subtotal } : {}),
        ...(taxAmount !== undefined ? { taxAmount } : {}),
        ...(grandTotal !== undefined ? { grandTotal } : {}),
        ...(requiresApproval !== undefined ? { requiresApproval } : {}),
        ...(replaceLineItems !== undefined ? { replaceLineItems } : {}),
      });
      if (result === null) throw new NotFoundError("quotation");
      if (result === "version_conflict") {
        throw new ConflictError("quotation was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await quotationsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("quotation");
    });
  }

  async transitionStatus(
    req: FastifyRequest,
    id: string,
    input: TransitionQuotationStatus,
  ): Promise<Quotation> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await quotationsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("quotation");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("quotation was modified by someone else");
      }
      const allowed = ALLOWED_STATUS_TRANSITIONS[cur.status];
      if (!allowed.includes(input.status)) {
        throw new StateTransitionError(
          `cannot transition quotation from ${cur.status} to ${input.status}`,
        );
      }
      if (input.status === "REJECTED" && !input.reason) {
        throw new ValidationError("reason is required for REJECTED");
      }
      const result = await quotationsRepo.transitionStatus(client, id, {
        status: input.status,
        expectedVersion: input.expectedVersion,
        rejectedReason: input.reason ?? null,
      });
      if (result === null) throw new NotFoundError("quotation");
      if (result === "version_conflict") {
        throw new ConflictError("quotation was modified by someone else");
      }
      // Transitioning INTO `SENT` fires the outbound email pipeline.
      // The row lands in the same txn as the status flip, so either both
      // commit or neither — no "status says SENT but no email queued".
      // The idempotency key includes the post-transition version so retries
      // from the client can't enqueue a second email for the same send.
      if (input.status === "SENT") {
        await enqueueOutbox(client, {
          aggregateType: "quotation",
          aggregateId: id,
          eventType: "quotation.sent",
          payload: {
            orgId: result.orgId,
            quotationId: id,
            quotationVersion: result.version,
          },
          idempotencyKey: `quotation.sent:${id}:v${result.version}`,
        });
      }
      return result;
    });
  }

  /**
   * Sales-manager approval. Enters APPROVED from AWAITING_APPROVAL, stamps
   * approved_by/approved_at. Enforced separately from generic status
   * transition because it carries an identity + requires a dedicated
   * permission (`quotations:approve`).
   */
  async approve(
    req: FastifyRequest,
    id: string,
    input: ApproveQuotation,
  ): Promise<Quotation> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await quotationsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("quotation");
      if (cur.status !== "AWAITING_APPROVAL") {
        throw new StateTransitionError(
          `can only approve a quotation in AWAITING_APPROVAL; it is ${cur.status}`,
        );
      }
      const result = await quotationsRepo.approve(client, id, {
        approverId: user.id,
        expectedVersion: input.expectedVersion,
      });
      if (result === null) throw new NotFoundError("quotation");
      if (result === "version_conflict") {
        throw new ConflictError("quotation was modified by someone else");
      }
      return result;
    });
  }

  /**
   * Quotation → SalesOrder promotion. Must be in ACCEPTED. Creates the SO
   * inside the same tx, copies line items verbatim, then flips the
   * quotation to CONVERTED stamped with the new order id.
   */
  async convertToSalesOrder(
    req: FastifyRequest,
    id: string,
    input: ConvertQuotation,
  ): Promise<{ quotation: Quotation; salesOrder: SalesOrder }> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await quotationsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("quotation");
      if (cur.status !== "ACCEPTED") {
        throw new StateTransitionError(
          `can only convert an ACCEPTED quotation; it is ${cur.status}`,
        );
      }
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("quotation was modified by someone else");
      }

      // Create the SO. Line items are copied as-is — totals are already
      // computed and stored on the quotation header.
      const salesOrder = await salesOrdersRepo.create(client, user.orgId, {
        quotationId: cur.id,
        accountId: cur.accountId,
        contactId: cur.contactId,
        company: cur.company,
        contactName: cur.contactName,
        expectedDelivery: input.expectedDelivery ?? null,
        notes: cur.notes,
        subtotal: cur.subtotal,
        taxAmount: cur.taxAmount,
        grandTotal: cur.grandTotal,
        lineItems: cur.lineItems.map((li) => ({
          productCode: li.productCode,
          productName: li.productName,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          discountPct: li.discountPct,
          taxPct: li.taxPct,
          lineTotal: li.lineTotal,
          taxAmount: li.taxAmount,
        })),
      });

      const marked = await quotationsRepo.markConverted(client, id, {
        orderId: salesOrder.id,
        expectedVersion: cur.version,
      });
      if (marked === null) throw new NotFoundError("quotation");
      if (marked === "version_conflict") {
        throw new ConflictError("quotation was modified by someone else");
      }

      return { quotation: marked, salesOrder };
    });
  }
}
