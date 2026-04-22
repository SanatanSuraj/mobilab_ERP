/**
 * Tenant-side fetch wrapper for the real apps/api surface (NOT the mock client
 * in src/lib/api-client.ts, which is still used by prototype pages).
 *
 * Mirrors lib/api/vendor-admin.ts but for tenant traffic:
 *
 *   - Reads `instigenie-access` / `instigenie-refresh` from sessionStorage —
 *     written by /auth/login after a successful login + optional tenant
 *     pick. No other code should ever touch these keys directly.
 *
 *   - Sends `Authorization: Bearer <access>` on every authed request.
 *
 *   - Sends `X-Org-Id: <uuid>` derived from the JWT's `org` claim. Decoded
 *     lazily from the access token, not stored separately — a fresh token
 *     carries a fresh org. The backend's RLS binding reads this header.
 *
 *   - On 401, tries /auth/refresh exactly once using the refresh token,
 *     rotates both, and retries the original request. If refresh itself
 *     rejects, tokens are cleared and the original 401 bubbles up so
 *     pages can redirect to /auth/login.
 *
 * Kept separate from the existing lib/api-client.ts `apiFetch` because that
 * one reads `orgId` from the mock Zustand store and would collide with the
 * real flow. Once the entire app migrates off the mock, the two can merge.
 */

import type { Problem } from "@instigenie/contracts";

/** Where to reach the real API. Override with NEXT_PUBLIC_API_BASE_URL. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

// Keep these in sync with /auth/login page.tsx.
export const TENANT_ACCESS_KEY = "instigenie-access";
export const TENANT_REFRESH_KEY = "instigenie-refresh";

export class ApiProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail ?? problem.title ?? "API error");
    this.name = "ApiProblem";
    this.problem = problem;
  }
}

// ─── Token storage ──────────────────────────────────────────────────────────

export function getTenantAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TENANT_ACCESS_KEY);
}

export function getTenantRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TENANT_REFRESH_KEY);
}

export function setTenantTokens(access: string, refresh: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(TENANT_ACCESS_KEY, access);
  sessionStorage.setItem(TENANT_REFRESH_KEY, refresh);
}

export function clearTenantTokens(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TENANT_ACCESS_KEY);
  sessionStorage.removeItem(TENANT_REFRESH_KEY);
}

// ─── JWT decode (just the payload — no signature verification) ──────────────

interface JwtClaimsLike {
  org?: string;
  sub?: string;
  email?: string;
  name?: string;
  exp?: number;
  [k: string]: unknown;
}

/** Base64url → utf-8 string. Works in both browser and Node (edge runtime). */
function base64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") return atob(b64);
  // Node fallback
  return Buffer.from(b64, "base64").toString("utf-8");
}

export function decodeJwtClaims(token: string): JwtClaimsLike | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64urlDecode(parts[1])) as JwtClaimsLike;
  } catch {
    return null;
  }
}

/** Read org UUID straight from the current access token. */
export function getTenantOrgId(): string | null {
  const t = getTenantAccessToken();
  if (!t) return null;
  return decodeJwtClaims(t)?.org ?? null;
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
 * Authed fetch for tenant endpoints. On 401 → tries /auth/refresh once and
 * retries. Never recurses past the single retry.
 *
 * Paths are relative: pass "/crm/leads?limit=50", not the full URL.
 */
export async function tenantFetch(
  path: string,
  init: RequestInit = {},
  opts: { retriedAfterRefresh?: boolean } = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const access = getTenantAccessToken();
  if (access) {
    headers.set("Authorization", `Bearer ${access}`);
    const orgId = decodeJwtClaims(access)?.org;
    if (orgId && !headers.has("X-Org-Id")) {
      headers.set("X-Org-Id", orgId);
    }
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (res.status !== 401 || opts.retriedAfterRefresh) return res;

  // One-shot refresh.
  const refresh = getTenantRefreshToken();
  if (!refresh) return res;

  try {
    const refreshed = await apiTenantRefresh(refresh);
    setTenantTokens(refreshed.accessToken, refreshed.refreshToken);
  } catch {
    clearTenantTokens();
    return res;
  }

  return tenantFetch(path, init, { retriedAfterRefresh: true });
}

// ─── Refresh helper (private-ish — CRM module also uses it transitively) ────

interface RefreshResponse {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function apiTenantRefresh(refreshToken: string): Promise<RefreshResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  return (await parseJsonOrThrow(res)) as RefreshResponse;
}

// ─── Typed convenience helpers ──────────────────────────────────────────────

export async function tenantGet<T>(path: string): Promise<T> {
  const res = await tenantFetch(path);
  return (await parseJsonOrThrow(res)) as T;
}

export async function tenantPost<T>(path: string, body: unknown): Promise<T> {
  const res = await tenantFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return (await parseJsonOrThrow(res)) as T;
}

export async function tenantPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await tenantFetch(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return (await parseJsonOrThrow(res)) as T;
}

export async function tenantDelete(path: string): Promise<void> {
  const res = await tenantFetch(path, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    await parseJsonOrThrow(res); // throws
  }
}
