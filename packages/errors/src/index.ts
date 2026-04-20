/**
 * @mobilab/errors — typed error hierarchy for the API + workers.
 *
 * ARCHITECTURE.md §5 / §14 — every error carries:
 *   - a machine code (stable, snake_case, used in Problem+JSON `type`)
 *   - an HTTP status
 *   - optional details (safe to return to the client)
 *
 * Rule: handlers catch AppError and translate to RFC 7807 Problem+JSON.
 *       Anything that's NOT AppError is a 500 `internal_error` and gets
 *       logged with the full stack.
 */

/**
 * Base class for every application-defined error. All errors the API
 * throws on purpose should extend this. Everything else = programmer
 * bug = 500.
 */
export abstract class AppError extends Error {
  /** Stable machine-readable code. snake_case. Safe to expose. */
  abstract readonly code: string;
  /** HTTP status for this error family. */
  abstract readonly status: number;
  /** Optional structured details for the client. Must be JSON-serializable. */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = this.constructor.name;
    this.details = details;
  }

  /**
   * Shape for Problem+JSON body. The API layer wraps this in `type`/`title`/
   * `status`/`detail`/`instance` according to RFC 7807.
   */
  toProblem(): {
    code: string;
    status: number;
    message: string;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      status: this.status,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// ─── 400 Bad Request ──────────────────────────────────────────────────────────

/** Request payload failed zod validation or business-rule pre-checks. */
export class ValidationError extends AppError {
  readonly code = "validation_error";
  readonly status = 400;
}

// ─── 401 Unauthorized ─────────────────────────────────────────────────────────

/** No credentials, invalid credentials, or expired token. */
export class UnauthorizedError extends AppError {
  readonly code = "unauthorized";
  readonly status = 401;
}

// ─── 402 Payment Required ─────────────────────────────────────────────────────

/**
 * Tenant's trial has expired or a required subscription is missing / past
 * grace period. The client uses this to redirect to a billing page.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5).
 *
 * `code` is typed as `string` (not a literal) so ModuleDisabledError /
 * QuotaExceededError can specialize it without TS2416.
 */
export class TrialExpiredError extends AppError {
  readonly code: string = "trial_expired";
  readonly status = 402;
}

/**
 * The tenant's plan does not include the requested module or feature. Used
 * by the feature-flag guard (Sprint 1C): e.g. FREE-plan tenant hits a
 * /crm/... route after CRM was downgraded out of their plan, or STARTER
 * tenant hits a manufacturing endpoint.
 *
 * 402 (not 403) because the right client action is "upgrade your plan",
 * not "ask an admin for permission". Semantically aligned with
 * TrialExpiredError: both say "this is a billing-tier gate".
 */
export class ModuleDisabledError extends TrialExpiredError {
  override readonly code: string = "module_disabled";
}

// ─── 403 Forbidden ────────────────────────────────────────────────────────────

/**
 * Authenticated but missing the required permission, wrong audience, or
 * operator capability missing (e.g. unauthorized PCB rework).
 *
 * `code` is typed as `string` (not a literal) so subclasses can specialize.
 */
export class ForbiddenError extends AppError {
  readonly code: string = "forbidden";
  readonly status = 403;
}

/**
 * Tenant has been administratively suspended (billing dispute, ToS
 * violation, etc.). Different from TrialExpired because a SUSPENDED tenant
 * is a deliberate admin action, not a billing-cycle outcome. Returned by
 * the auth guard on every request until the tenant is restored.
 */
export class TenantSuspendedError extends ForbiddenError {
  override readonly code: string = "tenant_suspended";
}

// ─── 404 Not Found ────────────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  readonly code = "not_found";
  readonly status = 404;
}

// ─── 410 Gone ────────────────────────────────────────────────────────────────

/**
 * Tenant was soft-deleted (organizations.deleted_at IS NOT NULL). The row
 * still exists for audit but the customer relationship is over — no token
 * will ever be issued and any stale access token is rejected here.
 *
 * 410 (not 404) because the URL / identity used to work and the client
 * should stop trying.
 */
export class TenantDeletedError extends AppError {
  readonly code = "tenant_deleted";
  readonly status = 410;
}

// ─── 409 Conflict ─────────────────────────────────────────────────────────────

/**
 * Optimistic-concurrency failure (`version` mismatch), idempotency-key
 * replay with a different payload, or any other state-transition race.
 * ARCHITECTURE.md §5.1 / §5.4.
 *
 * `code` is typed as `string` (not a literal) so subclasses can specialize
 * it without a TS2416 override conflict.
 */
export class ConflictError extends AppError {
  readonly code: string = "conflict";
  readonly status = 409;
}

/**
 * A state-machine transition attempted from a state that doesn't allow it.
 * E.g. closing a WO that's still RELEASED. Subclass of Conflict because
 * the server state was "fine" but the requested transition wasn't valid.
 */
export class StateTransitionError extends ConflictError {
  override readonly code: string = "invalid_state_transition";
}

// ─── 422 Unprocessable Entity ─────────────────────────────────────────────────

/**
 * Inventory shortage. Specific subclass because the frontend usually wants
 * to show the missing lines. `details` should include `{ itemId, required,
 * available }[]`. ARCHITECTURE.md §13.3.
 */
export class ShortageError extends AppError {
  readonly code = "insufficient_stock";
  readonly status = 422;
}

// ─── 429 Too Many Requests ────────────────────────────────────────────────────

/**
 * `code` is `string` (not literal) so subclasses can specialize.
 */
export class RateLimitError extends AppError {
  readonly code: string = "rate_limited";
  readonly status = 429;
}

/**
 * Plan quota exhausted for the current period. Different from RateLimitError
 * (transient, reset on window) — this is a billing-plan cap, so the client
 * should surface "upgrade your plan" rather than "try again in 60s".
 *
 * `details` includes `{metric, limit, used, period}` so the client can
 * render an informative message and the frontend can deep-link to the
 * upgrade flow with the overflowing metric pre-selected.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5 / Sprint 2).
 */
export class QuotaExceededError extends RateLimitError {
  override readonly code: string = "quota_exceeded";
}

// ─── 503 Service Unavailable ──────────────────────────────────────────────────

/**
 * Circuit breaker open, or a required downstream (SMS, e-invoice gateway)
 * is degraded. Callers can retry with backoff.
 */
export class DependencyUnavailableError extends AppError {
  readonly code = "dependency_unavailable";
  readonly status = 503;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Type guard for the error handler. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
