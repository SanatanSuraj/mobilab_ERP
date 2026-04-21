"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  wipInspections,
  ncrRecords,
  formatDate,
  formatDateTime,
  WIPInspection,
  WIPCheckpoint,
  WIPLine,
  InspectionStatus,
} from "@/data/qc-mock";
import {
  ClipboardList,
  CheckCircle2,
  XCircle,
  Activity,
  AlertTriangle,
  Search,
} from "lucide-react";

type LineFilter = "ALL" | WIPLine;
type StatusFilter = "ALL" | InspectionStatus;

function CheckResultBadge({ result }: { result: string }) {
  if (result === "PASS")
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 border border-green-200">
        PASS
      </span>
    );
  if (result === "FAIL")
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 border border-red-200">
        FAIL
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
      NA
    </span>
  );
}

function LineBadge({ line }: { line: WIPLine }) {
  const colors: Record<WIPLine, string> = {
    L1: "bg-blue-100 text-blue-800 border-blue-300",
    L2: "bg-purple-100 text-purple-800 border-purple-300",
    L3: "bg-teal-100 text-teal-800 border-teal-300",
    L4: "bg-orange-100 text-orange-800 border-orange-300",
    L5: "bg-indigo-100 text-indigo-800 border-indigo-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold border ${colors[line]}`}
    >
      {line}
    </span>
  );
}

function WIPDetailDialog({
  inspection,
  open,
  onOpenChange,
}: {
  inspection: WIPInspection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!inspection) return null;

  const linkedNCR = inspection.linkedNCRId
    ? ncrRecords.find((n) => n.id === inspection.linkedNCRId)
    : null;

  const passCount = inspection.checkpoints.filter((c) => c.result === "PASS").length;
  const failCount = inspection.checkpoints.filter((c) => c.result === "FAIL").length;
  const naCount = inspection.checkpoints.filter((c) => c.result === "NA").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            {inspection.inspectionNumber} — WIP Gate Inspection
          </DialogTitle>
        </DialogHeader>

        {/* Rework Banner */}
        {inspection.reworkRequired && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Rework Required</span>
              {" — "}
              {linkedNCR ? linkedNCR.ncrNumber : "NCR to be raised"}
            </div>
          </div>
        )}

        {/* Header Info Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm border rounded-lg p-4 bg-muted/30">
          <div>
            <span className="text-muted-foreground">Inspection #:</span>{" "}
            <span className="font-mono text-xs font-bold">{inspection.inspectionNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">WO PID:</span>{" "}
            <span className="font-mono text-xs">{inspection.workOrderPid}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Product:</span>{" "}
            <span className="font-medium text-xs">{inspection.productName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Line:</span>{" "}
            <LineBadge line={inspection.line} />
          </div>
          <div>
            <span className="text-muted-foreground">Stage:</span>{" "}
            <span className="font-medium">{inspection.stageName}</span>{" "}
            <span className="text-xs text-muted-foreground">(#{inspection.stageSequence})</span>
          </div>
          <div>
            <span className="text-muted-foreground">Unit ID:</span>{" "}
            <span className="font-mono text-xs">{inspection.deviceId ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            <StatusBadge status={inspection.status} />
          </div>
          <div>
            <span className="text-muted-foreground">Inspector:</span>{" "}
            <span>{inspection.inspectedBy}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Operator:</span>{" "}
            <span>{inspection.operatorName}</span>
          </div>
        </div>

        {/* Gate Checkpoints */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Gate Checkpoints</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-700 font-medium">{passCount} passed</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-red-700 font-medium">{failCount} failed</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">{naCount} N/A</span>
            </div>
          </div>

          {inspection.checkpoints.length === 0 ? (
            <div className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
              No checkpoints recorded yet
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Check Name</th>
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Severity</th>
                    <th className="text-left px-3 py-2 font-medium">Specification</th>
                    <th className="text-left px-3 py-2 font-medium">Measured Value</th>
                    <th className="text-left px-3 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {inspection.checkpoints.map((cp) => (
                    <tr
                      key={cp.checkId}
                      className={`${cp.result === "FAIL" ? "bg-red-50" : ""} ${cp.severity === "CRITICAL" ? "font-bold" : ""}`}
                    >
                      <td className="px-3 py-2 max-w-[120px]">{cp.checkName}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[140px]">
                        <span className="line-clamp-2">
                          {cp.description.length > 60
                            ? cp.description.slice(0, 60) + "…"
                            : cp.description}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={cp.category} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={cp.severity} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[140px]">
                        {cp.specification}
                      </td>
                      <td className="px-3 py-2 font-mono">{cp.measuredValue ?? "—"}</td>
                      <td className="px-3 py-2">
                        <CheckResultBadge result={cp.result} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary Footer */}
          {inspection.checkpoints.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
              <span className="text-green-700 font-medium">{passCount} passed</span>
              <span className="text-red-700 font-medium">{failCount} failed</span>
              <span>{naCount} N/A</span>
            </div>
          )}
        </div>

        {/* Notes */}
        {inspection.notes && (
          <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Notes: </span>
            {inspection.notes}
          </div>
        )}

        {/* Action Buttons */}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-green-700 border-green-300 hover:bg-green-50"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            Mark Stage Passed
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-700 border-red-300 hover:bg-red-50"
          >
            <XCircle className="h-4 w-4 mr-1.5" />
            Mark Stage Failed
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-orange-700 border-orange-300 hover:bg-orange-50"
          >
            <AlertTriangle className="h-4 w-4 mr-1.5" />
            Raise NCR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WIPGateInspectionPage() {
  const [lineFilter, setLineFilter] = useState<LineFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedInspection, setSelectedInspection] = useState<WIPInspection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Summary KPIs
  const total = wipInspections.length;
  const passed = wipInspections.filter((i) => i.status === "PASSED").length;
  const failed = wipInspections.filter((i) => i.status === "FAILED").length;
  const inProgress = wipInspections.filter(
    (i) => i.status === "IN_PROGRESS" || i.status === "PENDING"
  ).length;

  const filtered = useMemo(() => {
    return wipInspections.filter((i) => {
      const matchesLine = lineFilter === "ALL" || i.line === lineFilter;
      const matchesStatus = statusFilter === "ALL" || i.status === statusFilter;
      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        i.inspectionNumber.toLowerCase().includes(searchLower) ||
        i.workOrderPid.toLowerCase().includes(searchLower) ||
        i.productName.toLowerCase().includes(searchLower);
      return matchesLine && matchesStatus && matchesSearch;
    });
  }, [lineFilter, statusFilter, search]);

  function handleRowClick(insp: WIPInspection) {
    setSelectedInspection(insp);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-8 p-6">
      <PageHeader
        title="WIP Gate Inspections"
        description="Per-stage gate inspections — Mobilab assembly lines L1–L5 | ISO 13485"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total WIP Inspections"
          value={String(total)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change="All gate checkpoints"
          trend="neutral"
        />
        <KPICard
          title="Passed"
          value={String(passed)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="Gate cleared"
          trend="up"
        />
        <KPICard
          title="Failed"
          value={String(failed)}
          icon={XCircle}
          iconColor="text-red-600"
          change={failed > 0 ? "Rework required" : "None failed"}
          trend={failed > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="In Progress"
          value={String(inProgress)}
          icon={Activity}
          iconColor="text-amber-600"
          change="Active / Pending"
          trend="neutral"
        />
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by inspection #, WO PID, product…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={lineFilter}
          onValueChange={(v) => setLineFilter((v ?? "ALL") as LineFilter)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Filter by line" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Lines</SelectItem>
            <SelectItem value="L1">L1 — Mobimix</SelectItem>
            <SelectItem value="L2">L2 — Analyser</SelectItem>
            <SelectItem value="L3">L3 — Incubator</SelectItem>
            <SelectItem value="L4">L4 — Final Assembly</SelectItem>
            <SelectItem value="L5">L5 — Final QC</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter((v ?? "ALL") as StatusFilter)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="PASSED">Passed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {wipInspections.length} inspections
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              No WIP inspections match your filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inspection #</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">WO PID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Product</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Unit ID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Line</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stage Name</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Stage #</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Inspected</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Pass / Fail</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inspector</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Operator</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Started At</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rework</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((insp) => (
                    <tr
                      key={insp.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleRowClick(insp)}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                        {insp.inspectionNumber}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {insp.workOrderPid}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium">{insp.productName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{insp.productCode}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {insp.deviceId ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <LineBadge line={insp.line} />
                      </td>
                      <td className="px-4 py-3 text-sm max-w-[160px]">
                        <span className="truncate block" title={insp.stageName}>
                          {insp.stageName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {insp.stageSequence}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {insp.qtyUnderInspection}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="text-green-700 font-medium">{insp.qtyPassed}</span>
                        {" / "}
                        <span className="text-red-700 font-medium">{insp.qtyFailed}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={insp.status} />
                      </td>
                      <td className="px-4 py-3 text-sm">{insp.inspectedBy}</td>
                      <td className="px-4 py-3 text-sm">{insp.operatorName}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(insp.startedAt)}
                      </td>
                      <td className="px-4 py-3">
                        {insp.reworkRequired ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                            No
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <WIPDetailDialog
        inspection={selectedInspection}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
