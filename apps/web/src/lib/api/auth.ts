/**
 * Typed fetch wrapper for the real /auth/* endpoints exposed by apps/api.
 *
 * Kept deliberately framework-free — plain fetch — so it works in Next.js
 * server and client components alike. The shapes are imported from
 * @instigenie/contracts so frontend and backend stay in lockstep.
 *
 * Login flow (Option 2 identity model):
 *   1. apiLogin() returns either an AuthenticatedResponse (single
 *      membership short-circuit) or a MultiTenantResponse (tenant picker).
 *   2. On MultiTenantResponse, show the user a picker, then call
 *      apiSelectTenant() with the chosen orgId.
 */

import type {
  AuthenticatedResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  MultiTenantResponse,
  RefreshRequest,
  ResetPasswordPreviewResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  SelectTenantRequest,
  Problem,
} from "@instigenie/contracts";

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

// ─── Password reset (public — token-authed, no JWT) ─────────────────────

/**
 * Request a reset email. The API always responds 200 OK whether the email
 * is registered or not — never branch UI based on the response shape.
 * In non-prod, the response includes `devResetUrl` so QA can advance the
 * flow without an inbox; production builds strip that field.
 */
export async function apiForgotPassword(
  req: ForgotPasswordRequest,
): Promise<ForgotPasswordResponse & { devResetUrl?: string }> {
  const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await parseJsonOrThrow(res)) as ForgotPasswordResponse & {
    devResetUrl?: string;
  };
}

/**
 * Validate a reset token before showing the new-password form. 404 from
 * the API means invalid / expired / already-consumed — surface a single
 * "this link is invalid or has expired" message in the UI either way.
 */
export async function apiPreviewResetPassword(
  token: string,
): Promise<ResetPasswordPreviewResponse> {
  const url = new URL(`${API_BASE_URL}/auth/reset-password/preview`);
  url.searchParams.set("token", token);
  const res = await fetch(url.toString());
  return (await parseJsonOrThrow(res)) as ResetPasswordPreviewResponse;
}

export async function apiResetPassword(
  req: ResetPasswordRequest,
): Promise<ResetPasswordResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return (await parseJsonOrThrow(res)) as ResetPasswordResponse;
}

// Re-export for callers that want to narrow the union at the call site.
export type { AuthenticatedResponse, LoginResponse, MultiTenantResponse };
