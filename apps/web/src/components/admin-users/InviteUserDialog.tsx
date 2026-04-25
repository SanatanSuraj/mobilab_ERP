"use client";

/**
 * InviteUserDialog — wraps the POST /admin/users/invite flow.
 *
 * Props:
 *   open         controlled visibility
 *   onOpenChange callback the caller uses to close the dialog
 *   onInvited    fired with the new InvitationSummary after a successful
 *                invite. The admin page uses this to prepend the row to its
 *                live list without a full round-trip refetch.
 *
 * UX contract:
 *   - Required: email + role. Everything else has a sensible default.
 *   - expiresInHours defaults to 72 (server also defaults to 72). Shown as
 *     a small slider of presets so admins don't have to think in hours.
 *   - Blocks CUSTOMER from the role dropdown client-side — the server
 *     rejects it too, but surfacing it in the UI saves a round trip.
 *   - On success in dev the API returns `devAcceptUrl`. We toast it +
 *     copy it to the clipboard so the admin can paste it into their test
 *     browser without hunting in the mailbox table.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Copy, Mail } from "lucide-react";

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

import { useApiInviteUser } from "@/hooks/useAdminUsersApi";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import { ROLES, type Role } from "@instigenie/contracts";
import type { InvitationSummary } from "@instigenie/contracts";

// Same role labels as the admin/users page — repeated locally so the dialog
// can be dropped anywhere without importing from a page file.
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

// Roles admins are allowed to invite into. CUSTOMER is portal-only — it has
// its own onboarding path (invoice links, etc.) and doesn't belong in the
// staff-invite dropdown. The API enforces this too; we just hide it.
const INVITABLE_ROLES: readonly Role[] = ROLES.filter(
  (r) => r !== "CUSTOMER",
);

const EXPIRY_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days (default)" },
  { value: 168, label: "7 days" },
];

export interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: (invitation: InvitationSummary) => void;
}

export function InviteUserDialog({
  open,
  onOpenChange,
  onInvited,
}: InviteUserDialogProps): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState<Role | "">("");
  const [expiresInHours, setExpiresInHours] = useState<number>(72);
  const [error, setError] = useState<string>("");
  const inviteMutation = useApiInviteUser();
  const isPending = inviteMutation.isPending;

  // Close helper: resets + notifies parent. Called from both the Cancel button
  // and the dialog backdrop so re-opening never shows stale state. Handled
  // inline rather than in a useEffect(→open) to avoid React 19's
  // set-state-in-effect warning; the reset is a direct user action.
  function closeAndReset(): void {
    setEmail("");
    setName("");
    setRoleId("");
    setExpiresInHours(72);
    setError("");
    onOpenChange(false);
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError("");
    if (!roleId) {
      setError("Pick a role for the invitee.");
      return;
    }
    const body = {
      email: email.trim(),
      roleId: roleId as Role,
      // Server trims + ignores empty strings, but it's cheaper to send the
      // omitted form than a blank-string "name".
      ...(name.trim() ? { name: name.trim() } : {}),
      expiresInHours,
    };
    inviteMutation.mutate(body, {
      onSuccess: async (res) => {
        onInvited?.(res.invitation);
        if (res.devAcceptUrl) {
          // Best-effort clipboard write. In insecure contexts (http without
          // user gesture) this throws — swallow and still show the URL in
          // the toast so the admin can copy manually.
          try {
            await navigator.clipboard.writeText(res.devAcceptUrl);
            toast.success("Invite created — accept URL copied to clipboard.", {
              description: res.devAcceptUrl,
            });
          } catch {
            toast.success("Invite created.", {
              description: `Dev accept URL: ${res.devAcceptUrl}`,
            });
          }
        } else {
          toast.success(`Invite sent to ${res.invitation.email}.`);
        }
        closeAndReset();
      },
      onError: (err) => {
        if (err instanceof ApiProblem) {
          setError(err.problem.detail ?? err.problem.title);
        } else {
          setError("Could not reach the API. Is it running on :4000?");
        }
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeAndReset();
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              placeholder="person@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-name">
              Name <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="invite-name"
              autoComplete="off"
              placeholder="Display name hint"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
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
                {INVITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Link expires in</Label>
            <Select
              value={String(expiresInHours)}
              onValueChange={(v) => setExpiresInHours(Number(v))}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-md px-3 py-2 flex items-start gap-2">
            <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              An email with the accept link will be queued via outbox. In dev,
              you&apos;ll also see the link in the toast above and in the
              <code className="mx-1">invitation_emails</code> table.
            </span>
          </p>

          {error && (
            <p className="text-xs text-destructive leading-snug">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeAndReset}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !email || !roleId}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Send invite
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
