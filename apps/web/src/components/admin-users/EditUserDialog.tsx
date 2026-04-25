"use client";

/**
 * EditUserDialog — wraps PATCH /admin/users/:id.
 *
 * Three editable fields: name, role (single — replaces existing grants),
 * and membership status (ACTIVE | SUSPENDED). Email + identity_id are not
 * editable here — those tie the user to an identity row and shouldn't
 * change post-acceptance.
 *
 * Submit is a no-op when nothing changed (we'd send `{}` and the schema
 * would 400 with "provide at least one"). The button is disabled in that
 * state so users see the contract before they hit submit.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useApiUpdateUser } from "@/hooks/useAdminUsersApi";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import {
  ROLES,
  type EditableMembershipStatus,
  type Role,
  type UpdateUserRequest,
  type UserSummary,
} from "@instigenie/contracts";

const ROLE_LABELS: Record<Role, string> = {
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

const ASSIGNABLE_ROLES: readonly Role[] = ROLES.filter((r) => r !== "CUSTOMER");

const STATUS_LABELS: Record<EditableMembershipStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
};

export interface EditUserDialogProps {
  user: UserSummary | null;
  onOpenChange: (open: boolean) => void;
}

export function EditUserDialog({
  user,
  onOpenChange,
}: EditUserDialogProps): React.JSX.Element {
  const open = user !== null;
  const initialRole = (user?.roles[0] ?? "") as Role | "";
  const initialStatus: EditableMembershipStatus =
    user?.membershipStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";

  const [name, setName] = useState(user?.name ?? "");
  const [roleId, setRoleId] = useState<Role | "">(initialRole);
  const [status, setStatus] = useState<EditableMembershipStatus>(initialStatus);
  const [error, setError] = useState<string>("");

  const updateMutation = useApiUpdateUser();
  const isPending = updateMutation.isPending;

  // Re-seed the form whenever the dialog opens against a different user
  // (or re-opens after a previous edit). React 19 stable-id rule allows
  // this since we key off `user?.id`.
  useEffect(() => {
    if (user) {
      setName(user.name);
      setRoleId((user.roles[0] ?? "") as Role | "");
      setStatus(
        user.membershipStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      );
      setError("");
    }
  }, [user]);

  function buildPatch(): UpdateUserRequest | null {
    if (!user) return null;
    const patch: UpdateUserRequest = {};
    const trimmed = name.trim();
    if (trimmed && trimmed !== user.name) patch.name = trimmed;
    if (roleId && roleId !== (user.roles[0] ?? "")) patch.roleId = roleId;
    if (status !== initialStatus) patch.membershipStatus = status;
    if (
      patch.name === undefined &&
      patch.roleId === undefined &&
      patch.membershipStatus === undefined
    ) {
      return null;
    }
    return patch;
  }

  function handleClose(): void {
    setError("");
    onOpenChange(false);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!user) return;
    setError("");
    const patch = buildPatch();
    if (!patch) {
      setError("Nothing to save — change something first.");
      return;
    }
    updateMutation.mutate(
      { id: user.id, body: patch },
      {
        onSuccess: (updated) => {
          toast.success(`Updated ${updated.email}.`);
          handleClose();
        },
        onError: (err) => {
          if (err instanceof ApiProblem) {
            setError(err.problem.detail ?? err.problem.title);
          } else {
            setError("Could not reach the API. Is it running on :4000?");
          }
        },
      },
    );
  }

  const patch = user ? buildPatch() : null;
  const canSubmit = !!user && !isPending && patch !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
        </DialogHeader>

        {user && (
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                value={user.email}
                disabled
                readOnly
                className="text-muted-foreground"
              />
              <p className="text-[11px] text-muted-foreground">
                Email is tied to the identity and cannot be changed here.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={roleId}
                onValueChange={(v) => setRoleId((v ?? "") as Role)}
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role…" />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Switching roles replaces this user&apos;s existing role
                grants.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) =>
                  setStatus(v as EditableMembershipStatus)
                }
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(STATUS_LABELS) as EditableMembershipStatus[]
                  ).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Suspended users keep their record but cannot sign in.
              </p>
            </div>

            {error && (
              <p className="text-xs text-destructive leading-snug">{error}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save changes
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
