"use client";

import { useState, useMemo, useCallback } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  purchaseOrders as initialPOs,
  PurchaseOrder,
  POStatus,
  formatCurrency,
  formatDate,
} from "@/data/procurement-mock";
import {
  Inbox,
  AlertCircle,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Module-level pure helpers — no component state captured
// ---------------------------------------------------------------------------

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getThresholdLabel(po: PurchaseOrder, isFinance: boolean): string {
  const pendingLog = po.approvalLogs.find(
    (l) =>
      l.action === "PENDING" &&
      (isFinance
        ? l.role.toLowerCase().includes("finance")
        : l.role.toLowerCase().includes("management") ||
          l.role.toLowerCase().includes("mgmt"))
  );
  return pendingLog?.threshold ?? (isFinance ? "Finance threshold" : "Management threshold");
}

// ---------------------------------------------------------------------------
// Module-level sub-components — stable references across parent renders
// ---------------------------------------------------------------------------

function POCard({
  po,
  isFinance,
  onApprove,
  onReject,
  onView,
}: {
  po: PurchaseOrder;
  isFinance: boolean;
  onApprove: (po: PurchaseOrder, isFinance: boolean) => void;
  onReject: (po: PurchaseOrder) => void;
  onView: (id: string) => void;
}) {
  const days = daysUntil(po.requiredDeliveryDate);
  const firstTwo = po.lines.slice(0, 2);
  const remaining = po.lines.length - 2;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex gap-4">
          {/* Left */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="font-mono font-bold text-base">
                  {po.poNumber}
                </p>
                <p className="font-semibold text-sm mt-0.5">{po.vendorName}</p>
                <div className="flex gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span>{po.warehouseName}</span>
                  <span className="font-mono">{po.costCentre}</span>
                </div>
              </div>
              {/* Center: line items */}
              <div className="hidden md:block min-w-[200px] max-w-[240px]">
                <p className="text-xs text-muted-foreground mb-1">
                  Line Items
                </p>
                {firstTwo.map((line) => (
                  <p key={line.id} className="text-sm truncate">
                    {line.qty} {line.unit} — {line.itemName}
                  </p>
                ))}
                {remaining > 0 && (
                  <p className="text-xs text-muted-foreground">
                    +{remaining} more
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right: value */}
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-bold">
              {formatCurrency(po.totalValue)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {getThresholdLabel(po, isFinance)}
            </p>
          </div>
        </div>

        {/* Delivery & countdown */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t text-sm flex-wrap">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Required by{" "}
              <span className="font-medium text-foreground">
                {formatDate(po.requiredDeliveryDate)}
              </span>
            </span>
          </div>
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

          {/* Actions */}
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
              onClick={() => onApprove(po, isFinance)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 h-8 text-xs"
              onClick={() => onReject(po)}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Reject
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

function EmptyState() {
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
          No purchase orders are pending approval in this queue.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ApprovalsPage() {
  const router = useRouter();
  const [poList, setPOList] = useState<PurchaseOrder[]>(initialPOs);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PurchaseOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [activeTab, setActiveTab] = useState("finance");

  const financePending = useMemo(
    () => poList.filter((p) => p.status === "PENDING_FINANCE"),
    [poList]
  );

  const mgmtPending = useMemo(
    () => poList.filter((p) => p.status === "PENDING_MGMT"),
    [poList]
  );

  const totalPending = useMemo(
    () => financePending.length + mgmtPending.length,
    [financePending, mgmtPending]
  );

  const avgPOValue = useMemo(() => {
    const allPending = [...financePending, ...mgmtPending];
    return allPending.length > 0
      ? Math.round(
          allPending.reduce((sum, p) => sum + p.totalValue, 0) /
            allPending.length
        )
      : 0;
  }, [financePending, mgmtPending]);

  const approve = useCallback((po: PurchaseOrder, isFinance: boolean) => {
    setPOList((prev) =>
      prev.map((p) =>
        p.id === po.id
          ? {
              ...p,
              status: "APPROVED" as POStatus,
              approvedAt: new Date().toISOString(),
              approvalLogs: p.approvalLogs.map((log) =>
                log.action === "PENDING"
                  ? {
                      ...log,
                      action: "APPROVED" as const,
                      note: isFinance
                        ? "Approved by Finance"
                        : "Approved by Management",
                      actionedAt: new Date().toISOString(),
                    }
                  : log
              ),
            }
          : p
      )
    );
  }, []);

  const openReject = useCallback((po: PurchaseOrder) => {
    setRejectTarget(po);
    setRejectReason("");
    setRejectOpen(true);
  }, []);

  function handleReject() {
    if (!rejectTarget) return;
    setPOList((prev) =>
      prev.map((p) =>
        p.id === rejectTarget.id
          ? {
              ...p,
              status: "CANCELLED" as POStatus,
              approvalLogs: p.approvalLogs.map((log) =>
                log.action === "PENDING"
                  ? {
                      ...log,
                      action: "REJECTED" as const,
                      note: rejectReason,
                      actionedAt: new Date().toISOString(),
                    }
                  : log
              ),
            }
          : p
      )
    );
    setRejectOpen(false);
    setRejectTarget(null);
    setRejectReason("");
  }

  const handleView = useCallback(
    (id: string) => router.push(`/procurement/purchase-orders/${id}`),
    [router]
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Approval Inbox"
        description="Purchase orders awaiting Finance and Management approval"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total Pending"
          value={String(totalPending)}
          icon={Inbox}
          iconColor="text-primary"
        />
        <KPICard
          title="Finance Approval"
          value={String(financePending.length)}
          icon={AlertCircle}
          iconColor="text-amber-500"
        />
        <KPICard
          title="Management Approval"
          value={String(mgmtPending.length)}
          icon={AlertCircle}
          iconColor="text-orange-500"
        />
        <KPICard
          title="Avg PO Value (Pending)"
          value={avgPOValue > 0 ? formatCurrency(avgPOValue) : "—"}
          icon={TrendingUp}
          iconColor="text-blue-600"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v ?? "finance")}>
        <TabsList>
          <TabsTrigger value="finance">
            Finance Approval
            {financePending.length > 0 && (
              <Badge className="ml-2 bg-amber-100 text-amber-700 border-amber-200 text-xs h-5 px-1.5">
                {financePending.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="mgmt">
            Management Approval
            {mgmtPending.length > 0 && (
              <Badge className="ml-2 bg-orange-100 text-orange-700 border-orange-200 text-xs h-5 px-1.5">
                {mgmtPending.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="finance" className="space-y-4 mt-4">
          {financePending.length === 0 ? (
            <EmptyState />
          ) : (
            financePending.map((po) => (
              <POCard
                key={po.id}
                po={po}
                isFinance={true}
                onApprove={approve}
                onReject={openReject}
                onView={handleView}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="mgmt" className="space-y-4 mt-4">
          {mgmtPending.length === 0 ? (
            <EmptyState />
          ) : (
            mgmtPending.map((po) => (
              <POCard
                key={po.id}
                po={po}
                isFinance={false}
                onApprove={approve}
                onReject={openReject}
                onView={handleView}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Reject Dialog */}
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
                from{" "}
                <span className="font-medium">{rejectTarget.vendorName}</span>{" "}
                — {formatCurrency(rejectTarget.totalValue)}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleReject}
              disabled={!rejectReason.trim()}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
