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

// ─── 403 Forbidden ────────────────────────────────────────────────────────────

/**
 * Authenticated but missing the required permission, wrong audience, or
 * operator capability missing (e.g. unauthorized PCB rework).
 */
export class ForbiddenError extends AppError {
  readonly code = "forbidden";
  readonly status = 403;
}

// ─── 404 Not Found ────────────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  readonly code = "not_found";
  readonly status = 404;
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

export class RateLimitError extends AppError {
  readonly code = "rate_limited";
  readonly status = 429;
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
