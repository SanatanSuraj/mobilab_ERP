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
 * Two entry surfaces:
 *   - Direct: `/procurement/purchase-orders/:id/{approve,reject}` →
 *     `approve()` / `reject()`. Caller-supplied expectedVersion. No
 *     approval_request created — callers using this path bypass the
 *     central approvals workflow.
 *   - Routed via approvals: `/procurement/purchase-orders/:id/submit-for-approval`
 *     → `submitForApproval()` opens an approval_request; the eventual
 *     decision arrives through `/approvals/:id/act`, which calls
 *     `applyDecisionFromApprovals()` to flip the PO header.
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
  SubmitPurchaseOrderForApproval,
} from "@instigenie/contracts";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import { withRequest } from "../shared/with-request.js";
import { requireUser } from "../../context/request-context.js";
import { purchaseOrdersRepo } from "./purchase-orders.repository.js";
import { poApprovalsRepo } from "./po-approvals.repository.js";
import type {
  ApprovalsService,
  ApprovalFinaliserContext,
} from "../approvals/approvals.service.js";

/** Statuses from which an approve/reject action is permitted. */
const APPROVABLE_FROM: ReadonlySet<PoStatus> = new Set([
  "DRAFT",
  "PENDING_APPROVAL",
]);

export interface PoApprovalsServiceDeps {
  pool: pg.Pool;
  /**
   * Required to dispatch into `/approvals/*` on submit-for-approval.
   * Optional in the deps shape so the legacy single-arg `pool` constructor
   * still compiles; when absent, `submitForApproval()` throws a clear
   * boot-time error rather than silently skipping the approval row.
   */
  approvals?: ApprovalsService;
}

function isPoApprovalsServiceDeps(
  x: PoApprovalsServiceDeps | pg.Pool,
): x is PoApprovalsServiceDeps {
  return typeof x === "object" && x !== null && "pool" in x;
}

export class PoApprovalsService {
  private readonly pool: pg.Pool;
  private readonly approvals: ApprovalsService | null;

  // Two accepted shapes for backward compatibility with any caller that
  // still passes a bare pool. Phase 1 §approvals-dispatch wires
  // `approvals` so the submit-for-approval flow has a place to write the
  // approval_request inside the same transaction.
  constructor(deps: PoApprovalsServiceDeps | pg.Pool) {
    if (isPoApprovalsServiceDeps(deps)) {
      this.pool = deps.pool;
      this.approvals = deps.approvals ?? null;
    } else {
      this.pool = deps;
      this.approvals = null;
    }
  }

  async approve(
    req: FastifyRequest,
    poId: string,
    input: ApprovePurchaseOrder,
  ): Promise<PurchaseOrder> {
    return this.transition(req, poId, "APPROVE", "APPROVED", {
      expectedVersion: input.expectedVersion,
      remarks: input.remarks ?? null,
    });
  }

  async reject(
    req: FastifyRequest,
    poId: string,
    input: RejectPurchaseOrder,
  ): Promise<PurchaseOrder> {
    return this.transition(req, poId, "REJECT", "REJECTED", {
      expectedVersion: input.expectedVersion,
      remarks: input.remarks,
    });
  }

  async getApprovalHistory(
    req: FastifyRequest,
    poId: string,
  ): Promise<PoApprovalHistory> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, poId);
      if (!header) throw new NotFoundError("purchase order");
      const data = await poApprovalsRepo.listForPo(client, poId);
      return { poId, data };
    });
  }

  /**
   * Flip a DRAFT PO to PENDING_APPROVAL and open a central
   * approval_request for it. Both writes happen in one transaction so
   * the PO never sits in PENDING_APPROVAL without a backing approval_request,
   * and a missing chain configuration aborts the whole submit (no half
   * state).
   *
   * Approval band lookup uses the PO's `grand_total` against the
   * `purchase_order` chain definition's min/max amount columns.
   */
  async submitForApproval(
    req: FastifyRequest,
    poId: string,
    input: SubmitPurchaseOrderForApproval,
  ): Promise<PurchaseOrder> {
    if (!this.approvals) {
      throw new ValidationError(
        "approvals service is not wired — submit-for-approval is unavailable",
      );
    }
    const approvals = this.approvals;
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, poId);
      if (!header) throw new NotFoundError("purchase order");
      if (header.status !== "DRAFT") {
        throw new StateTransitionError(
          `cannot submit a purchase order in status ${header.status} for approval`,
          { from: header.status, action: "SUBMIT", allowedFrom: ["DRAFT"] },
        );
      }

      // Open the approval_request first. If chain resolution fails or a
      // duplicate PENDING request already exists for this PO, we abort
      // BEFORE touching the PO header — leaving status as DRAFT.
      await approvals.createRequestForEntity(client, user, {
        entityType: "purchase_order",
        entityId: poId,
        amount: header.grandTotal,
        currency: header.currency,
        notes: input.notes,
      });

      // Now flip the PO header. OCC guards against a concurrent edit
      // between the user's GET and POST.
      const updated = await purchaseOrdersRepo.updateWithVersion(client, poId, {
        status: "PENDING_APPROVAL",
        expectedVersion: input.expectedVersion,
      });
      if (updated === null) throw new NotFoundError("purchase order");
      if (updated === "version_conflict") {
        throw new ConflictError(
          "purchase order was modified by someone else",
        );
      }
      return updated;
    });
  }

  /**
   * Finaliser called by `ApprovalsService.act()` once a `purchase_order`
   * approval_request reaches APPROVED or REJECTED. Runs inside the
   * caller's transaction. Mirrors the post-state-change side effects of
   * `transition()` (status flip, denormalised approved_by/_at on
   * APPROVE, append po_approvals audit row) without reading
   * `expectedVersion` — the approvals layer is the source of truth for
   * the action, so OCC against the user's local PO snapshot is not the
   * right gate here.
   */
  async applyDecisionFromApprovals(
    client: pg.PoolClient,
    ctx: ApprovalFinaliserContext,
  ): Promise<void> {
    const { request, finalStatus, actor, comment } = ctx;
    const header = await purchaseOrdersRepo.getById(client, request.entityId);
    if (!header) {
      throw new NotFoundError("purchase order");
    }
    if (!APPROVABLE_FROM.has(header.status)) {
      throw new StateTransitionError(
        `cannot ${finalStatus.toLowerCase()} a purchase order in status ${header.status}`,
        {
          from: header.status,
          action: finalStatus,
          allowedFrom: [...APPROVABLE_FROM],
        },
      );
    }

    await client.query(
      `UPDATE purchase_orders
          SET status     = $2,
              version    = version + 1,
              updated_at = now()
        WHERE id = $1`,
      [header.id, finalStatus],
    );

    if (finalStatus === "APPROVED") {
      await client.query(
        `UPDATE purchase_orders
            SET approved_by = $2, approved_at = now()
          WHERE id = $1`,
        [header.id, actor.id],
      );
    }

    await poApprovalsRepo.insertEntry(client, {
      orgId: actor.orgId,
      poId: header.id,
      action: finalStatus === "APPROVED" ? "APPROVE" : "REJECT",
      userId: actor.id,
      priorStatus: header.status,
      newStatus: finalStatus,
      remarks: comment,
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async transition(
    req: FastifyRequest,
    poId: string,
    action: "APPROVE" | "REJECT",
    target: Extract<PoStatus, "APPROVED" | "REJECTED">,
    args: { expectedVersion: number; remarks: string | null },
  ): Promise<PurchaseOrder> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, poId);
      if (!header) throw new NotFoundError("purchase order");

      if (!APPROVABLE_FROM.has(header.status)) {
        throw new StateTransitionError(
          `cannot ${action.toLowerCase()} a purchase order in status ${header.status}`,
          { from: header.status, action, allowedFrom: [...APPROVABLE_FROM] },
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
          "purchase order was modified by someone else",
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
          [poId, user.id],
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
        },
      );
      // Reference the audit row id so eslint/no-unused-vars stays
      // satisfied without a leading underscore rename.
      void auditEntry;

      // Re-read the header so the response reflects approved_by / approved_at
      // (denormalised above) and the bumped version.
      const fresh = await purchaseOrdersRepo.getById(client, poId);
      return fresh ?? updated;
    });
  }
}
