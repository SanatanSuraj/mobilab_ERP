/**
 * Deal-discount approvals service.
 *
 * ARCHITECTURE.md §3.3 routes any header-level discount > 15% on a deal
 * through the central approvals engine (entity_type='deal_discount',
 * Sales Manager + Finance). Discounts ≤15% just go through the regular
 * deal PATCH path — no approval is opened.
 *
 * Two surfaces:
 *
 *   - Submit:   `submitForApproval()` parks `pending_discount_pct` +
 *               `discount_request_id` on the deal row and opens an
 *               approval_request inside the same transaction. The row
 *               never sits in "pending" without a backing request.
 *
 *   - Decision: `applyDecisionFromApprovals()` is the finaliser invoked
 *               by `ApprovalsService.act()` once the deal_discount
 *               request reaches APPROVED or REJECTED. Runs inside the
 *               approvals transaction.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  Deal,
  SubmitDealDiscountForApproval,
} from "@instigenie/contracts";
import { ConflictError, NotFoundError, ValidationError } from "@instigenie/errors";
import { withRequest } from "../shared/with-request.js";
import { requireUser } from "../../context/request-context.js";
import { dealsRepo } from "./deals.repository.js";
import type {
  ApprovalsService,
  ApprovalFinaliserContext,
} from "../approvals/approvals.service.js";

/** Discounts at or below this percentage skip approval entirely. */
const DEAL_DISCOUNT_MIN_PCT = 15;

export interface DealApprovalsServiceDeps {
  pool: pg.Pool;
  /**
   * Required to dispatch into `/approvals/*` on submit-for-approval.
   * Optional in the deps shape so a bare-pool fallback compiles, but
   * absent at runtime it throws a clear boot-time error rather than
   * silently skipping the approval row.
   */
  approvals?: ApprovalsService;
}

function isDealApprovalsServiceDeps(
  x: DealApprovalsServiceDeps | pg.Pool,
): x is DealApprovalsServiceDeps {
  return typeof x === "object" && x !== null && "pool" in x;
}

export class DealApprovalsService {
  private readonly pool: pg.Pool;
  private readonly approvals: ApprovalsService | null;

  constructor(deps: DealApprovalsServiceDeps | pg.Pool) {
    if (isDealApprovalsServiceDeps(deps)) {
      this.pool = deps.pool;
      this.approvals = deps.approvals ?? null;
    } else {
      this.pool = deps;
      this.approvals = null;
    }
  }

  /**
   * Park a pending discount on the deal and open the approval_request.
   * Refuses ≤15% — those discounts skip approval and should go through
   * the regular deal PATCH path. Refuses if a PENDING request already
   * exists on this deal (the partial-unique index on approval_requests
   * also enforces this server-side).
   */
  async submitForApproval(
    req: FastifyRequest,
    dealId: string,
    input: SubmitDealDiscountForApproval,
  ): Promise<Deal> {
    if (!this.approvals) {
      throw new ValidationError(
        "approvals service is not wired — deal-discount approvals are unavailable",
      );
    }
    const approvals = this.approvals;
    const user = requireUser(req);
    if (input.pendingDiscountPct <= DEAL_DISCOUNT_MIN_PCT) {
      throw new ValidationError(
        `deal_discount approval is only required for discounts > ${DEAL_DISCOUNT_MIN_PCT}% — apply ≤${DEAL_DISCOUNT_MIN_PCT}% directly via PATCH /crm/deals/:id`,
      );
    }
    return withRequest(req, this.pool, async (client) => {
      const cur = await dealsRepo.getById(client, dealId);
      if (!cur) throw new NotFoundError("deal");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("deal was modified by someone else");
      }
      if (cur.discountRequestId !== null) {
        throw new ConflictError(
          "a discount approval is already pending for this deal",
          { requestId: cur.discountRequestId },
        );
      }

      // Open the approval_request first. createRequestForEntity throws on
      // duplicate-pending or chain-not-found; both abort BEFORE we touch the
      // deal row, so failure leaves the row exactly as it was.
      const pctStr = input.pendingDiscountPct.toFixed(2);
      const detail = await approvals.createRequestForEntity(client, user, {
        entityType: "deal_discount",
        entityId: dealId,
        amount: pctStr,
        currency: "INR",
        notes: input.notes,
      });

      const updated = await dealsRepo.setPendingDiscount(client, dealId, {
        pendingDiscountPct: pctStr,
        discountRequestId: detail.request.id,
        expectedVersion: input.expectedVersion,
      });
      if (updated === null) throw new NotFoundError("deal");
      if (updated === "version_conflict") {
        throw new ConflictError("deal was modified by someone else");
      }
      return updated;
    });
  }

  /**
   * Finaliser called by `ApprovalsService.act()` once a deal_discount
   * approval_request reaches APPROVED or REJECTED. Runs inside the
   * caller's transaction. Copies `pending_discount_pct` → `approved_discount_pct`
   * + stamps approver on APPROVE, clears all pending state on REJECT.
   */
  async applyDecisionFromApprovals(
    client: pg.PoolClient,
    ctx: ApprovalFinaliserContext,
  ): Promise<void> {
    const { request, finalStatus, actor } = ctx;
    const updated = await dealsRepo.applyDiscountDecision(
      client,
      request.entityId,
      { finalStatus, approverId: actor.id },
    );
    if (!updated) {
      throw new NotFoundError("deal");
    }
  }
}
