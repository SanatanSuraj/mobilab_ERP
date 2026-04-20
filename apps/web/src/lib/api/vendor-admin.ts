/**
 * Typed fetch wrapper for the /vendor-admin/* surface exposed by apps/api.
 *
 * This is the SEPARATE client used by the Mobilab vendor-admin console
 * (Sprint 3). Keep it apart from lib/api/auth.ts — the two surfaces use:
 *
 *   - different JWT audiences (mobilab-vendor vs mobilab-internal/portal)
 *   - different token storage keys (no accidental cross-surface leakage)
 *   - different cookie/header rules (vendor never sends X-Org-Id)
 *
 * The contracts (shapes) are imported from @mobilab/contracts so the UI and
 * Fastify routes agree on the wire.
 *
 * Silent refresh: on a 401 from any authed endpoint we try the refresh
 * endpoint exactly once, update the stored tokens, and retry the original
 * request. If refresh fails, we clear both tokens and let the caller see
 * the 401 so the UI can route back to /vendor-admin/login.
 */

import type {
  VendorAuditListResponse,
  VendorLoginRequest,
  VendorLoginResponse,
  VendorMeResponse,
  VendorTenantListResponse,
  VendorTenantRow,
  SuspendTenantRequest,
  ReinstateTenantRequest,
  ChangePlanRequest,
  VendorTenantListQuery,
  VendorAuditListQuery,
} from "@mobilab/contracts/vendor-admin";
import type { Problem } from "@mobilab/contracts/auth";

/** Where to reach the real API. Override with NEXT_PUBLIC_API_BASE_URL. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

// Keep vendor keys distinct from the tenant-side "mobilab-access" / "mobilab-refresh"
// so a user who is simultaneously a tenant admin AND a vendor admin on the
// same browser can't pick up the wrong token by accident.
export const VENDOR_ACCESS_KEY = "mobilab-vendor-access";
export const VENDOR_REFRESH_KEY = "mobilab-vendor-refresh";

export class ApiProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail ?? problem.title ?? "API error");
    this.name = "ApiProblem";
    this.problem = problem;
  }
}

// ─── Token storage helpers ───────────────────────────────────────────────────

export function getVendorAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(VENDOR_ACCESS_KEY);
}

export function getVendorRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(VENDOR_REFRESH_KEY);
}

export function setVendorTokens(access: string, refresh: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(VENDOR_ACCESS_KEY, access);
  sessionStorage.setItem(VENDOR_REFRESH_KEY, refresh);
}

export function clearVendorTokens(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(VENDOR_ACCESS_KEY);
  sessionStorage.removeItem(VENDOR_REFRESH_KEY);
}

// ─── Core fetch ──────────────────────────────────────────────────────────────

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiProblem(
      (body as Problem) ?? {
        type: "unknown",
        title: "http_error",
        status: res.status,
        code: "http_error",
      }
    );
  }
  return body;
}

/**
 * Authed fetch for vendor endpoints. On 401, tries refresh exactly once.
 * Never recurses — if refresh itself returns 401, the caller sees it.
 */
async function vendorFetch(
  path: string,
  init: RequestInit = {},
  opts: { retriedAfterRefresh?: boolean } = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const access = getVendorAccessToken();
  if (access) headers.set("Authorization", `Bearer ${access}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (res.status !== 401 || opts.retriedAfterRefresh) return res;

  // Try a one-shot refresh.
  const refreshToken = getVendorRefreshToken();
  if (!refreshToken) return res;

  try {
    const refreshed = await apiVendorRefresh(refreshToken);
    setVendorTokens(refreshed.accessToken, refreshed.refreshToken);
  } catch {
    clearVendorTokens();
    return res;
  }

  // Retry once with the new access token.
  return vendorFetch(path, init, { retriedAfterRefresh: true });
}

// ─── Endpoint wrappers ───────────────────────────────────────────────────────

export async function apiVendorLogin(
  req: VendorLoginRequest
): Promise<VendorLoginResponse> {
  const res = await fetch(`${API_BASE_URL}/vendor-admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await parseJsonOrThrow(res)) as VendorLoginResponse;
}

export async function apiVendorRefresh(
  refreshToken: string
): Promise<VendorLoginResponse> {
  const res = await fetch(`${API_BASE_URL}/vendor-admin/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  return (await parseJsonOrThrow(res)) as VendorLoginResponse;
}

export async function apiVendorLogout(refreshToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/vendor-admin/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok && res.status !== 204) {
    await parseJsonOrThrow(res);
  }
}

export async function apiVendorMe(): Promise<VendorMeResponse> {
  const res = await vendorFetch("/vendor-admin/auth/me");
  return (await parseJsonOrThrow(res)) as VendorMeResponse;
}

// ─── Tenant admin ────────────────────────────────────────────────────────────

export async function apiVendorListTenants(
  query: Partial<VendorTenantListQuery> = {}
): Promise<VendorTenantListResponse> {
  const qs = new URLSearchParams();
  if (query.status) qs.set("status", query.status);
  if (query.plan) qs.set("plan", query.plan);
  if (query.q) qs.set("q", query.q);
  if (typeof query.limit === "number") qs.set("limit", String(query.limit));
  if (typeof query.offset === "number") qs.set("offset", String(query.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await vendorFetch(`/vendor-admin/tenants${suffix}`);
  return (await parseJsonOrThrow(res)) as VendorTenantListResponse;
}

export async function apiVendorGetTenant(
  orgId: string
): Promise<VendorTenantRow> {
  // There's no single-tenant GET in the backend today; reuse the list
  // endpoint with a UUID filter. Cheap and correct — list routes through
  // the same BYPASSRLS path and returns the same row shape.
  const res = await vendorFetch(`/vendor-admin/tenants?limit=200`);
  const body = (await parseJsonOrThrow(res)) as VendorTenantListResponse;
  const found = body.items.find((t) => t.id === orgId);
  if (!found) {
    throw new ApiProblem({
      type: "https://mobilab.dev/errors/not_found",
      title: "tenant_not_found",
      status: 404,
      code: "tenant_not_found",
      detail: `Tenant ${orgId} not found.`,
    });
  }
  return found;
}

export async function apiVendorSuspendTenant(
  orgId: string,
  req: SuspendTenantRequest
): Promise<void> {
  const res = await vendorFetch(`/vendor-admin/tenants/${orgId}/suspend`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok && res.status !== 204) await parseJsonOrThrow(res);
}

export async function apiVendorReinstateTenant(
  orgId: string,
  req: ReinstateTenantRequest
): Promise<void> {
  const res = await vendorFetch(`/vendor-admin/tenants/${orgId}/reinstate`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok && res.status !== 204) await parseJsonOrThrow(res);
}

export async function apiVendorChangePlan(
  orgId: string,
  req: ChangePlanRequest
): Promise<{ oldPlanCode: string | null; newPlanCode: string }> {
  const res = await vendorFetch(`/vendor-admin/tenants/${orgId}/change-plan`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  return (await parseJsonOrThrow(res)) as {
    oldPlanCode: string | null;
    newPlanCode: string;
  };
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export async function apiVendorListAudit(
  query: Partial<VendorAuditListQuery> = {}
): Promise<VendorAuditListResponse> {
  const qs = new URLSearchParams();
  if (query.orgId) qs.set("orgId", query.orgId);
  if (query.action) qs.set("action", query.action);
  if (query.vendorAdminId) qs.set("vendorAdminId", query.vendorAdminId);
  if (typeof query.limit === "number") qs.set("limit", String(query.limit));
  if (typeof query.offset === "number") qs.set("offset", String(query.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await vendorFetch(`/vendor-admin/audit${suffix}`);
  return (await parseJsonOrThrow(res)) as VendorAuditListResponse;
}
