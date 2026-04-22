"use client";

/**
 * /vendor-admin/tenants/[orgId] — tenant detail + lifecycle actions.
 *
 * Three mutations live here:
 *   - Suspend     (ACTIVE / TRIAL → SUSPENDED)
 *   - Reinstate   (SUSPENDED      → ACTIVE)
 *   - Change plan (any → any — the audit entry captures old + new codes)
 *
 * Each action requires a reason (min 1, max 1000 chars — enforced by the
 * vendor-admin contract schemas). After any successful mutation we:
 *   1. Re-fetch the tenant row so the UI reflects the new status / plan.
 *   2. Re-fetch the last 10 audit rows for this org so the vendor sees
 *      their action land immediately — proves the write path end-to-end.
 *
 * A failed mutation keeps the dialog open and surfaces the Problem message
 * inline; the tenant data is NOT reloaded on failure (it didn't change).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import type { PlanCode, TenantStatus } from "@instigenie/contracts/billing";
import type {
  VendorActionLogEntry,
  VendorTenantRow,
} from "@instigenie/contracts/vendor-admin";
import { PLAN_CODES } from "@instigenie/contracts/billing";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  apiVendorGetTenant,
  apiVendorListAudit,
  apiVendorReinstateTenant,
  apiVendorSuspendTenant,
  apiVendorChangePlan,
  ApiProblem,
} from "@/lib/api/vendor-admin";

type DialogKind = "suspend" | "reinstate" | "change-plan" | null;

export default function TenantDetailPage() {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params?.orgId;

  const [tenant, setTenant] = useState<VendorTenantRow | null>(null);
  const [auditRows, setAuditRows] = useState<VendorActionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<DialogKind>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [row, audit] = await Promise.all([
        apiVendorGetTenant(orgId),
        apiVendorListAudit({ orgId, limit: 10, offset: 0 }),
      ]);
      setTenant(row);
      setAuditRows(audit.items);
    } catch (err) {
      setLoadError(
        err instanceof ApiProblem
          ? err.problem.detail ?? err.problem.title
          : "Could not load tenant."
      );
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!orgId) return null;

  if (loading && !tenant) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (loadError && !tenant) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/vendor-admin/tenants")}
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to tenants
        </Button>
        <Card>
          <CardContent className="pt-6 text-rose-600 text-sm">
            {loadError}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tenant) return null;

  const canSuspend = tenant.status === "ACTIVE" || tenant.status === "TRIAL";
  const canReinstate = tenant.status === "SUSPENDED";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/vendor-admin/tenants"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " text-slate-600 -ml-3"}
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to tenants
        </Link>
      </div>

      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tenant.name}</h1>
          <p className="font-mono text-xs text-slate-400 mt-1">{tenant.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={canSuspend ? "destructive" : "outline"}
            disabled={!canSuspend}
            onClick={() => setDialog("suspend")}
          >
            <PauseCircle className="h-4 w-4 mr-1.5" />
            Suspend
          </Button>
          <Button
            variant="default"
            disabled={!canReinstate}
            onClick={() => setDialog("reinstate")}
            className={canReinstate ? "bg-emerald-600 hover:bg-emerald-700" : ""}
          >
            <PlayCircle className="h-4 w-4 mr-1.5" />
            Reinstate
          </Button>
          <Button variant="outline" onClick={() => setDialog("change-plan")}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Change plan
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500 font-medium">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusBadge status={tenant.status} />
            <div className="mt-3 text-xs text-slate-500 space-y-0.5">
              {tenant.status === "SUSPENDED" && tenant.suspendedAt && (
                <div>Suspended {formatDate(tenant.suspendedAt)}</div>
              )}
              {tenant.status === "TRIAL" && tenant.trialEndsAt && (
                <div>Trial ends {formatDate(tenant.trialEndsAt)}</div>
              )}
              {tenant.status === "DELETED" && tenant.deletedAt && (
                <div>Deleted {formatDate(tenant.deletedAt)}</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500 font-medium">
              Plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenant.plan ? (
              <div>
                <Badge variant="outline" className="text-sm">
                  {tenant.plan.code}
                </Badge>
                <div className="mt-2 text-sm text-slate-700">
                  {tenant.plan.name}
                </div>
              </div>
            ) : (
              <span className="text-sm text-slate-400">
                No active subscription
              </span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500 font-medium">
              Billing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenant.subscription ? (
              <div className="text-sm space-y-1">
                <div className="font-medium">{tenant.subscription.status}</div>
                <div className="text-xs text-slate-500">
                  Renews {formatDate(tenant.subscription.currentPeriodEnd)}
                </div>
                {tenant.subscription.cancelAtPeriodEnd && (
                  <div className="text-xs text-amber-600">
                    Cancels at period end
                  </div>
                )}
              </div>
            ) : (
              <span className="text-sm text-slate-400">—</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {auditRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No audit entries for this tenant yet.
            </p>
          ) : (
            auditRows.map((entry) => (
              <AuditEntryRow key={entry.id} entry={entry} />
            ))
          )}
          {auditRows.length > 0 && (
            <div className="pt-2">
              <Link
                href={`/vendor-admin/audit?orgId=${tenant.id}`}
                className={buttonVariants({ variant: "link", size: "sm" }) + " px-0"}
              >
                See full audit log →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <SuspendDialog
        open={dialog === "suspend"}
        onClose={() => setDialog(null)}
        orgId={orgId}
        onDone={() => {
          toast.success("Tenant suspended.");
          setDialog(null);
          void load();
        }}
      />
      <ReinstateDialog
        open={dialog === "reinstate"}
        onClose={() => setDialog(null)}
        orgId={orgId}
        onDone={() => {
          toast.success("Tenant reinstated.");
          setDialog(null);
          void load();
        }}
      />
      <ChangePlanDialog
        open={dialog === "change-plan"}
        onClose={() => setDialog(null)}
        orgId={orgId}
        currentPlan={tenant.plan?.code ?? null}
        onDone={(newPlan) => {
          toast.success(`Plan changed to ${newPlan}.`);
          setDialog(null);
          void load();
        }}
      />
    </div>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

function SuspendDialog({
  open,
  onClose,
  orgId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-rose-500" />
            Suspend tenant
          </DialogTitle>
          <DialogDescription>
            The tenant will lose access immediately. Their data is retained —
            use Reinstate to restore access later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="suspend-reason">Reason (required)</Label>
          <Textarea
            id="suspend-reason"
            placeholder="e.g. non-payment after Day 45, confirmed by Finance."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            disabled={submitting}
          />
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || submitting}
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await apiVendorSuspendTenant(orgId, { reason: reason.trim() });
                onDone();
              } catch (err) {
                setError(
                  err instanceof ApiProblem
                    ? err.problem.detail ?? err.problem.title
                    : "Suspend failed."
                );
                setSubmitting(false);
              }
            }}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Suspend tenant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReinstateDialog({
  open,
  onClose,
  orgId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-emerald-500" />
            Reinstate tenant
          </DialogTitle>
          <DialogDescription>
            Status returns to ACTIVE. Existing subscription is untouched.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reinstate-reason">Reason (required)</Label>
          <Textarea
            id="reinstate-reason"
            placeholder="e.g. payment received, ticket #1234."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            disabled={submitting}
          />
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || submitting}
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={async () => {
              setSubmitting(true);
              setError(null);
              try {
                await apiVendorReinstateTenant(orgId, {
                  reason: reason.trim(),
                });
                onDone();
              } catch (err) {
                setError(
                  err instanceof ApiProblem
                    ? err.problem.detail ?? err.problem.title
                    : "Reinstate failed."
                );
                setSubmitting(false);
              }
            }}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Reinstate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangePlanDialog({
  open,
  onClose,
  orgId,
  currentPlan,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  currentPlan: PlanCode | null;
  onDone: (newPlan: PlanCode) => void;
}) {
  const [plan, setPlan] = useState<PlanCode | "">("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPlan("");
      setReason("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-sky-500" />
            Change plan
          </DialogTitle>
          <DialogDescription>
            Swap the tenant&apos;s subscription to a different plan. Entitlement
            caches refresh on next request.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Current plan</Label>
            <div className="text-sm">
              {currentPlan ? (
                <Badge variant="outline">{currentPlan}</Badge>
              ) : (
                <span className="text-slate-500">No active subscription</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan">New plan (required)</Label>
            <Select
              value={plan}
              onValueChange={(v) => setPlan(v as PlanCode)}
              disabled={submitting}
            >
              <SelectTrigger id="new-plan">
                <SelectValue placeholder="Pick a plan…" />
              </SelectTrigger>
              <SelectContent>
                {PLAN_CODES.map((code) => (
                  <SelectItem
                    key={code}
                    value={code}
                    disabled={code === currentPlan}
                  >
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="change-reason">Reason (required)</Label>
            <Textarea
              id="change-reason"
              placeholder="e.g. upgraded via sales negotiation, PO #2025-04-11."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              disabled={submitting}
            />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={!plan || !reason.trim() || submitting}
            onClick={async () => {
              if (!plan) return;
              setSubmitting(true);
              setError(null);
              try {
                await apiVendorChangePlan(orgId, {
                  planCode: plan,
                  reason: reason.trim(),
                });
                onDone(plan);
              } catch (err) {
                setError(
                  err instanceof ApiProblem
                    ? err.problem.detail ?? err.problem.title
                    : "Change plan failed."
                );
                setSubmitting(false);
              }
            }}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Apply change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Small shared bits ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TenantStatus }) {
  const cfg: Record<TenantStatus, { bg: string; text: string; dot: string }> = {
    TRIAL: { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" },
    ACTIVE: {
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      dot: "bg-emerald-500",
    },
    SUSPENDED: { bg: "bg-amber-50", text: "text-amber-800", dot: "bg-amber-500" },
    DELETED: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  };
  const s = cfg[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.bg} ${s.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function AuditEntryRow({ entry }: { entry: VendorActionLogEntry }) {
  const details = entry.details as Record<string, unknown> | null;
  const summary = summarizeDetails(entry.action, details);
  return (
    <div className="flex items-start gap-3 text-sm py-1.5 border-b border-slate-100 last:border-b-0">
      <Badge
        variant="outline"
        className="text-[11px] font-normal shrink-0"
      >
        {ACTION_LABELS[entry.action] ?? entry.action}
      </Badge>
      <div className="flex-1 min-w-0">
        {summary && <div className="text-slate-700">{summary}</div>}
        <div className="text-xs text-slate-500">
          {entry.vendorAdminEmail ?? "unknown"} ·{" "}
          {formatDateTime(entry.createdAt)}
        </div>
      </div>
    </div>
  );
}

// Friendlier action names. Falls back to the raw action string for anything
// not in the map so new action types don't silently go unlabelled.
const ACTION_LABELS: Record<string, string> = {
  "tenant.list": "Browsed tenants",
  "tenant.view_audit": "Viewed audit log",
  "tenant.suspend": "Suspended",
  "tenant.reinstate": "Reinstated",
  "tenant.change_plan": "Changed plan",
};

function summarizeDetails(
  action: string,
  details: Record<string, unknown> | null
): string | null {
  if (!details) return null;
  if (action === "tenant.change_plan") {
    const o = details.oldPlanCode ?? "—";
    const n = details.newPlanCode ?? "—";
    return `${o} → ${n}${details.reason ? ` · ${String(details.reason)}` : ""}`;
  }
  if (typeof details.reason === "string") return String(details.reason);
  return null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
