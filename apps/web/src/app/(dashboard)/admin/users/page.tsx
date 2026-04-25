"use client";

/**
 * Admin → Users & Roles.
 *
 * Backend reality (apps/api/src/modules/admin-users/routes.ts):
 *   - GET  /admin/users                              — active members (real)
 *   - POST /admin/users/invite                       — create + queue email
 *   - GET  /admin/users/invitations                  — list (status filter)
 *   - POST /admin/users/invitations/:id/revoke       — revoke open invite
 *
 * Data model used here:
 *   - useApiUsers()                               → Members tab (canonical:
 *                                                   includes bootstrap +
 *                                                   pre-invite seeded users)
 *   - useApiInvitations()                         → open pipeline
 *                                                   (PENDING + EXPIRED + REVOKED)
 *   - useApiRevokeInvitation()                    → revoke action
 *
 * No MOCK data. No fake "edit role" flow — there is no API for it.
 */

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuthStore, type UserRole } from "@/store/auth.store";
import {
  Shield,
  UserPlus,
  Lock,
  Loader2,
  MailX,
  Clock,
  RefreshCw,
  Pencil,
  Trash2,
  Ban,
} from "lucide-react";
import { toast } from "sonner";

import { InviteUserDialog } from "@/components/admin-users/InviteUserDialog";
import { EditUserDialog } from "@/components/admin-users/EditUserDialog";
import {
  useApiDeleteInvitation,
  useApiDeleteUser,
  useApiInvitations,
  useApiRevokeInvitation,
  useApiUsers,
} from "@/hooks/useAdminUsersApi";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type { InvitationSummary, UserSummary } from "@instigenie/contracts";

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  MANAGEMENT: "Management",
  SALES_REP: "Sales Rep",
  SALES_MANAGER: "Sales Manager",
  FINANCE: "Finance",
  PRODUCTION: "Production Operator",
  PRODUCTION_MANAGER: "Production Manager",
  RD: "R&D / Engineering",
  QC_INSPECTOR: "QC Inspector",
  QC_MANAGER: "QC Manager",
  STORES: "Stores",
  CUSTOMER: "Customer Portal",
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: "Full system access including user management and audit logs",
  MANAGEMENT: "All modules (read) + approvals — no direct CRM/WO creation",
  SALES_REP: "Own deals, leads, accounts, dispatch, support tickets",
  SALES_MANAGER: "All CRM data across reps, pipeline reports, reassignment",
  FINANCE: "PO approval, invoices, ledger, GST, Tally export",
  PRODUCTION: "WIP stage advancement, component assignment, stage notes",
  PRODUCTION_MANAGER:
    "All production + manual WO creation, scheduling, capacity",
  RD: "BOM creation/editing (DRAFT), ECN initiation",
  QC_INSPECTOR: "Inspection queue, defect logging, certificate issuance",
  QC_MANAGER: "All QC + template management, quarantine, amendment",
  STORES: "Inward entry, cycle count, stock adjustment, transfers",
  CUSTOMER: "Own orders, invoices, QC certs, support tickets (portal only)",
};

const ROLE_COLORS: Partial<Record<UserRole, string>> = {
  SUPER_ADMIN: "bg-red-50 text-red-700 border-red-200",
  MANAGEMENT: "bg-purple-50 text-purple-700 border-purple-200",
  SALES_REP: "bg-blue-50 text-blue-700 border-blue-200",
  SALES_MANAGER: "bg-blue-50 text-blue-700 border-blue-200",
  FINANCE: "bg-green-50 text-green-700 border-green-200",
  PRODUCTION: "bg-amber-50 text-amber-700 border-amber-200",
  PRODUCTION_MANAGER: "bg-orange-50 text-orange-700 border-orange-200",
  RD: "bg-cyan-50 text-cyan-700 border-cyan-200",
  QC_INSPECTOR: "bg-indigo-50 text-indigo-700 border-indigo-200",
  QC_MANAGER: "bg-violet-50 text-violet-700 border-violet-200",
  STORES: "bg-teal-50 text-teal-700 border-teal-200",
  CUSTOMER: "bg-gray-50 text-gray-600 border-gray-200",
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiProblem) {
    return err.problem.detail ?? err.problem.title;
  }
  return fallback;
}

export default function UsersRolesPage() {
  const { user: currentUser, role: currentRole } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"users" | "roles">("users");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);

  // Permission gate — both queries are gated on enabled so role-switch in
  // dev doesn't fire 403s. Queries auto-refetch when `enabled` flips.
  const isAdmin = currentRole === "SUPER_ADMIN";

  const membersQuery = useApiUsers(isAdmin ? { limit: 200 } : {});
  const pipelineQuery = useApiInvitations(isAdmin ? { limit: 200 } : {});
  const revokeMutation = useApiRevokeInvitation();
  const deleteInvitationMutation = useApiDeleteInvitation();
  const deleteUserMutation = useApiDeleteUser();

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <Lock className="h-6 w-6 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            User &amp; Role management is restricted to Super Admin only. Your
            current role is{" "}
            <span className="font-medium">
              {currentRole ? ROLE_LABELS[currentRole] : "Unknown"}
            </span>
            .
          </p>
          <p className="text-xs text-muted-foreground">
            Use the role switcher in the sidebar to switch to Super Admin.
          </p>
        </div>
      </div>
    );
  }

  const members = membersQuery.data?.items ?? [];
  const pipeline = pipelineQuery.data?.items ?? [];

  // Role-usage tally for the Role Definitions tab — drawn from the canonical
  // members list (users + memberships + user_roles), so bootstrap and seeded
  // users are now included.
  const roleCount = Object.entries(
    members.reduce(
      (acc, m) => {
        for (const r of m.roles) acc[r] = (acc[r] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  ).sort((a, b) => b[1] - a[1]);

  function handleRevoke(invitation: InvitationSummary) {
    if (revokeMutation.isPending) return;
    revokeMutation.mutate(invitation.id, {
      onSuccess: () => {
        toast.success(`Revoked invite to ${invitation.email}.`);
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not revoke invite."));
      },
    });
  }

  function handleDeleteInvitation(invitation: InvitationSummary) {
    if (deleteInvitationMutation.isPending) return;
    const ok = window.confirm(
      `Permanently delete the invitation for ${invitation.email}? This cannot be undone.`,
    );
    if (!ok) return;
    deleteInvitationMutation.mutate(invitation.id, {
      onSuccess: () => {
        toast.success(`Deleted invite to ${invitation.email}.`);
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete invite."));
      },
    });
  }

  function handleRemoveMember(u: UserSummary) {
    if (deleteUserMutation.isPending) return;
    const ok = window.confirm(
      `Remove ${u.name || u.email} from this organisation? Their role grants and active sessions will be revoked. They can be re-invited later.`,
    );
    if (!ok) return;
    deleteUserMutation.mutate(u.id, {
      onSuccess: () => {
        toast.success(`Removed ${u.email} from the organisation.`);
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not remove member."));
      },
    });
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <EditUserDialog
        user={editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users &amp; Roles</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage system users and their access permissions. All permissions
            enforced at API layer.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      <div className="flex gap-2 border-b pb-0">
        {(["users", "roles"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "users" ? "Users" : "Role Definitions"}
          </button>
        ))}
      </div>

      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Members (joined)</p>
              <p className="text-2xl font-bold mt-1">
                {membersQuery.isPending ? "—" : members.length}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Pending Invites</p>
              <p className="text-2xl font-bold mt-1 text-blue-600">
                {pipelineQuery.isPending
                  ? "—"
                  : pipeline.filter((i) => i.status === "PENDING").length}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Expired</p>
              <p className="text-2xl font-bold mt-1 text-amber-600">
                {pipelineQuery.isPending
                  ? "—"
                  : pipeline.filter((i) => i.status === "EXPIRED").length}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Roles in Use</p>
              <p className="text-2xl font-bold mt-1">
                {membersQuery.isPending
                  ? "—"
                  : new Set(members.flatMap((m) => m.roles)).size}
              </p>
            </Card>
          </div>

          <MembersCard
            users={members}
            loading={membersQuery.isPending}
            fetching={membersQuery.isFetching}
            error={
              membersQuery.error
                ? errorMessage(
                    membersQuery.error,
                    "Couldn't load members. Is the API running?",
                  )
                : null
            }
            currentUserId={currentUser?.id ?? null}
            removingId={
              deleteUserMutation.isPending
                ? (deleteUserMutation.variables ?? null)
                : null
            }
            onRefresh={() => void membersQuery.refetch()}
            onEdit={(u) => setEditing(u)}
            onRemove={handleRemoveMember}
          />

          <PipelineCard
            invitations={pipeline}
            loading={pipelineQuery.isPending}
            fetching={pipelineQuery.isFetching}
            error={
              pipelineQuery.error
                ? errorMessage(
                    pipelineQuery.error,
                    "Couldn't load invitations. Is the API running?",
                  )
                : null
            }
            revokingId={
              revokeMutation.isPending
                ? (revokeMutation.variables ?? null)
                : null
            }
            deletingId={
              deleteInvitationMutation.isPending
                ? (deleteInvitationMutation.variables ?? null)
                : null
            }
            onRevoke={handleRevoke}
            onDelete={handleDeleteInvitation}
            onRefresh={() => void pipelineQuery.refetch()}
          />
        </div>
      )}

      {activeTab === "roles" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 mb-2">
            {roleCount.length === 0 && !membersQuery.isPending && (
              <p className="text-xs text-muted-foreground">
                No member-role data yet — invite a user to populate this view.
              </p>
            )}
            {roleCount.map(([role, count]) => (
              <span
                key={role}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                  ROLE_COLORS[role as UserRole] ??
                  "bg-gray-50 text-gray-600 border-gray-200"
                }`}
              >
                {ROLE_LABELS[role as UserRole]}
                <Badge variant="secondary" className="h-4 text-[10px] px-1">
                  {count}
                </Badge>
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => {
              const usage = members.filter((m) => m.roles.includes(role))
                .length;
              return (
                <Card key={role} className="overflow-hidden">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold">
                        {ROLE_LABELS[role]}
                      </CardTitle>
                      <div className="flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {usage} user{usage !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-xs text-muted-foreground">
                      {ROLE_DESCRIPTIONS[role]}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            All permissions are enforced at the API middleware layer — not just
            the UI. Frontend role restrictions are a UX feature only.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Members card ─────────────────────────────────────────────────────────

interface MembersCardProps {
  users: UserSummary[];
  loading: boolean;
  fetching: boolean;
  error: string | null;
  currentUserId: string | null;
  removingId: string | null;
  onRefresh: () => void;
  onEdit: (user: UserSummary) => void;
  onRemove: (user: UserSummary) => void;
}

function MembersCard({
  users,
  loading,
  fetching,
  error,
  currentUserId,
  removingId,
  onRefresh,
  onEdit,
  onRemove,
}: MembersCardProps) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h3 className="text-sm font-semibold">Members</h3>
          <p className="text-xs text-muted-foreground">
            {users.length} active member
            {users.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={fetching}
        >
          {fetching ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Loading
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </>
          )}
        </Button>
      </div>
      {error ? (
        <p className="px-4 py-6 text-sm text-destructive">{error}</p>
      ) : loading ? (
        <p className="px-4 py-8 text-sm text-muted-foreground flex items-center gap-2 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading members…
        </p>
      ) : users.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted-foreground text-center">
          No active members yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-44 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const initials = (u.name || u.email).slice(0, 2).toUpperCase();
              const isSuspended = u.membershipStatus === "SUSPENDED";
              const isSelf = currentUserId === u.id;
              const isRemoving = removingId === u.id;
              return (
                <TableRow key={u.id} className="hover:bg-muted/20">
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                        {initials}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium break-all">
                          {u.name}
                        </span>
                        <span className="text-xs text-muted-foreground break-all">
                          {u.email}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      ) : (
                        u.roles.map((r) => (
                          <span
                            key={r}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                              ROLE_COLORS[r as UserRole] ??
                              "bg-gray-50 text-gray-600 border-gray-200"
                            }`}
                          >
                            {ROLE_LABELS[r as UserRole] ?? r}
                          </span>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                        isSuspended
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-green-50 text-green-700 border-green-200"
                      }`}
                    >
                      {isSuspended ? (
                        <>
                          <Ban className="h-3 w-3" /> Suspended
                        </>
                      ) : (
                        "Active"
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.joinedAt
                      ? new Date(u.joinedAt).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => onEdit(u)}
                        disabled={isRemoving}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        disabled={isSelf || isRemoving}
                        title={
                          isSelf
                            ? "You cannot remove your own membership"
                            : "Remove this member from the organisation"
                        }
                        onClick={() => onRemove(u)}
                      >
                        {isRemoving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                          </>
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── Pipeline card (PENDING + EXPIRED + REVOKED) ─────────────────────────

interface PipelineCardProps {
  invitations: InvitationSummary[];
  loading: boolean;
  fetching: boolean;
  error: string | null;
  revokingId: string | null;
  deletingId: string | null;
  onRevoke: (invitation: InvitationSummary) => void;
  onDelete: (invitation: InvitationSummary) => void;
  onRefresh: () => void;
}

function PipelineCard({
  invitations,
  loading,
  fetching,
  error,
  revokingId,
  deletingId,
  onRevoke,
  onDelete,
  onRefresh,
}: PipelineCardProps) {
  const pending = invitations.filter((i) => i.status === "PENDING");
  const closed = invitations.filter((i) => i.status !== "PENDING");

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h3 className="text-sm font-semibold">Invitations</h3>
          <p className="text-xs text-muted-foreground">
            {pending.length} pending · {closed.length} closed
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={fetching}
        >
          {fetching ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Loading
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </>
          )}
        </Button>
      </div>
      {error ? (
        <p className="px-4 py-6 text-sm text-destructive">{error}</p>
      ) : loading ? (
        <p className="px-4 py-8 text-sm text-muted-foreground flex items-center gap-2 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading invitations…
        </p>
      ) : invitations.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted-foreground text-center">
          No invitations yet. Use{" "}
          <span className="font-medium">Invite User</span> above to send the
          first one.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-44 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invite) => {
              const roleLabel =
                ROLE_LABELS[invite.roleId as UserRole] ?? invite.roleId;
              const isRevoking = revokingId === invite.id;
              const isDeleting = deletingId === invite.id;
              return (
                <TableRow key={invite.id} className="hover:bg-muted/20">
                  <TableCell className="text-sm font-medium break-all">
                    {invite.email}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                        ROLE_COLORS[invite.roleId as UserRole] ??
                        "bg-gray-50 text-gray-600 border-gray-200"
                      }`}
                    >
                      {roleLabel}
                    </span>
                  </TableCell>
                  <TableCell>
                    <InvitationStatusChip status={invite.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(invite.expiresAt).toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {invite.status === "PENDING" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isRevoking || isDeleting}
                          onClick={() => onRevoke(invite)}
                          className="h-7 text-xs"
                        >
                          {isRevoking ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <MailX className="h-3.5 w-3.5 mr-1" /> Revoke
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isDeleting || isRevoking}
                        onClick={() => onDelete(invite)}
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        title="Permanently delete this invitation row"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                          </>
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function InvitationStatusChip({
  status,
}: {
  status: InvitationSummary["status"];
}) {
  const classes: Record<InvitationSummary["status"], string> = {
    PENDING: "bg-blue-50 text-blue-700 border-blue-200",
    EXPIRED: "bg-gray-50 text-gray-600 border-gray-200",
    REVOKED: "bg-red-50 text-red-700 border-red-200",
    ACCEPTED: "bg-green-50 text-green-700 border-green-200",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${classes[status]}`}
    >
      {status}
    </span>
  );
}
