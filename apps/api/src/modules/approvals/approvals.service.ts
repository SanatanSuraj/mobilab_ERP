/**
 * Approvals service. ARCHITECTURE.md §3.3.
 *
 * Business rules:
 *
 *   - createRequest(entityType, entityId, amount?) — picks a chain from
 *     approval_chain_definitions (band match on min/max_amount), materialises
 *     its steps into approval_steps, logs a CREATE transition. Errors:
 *       * ConflictError if a PENDING request already exists for the entity.
 *       * NotFoundError if no chain is configured for the (type, amount) band.
 *       * ValidationError if deal_discount ≤ 15 (no approval needed).
 *
 *   - act(requestId, APPROVE|REJECT, comment, eSignaturePayload?) —
 *     called by an approver. Under SELECT ... FOR UPDATE on the request
 *     row so two approvers cannot both land an action on the same step.
 *       * Validates actor holds a role that matches the current step's role_id.
 *       * Validates e-signature payload is present if the step requires one.
 *       * On APPROVE: advances current_step, or finalises status=APPROVED.
 *       * On REJECT: finalises status=REJECTED (terminal, no re-open).
 *       * Logs a workflow_transitions row.
 *
 *   - cancelRequest(requestId, reason) — only the original requester or a
 *     cancel-permissioned role. Finalises status=CANCELLED.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  ApprovalActPayload,
  ApprovalChainDefinition,
  ApprovalChainListQuery,
  ApprovalEntityType,
  ApprovalInboxItem,
  ApprovalInboxQuery,
  ApprovalRequest,
  ApprovalRequestDetail,
  ApprovalRequestListQuery,
  ApprovalStep,
  CreateApprovalChainDefinition,
  CreateApprovalRequest,
} from "@instigenie/contracts";
import { paginated } from "@instigenie/contracts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@instigenie/errors";
import { m, MoneyTypeError } from "@instigenie/money";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { approvalsRepo } from "./approvals.repository.js";
import { requireUser } from "../../context/request-context.js";
import type { EsignatureService } from "../esignature/service.js";

const REQUEST_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  completedAt: "completed_at",
  amount: "amount",
  status: "status",
};

const CHAIN_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
  entityType: "entity_type",
};

const INBOX_SORTS: Record<string, string> = {
  createdAt: "r.created_at",
  updatedAt: "r.updated_at",
};

/** Entity types that MUST come with an amount at request creation. */
const AMOUNT_REQUIRED: Set<ApprovalEntityType> = new Set([
  "work_order",
  "purchase_order",
  "deal_discount",
  "invoice",
]);

/** deal_discount gate: >15% only. */
const DEAL_DISCOUNT_MIN_PCT = 15;

function pgCodeOf(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

export interface ApprovalsServiceDeps {
  pool: pg.Pool;
  /**
   * Phase 4 §4.2 — re-entered password + HMAC-SHA256 hash for any
   * approval step with requires_e_signature = true. Optional so the
   * Phase 3 gates that hand-roll the service without going through
   * the bootstrap still compile; when absent, any act() call against
   * a requires-e-signature step throws ValidationError before
   * touching the DB, which is strictly safer than silently skipping.
   */
  esignature?: EsignatureService;
}

/** Type-guard for the overloaded constructor. pg.Pool has no `pool` own
 *  key, so this discriminates cleanly without instanceof coupling. */
function isApprovalsServiceDeps(
  x: ApprovalsServiceDeps | pg.Pool,
): x is ApprovalsServiceDeps {
  return typeof x === "object" && x !== null && "pool" in x;
}

export class ApprovalsService {
  private readonly pool: pg.Pool;
  private readonly esignature: EsignatureService | null;

  // Two accepted shapes so Phase 3 gates (which pre-date §4.2 and hand
  // the service a bare pool) keep compiling. Phase 4 callers pass a
  // deps object so the EsignatureService can be injected.
  //
  // When the bare-pool form is used, `esignature` is null and any
  // requires_e_signature step raises ValidationError before touching
  // the DB — a strictly safer default than silently proceeding.
  constructor(deps: ApprovalsServiceDeps | pg.Pool) {
    if (isApprovalsServiceDeps(deps)) {
      this.pool = deps.pool;
      this.esignature = deps.esignature ?? null;
    } else {
      this.pool = deps;
      this.esignature = null;
    }
  }

  // ── Chain definitions ─────────────────────────────────────────────────────

  async listChains(req: FastifyRequest, query: ApprovalChainListQuery) {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, CHAIN_SORTS, "createdAt");
      const { data, total } = await approvalsRepo.listChains(
        client,
        {
          entityType: query.entityType,
          isActive: query.isActive,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getChain(
    req: FastifyRequest,
    id: string,
  ): Promise<ApprovalChainDefinition> {
    return withRequest(req, this.pool, async (client) => {
      const row = await approvalsRepo.getChainById(client, id);
      if (!row) throw new NotFoundError("approval chain definition");
      return row;
    });
  }

  async createChain(
    req: FastifyRequest,
    input: CreateApprovalChainDefinition,
  ): Promise<ApprovalChainDefinition> {
    const user = requireUser(req);
    // Validate step_number starts at 1 and increments by 1
    const sorted = [...input.steps].sort(
      (a, b) => a.stepNumber - b.stepNumber,
    );
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i]!.stepNumber !== i + 1) {
        throw new ValidationError(
          `chain steps must be numbered 1..${sorted.length} contiguously`,
        );
      }
    }
    return withRequest(req, this.pool, async (client) => {
      try {
        return await approvalsRepo.createChain(client, user.orgId, user.id, {
          entityType: input.entityType,
          name: input.name,
          description: input.description,
          minAmount: input.minAmount,
          maxAmount: input.maxAmount,
          steps: sorted,
          isActive: input.isActive,
        });
      } catch (err) {
        if (pgCodeOf(err) === "23514") {
          throw new ValidationError(
            "invalid chain definition — check min_amount < max_amount and steps is a non-empty array",
          );
        }
        throw err;
      }
    });
  }

  async removeChain(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await approvalsRepo.softDeleteChain(client, id);
      if (!ok) throw new NotFoundError("approval chain definition");
    });
  }

  // ── Requests ──────────────────────────────────────────────────────────────

  async listRequests(req: FastifyRequest, query: ApprovalRequestListQuery) {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, REQUEST_SORTS, "createdAt");
      const { data, total } = await approvalsRepo.listRequests(
        client,
        {
          entityType: query.entityType,
          entityId: query.entityId,
          status: query.status,
          requestedBy: query.requestedBy,
          from: query.from,
          to: query.to,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getRequestDetail(
    req: FastifyRequest,
    id: string,
  ): Promise<ApprovalRequestDetail> {
    return withRequest(req, this.pool, async (client) => {
      const request = await approvalsRepo.getRequestById(client, id);
      if (!request) throw new NotFoundError("approval request");
      const [steps, transitions] = await Promise.all([
        approvalsRepo.listStepsForRequest(client, id),
        approvalsRepo.listTransitionsForRequest(client, id),
      ]);
      return { request, steps, transitions };
    });
  }

  async createRequest(
    req: FastifyRequest,
    input: CreateApprovalRequest,
  ): Promise<ApprovalRequestDetail> {
    const user = requireUser(req);
    const actorRole = user.roles[0] ?? null;

    // Entity-type / amount validation.
    if (AMOUNT_REQUIRED.has(input.entityType)) {
      if (!input.amount) {
        throw new ValidationError(
          `amount is required for entity_type=${input.entityType}`,
        );
      }
      if (input.entityType === "deal_discount") {
        // input.amount is a decimal string — parse via decimal.js so we
        // never coerce money-adjacent values through Number(). Here it's
        // actually a percentage, not a currency amount, but the same
        // precision argument applies: the approval chain band lookup later
        // compares string-formatted min/max_amount and any float drift here
        // would shift which chain fires.
        let pct;
        try {
          pct = m(input.amount);
        } catch (err) {
          if (err instanceof MoneyTypeError) {
            throw new ValidationError(
              `deal_discount requires >${DEAL_DISCOUNT_MIN_PCT}% — ≤${DEAL_DISCOUNT_MIN_PCT}% skips approval`,
            );
          }
          throw err;
        }
        if (pct.lte(DEAL_DISCOUNT_MIN_PCT)) {
          throw new ValidationError(
            `deal_discount requires >${DEAL_DISCOUNT_MIN_PCT}% — ≤${DEAL_DISCOUNT_MIN_PCT}% skips approval`,
          );
        }
      } else {
        // Decimal.js parse; `m()` throws MoneyTypeError on non-numeric
        // input, which we surface as ValidationError — keeping the public
        // contract identical to the old `Number.isNaN(...)` check but
        // without dropping precision on the way through.
        let amt;
        try {
          amt = m(input.amount);
        } catch (err) {
          if (err instanceof MoneyTypeError) {
            throw new ValidationError(
              "amount must be a non-negative number",
            );
          }
          throw err;
        }
        if (amt.isNegative()) {
          throw new ValidationError("amount must be a non-negative number");
        }
      }
    }

    return withRequest(req, this.pool, async (client) => {
      // Reject if there's already a PENDING request for the same entity.
      const existing = await approvalsRepo.getRequestByEntity(
        client,
        input.entityType,
        input.entityId,
      );
      if (existing) {
        throw new ConflictError(
          "an approval request is already pending for this entity",
          { requestId: existing.id },
        );
      }

      const chain = await approvalsRepo.resolveChain(
        client,
        input.entityType,
        input.amount ?? null,
      );
      if (!chain) {
        throw new NotFoundError(
          `no approval chain configured for entity_type=${input.entityType}${
            input.amount ? ` amount=${input.amount}` : ""
          }`,
        );
      }

      try {
        const { request, steps } = await approvalsRepo.createRequestWithSteps(
          client,
          user.orgId,
          user.id,
          actorRole,
          {
            chainDefId: chain.id,
            entityType: input.entityType,
            entityId: input.entityId,
            amount: input.amount ?? null,
            currency: input.currency,
            notes: input.notes ?? null,
            steps: chain.steps,
          },
        );
        const transitions = await approvalsRepo.listTransitionsForRequest(
          client,
          request.id,
        );
        return { request, steps, transitions };
      } catch (err) {
        // Partial-unique index collision on entity_pending — race with a
        // concurrent create() for the same entity.
        if (pgCodeOf(err) === "23505") {
          throw new ConflictError(
            "an approval request is already pending for this entity",
          );
        }
        throw err;
      }
    });
  }

  /**
   * Approve or reject the current step. Actor must hold a role matching the
   * step's role_id. Runs under SELECT ... FOR UPDATE on the request row so
   * two approvers cannot both land an action on the same step.
   */
  async act(
    req: FastifyRequest,
    requestId: string,
    payload: ApprovalActPayload,
  ): Promise<ApprovalRequestDetail> {
    const user = requireUser(req);
    const actorRole = user.roles[0] ?? null;

    return withRequest(req, this.pool, async (client) => {
      // withRequest already opens a transaction via withOrg; we just
      // layer the row-level lock on top. SELECT ... FOR UPDATE in
      // lockStepForAction serialises concurrent approvers.
      const locked = await approvalsRepo.lockStepForAction(client, requestId);
      if (!locked) {
        throw new NotFoundError("approval request");
      }
      const { request, step } = locked;
      if (request.status !== "PENDING" || step == null) {
        throw new ConflictError(
          `approval request is not PENDING (status=${request.status})`,
        );
      }
      if (step.status !== "PENDING") {
        throw new ConflictError(
          `step ${step.stepNumber} is not PENDING (status=${step.status})`,
        );
      }
      if (!user.roles.includes(step.roleId as (typeof user.roles)[number])) {
        throw new ForbiddenError(
          `this step requires role=${step.roleId}; you hold [${user.roles.join(", ")}]`,
        );
      }
      if (step.requiresESignature) {
        if (!payload.eSignaturePayload) {
          throw new ValidationError(
            "this step requires an e-signature — eSignaturePayload is required",
          );
        }
        if (!payload.eSignaturePassword) {
          throw new ValidationError(
            "this step requires an e-signature — eSignaturePassword is required",
          );
        }
        if (!this.esignature) {
          // Boot misconfiguration (EsignatureService not injected). Fail
          // closed rather than silently persisting an unsigned step.
          throw new ValidationError(
            "this step requires an e-signature but the server is not configured for electronic signatures",
          );
        }
        if (!user.identityId) {
          // Session is vendor-admin or a pre-§4.2 token without the
          // `idn` claim — cannot resolve the password_hash to compare
          // against.
          throw new UnauthorizedError(
            "e-signature requires a tenant-user session; re-login and retry",
          );
        }
      }

      const actedAt = new Date().toISOString();
      let eSignatureHash: string | null = null;
      if (
        step.requiresESignature &&
        payload.eSignaturePayload &&
        payload.eSignaturePassword &&
        this.esignature &&
        user.identityId
      ) {
        // Password verification + HMAC-SHA256 live in EsignatureService
        // so the §9.5 policy lives in exactly one file. Throws
        // UnauthorizedError on bad password — propagates out of
        // withRequest without advancing the step.
        const { hash } = await this.esignature.verifyAndHash({
          userIdentityId: user.identityId,
          password: payload.eSignaturePassword,
          reason: payload.eSignaturePayload,
          actedAt,
        });
        eSignatureHash = hash;
      }

      const newStatus: "APPROVED" | "REJECTED" =
        payload.action === "APPROVE" ? "APPROVED" : "REJECTED";

      const updatedStep = await approvalsRepo.updateStepDecision(
        client,
        step.id,
        {
          status: newStatus,
          actedBy: user.id,
          // Pass the same ISO-8601 string that went into the e-sig
          // hash so auditors can recompute against a single consistent
          // timestamp — see updateStepDecision's docstring for the
          // rationale.
          actedAt,
          comment: payload.comment ?? null,
          eSignatureHash,
        },
      );

      // Advance or finalise the request.
      const allSteps = await approvalsRepo.listStepsForRequest(
        client,
        request.id,
      );
      let finalStatus: "APPROVED" | "REJECTED" | null = null;
      let nextStep: number | null = null;
      if (newStatus === "REJECTED") {
        finalStatus = "REJECTED";
      } else {
        const nextPending = allSteps
          .filter((s) => s.stepNumber > step.stepNumber)
          .sort((a, b) => a.stepNumber - b.stepNumber)[0];
        if (nextPending) {
          nextStep = nextPending.stepNumber;
        } else {
          finalStatus = "APPROVED";
        }
      }

      const progressed = await approvalsRepo.progressRequest(
        client,
        request.id,
        {
          nextStep,
          finalStatus,
          completedBy: finalStatus ? user.id : null,
        },
      );

      await approvalsRepo.logTransition(client, user.orgId, {
        requestId: request.id,
        stepId: updatedStep.id,
        action: payload.action,
        fromStatus: "PENDING",
        toStatus: newStatus,
        actorId: user.id,
        actorRole,
        comment: payload.comment ?? null,
        eSignatureHash,
        metadata: {
          stepNumber: updatedStep.stepNumber,
          requestFinalStatus: finalStatus ?? progressed.status,
        },
      });

      // Fresh snapshot for the response. Still inside the outer txn, so
      // the just-written rows are visible here.
      const [freshRequest, freshSteps, freshTransitions] = await Promise.all([
        approvalsRepo.getRequestById(client, request.id),
        approvalsRepo.listStepsForRequest(client, request.id),
        approvalsRepo.listTransitionsForRequest(client, request.id),
      ]);
      if (!freshRequest) throw new NotFoundError("approval request");
      return {
        request: freshRequest,
        steps: freshSteps,
        transitions: freshTransitions,
      };
    });
  }

  async cancelRequest(
    req: FastifyRequest,
    requestId: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const user = requireUser(req);
    const actorRole = user.roles[0] ?? null;
    return withRequest(req, this.pool, async (client) => {
      // withRequest already supplies the transaction.
      const existing = await approvalsRepo.getRequestById(client, requestId);
      if (!existing) throw new NotFoundError("approval request");
      if (existing.status !== "PENDING") {
        throw new ConflictError(
          `cannot cancel — status is ${existing.status}`,
        );
      }
      const isOwnRequest = existing.requestedBy === user.id;
      const hasCancelPerm = user.permissions.has("approvals:cancel");
      if (!isOwnRequest && !hasCancelPerm) {
        throw new ForbiddenError(
          "only the requester or a role with approvals:cancel can cancel this request",
        );
      }
      const cancelled = await approvalsRepo.cancelRequest(client, requestId, {
        cancelledBy: user.id,
        reason,
      });
      await approvalsRepo.logTransition(client, user.orgId, {
        requestId: cancelled.id,
        stepId: null,
        action: "CANCEL",
        fromStatus: "PENDING",
        toStatus: "CANCELLED",
        actorId: user.id,
        actorRole,
        comment: reason,
        eSignatureHash: null,
        metadata: null,
      });
      return cancelled;
    });
  }

  async listInbox(
    req: FastifyRequest,
    query: ApprovalInboxQuery,
  ): Promise<ReturnType<typeof paginated<ApprovalInboxItem>>> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, INBOX_SORTS, "createdAt");
      const { data, total } = await approvalsRepo.listInbox(
        client,
        [...user.roles],
        { entityType: query.entityType },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  // Test / integration helper — step snapshot by id.
  async getStepsForRequest(
    req: FastifyRequest,
    requestId: string,
  ): Promise<ApprovalStep[]> {
    return withRequest(req, this.pool, async (client) => {
      return approvalsRepo.listStepsForRequest(client, requestId);
    });
  }
}
