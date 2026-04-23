/**
 * Typed client for /admin/users/* and /auth/accept-invite/* — the invitation
 * flow (packages/contracts/src/admin-users.ts). Two personas call this file:
 *
 *   - Signed-in admins hit /admin/users/*. Those calls go through tenantFetch
 *     so the bearer + X-Org-Id headers + one-shot refresh are handled for us.
 *   - Anonymous invitees hit /auth/accept-invite/preview and /auth/accept-invite.
 *     Those endpoints are public (the raw token in the URL is the secret), so
 *     we use plain fetch — adding a stale bearer from a previous session would
 *     be noise at best and a 401 footgun at worst.
 *
 * Wire shapes come from @instigenie/contracts; never redeclare them here.
 */

import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  AcceptInvitePreviewResponse,
  InvitationSummary,
  InviteUserRequest,
  InviteUserResponse,
  ListInvitationsQuery,
  ListInvitationsResponse,
} from "@instigenie/contracts";
import {
  API_BASE_URL,
  ApiProblem,
  tenantGet,
  tenantPost,
} from "./tenant-fetch";
import type { Problem } from "@instigenie/contracts";

// ─── Admin surface (authed via tenantFetch) ─────────────────────────────────

/** POST /admin/users/invite — create + queue email. Requires users:invite. */
export async function apiInviteUser(
  body: InviteUserRequest,
): Promise<InviteUserResponse> {
  return tenantPost<InviteUserResponse>("/admin/users/invite", body);
}

/** GET /admin/users/invitations — filtered list for the admin page. */
export async function apiListInvitations(
  query: Partial<ListInvitationsQuery> = {},
): Promise<ListInvitationsResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const qs = params.toString();
  return tenantGet<ListInvitationsResponse>(
    `/admin/users/invitations${qs ? `?${qs}` : ""}`,
  );
}

/**
 * POST /admin/users/invitations/:id/revoke — soft-revoke by stamping
 * metadata.revokedAt; the row stays for audit/history. Returns the updated
 * invitation so the UI can replace its local copy in one render.
 */
export async function apiRevokeInvitation(
  id: string,
): Promise<InvitationSummary> {
  const res = await tenantPost<{ invitation: InvitationSummary }>(
    `/admin/users/invitations/${id}/revoke`,
    {},
  );
  return res.invitation;
}

// ─── Public accept surface (plain fetch, no bearer) ─────────────────────────

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
      },
    );
  }
  return body;
}

/** GET /auth/accept-invite/preview — look up invite by raw token. */
export async function apiPreviewAcceptInvite(
  token: string,
): Promise<AcceptInvitePreviewResponse> {
  const qs = new URLSearchParams({ token }).toString();
  const res = await fetch(`${API_BASE_URL}/auth/accept-invite/preview?${qs}`);
  return (await parseJsonOrThrow(res)) as AcceptInvitePreviewResponse;
}

/** POST /auth/accept-invite — finalise + mint access/refresh tokens. */
export async function apiAcceptInvite(
  body: AcceptInviteRequest,
): Promise<AcceptInviteResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await parseJsonOrThrow(res)) as AcceptInviteResponse;
}
