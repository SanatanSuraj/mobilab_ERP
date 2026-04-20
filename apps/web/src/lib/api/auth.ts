/**
 * Typed fetch wrapper for the real /auth/* endpoints exposed by apps/api.
 *
 * Kept deliberately framework-free — plain fetch — so it works in Next.js
 * server and client components alike. The shapes are imported from
 * @mobilab/contracts so frontend and backend stay in lockstep.
 *
 * Login flow (Option 2 identity model):
 *   1. apiLogin() returns either an AuthenticatedResponse (single
 *      membership short-circuit) or a MultiTenantResponse (tenant picker).
 *   2. On MultiTenantResponse, show the user a picker, then call
 *      apiSelectTenant() with the chosen orgId.
 */

import type {
  AuthenticatedResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  MultiTenantResponse,
  RefreshRequest,
  SelectTenantRequest,
  Problem,
} from "@mobilab/contracts";

/** Where to reach the real API. Override with NEXT_PUBLIC_API_BASE_URL. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail ?? problem.title ?? "API error");
    this.name = "ApiProblem";
    this.problem = problem;
  }
}

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

export async function apiLogin(req: LoginRequest): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await parseJsonOrThrow(res)) as LoginResponse;
}

export async function apiSelectTenant(
  req: SelectTenantRequest
): Promise<AuthenticatedResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/select-tenant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await parseJsonOrThrow(res)) as AuthenticatedResponse;
}

export async function apiRefresh(
  req: RefreshRequest
): Promise<AuthenticatedResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await parseJsonOrThrow(res)) as AuthenticatedResponse;
}

export async function apiLogout(refreshToken: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok && res.status !== 204) {
    await parseJsonOrThrow(res); // throws ApiProblem
  }
}

export async function apiMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await parseJsonOrThrow(res)) as MeResponse;
}

// Re-export for callers that want to narrow the union at the call site.
export type { AuthenticatedResponse, LoginResponse, MultiTenantResponse };
