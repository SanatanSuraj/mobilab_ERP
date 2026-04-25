/**
 * Real-API React Query hooks for the admin-users (invitation) surface.
 *
 * Backend reality (apps/api/src/modules/admin-users/routes.ts):
 *   - POST /admin/users/invite                       — create + queue email
 *   - GET  /admin/users/invitations                  — list (status filter)
 *   - POST /admin/users/invitations/:id/revoke       — revoke open invite
 *
 * There is intentionally NO `GET /admin/users` endpoint — the admin
 * surface is invitation-driven. To approximate a "members" list this
 * module exposes a parameterised hook (`useApiInvitations`) that the
 * page can call twice: once with `status: "ACCEPTED"` (active members
 * who joined via invitation) and once with no filter (PENDING +
 * EXPIRED + REVOKED — open / closed invitation pipeline).
 *
 * Cache fan-out: every mutation invalidates the whole `invitations.all`
 * subtree so both views (members + open invites) re-fetch in lockstep.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiInviteUser,
  apiListInvitations,
  apiRevokeInvitation,
} from "@/lib/api/admin-users";

import type {
  InvitationSummary,
  InviteUserRequest,
  InviteUserResponse,
  ListInvitationsQuery,
} from "@instigenie/contracts";

// ─── Query keys ────────────────────────────────────────────────────────────

export const adminUsersApiKeys = {
  all: ["admin-users-api"] as const,
  invitations: {
    all: ["admin-users-api", "invitations"] as const,
    list: (q: Partial<ListInvitationsQuery>) =>
      ["admin-users-api", "invitations", "list", q] as const,
  },
};

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * List invitations. Default behaviour (no `status`) returns PENDING +
 * EXPIRED + REVOKED — the actionable inbox. Pass `status: "ACCEPTED"` to
 * get the members view.
 */
export function useApiInvitations(query: Partial<ListInvitationsQuery> = {}) {
  return useQuery({
    queryKey: adminUsersApiKeys.invitations.list(query),
    queryFn: () => apiListInvitations(query),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

// ─── Writes ────────────────────────────────────────────────────────────────

export function useApiInviteUser() {
  const qc = useQueryClient();
  return useMutation<InviteUserResponse, Error, InviteUserRequest>({
    mutationFn: (body) => apiInviteUser(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.invitations.all });
    },
  });
}

export function useApiRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation<InvitationSummary, Error, string>({
    mutationFn: (id) => apiRevokeInvitation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.invitations.all });
    },
  });
}
