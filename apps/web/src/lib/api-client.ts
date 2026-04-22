/**
 * API Client — thin wrapper that injects org_id and auth headers into every
 * request, aligned with ERP-ARCH-MIDSCALE-2025-005 section 3.1.
 *
 * All service files MUST use apiFetch() instead of raw fetch() so that:
 *   • X-Org-Id  — PostgreSQL RLS reads app.current_org_id from this header
 *   • Authorization — JWT for identity (added when real auth lands)
 *   • Content-Type  — defaulted to application/json
 *
 * Usage in a service:
 *   import { apiFetch, getOrgId } from "@/lib/api-client";
 *
 *   // For fetch-based API calls:
 *   const leads = await apiFetch("/api/crm/leads").then(r => r.json());
 *
 *   // For mock services (today): org_id still logged/available for future use
 *   const orgId = getOrgId(); // attach to query filters when real API arrives
 *
 * Swapping mock → real:
 *   1. Remove the `if (process.env.NODE_ENV === 'development') return` guards
 *      from service files.
 *   2. apiFetch() is already wired — real calls will work automatically.
 *   3. Add token retrieval below when cookie/httpOnly auth is implemented.
 */

import { useAuthStore } from "@/store/auth.store";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read orgId from the auth store without subscribing to the store.
 * Safe to call from non-component contexts (service files, utilities).
 * Throws when called before the user is authenticated — never call in global
 * scope, only inside async functions triggered by user actions.
 */
export function getOrgId(): string {
  const orgId = useAuthStore.getState().orgId;
  if (!orgId) {
    throw new Error(
      "[api-client] getOrgId() called before authentication. " +
        "Ensure the user is logged in and orgId is set in AuthStore."
    );
  }
  return orgId;
}

/**
 * Get the current authenticated user's id — convenience helper for service
 * files that need to filter by assignedTo / createdBy.
 */
export function getCurrentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

// ─── Core Fetch Wrapper ───────────────────────────────────────────────────────

export interface ApiFetchOptions extends RequestInit {
  /** Skip org_id injection — for public endpoints like /api/health. */
  skipOrgId?: boolean;
}

/**
 * Drop-in replacement for fetch() that injects Instigenie ERP required headers.
 *
 * @param path  - Relative API path, e.g. "/api/crm/leads"
 * @param init  - Standard RequestInit + skipOrgId option
 */
export async function apiFetch(
  path: string,
  init: ApiFetchOptions = {}
): Promise<Response> {
  const { skipOrgId, ...fetchInit } = init;

  const headers = new Headers(fetchInit.headers);

  // Content-Type default
  if (!headers.has("Content-Type") && fetchInit.body) {
    headers.set("Content-Type", "application/json");
  }

  // org_id — required by PostgreSQL RLS and FastAPI dependency
  if (!skipOrgId) {
    const orgId = getOrgId();
    headers.set("X-Org-Id", orgId);
  }

  // TODO: add JWT once real auth lands
  // const token = getToken(); // from memory store or httpOnly cookie helper
  // if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(path, { ...fetchInit, headers });

  if (!response.ok) {
    // Throw a structured error that React Query can catch and surface
    const body = await response.text().catch(() => "");
    throw new ApiError(response.status, response.statusText, path, body);
  }

  return response;
}

// ─── Typed Error ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly path: string,
    public readonly body: string
  ) {
    super(`[${status}] ${statusText} — ${path}`);
    this.name = "ApiError";
  }

  get isUnauthorized() { return this.status === 401; }
  get isForbidden()    { return this.status === 403; }
  get isNotFound()     { return this.status === 404; }
  get isServerError()  { return this.status >= 500; }
}

// ─── Convenience Methods ──────────────────────────────────────────────────────

export const apiGet = <T>(path: string, init?: ApiFetchOptions): Promise<T> =>
  apiFetch(path, { ...init, method: "GET" }).then((r) => r.json() as Promise<T>);

export const apiPost = <T>(path: string, body: unknown, init?: ApiFetchOptions): Promise<T> =>
  apiFetch(path, {
    ...init,
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<T>);

export const apiPatch = <T>(path: string, body: unknown, init?: ApiFetchOptions): Promise<T> =>
  apiFetch(path, {
    ...init,
    method: "PATCH",
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<T>);

export const apiDelete = (path: string, init?: ApiFetchOptions): Promise<void> =>
  apiFetch(path, { ...init, method: "DELETE" }).then(() => undefined);
