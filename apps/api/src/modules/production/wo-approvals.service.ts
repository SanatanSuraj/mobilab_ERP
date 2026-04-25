/**
 * Work-order approvals service.
 *
 * Mirrors PoApprovalsService one-for-one: a thin orchestrator that sits
 * between the `/production/work-orders/:id/submit-for-approval` route and
 * the central ApprovalsService, plus a finaliser called back when the
 * approval reaches a terminal status.
 *
 * Why a separate service instead of folding into WorkOrdersService:
 *   - WorkOrdersService is constructed BEFORE ApprovalsService in the
 *     bootstrap (it has no approvals dependency), so adding approvals
 *     there would force a refactor of every test that hand-rolls the
 *     service tree.
 *   - The PO module has the same shape (PoApprovalsService alongside
 *     PurchaseOrdersService) — copying that pattern keeps the codebase
 *     uniform.
 *
 * State transitions (idempotent finaliser calls notwithstanding):
 *   submitForApproval(): PLANNED → PLANNED + opens approval_request
 *                        (WO status stays PLANNED while pending — there
 *                        is no AWAITING_APPROVAL state in WoStatus, the
 *                        approval_request itself carries the pending bit).
 *   APPROVED finaliser : PLANNED → MATERIAL_CHECK
 *   REJECTED finaliser : PLANNED → CANCELLED
 *
 * The chain bands are seeded against `work_order` in
 * ops/sql/seed/14-approvals-dev-data.sql; the caller supplies an
 * estimatedValue at submit time because the WO row has no native money
 * column (it has quantity, not value).
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  SubmitWorkOrderForApproval,
  WorkOrder,
  WoStatus,
} from "@instigenie/contracts";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import { withRequest } from "../shared/with-request.js";
import { requireUser } from "../../context/request-context.js";
import { workOrdersRepo } from "./work-orders.repository.js";
import type {
  ApprovalsService,
  ApprovalFinaliserContext,
} from "../approvals/approvals.service.js";

/**
 * The only WO status from which submit-for-approval and the eventual
 * finaliser are allowed to act. Anything past PLANNED has already been
 * released for production; an approval landing late on an in-flight WO
 * would be a workflow bug.
 */
const APPROVABLE_FROM: ReadonlySet<WoStatus> = new Set(["PLANNED"]);

/** Map of approval decision → resulting WO status. */
const DECISION_TARGET: Record<"APPROVED" | "REJECTED", WoStatus> = {
  APPROVED: "MATERIAL_CHECK",
  REJECTED: "CANCELLED",
};

export interface WoApprovalsServiceDeps {
  pool: pg.Pool;
  approvals: ApprovalsService;
}

export class WoApprovalsService {
  private readonly pool: pg.Pool;
  private readonly approvals: ApprovalsService;

  constructor(deps: WoApprovalsServiceDeps) {
    this.pool = deps.pool;
    this.approvals = deps.approvals;
  }

  /**
   * Open a `work_order` approval_request for a PLANNED WO. The WO header
   * stays in PLANNED while the request is pending; the finaliser flips
   * status on the eventual decision.
   *
   * Atomicity: the createRequestForEntity write and the version-bump on
   * the WO header (so OCC catches the second submit) happen in one
   * transaction. If chain resolution fails or a duplicate PENDING
   * request already exists for this WO, the WO header stays untouched.
   */
  async submitForApproval(
    req: FastifyRequest,
    woId: string,
    input: SubmitWorkOrderForApproval,
  ): Promise<WorkOrder> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await workOrdersRepo.getById(client, woId);
      if (!header) throw new NotFoundError("work order");
      if (!APPROVABLE_FROM.has(header.status)) {
        throw new StateTransitionError(
          `cannot submit a work order in status ${header.status} for approval`,
          {
            from: header.status,
            action: "SUBMIT",
            allowedFrom: [...APPROVABLE_FROM],
          },
        );
      }

      // Open the approval_request first. Chain resolution + uniqueness
      // are enforced inside the approvals service; we just propagate
      // their errors. NOTE: amount is the caller's estimated production
      // value, NOT a stored column on the WO.
      await this.approvals.createRequestForEntity(client, user, {
        entityType: "work_order",
        entityId: woId,
        amount: input.estimatedValue,
        currency: input.currency,
        notes: input.notes,
      });

      // Bump the WO version so a stale UI submit (or a second concurrent
      // submit) fails OCC. We don't change status — there's no
      // AWAITING_APPROVAL state in WoStatus and inventing one would
      // require a CHECK-constraint migration.
      const updated = await workOrdersRepo.updateWithVersion(client, woId, {
        expectedVersion: input.expectedVersion,
      });
      if (updated === null) throw new NotFoundError("work order");
      if (updated === "version_conflict") {
        throw new ConflictError("work order was modified by someone else");
      }
      return updated;
    });
  }

  /**
   * Finaliser invoked by `ApprovalsService.act()` when a `work_order`
   * approval_request reaches APPROVED or REJECTED. Runs inside the act()
   * transaction.
   *
   * Behaviour:
   *   APPROVED → setStatus(MATERIAL_CHECK)  — releases for production
   *   REJECTED → setStatus(CANCELLED)       — terminal; the requester
   *                                           must create a new WO if
   *                                           they want to re-attempt.
   *
   * Defensive guards:
   *   - WO must still exist (could have been soft-deleted between
   *     submission and decision).
   *   - WO must be in PLANNED. Anything else means the workflow has
   *     already been mutated by another path (an operator running
   *     advanceStage too eagerly). Throwing here aborts the act()
   *     transaction so the approval_request stays PENDING and ops can
   *     untangle the state by hand.
   */
  async applyDecisionFromApprovals(
    client: pg.PoolClient,
    ctx: ApprovalFinaliserContext,
  ): Promise<void> {
    const { request, finalStatus } = ctx;
    const header = await workOrdersRepo.getById(client, request.entityId);
    if (!header) {
      throw new NotFoundError("work order");
    }
    if (!APPROVABLE_FROM.has(header.status)) {
      throw new StateTransitionError(
        `cannot ${finalStatus.toLowerCase()} a work order in status ${header.status}`,
        {
          from: header.status,
          action: finalStatus,
          allowedFrom: [...APPROVABLE_FROM],
        },
      );
    }
    const target = DECISION_TARGET[finalStatus];
    if (!target) {
      // Belt-and-braces — `finalStatus` is typed APPROVED | REJECTED, so
      // this branch is unreachable. We keep the throw in place because a
      // future change to ApprovalFinaliserContext that adds a third
      // value MUST be considered explicitly here.
      throw new ValidationError(
        `unsupported finaliser status for work_order: ${finalStatus}`,
      );
    }
    await workOrdersRepo.setStatus(client, header.id, target);
  }
}
