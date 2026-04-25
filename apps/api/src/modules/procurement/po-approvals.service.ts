/**
 * PO approvals service. Owns the approve / reject state machine and the
 * audit-history read.
 *
 * State transitions:
 *   APPROVE: { DRAFT, PENDING_APPROVAL } → APPROVED
 *   REJECT:  { DRAFT, PENDING_APPROVAL } → REJECTED
 *   anything else → StateTransitionError (409)
 *
 * Concurrency: callers pass `expectedVersion`; we route through
 * purchaseOrdersRepo.updateWithVersion so a stale UI submit fails with
 * the same `conflict` (409) the rest of the procurement surface uses.
 *
 * On APPROVE we *also* denormalise approved_by/approved_at onto the
 * header so list views stay single-trip; the po_approvals row is the
 * full audit trail.
 *
 * Outbox: emits `po.approved` / `po.rejected` so downstream automations
 * (Track 2 vendor advance posting, notifications) can react without
 * polling.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  ApprovePurchaseOrder,
  PoApproval,
  PoApprovalHistory,
  PoStatus,
  PurchaseOrder,
  RejectPurchaseOrder,
} from "@instigenie/contracts";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
} from "@instigenie/errors";
import { enqueueOutbox } from "@instigenie/db";
import { withRequest } from "../shared/with-request.js";
import { requireUser } from "../../context/request-context.js";
import { purchaseOrdersRepo } from "./purchase-orders.repository.js";
import { poApprovalsRepo } from "./po-approvals.repository.js";

/** Statuses from which an approve/reject action is permitted. */
const APPROVABLE_FROM: ReadonlySet<PoStatus> = new Set([
  "DRAFT",
  "PENDING_APPROVAL",
]);

export class PoApprovalsService {
  constructor(private readonly pool: pg.Pool) {}

  async approve(
    req: FastifyRequest,
    poId: string,
    input: ApprovePurchaseOrder
  ): Promise<PurchaseOrder> {
    return this.transition(req, poId, "APPROVE", "APPROVED", {
      expectedVersion: input.expectedVersion,
      remarks: input.remarks ?? null,
    });
  }

  async reject(
    req: FastifyRequest,
    poId: string,
    input: RejectPurchaseOrder
  ): Promise<PurchaseOrder> {
    return this.transition(req, poId, "REJECT", "REJECTED", {
      expectedVersion: input.expectedVersion,
      remarks: input.remarks,
    });
  }

  async getApprovalHistory(
    req: FastifyRequest,
    poId: string
  ): Promise<PoApprovalHistory> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, poId);
      if (!header) throw new NotFoundError("purchase order");
      const data = await poApprovalsRepo.listForPo(client, poId);
      return { poId, data };
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async transition(
    req: FastifyRequest,
    poId: string,
    action: "APPROVE" | "REJECT",
    target: Extract<PoStatus, "APPROVED" | "REJECTED">,
    args: { expectedVersion: number; remarks: string | null }
  ): Promise<PurchaseOrder> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, poId);
      if (!header) throw new NotFoundError("purchase order");

      if (!APPROVABLE_FROM.has(header.status)) {
        throw new StateTransitionError(
          `cannot ${action.toLowerCase()} a purchase order in status ${header.status}`,
          { from: header.status, action, allowedFrom: [...APPROVABLE_FROM] }
        );
      }

      // Optimistic concurrency — same code path as every other PO mutation.
      const updated = await purchaseOrdersRepo.updateWithVersion(client, poId, {
        status: target,
        expectedVersion: args.expectedVersion,
      });
      if (updated === null) throw new NotFoundError("purchase order");
      if (updated === "version_conflict") {
        throw new ConflictError(
          "purchase order was modified by someone else"
        );
      }

      // Denormalise approved_by/approved_at on APPROVE so list/detail
      // reads don't need to join po_approvals. We deliberately don't
      // stamp these on REJECT — `approved_*` should stay null for a PO
      // that was never approved; the rejection trail lives in po_approvals.
      if (target === "APPROVED") {
        await client.query(
          `UPDATE purchase_orders
              SET approved_by = $2, approved_at = now(), updated_at = now()
            WHERE id = $1`,
          [poId, user.id]
        );
      }

      const auditEntry: PoApproval = await poApprovalsRepo.insertEntry(
        client,
        {
          orgId: user.orgId,
          poId,
          action,
          userId: user.id,
          priorStatus: header.status,
          newStatus: target,
          remarks: args.remarks,
        }
      );

      await enqueueOutbox(client, {
        aggregateType: "purchase_order",
        aggregateId: poId,
        eventType: action === "APPROVE" ? "po.approved" : "po.rejected",
        payload: {
          orgId: user.orgId,
          poId,
          poNumber: header.poNumber,
          vendorId: header.vendorId,
          priorStatus: header.status,
          newStatus: target,
          actorId: user.id,
          remarks: args.remarks,
          totalValue: header.grandTotal,
          currency: header.currency,
        },
        idempotencyKey: `po.${action.toLowerCase()}:${auditEntry.id}`,
      });

      // Re-read the header so the response reflects approved_by / approved_at
      // (denormalised above) and the bumped version.
      const fresh = await purchaseOrdersRepo.getById(client, poId);
      return fresh ?? updated;
    });
  }
}
