"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, Clock, CheckCircle, XCircle, Check, X } from "lucide-react";
import {
  purchaseOrders,
  getVendorById,
  finActivities,
  type PurchaseOrder,
  type POStatus,
} from "@/data/finance-mock";
import { getUserById, formatCurrency } from "@/data/mock";
import { toast } from "sonner";

const approvalLevelConfig: Record<string, { label: string; className: string }> = {
  auto: { label: "Auto", className: "bg-teal-50 text-teal-700 border-teal-200" },
  finance: { label: "Finance", className: "bg-blue-50 text-blue-700 border-blue-200" },
  management: { label: "Management", className: "bg-purple-50 text-purple-700 border-purple-200" },
};

export default function ApprovalsPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>(purchaseOrders);

  const pending = useMemo(() => pos.filter((p) => p.status === "pending_approval"), [pos]);
  const approved = useMemo(
    () => pos.filter((p) => ["auto_approved", "finance_approved", "management_approved"].includes(p.status)),
    [pos]
  );
  const rejected = useMemo(() => pos.filter((p) => p.status === "rejected"), [pos]);

  function handleApprove(id: string) {
    setPos((prev) =>
      prev.map((po) =>
        po.id === id
          ? {
              ...po,
              status: (po.approvalLevel === "finance"
                ? "finance_approved"
                : "management_approved") as POStatus,
              approvedBy: "u6",
              approvalDate: new Date().toISOString().split("T")[0],
            }
          : po
      )
    );
    toast.success("Purchase order approved successfully");
  }

  function handleReject(id: string) {
    setPos((prev) =>
      prev.map((po) =>
        po.id === id
          ? { ...po, status: "rejected" as POStatus, rejectionReason: "Rejected by approver" }
          : po
      )
    );
    toast.error("Purchase order rejected");
  }

  function POCard({ po }: { po: PurchaseOrder }) {
    const vendor = getVendorById(po.vendorId);
    const requester = getUserById(po.requestedBy);
    const approver = po.approvedBy && po.approvedBy !== "system" ? getUserById(po.approvedBy) : null;
    const levelCfg = approvalLevelConfig[po.approvalLevel];
    const itemsSummary = po.items.map((i) => i.description).join(", ");

    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold font-mono">{po.poNumber}</span>
                <StatusBadge status={po.status} />
                <Badge variant="outline" className={levelCfg.className}>
                  {levelCfg.label}
                </Badge>
              </div>

              <div>
                <p className="text-sm font-medium">{vendor?.name ?? "Unknown Vendor"}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{itemsSummary}</p>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Total: <span className="font-medium text-foreground">{formatCurrency(po.grandTotal)}</span></span>
                <span>Requested by: {requester?.name ?? "Unknown"}</span>
                {approver && <span>Approved by: {approver.name}</span>}
                {po.approvalDate && <span>Date: {po.approvalDate}</span>}
              </div>

              {po.rejectionReason && (
                <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-md mt-1">
                  Reason: {po.rejectionReason}
                </p>
              )}
            </div>

            {po.status === "pending_approval" && (
              <div className="flex gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-green-600 hover:bg-green-50 hover:text-green-700"
                  onClick={() => handleApprove(po.id)}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => handleReject(po.id)}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="PO Approval Workflow"
        description="Review and approve purchase orders"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total POs" value={String(pos.length)} icon={ClipboardList} />
        <KPICard
          title="Pending Approval"
          value={String(pending.length)}
          icon={Clock}
          change="Needs action"
          trend="neutral"
        />
        <KPICard title="Approved" value={String(approved.length)} icon={CheckCircle} />
        <KPICard title="Rejected" value={String(rejected.length)} icon={XCircle} />
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
          <TabsTrigger value="all">All ({pos.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4 space-y-3">
          {pending.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No pending approvals</p>
          )}
          {pending.map((po) => (
            <POCard key={po.id} po={po} />
          ))}
        </TabsContent>
        <TabsContent value="approved" className="mt-4 space-y-3">
          {approved.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No approved POs</p>
          )}
          {approved.map((po) => (
            <POCard key={po.id} po={po} />
          ))}
        </TabsContent>
        <TabsContent value="rejected" className="mt-4 space-y-3">
          {rejected.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No rejected POs</p>
          )}
          {rejected.map((po) => (
            <POCard key={po.id} po={po} />
          ))}
        </TabsContent>
        <TabsContent value="all" className="mt-4 space-y-3">
          {pos.map((po) => (
            <POCard key={po.id} po={po} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
