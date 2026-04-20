"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  vendors,
  purchaseOrders,
  indents,
  inwardEntries,
  qcInspections,
  formatCurrency,
  formatDate,
  getRatingColor,
  getRatingLabel,
} from "@/data/procurement-mock";
import {
  ClipboardList,
  Clock,
  FlaskConical,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

const TODAY = new Date("2026-04-17");

export default function ProcurementDashboardPage() {
  const openIndents = useMemo(
    () => indents.filter((i) => ["DRAFT", "SUBMITTED", "APPROVED"].includes(i.status)).length,
    []
  );

  const pendingApprovals = useMemo(
    () => purchaseOrders.filter((po) => ["PENDING_FINANCE", "PENDING_MGMT"].includes(po.status)).length,
    []
  );

  const inQC = useMemo(
    () => inwardEntries.filter((ie) => ie.status === "QC_IN_PROGRESS").length,
    []
  );

  const overduePOs = useMemo(
    () =>
      purchaseOrders.filter((po) => {
        const deliveryDate = new Date(po.requiredDeliveryDate);
        return deliveryDate < TODAY && ["APPROVED", "PO_SENT"].includes(po.status);
      }).length,
    []
  );

  const recentPOs = useMemo(() => [...purchaseOrders].slice(-5).reverse(), []);

  // Lifecycle stage counts
  const lifecycle = useMemo(() => {
    const indent = indents.filter((i) => ["DRAFT", "SUBMITTED"].includes(i.status)).length;
    const approved = indents.filter((i) => i.status === "APPROVED").length;
    const poCreated = purchaseOrders.filter((po) => po.status === "DRAFT").length;
    const financeApproval = purchaseOrders.filter((po) => po.status === "PENDING_FINANCE").length;
    const mgmtApproval = purchaseOrders.filter((po) => po.status === "PENDING_MGMT").length;
    const poSent = purchaseOrders.filter((po) => po.status === "PO_SENT").length;
    const inward = inwardEntries.filter((ie) => ie.status === "RECEIVED").length;
    const qcInProgress = inwardEntries.filter((ie) => ie.status === "QC_IN_PROGRESS").length;
    const qcDone = inwardEntries.filter((ie) => ie.status === "QC_DONE").length;
    const grn = inwardEntries.filter((ie) => ie.status === "GRN_CREATED").length;
    const stockUpdated = grn; // same as GRN for demo
    const invoice = purchaseOrders.filter((po) => po.status === "FULFILLED").length;
    return { indent, approved, poCreated, financeApproval, mgmtApproval, poSent, inward, qcInProgress, qcDone, grn, stockUpdated, invoice };
  }, []);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Procurement"
        description="End-to-end purchase lifecycle management"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Open Indents"
          value={String(openIndents)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change="DRAFT / SUBMITTED / APPROVED"
          trend="neutral"
        />
        <KPICard
          title="Pending Approvals"
          value={String(pendingApprovals)}
          icon={Clock}
          iconColor="text-amber-600"
          change="Finance + Management"
          trend="neutral"
        />
        <KPICard
          title="In QC"
          value={String(inQC)}
          icon={FlaskConical}
          iconColor="text-purple-600"
          change="Inward entries in QC"
          trend="neutral"
        />
        <KPICard
          title="Overdue POs"
          value={String(overduePOs)}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change="Delivery date passed"
          trend={overduePOs > 0 ? "down" : "neutral"}
        />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left: Recent POs */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>PO Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Required By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPOs.map((po) => {
                  const isOverdue =
                    new Date(po.requiredDeliveryDate) < TODAY &&
                    ["APPROVED", "PO_SENT"].includes(po.status);
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-xs text-blue-700">
                        {po.poNumber}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{po.vendorName}</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatCurrency(po.totalValue)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={po.status} />
                      </TableCell>
                      <TableCell
                        className={`text-sm ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}
                      >
                        {isOverdue && (
                          <span className="mr-1 text-red-500">⚠</span>
                        )}
                        {formatDate(po.requiredDeliveryDate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Right: Vendor Performance */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Vendor Performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vendors.map((vendor) => (
              <div key={vendor.id} className="space-y-1.5 pb-3 border-b last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{vendor.tradeName}</span>
                  <StatusBadge status={vendor.status} />
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={vendor.ratingScore}
                    className="h-1.5 flex-1"
                  />
                  <span className={`text-xs font-bold w-8 text-right ${getRatingColor(vendor.ratingScore)}`}>
                    {vendor.ratingScore}
                  </span>
                </div>
                <p className={`text-xs ${getRatingColor(vendor.ratingScore)}`}>
                  {getRatingLabel(vendor.ratingScore)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Procurement Lifecycle Flow */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Procurement Lifecycle</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 overflow-x-auto pb-2 flex-wrap">
            {[
              { label: "Indent", count: lifecycle.indent, color: "bg-blue-100 text-blue-700" },
              { label: "Approved", count: lifecycle.approved, color: "bg-green-100 text-green-700" },
              { label: "PO Created", count: lifecycle.poCreated, color: "bg-gray-100 text-gray-600" },
              { label: "Finance Approval", count: lifecycle.financeApproval, color: "bg-amber-100 text-amber-700" },
              { label: "Mgmt Approval", count: lifecycle.mgmtApproval, color: "bg-orange-100 text-orange-700" },
              { label: "PO Sent", count: lifecycle.poSent, color: "bg-indigo-100 text-indigo-700" },
              { label: "Inward", count: lifecycle.inward, color: "bg-cyan-100 text-cyan-700" },
              { label: "QC", count: lifecycle.qcInProgress, color: "bg-purple-100 text-purple-700" },
              { label: "QC Done", count: lifecycle.qcDone, color: "bg-teal-100 text-teal-700" },
              { label: "GRN", count: lifecycle.grn, color: "bg-lime-100 text-lime-700" },
              { label: "Stock Updated", count: lifecycle.stockUpdated, color: "bg-emerald-100 text-emerald-700" },
              { label: "Invoice", count: lifecycle.invoice, color: "bg-green-100 text-green-700" },
            ].map((stage, idx, arr) => (
              <div key={stage.label} className="flex items-center gap-1">
                <div className="flex flex-col items-center gap-1">
                  <span className={`text-xs font-medium px-2 py-1 rounded-md whitespace-nowrap ${stage.color}`}>
                    {stage.label}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-xs h-5 min-w-[1.5rem] justify-center ${stage.color} border-current`}
                  >
                    {stage.count}
                  </Badge>
                </div>
                {idx < arr.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-[-14px]" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
