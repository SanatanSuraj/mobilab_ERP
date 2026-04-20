"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  mobiWorkOrders,
  getDeviceIDsByWO,
  getStageLogsByWO,
  getScrapByWO,
  getWOProgress,
  isWOOverdue,
  formatCurrency,
  formatDate,
  MobiWorkOrder,
  MobiWOStatus,
  MobicaseProduct,
} from "@/data/mobilab-mock";
import { Search, AlertTriangle, Info } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type WOStatusFilter = MobiWOStatus | "ALL";
type ProductFilter = MobicaseProduct | "ALL";

// ─── All 13 WO statuses for the legend ────────────────────────────────────────

const ALL_WO_STATUSES: MobiWOStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "PENDING_RM",
  "RM_ISSUED",
  "RM_QC_IN_PROGRESS",
  "IN_PROGRESS",
  "ASSEMBLY_COMPLETE",
  "QC_HANDOVER_PENDING",
  "QC_IN_PROGRESS",
  "QC_COMPLETED",
  "COMPLETED",
  "PARTIAL_COMPLETE",
  "ON_HOLD",
  "CANCELLED",
];

const ALL_PRODUCTS: MobicaseProduct[] = ["MBA", "MBM", "MBC", "MCC", "CFG"];

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── WO Detail Dialog ─────────────────────────────────────────────────────────

function WODetailDialog({
  wo,
  open,
  onOpenChange,
}: {
  wo: MobiWorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!wo) return null;

  const devices = getDeviceIDsByWO(wo.id);
  const stageLogs = getStageLogsByWO(wo.id);
  const scraps = getScrapByWO(wo.id);
  const overdue = isWOOverdue(wo);
  const progress = getWOProgress(wo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 font-mono text-base">
            {wo.woNumber}
            <StatusBadge status={wo.status} />
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                <AlertTriangle className="h-3 w-3" /> OVERDUE
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* WO Header Info */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm border rounded-lg p-4 bg-muted/30">
          <div>
            <span className="text-muted-foreground">DMR Version:</span>{" "}
            <span className="font-mono text-xs font-medium">{wo.dmrVersion}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Priority:</span>{" "}
            <StatusBadge status={wo.priority} />
          </div>
          <div>
            <span className="text-muted-foreground">Batch Qty:</span>{" "}
            <span className="font-semibold">{wo.batchQty}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Products:</span>{" "}
            <span className="inline-flex gap-1 flex-wrap">
              {wo.productCodes.map((p) => (
                <StatusBadge key={p} status={p} />
              ))}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Target Start:</span>{" "}
            <span>{formatDate(wo.targetStartDate)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Target End:</span>{" "}
            <span className={overdue ? "text-red-700 font-semibold" : ""}>
              {formatDate(wo.targetEndDate)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Created By:</span>{" "}
            <span>{wo.createdBy}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Approved By:</span>{" "}
            <span>{wo.approvedBy ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Customer:</span>{" "}
            <span>{wo.customerName ?? "—"}</span>
          </div>
          {wo.linkedSalesOrder && (
            <div>
              <span className="text-muted-foreground">Sales Order:</span>{" "}
              <span className="font-mono text-xs">{wo.linkedSalesOrder}</span>
            </div>
          )}
          {wo.bmrId && (
            <div>
              <span className="text-muted-foreground">BMR:</span>{" "}
              <span className="font-mono text-xs">{wo.bmrId}</span>
            </div>
          )}
          {wo.firstPassYield !== undefined && (
            <div>
              <span className="text-muted-foreground">First Pass Yield:</span>{" "}
              <span className="font-semibold text-green-700">{wo.firstPassYield}%</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Scrap Count:</span>{" "}
            <span className={wo.scrapCount > 0 ? "text-red-700 font-semibold" : ""}>{wo.scrapCount}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Rework Count:</span>{" "}
            <span className={wo.reworkCount > 0 ? "text-orange-700 font-semibold" : ""}>{wo.reworkCount}</span>
          </div>
          <div className="col-span-3">
            <span className="text-muted-foreground">Progress:</span>{" "}
            <span className="inline-flex items-center gap-2">
              <ProgressBar pct={progress} />
            </span>
          </div>
          {wo.onHoldReason && (
            <div className="col-span-3 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              <span className="font-semibold">On Hold Reason:</span> {wo.onHoldReason}
            </div>
          )}
          {wo.notes && (
            <div className="col-span-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {wo.notes}
            </div>
          )}
        </div>

        {/* Line Assignments */}
        {wo.lineAssignments.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Line Assignments</h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Line</th>
                    <th className="text-left px-3 py-2 font-medium">Lead Operator</th>
                    <th className="text-left px-3 py-2 font-medium">Support</th>
                    <th className="text-left px-3 py-2 font-medium">Shift</th>
                    <th className="text-right px-3 py-2 font-medium">Target Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {wo.lineAssignments.map((la) => (
                    <tr key={la.line}>
                      <td className="px-3 py-2">
                        <StatusBadge status={la.line} />
                      </td>
                      <td className="px-3 py-2 font-medium">{la.leadOperator}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {la.supportOperators.length > 0 ? la.supportOperators.join(", ") : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={la.shift} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{la.targetQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Device IDs */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Device IDs{" "}
            <span className="font-normal text-muted-foreground">({devices.length})</span>
          </h3>
          {devices.length === 0 ? (
            <div className="rounded-lg border py-6 text-center text-sm text-muted-foreground">
              No devices assigned yet
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Device ID</th>
                    <th className="text-left px-3 py-2 font-medium">Product</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-right px-3 py-2 font-medium">Rework Count</th>
                    <th className="text-left px-3 py-2 font-medium">Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {devices.map((dev) => (
                    <tr key={dev.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs font-bold text-blue-700">
                        {dev.deviceId}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={dev.productCode} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={dev.status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={
                            dev.reworkCount >= 3
                              ? "font-bold text-red-700"
                              : dev.reworkCount > 0
                              ? "font-semibold text-orange-700"
                              : "text-muted-foreground"
                          }
                        >
                          {dev.reworkCount}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={dev.assignedLine} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stage Logs */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Stage Logs{" "}
            <span className="font-normal text-muted-foreground">({stageLogs.length})</span>
          </h3>
          {stageLogs.length === 0 ? (
            <div className="rounded-lg border py-6 text-center text-sm text-muted-foreground">
              No stage logs recorded yet
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Stage</th>
                    <th className="text-left px-3 py-2 font-medium">Line</th>
                    <th className="text-left px-3 py-2 font-medium">Operator</th>
                    <th className="text-right px-3 py-2 font-medium">Cycle Time (min)</th>
                    <th className="text-right px-3 py-2 font-medium">Std Time (min)</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">QC Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stageLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium max-w-[160px]">
                        <span className="block truncate" title={log.stageName}>
                          {log.stageName}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={log.line} />
                      </td>
                      <td className="px-3 py-2">{log.operator}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {log.cycleTimeMin !== undefined ? (
                          <span
                            className={
                              log.cycleTimeMin > log.stdTimeMin
                                ? "text-orange-700 font-semibold"
                                : "text-green-700"
                            }
                          >
                            {log.cycleTimeMin}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {log.stdTimeMin}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={log.status} />
                      </td>
                      <td className="px-3 py-2">
                        {log.qcResult ? (
                          <StatusBadge status={log.qcResult} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Scrap Entries */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Scrap Entries{" "}
            <span className="font-normal text-muted-foreground">({scraps.length})</span>
          </h3>
          {scraps.length === 0 ? (
            <div className="rounded-lg border py-6 text-center text-sm text-muted-foreground">
              No scrap recorded for this WO
            </div>
          ) : (
            <div className="space-y-2">
              {scraps.map((scrap) => (
                <div
                  key={scrap.id}
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs space-y-1"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-bold text-red-800">{scrap.scrapNumber}</span>
                    <StatusBadge status={scrap.rootCause} />
                    <span className="text-red-700 font-semibold">
                      {formatCurrency(scrap.scrapValueINR)}
                    </span>
                    {scrap.autoCAPATriggered && (
                      <span className="font-mono text-orange-700">
                        {scrap.linkedCAPANumber}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    <span className="font-medium text-foreground">Device:</span>{" "}
                    {scrap.deviceId ?? "—"}
                    {" · "}
                    <span className="font-medium text-foreground">Item:</span>{" "}
                    {scrap.itemName}
                    {" · "}
                    <span className="font-medium text-foreground">Qty Scrapped:</span>{" "}
                    {scrap.qtyScrap}
                  </div>
                  <div className="text-muted-foreground">{scrap.rootCauseDescription}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<WOStatusFilter>("ALL");
  const [productFilter, setProductFilter] = useState<ProductFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedWO, setSelectedWO] = useState<MobiWorkOrder | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    return mobiWorkOrders.filter((wo) => {
      const matchesStatus = statusFilter === "ALL" || wo.status === statusFilter;
      const matchesProduct =
        productFilter === "ALL" || wo.productCodes.includes(productFilter);
      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        wo.woNumber.toLowerCase().includes(searchLower) ||
        (wo.customerName ?? "").toLowerCase().includes(searchLower);
      return matchesStatus && matchesProduct && matchesSearch;
    });
  }, [statusFilter, productFilter, search]);

  function handleRowClick(wo: MobiWorkOrder) {
    setSelectedWO(wo);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Work Orders"
        description="Mobilab Manufacturing — Mobicase Diagnostic Suite | ISO 13485:2016"
      />

      {/* Status Badge Legend */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium mr-1">
              <Info className="inline h-3.5 w-3.5 mr-0.5 mb-0.5" />
              WO Status Legend:
            </span>
            {ALL_WO_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by WO#, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter((v ?? "ALL") as WOStatusFilter)}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {ALL_WO_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={productFilter}
          onValueChange={(v) => setProductFilter((v ?? "ALL") as ProductFilter)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Products</SelectItem>
            {ALL_PRODUCTS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {mobiWorkOrders.length} work orders
        </span>
      </div>

      {/* Work Orders Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              No work orders match your filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">WO #</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Products</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Customer</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty Planned</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Completed</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Assigned Lines</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((wo) => {
                    const overdue = isWOOverdue(wo);
                    const progress = getWOProgress(wo);
                    const completedDevices = getDeviceIDsByWO(wo.id).filter(
                      (d) =>
                        d.status === "RELEASED" ||
                        d.status === "DISPATCHED" ||
                        d.status === "FINAL_QC_PASS"
                    ).length;

                    return (
                      <tr
                        key={wo.id}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => handleRowClick(wo)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs font-bold text-blue-700">
                            {wo.woNumber}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {wo.dmrVersion}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {wo.productCodes.map((p) => (
                              <StatusBadge key={p} status={p} />
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-[160px]">
                          <span
                            className="truncate block text-sm"
                            title={wo.customerName ?? "—"}
                          >
                            {wo.customerName ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {wo.batchQty}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <span
                            className={
                              completedDevices > 0 ? "text-green-700 font-semibold" : "text-muted-foreground"
                            }
                          >
                            {completedDevices}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={wo.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {wo.lineAssignments.length > 0 ? (
                              wo.lineAssignments.map((la) => (
                                <StatusBadge key={la.line} status={la.line} />
                              ))
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              overdue
                                ? "text-red-700 font-semibold text-xs"
                                : "text-xs text-muted-foreground"
                            }
                          >
                            {overdue && (
                              <AlertTriangle className="inline h-3 w-3 mr-0.5 mb-0.5" />
                            )}
                            {formatDate(wo.targetEndDate)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ProgressBar pct={progress} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <WODetailDialog
        wo={selectedWO}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
