"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  stockAdjustments,
  invItems,
  warehouses,
  formatDate,
  StockAdjustment,
  AdjustmentLine,
} from "@/data/inventory-mock";
import {
  ClipboardList,
  Clock,
  CheckCircle,
  TrendingDown,
  Plus,
} from "lucide-react";

const REASON_CODES = [
  "BREAKAGE",
  "CYCLE_COUNT",
  "SYSTEM_ERROR",
  "THEFT",
  "RETURN",
  "OTHER",
] as const;

function formatReasonCode(code: string): string {
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getTotalVariance(lines: AdjustmentLine[]): number {
  return lines.reduce((sum, l) => sum + l.varianceQty, 0);
}

export default function AdjustmentsPage() {
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([
    ...stockAdjustments,
  ]);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [detailAdj, setDetailAdj] = useState<StockAdjustment | null>(null);

  // New adjustment form state
  const [formWarehouse, setFormWarehouse] = useState("");
  const [formItem, setFormItem] = useState("");
  const [formPhysical, setFormPhysical] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formRemarks, setFormRemarks] = useState("");

  const selectedItem = useMemo(
    () => invItems.find((i) => i.id === formItem),
    [formItem]
  );

  // KPIs
  const totalAdj = adjustments.length;
  const pendingAdj = adjustments.filter(
    (a) => a.status === "PENDING_APPROVAL"
  ).length;
  const approvedAdj = adjustments.filter((a) => a.status === "APPROVED").length;
  const totalVarianceValue = adjustments.reduce((sum, adj) => {
    return (
      sum +
      adj.lines.reduce((ls, line) => {
        const item = invItems.find((i) => i.id === line.itemId);
        return ls + Math.abs(line.varianceQty) * (item?.standardCost ?? 0);
      }, 0)
    );
  }, 0);

  function handleApprove(id: string) {
    setAdjustments((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "APPROVED" as const,
              approvedBy: "Current User",
              approvedAt: new Date().toISOString().split("T")[0],
            }
          : a
      )
    );
  }

  function handleSaveNew() {
    setNewDialogOpen(false);
    setFormWarehouse("");
    setFormItem("");
    setFormPhysical("");
    setFormReason("");
    setFormRemarks("");
  }

  const columns: Column<StockAdjustment>[] = [
    {
      key: "adjNumber",
      header: "Adj Number",
      render: (a) => (
        <span className="font-mono text-xs font-semibold">{a.adjNumber}</span>
      ),
    },
    {
      key: "warehouseName",
      header: "Warehouse",
      render: (a) => <span className="text-sm">{a.warehouseName}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (a) => <StatusBadge status={a.status} />,
    },
    {
      key: "reasonCode",
      header: "Reason",
      render: (a) => (
        <span className="text-sm">{formatReasonCode(a.reasonCode)}</span>
      ),
    },
    {
      key: "lines",
      header: "Lines",
      render: (a) => (
        <span className="text-sm font-medium">{a.lines.length}</span>
      ),
    },
    {
      key: "variance",
      header: "Variance",
      render: (a) => {
        const total = getTotalVariance(a.lines);
        return (
          <span
            className={`text-sm font-semibold ${total < 0 ? "text-red-600" : total > 0 ? "text-green-600" : "text-muted-foreground"}`}
          >
            {total > 0 ? "+" : ""}
            {total}
          </span>
        );
      },
    },
    {
      key: "requiresApproval",
      header: "Requires Approval",
      render: (a) =>
        a.requiresApproval ? (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
          >
            Yes
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-gray-50 text-gray-500 border-gray-200 text-xs"
          >
            No
          </Badge>
        ),
    },
    {
      key: "requestedBy",
      header: "Requested By",
      render: (a) => <span className="text-sm">{a.requestedBy}</span>,
    },
    {
      key: "createdAt",
      header: "Created At",
      render: (a) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(a.createdAt)}
        </span>
      ),
    },
    {
      key: "approvedBy",
      header: "Approved By",
      render: (a) => (
        <span className="text-sm text-muted-foreground">
          {a.approvedBy ?? (
            <span className="text-amber-600 font-medium">Pending</span>
          )}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (a) =>
        a.status === "PENDING_APPROVAL" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
            onClick={(e) => {
              e.stopPropagation();
              handleApprove(a.id);
            }}
          >
            Approve
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Stock Adjustments"
        description="Manual inventory corrections with audit trail and approval"
        actions={
          <Button onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Adjustment
          </Button>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Adjustments"
          value={String(totalAdj)}
          icon={ClipboardList}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Pending Approval"
          value={String(pendingAdj)}
          icon={Clock}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Approved"
          value={String(approvedAdj)}
          icon={CheckCircle}
          iconColor="text-green-600"
        />
        <KPICard
          title="Total Variance Value"
          value={`₹${totalVarianceValue.toLocaleString("en-IN")}`}
          icon={TrendingDown}
          iconColor="text-red-600"
        />
      </div>

      {/* DataTable */}
      <DataTable<StockAdjustment>
        data={adjustments}
        columns={columns}
        searchKey="adjNumber"
        searchPlaceholder="Search by adjustment number..."
        onRowClick={(a) => setDetailAdj(a)}
      />

      {/* New Adjustment Dialog */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Stock Adjustment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Warehouse</label>
              <Select
                value={formWarehouse}
                onValueChange={(v) => setFormWarehouse(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Item</label>
              <Select
                value={formItem}
                onValueChange={(v) => setFormItem(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {invItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">System Qty</label>
              <Input
                value={selectedItem ? "—" : ""}
                readOnly
                placeholder="Auto-populated"
                className="bg-muted"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Physical Count</label>
              <Input
                type="number"
                value={formPhysical}
                onChange={(e) => setFormPhysical(e.target.value)}
                placeholder="Enter physical count"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Reason Code</label>
              <Select
                value={formReason}
                onValueChange={(v) => setFormReason(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CODES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {formatReasonCode(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Remarks</label>
              <textarea
                className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                value={formRemarks}
                onChange={(e) => setFormRemarks(e.target.value)}
                placeholder="Enter remarks..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNew}>Save Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog
        open={!!detailAdj}
        onOpenChange={(open) => !open && setDetailAdj(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono">
              {detailAdj?.adjNumber}
            </DialogTitle>
          </DialogHeader>
          {detailAdj && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Warehouse:</span>{" "}
                  <span className="font-medium">{detailAdj.warehouseName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <StatusBadge status={detailAdj.status} />
                </div>
                <div>
                  <span className="text-muted-foreground">Reason:</span>{" "}
                  <span className="font-medium">
                    {formatReasonCode(detailAdj.reasonCode)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Requested By:</span>{" "}
                  <span className="font-medium">{detailAdj.requestedBy}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Created At:</span>{" "}
                  <span className="font-medium">
                    {formatDate(detailAdj.createdAt)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Approved By:</span>{" "}
                  <span className="font-medium">
                    {detailAdj.approvedBy ?? "Pending"}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Remarks:</span>{" "}
                  <span className="font-medium">{detailAdj.remarks}</span>
                </div>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Adjustment Lines</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">System Qty</TableHead>
                        <TableHead className="text-right">Physical Qty</TableHead>
                        <TableHead className="text-right">Variance</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Batch</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailAdj.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="font-mono text-xs">
                            {line.itemCode}
                          </TableCell>
                          <TableCell className="text-sm">
                            {line.itemName}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {line.systemQty}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {line.physicalQty}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={`text-sm font-semibold ${line.varianceQty < 0 ? "text-red-600" : line.varianceQty > 0 ? "text-green-600" : "text-muted-foreground"}`}
                            >
                              {line.varianceQty > 0 ? "+" : ""}
                              {line.varianceQty}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{line.unit}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {line.batchId ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailAdj(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
