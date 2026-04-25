"use client";

/**
 * Finance Approvals — finance-centric view over the same /procurement/*
 * surface. Filters by `minTotal` (high-value PO threshold) so finance
 * focuses on POs that actually require their sign-off; everything below
 * the threshold flows through the regular procurement queue.
 *
 * Backend: NO new endpoints. Reuses
 *   - GET   /procurement/purchase-orders?status=...&minTotal=...
 *   - POST  /procurement/purchase-orders/:id/approve
 *   - POST  /procurement/purchase-orders/:id/reject
 *   - GET   /procurement/purchase-orders/:id/approval-history
 *
 * Threshold is hard-coded today; promote to a tenant setting when a
 * configurable financial-policy table lands.
 */

import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiApprovalHistory,
  useApiApprovePurchaseOrder,
  useApiPurchaseOrders,
  useApiRejectPurchaseOrder,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import type {
  PoApproval,
  PoStatus,
  PurchaseOrder,
} from "@instigenie/contracts";
import {
  AlertCircle,
  Check,
  CheckCircle,
  ClipboardList,
  Clock,
  History,
  X,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Config — finance threshold (lower bound on grand_total).
// ---------------------------------------------------------------------------

const FINANCE_THRESHOLD_INR = "500000"; // ₹5,00,000+ POs require finance review.

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

const STATUS_TONE: Record<PoStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200",
  SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PARTIALLY_RECEIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RECEIVED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface POCardProps {
  po: PurchaseOrder;
  vendorName: string;
  busy: boolean;
  onApprove?: (po: PurchaseOrder) => void;
  onReject?: (po: PurchaseOrder) => void;
  onHistory: (po: PurchaseOrder) => void;
}

function POCard({
  po,
  vendorName,
  busy,
  onApprove,
  onReject,
  onHistory,
}: POCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold font-mono">
                {po.poNumber}
              </span>
              <Badge variant="outline" className={STATUS_TONE[po.status]}>
                {po.status}
              </Badge>
              <Badge
                variant="outline"
                className="bg-blue-50 text-blue-700 border-blue-200 text-xs"
              >
                Finance
              </Badge>
            </div>

            <div>
              <p className="text-sm font-medium">{vendorName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ordered {formatDate(po.orderDate)} • Expected{" "}
                {formatDate(po.expectedDate)}
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                Total:{" "}
                <span className="font-medium text-foreground">
                  {formatMoney(po.grandTotal)}
                </span>
              </span>
              <span>net {po.paymentTermsDays}d</span>
              {po.approvedAt && (
                <span>Approved: {formatDate(po.approvedAt)}</span>
              )}
            </div>
          </div>

          <div className="flex gap-1.5 shrink-0">
            {po.status === "PENDING_APPROVAL" && onApprove && onReject && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-green-600 hover:bg-green-50 hover:text-green-700"
                  disabled={busy}
                  onClick={() => onApprove(po)}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={busy}
                  onClick={() => onReject(po)}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Reject
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onHistory(po)}
              className="text-xs"
            >
              <History className="h-3.5 w-3.5 mr-1" />
              History
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History dialog
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
          {history.isLoading && <Skeleton className="h-24 w-full" />}
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
              {entry.action === "APPROVE" ? (
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              )}
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
// Page
// ---------------------------------------------------------------------------

export default function FinanceApprovalsPage() {
  // Three reads: pending (the actionable bucket), approved, rejected. All
  // share the same `minTotal` threshold so the finance view is consistent
  // across tabs. Each query is small (limit 100) and only the active tab
  // mounts its data — but React Query caches all three so tab swaps are
  // instant after the first visit.
  const pendingQuery = useApiPurchaseOrders({
    status: "PENDING_APPROVAL",
    minTotal: FINANCE_THRESHOLD_INR,
    limit: 100,
  });
  const approvedQuery = useApiPurchaseOrders({
    status: "APPROVED",
    minTotal: FINANCE_THRESHOLD_INR,
    limit: 100,
  });
  const rejectedQuery = useApiPurchaseOrders({
    status: "REJECTED",
    minTotal: FINANCE_THRESHOLD_INR,
    limit: 100,
  });
  const vendorsQuery = useApiVendors({ limit: 200 });

  const pending: PurchaseOrder[] = pendingQuery.data?.data ?? [];
  const approved: PurchaseOrder[] = approvedQuery.data?.data ?? [];
  const rejected: PurchaseOrder[] = rejectedQuery.data?.data ?? [];
  const totalCount = pending.length + approved.length + rejected.length;

  const vendorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendorsQuery.data?.data ?? []) map.set(v.id, v.name);
    return map;
  }, [vendorsQuery.data]);

  // ─── Action state ──────────────────────────────────────────────────────────

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

  if (pendingQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (pendingQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto" />
            <p className="font-semibold">Failed to load finance approvals</p>
            <p className="text-sm text-muted-foreground">
              {pendingQuery.error instanceof Error
                ? pendingQuery.error.message
                : "Unknown error"}
            </p>
            <Button onClick={() => pendingQuery.refetch()}>Retry</Button>
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

  const renderList = (
    rows: PurchaseOrder[],
    actionable: boolean,
    emptyText: string
  ) => {
    if (rows.length === 0) {
      return (
        <p className="text-sm text-muted-foreground text-center py-8">
          {emptyText}
        </p>
      );
    }
    return rows.map((po) => (
      <POCard
        key={po.id}
        po={po}
        vendorName={vendorMap.get(po.vendorId) ?? po.vendorId}
        busy={busyId === po.id}
        onApprove={actionable ? onApproveClick : undefined}
        onReject={actionable ? onRejectClick : undefined}
        onHistory={onHistoryClick}
      />
    ));
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="PO Approval Workflow"
        description={`Review high-value purchase orders (≥ ${formatMoney(
          FINANCE_THRESHOLD_INR
        )})`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total POs"
          value={String(totalCount)}
          icon={ClipboardList}
        />
        <KPICard
          title="Pending Approval"
          value={String(pending.length)}
          icon={Clock}
          change={pending.length > 0 ? "Needs action" : "Caught up"}
          trend={pending.length > 0 ? "neutral" : "up"}
        />
        <KPICard
          title="Approved"
          value={String(approved.length)}
          icon={CheckCircle}
        />
        <KPICard
          title="Rejected"
          value={String(rejected.length)}
          icon={XCircle}
        />
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            Approved ({approved.length})
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected ({rejected.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4 space-y-3">
          {renderList(pending, true, "No pending approvals")}
        </TabsContent>
        <TabsContent value="approved" className="mt-4 space-y-3">
          {renderList(approved, false, "No approved POs")}
        </TabsContent>
        <TabsContent value="rejected" className="mt-4 space-y-3">
          {renderList(rejected, false, "No rejected POs")}
        </TabsContent>
      </Tabs>

      {/* Approve dialog */}
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

      {/* Reject dialog */}
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
