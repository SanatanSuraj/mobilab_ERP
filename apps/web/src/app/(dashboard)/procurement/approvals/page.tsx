"use client";

/**
 * Approval Inbox — reads /procurement/purchase-orders?status=PENDING_APPROVAL
 * via useApiPurchaseOrders. Approve / Reject hit the dedicated transition
 * endpoints (see hooks/useProcurementApi.ts).
 *
 * Workflow note: Phase 2 collapses the older PENDING_FINANCE / PENDING_MGMT
 * double-step model to a single PENDING_APPROVAL step. The finance-specific
 * variant (high-value POs only) lives at /finance/approvals and is the same
 * surface filtered by `minTotal`.
 *
 * Concurrency: every mutation passes `expectedVersion` from the cached PO
 * row. Stale UI submits surface as 409 conflict via the shared mutation
 * error path.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiApprovalHistory,
  useApiApprovePurchaseOrder,
  useApiPurchaseOrders,
  useApiRejectPurchaseOrder,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import type { PoApproval, PurchaseOrder } from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  History,
  Inbox,
  TrendingUp,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function formatMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw ?? "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  return Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function avgGrandTotal(rows: PurchaseOrder[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, p) => acc + (Number(p.grandTotal) || 0), 0);
  return Math.round(sum / rows.length);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

interface POCardProps {
  po: PurchaseOrder;
  vendorName: string;
  busy: boolean;
  onApprove: (po: PurchaseOrder) => void;
  onReject: (po: PurchaseOrder) => void;
  onHistory: (po: PurchaseOrder) => void;
  onView: (id: string) => void;
}

function POCard({
  po,
  vendorName,
  busy,
  onApprove,
  onReject,
  onHistory,
  onView,
}: POCardProps) {
  const days = daysUntil(po.expectedDate);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5 space-y-4">
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-mono font-bold text-base">{po.poNumber}</p>
            <p className="font-semibold text-sm mt-0.5">{vendorName}</p>
            <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span>Ordered {formatDate(po.orderDate)}</span>
              <span>v{po.version}</span>
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-bold">{formatMoney(po.grandTotal)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {po.currency} • net {po.paymentTermsDays}d
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-3 border-t text-sm flex-wrap">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Expected{" "}
              <span className="font-medium text-foreground">
                {formatDate(po.expectedDate)}
              </span>
            </span>
          </div>
          {days != null && (
            <Badge
              className={
                days < 0
                  ? "bg-red-100 text-red-700 border-red-200 text-xs"
                  : days <= 3
                    ? "bg-amber-100 text-amber-700 border-amber-200 text-xs"
                    : "bg-blue-100 text-blue-700 border-blue-200 text-xs"
              }
            >
              {days < 0
                ? `${Math.abs(days)}d overdue`
                : days === 0
                  ? "Due today"
                  : `${days}d remaining`}
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
              disabled={busy}
              onClick={() => onApprove(po)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 h-8 text-xs"
              disabled={busy}
              onClick={() => onReject(po)}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => onHistory(po)}
            >
              <History className="h-3.5 w-3.5 mr-1" />
              History
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => onView(po.id)}
            >
              View PO
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message?: string }) {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <div className="flex justify-center mb-4">
          <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7 text-green-600" />
          </div>
        </div>
        <p className="font-semibold text-lg">All approvals up to date</p>
        <p className="text-muted-foreground text-sm mt-1">
          {message ?? "No purchase orders are pending approval."}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Approval-history modal (lazy — only fetches when opened)
// ---------------------------------------------------------------------------

function HistoryDialog({
  po,
  open,
  onOpenChange,
}: {
  po: PurchaseOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const history = useApiApprovalHistory(open ? po?.id : undefined);
  const entries: PoApproval[] = history.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Approval History
            {po && (
              <span className="ml-2 font-mono text-sm text-muted-foreground">
                {po.poNumber}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {history.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {history.isError && (
            <p className="text-sm text-red-600">
              Failed to load approval history.
            </p>
          )}
          {!history.isLoading && !history.isError && entries.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No approval actions recorded yet.
            </p>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex gap-3 p-3 rounded-md border bg-muted/30"
            >
              <div className="flex-shrink-0 mt-0.5">
                {entry.action === "APPROVE" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">
                    {entry.action === "APPROVE" ? "Approved" : "Rejected"}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {entry.priorStatus} → {entry.newStatus}
                  </Badge>
                </div>
                {entry.remarks && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {entry.remarks}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDate(entry.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ApprovalsPage() {
  const router = useRouter();

  const posQuery = useApiPurchaseOrders({
    status: "PENDING_APPROVAL",
    limit: 100,
  });
  const vendorsQuery = useApiVendors({ limit: 200 });

  const pos: PurchaseOrder[] = posQuery.data?.data ?? [];
  const vendorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendorsQuery.data?.data ?? []) map.set(v.id, v.name);
    return map;
  }, [vendorsQuery.data]);

  // ─── Mutation hooks. Targets are set just-in-time; we re-init on the fly
  //     by swapping the poId via state below. We use one transient hook per
  //     action triggered by the dialog because the hook factory takes poId
  //     up-front. (For low-volume approvals UI this is fine; for bulk we'd
  //     refactor to a single mutation that accepts {poId, body}.)

  const [approveTarget, setApproveTarget] = useState<PurchaseOrder | null>(
    null
  );
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveRemarks, setApproveRemarks] = useState("");

  const [rejectTarget, setRejectTarget] = useState<PurchaseOrder | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [historyTarget, setHistoryTarget] = useState<PurchaseOrder | null>(
    null
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);

  const approveMutation = useApiApprovePurchaseOrder(approveTarget?.id ?? "");
  const rejectMutation = useApiRejectPurchaseOrder(rejectTarget?.id ?? "");

  const totalPending = pos.length;
  const avgValue = useMemo(() => avgGrandTotal(pos), [pos]);
  const overdue = useMemo(() => {
    return pos.filter((p) => {
      const d = daysUntil(p.expectedDate);
      return d != null && d < 0;
    }).length;
  }, [pos]);

  const onApproveClick = useCallback((po: PurchaseOrder) => {
    setApproveTarget(po);
    setApproveRemarks("");
    setActionError(null);
    setApproveOpen(true);
  }, []);

  const onRejectClick = useCallback((po: PurchaseOrder) => {
    setRejectTarget(po);
    setRejectReason("");
    setActionError(null);
    setRejectOpen(true);
  }, []);

  const onHistoryClick = useCallback((po: PurchaseOrder) => {
    setHistoryTarget(po);
    setHistoryOpen(true);
  }, []);

  const onView = useCallback(
    (id: string) => router.push(`/procurement/purchase-orders/${id}`),
    [router]
  );

  async function handleApprove() {
    if (!approveTarget) return;
    try {
      await approveMutation.mutateAsync({
        expectedVersion: approveTarget.version,
        remarks: approveRemarks.trim() || undefined,
      });
      setApproveOpen(false);
      setApproveTarget(null);
      setApproveRemarks("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approval failed");
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    const remarks = rejectReason.trim();
    if (!remarks) {
      setActionError("Rejection reason is required.");
      return;
    }
    try {
      await rejectMutation.mutateAsync({
        expectedVersion: rejectTarget.version,
        remarks,
      });
      setRejectOpen(false);
      setRejectTarget(null);
      setRejectReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rejection failed");
    }
  }

  // ─── Loading / error shells ───────────────────────────────────────────────

  if (posQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (posQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto" />
            <p className="font-semibold">Failed to load approval inbox</p>
            <p className="text-sm text-muted-foreground">
              {posQuery.error instanceof Error
                ? posQuery.error.message
                : "Unknown error"}
            </p>
            <Button onClick={() => posQuery.refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const busyId =
    approveMutation.isPending && approveTarget
      ? approveTarget.id
      : rejectMutation.isPending && rejectTarget
        ? rejectTarget.id
        : null;

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Approval Inbox"
        description="Purchase orders pending approval"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Pending"
          value={String(totalPending)}
          icon={Inbox}
          iconColor="text-primary"
        />
        <KPICard
          title="Overdue"
          value={String(overdue)}
          icon={AlertCircle}
          iconColor="text-red-500"
        />
        <KPICard
          title="Avg PO Value"
          value={avgValue > 0 ? formatMoney(String(avgValue)) : "—"}
          icon={TrendingUp}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Vendors Loaded"
          value={String(vendorMap.size)}
          icon={Inbox}
          iconColor="text-muted-foreground"
        />
      </div>

      <div className="space-y-4">
        {pos.length === 0 ? (
          <EmptyState />
        ) : (
          pos.map((po) => (
            <POCard
              key={po.id}
              po={po}
              vendorName={vendorMap.get(po.vendorId) ?? po.vendorId}
              busy={busyId === po.id}
              onApprove={onApproveClick}
              onReject={onRejectClick}
              onHistory={onHistoryClick}
              onView={onView}
            />
          ))
        )}
      </div>

      {/* Approve dialog (remarks optional) */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {approveTarget && (
              <p className="text-sm text-muted-foreground">
                Approving{" "}
                <span className="font-mono font-medium">
                  {approveTarget.poNumber}
                </span>{" "}
                — {formatMoney(approveTarget.grandTotal)}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Remarks (optional)</Label>
              <Textarea
                value={approveRemarks}
                onChange={(e) => setApproveRemarks(e.target.value)}
                placeholder="Add a note for the audit trail..."
                rows={3}
              />
            </div>
            {actionError && (
              <p className="text-sm text-red-600">{actionError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveOpen(false)}
              disabled={approveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleApprove}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? "Approving..." : "Confirm Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog (remarks required) */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {rejectTarget && (
              <p className="text-sm text-muted-foreground">
                Rejecting{" "}
                <span className="font-mono font-medium">
                  {rejectTarget.poNumber}
                </span>{" "}
                — {formatMoney(rejectTarget.grandTotal)}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Rejection Reason</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="State the reason for rejection..."
                rows={3}
              />
            </div>
            {actionError && (
              <p className="text-sm text-red-600">{actionError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={rejectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleReject}
              disabled={rejectMutation.isPending || !rejectReason.trim()}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoryDialog
        po={historyTarget}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}
