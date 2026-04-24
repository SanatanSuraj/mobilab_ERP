/**
 * Thin API client for seeding + cleanup from E2E tests.
 *
 * We hit the real API (:4000) rather than touching the DB directly where
 * possible — less coupling to schema, and we get invitation-token generation
 * for free via the real POST /admin/users/invite endpoint.
 */

import { API_URL, DEV_PASSWORD, DEV_USERS } from "./env";

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    roles: string[];
  };
}

export async function apiLogin(email: string, password: string = DEV_PASSWORD): Promise<LoginResult> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, surface: "internal" }),
  });
  if (!res.ok) {
    throw new Error(
      `apiLogin(${email}) failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = await res.json();
  if (body.status !== "authenticated") {
    throw new Error(
      `apiLogin(${email}) did not authenticate (status=${body.status})`,
    );
  }
  return body as LoginResult;
}

export interface InviteResult {
  invitation: { id: string; email: string };
  devAcceptUrl?: string;
}

/**
 * Create a fresh user invitation as MANAGEMENT and return the dev accept URL
 * (contains the raw token as ?token=…). Dev mode only — in prod the token
 * is emailed, not returned.
 */
export async function seedInvitation(opts: {
  email: string;
  roleId?: string;
}): Promise<InviteResult> {
  const admin = await apiLogin(DEV_USERS.SUPER_ADMIN.email);
  const res = await fetch(`${API_URL}/admin/users/invite`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${admin.accessToken}`,
    },
    body: JSON.stringify({
      email: opts.email,
      roleId: opts.roleId ?? "SALES_REP",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `seedInvitation(${opts.email}) failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as InviteResult;
}

/** Revoke a freshly-seeded invitation — used in cleanup between tests. */
export async function revokeInvitation(invitationId: string): Promise<void> {
  const admin = await apiLogin(DEV_USERS.SUPER_ADMIN.email);
  await fetch(`${API_URL}/admin/users/invitations/${invitationId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
  }).catch(() => undefined);
}

/**
 * Extract ?token=… from a devAcceptUrl that points at /auth/accept-invite.
 * Works whether the URL origin matches the web base or not.
 */
export function extractInviteToken(devAcceptUrl: string): string {
  const url = new URL(devAcceptUrl);
  const tok = url.searchParams.get("token");
  if (!tok) throw new Error(`no ?token= on devAcceptUrl: ${devAcceptUrl}`);
  return tok;
}
