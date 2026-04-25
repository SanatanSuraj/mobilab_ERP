/**
 * Real-API React Query hooks for the admin-users surface.
 *
 * Backend reality (apps/api/src/modules/admin-users/routes.ts):
 *   - GET  /admin/users                              — active members (real)
 *   - POST /admin/users/invite                       — create + queue email
 *   - GET  /admin/users/invitations                  — list (status filter)
 *   - POST /admin/users/invitations/:id/revoke       — revoke open invite
 *
 * The Members tab now reads from `useApiUsers()` (joined users + memberships +
 * roles), while the Invitations tab continues to read `useApiInvitations()` for
 * the open / closed invitation pipeline.
 *
 * Cache fan-out: invite + revoke mutations invalidate both subtrees so
 * accepting an invite (manually, in another tab) → members list refresh
 * still works without a hard reload, and so a fresh invite shows up
 * immediately in the open-invitations card.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiDeleteInvitation,
  apiDeleteUser,
  apiInviteUser,
  apiListInvitations,
  apiListUsers,
  apiRevokeInvitation,
  apiUpdateUser,
} from "@/lib/api/admin-users";

import type {
  InvitationSummary,
  InviteUserRequest,
  InviteUserResponse,
  ListInvitationsQuery,
  ListUsersQuery,
  UpdateUserRequest,
  UserSummary,
} from "@instigenie/contracts";

// ─── Query keys ────────────────────────────────────────────────────────────

export const adminUsersApiKeys = {
  all: ["admin-users-api"] as const,
  invitations: {
    all: ["admin-users-api", "invitations"] as const,
    list: (q: Partial<ListInvitationsQuery>) =>
      ["admin-users-api", "invitations", "list", q] as const,
  },
  users: {
    all: ["admin-users-api", "users"] as const,
    list: (q: Partial<ListUsersQuery>) =>
      ["admin-users-api", "users", "list", q] as const,
  },
};

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * List invitations. Default behaviour (no `status`) returns PENDING +
 * EXPIRED + REVOKED — the actionable inbox. Pass `status: "ACCEPTED"` to
 * get the historic accepted-invite view (note: prefer `useApiUsers` for
 * the members card — the canonical source of truth includes pre-invite
 * seeded users and bootstrap admins, neither of which appears here).
 */
export function useApiInvitations(query: Partial<ListInvitationsQuery> = {}) {
  return useQuery({
    queryKey: adminUsersApiKeys.invitations.list(query),
    queryFn: () => apiListInvitations(query),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * List active members of the tenant. Defaults to ACTIVE only; pass
 * `status: "INVITED"` or `"SUSPENDED"` to scope. Use this — not
 * `useApiInvitations({ status: "ACCEPTED" })` — for the Members tab.
 */
export function useApiUsers(query: Partial<ListUsersQuery> = {}) {
  return useQuery({
    queryKey: adminUsersApiKeys.users.list(query),
    queryFn: () => apiListUsers(query),
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
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.users.all });
    },
  });
}

export function useApiRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation<InvitationSummary, Error, string>({
    mutationFn: (id) => apiRevokeInvitation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.invitations.all });
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.users.all });
    },
  });
}

export function useApiDeleteInvitation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteInvitation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.invitations.all });
    },
  });
}

export function useApiUpdateUser() {
  const qc = useQueryClient();
  return useMutation<
    UserSummary,
    Error,
    { id: string; body: UpdateUserRequest }
  >({
    mutationFn: ({ id, body }) => apiUpdateUser(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.users.all });
    },
  });
}

export function useApiDeleteUser() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminUsersApiKeys.users.all });
    },
  });
}
