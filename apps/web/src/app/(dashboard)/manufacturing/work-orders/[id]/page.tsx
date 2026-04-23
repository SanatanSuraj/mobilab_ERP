"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  enhancedWorkOrders,
  getWOById,
  getWOProgress,
  getCompletedStages,
  isWOOverdue,
  formatDate,
  formatDateTime,
  EnhancedWorkOrder,
  WIPStage,
  WOStatus,
} from "@/data/manufacturing-mock";
import {
  mobiDeviceIDs,
  mobiStageLogs,
  isFinishedDeviceCode,
  type MobicaseProduct,
} from "@/data/instigenie-mock";

// Extended local types to support QC gate and rework limit tracking
type WIPStageEx = WIPStage & { qcInspectionId?: string };
type EnhancedWorkOrderEx = Omit<EnhancedWorkOrder, "wipStages"> & {
  wipStages: WIPStageEx[];
  reworkLimitExceeded?: boolean;
};
import { toast } from "sonner";
import {
  ArrowLeft,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCcw,
  Link2,
  Package,
  User,
  Calendar,
  Hash,
  FileText,
  ChevronRight,
} from "lucide-react";

// ─── ComponentAssignmentPanel (inline) ───────────────────────────────────────

interface ComponentRow {
  unitId: string;
  productCode: MobicaseProduct;
  pcbId: string | null;
  sensorId: string | null;
  mechId: string | null;
  ocId: string | null;
  status: "COMPLETE" | "INCOMPLETE";
}

function buildComponentRows(woId: string): ComponentRow[] {
  const devices = mobiDeviceIDs.filter((d) => d.workOrderId === woId);
  const fallbackDevices = mobiDeviceIDs.filter((d) => d.workOrderId === "mwo-001");
  const target = devices.length > 0 ? devices : fallbackDevices;

  return target.map((dev) => {
    const logs = mobiStageLogs.filter(
      (s) => s.workOrderId === dev.workOrderId && s.deviceId === dev.deviceId
    );

    // Extract IDs from logs / device links
    const pcbLog = logs.find((s) => s.stageName.toLowerCase().includes("pcb"));
    const ocLog = logs.find((s) => s.stageName.toLowerCase().includes("oc assembly"));

    // Use real component IDs from the device record; fall back to derived IDs from stage logs
    const pcbId =
      dev.pcbId ?? dev.analyzerPcbId ?? dev.mixerPcbId ?? dev.incubatorPcbId ??
      (pcbLog ? `PCB-${dev.deviceId.slice(-6)}` : null);
    const sensorId =
      dev.sensorId ?? dev.analyzerSensorId ??
      (ocLog ? `SEN-${dev.deviceId.slice(-6)}` : null);
    const mechId =
      dev.machineId ?? dev.mixerMachineId ??
      (pcbLog ? `MCH-${dev.deviceId.slice(-6)}` : null);
    const ocId =
      dev.detectorId ?? dev.analyzerDetectorId ?? dev.incubatorPcbId ??
      (ocLog ? `OC-${dev.deviceId.slice(-6)}` : null);

    const isComplete = pcbId !== null && sensorId !== null && mechId !== null && ocId !== null;
    return {
      unitId: dev.deviceId,
      productCode: dev.productCode,
      pcbId,
      sensorId,
      mechId,
      ocId,
      status: isComplete ? "COMPLETE" : "INCOMPLETE",
    };
  });
}

function ComponentAssignmentPanel({ woId }: { woId: string }) {
  const rows = buildComponentRows(woId);
  const deviceCount = rows.filter((r) => isFinishedDeviceCode(r.productCode)).length;
  const moduleCount = rows.length - deviceCount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Component Assignment</CardTitle>
        <CardDescription>
          Unit-level component traceability
          {rows.length > 0 && (
            <span className="ml-1 text-muted-foreground">
              — {deviceCount} Device · {moduleCount} Module
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No unit IDs assigned yet.</p>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Unit ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>PCB-ID</TableHead>
                  <TableHead>Sensor-ID</TableHead>
                  <TableHead>Mech-ID</TableHead>
                  <TableHead>OC-ID</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const finished = isFinishedDeviceCode(row.productCode);
                  return (
                    <TableRow key={row.unitId}>
                      <TableCell className="font-mono text-xs font-medium">{row.unitId}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            finished
                              ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                              : "bg-slate-50 text-slate-700 border border-slate-200"
                          }`}
                        >
                          {finished ? "Device" : "Module"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.pcbId ?? <span className="text-red-500">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.sensorId ?? <span className="text-red-500">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.mechId ?? <span className="text-red-500">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.ocId ?? <span className="text-red-500">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.status === "COMPLETE"
                              ? "bg-green-50 text-green-700 border-green-200 text-xs"
                              : "bg-amber-50 text-amber-700 border-amber-200 text-xs"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main WO Detail Page ──────────────────────────────────────────────────────

export default function WorkOrderDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const found = getWOById(params.id) ?? enhancedWorkOrders.find((w) => w.id === params.id);

  const [wo, setWO] = useState<EnhancedWorkOrderEx | null>(found ? (found as EnhancedWorkOrderEx) : null);
  const [qcRequested, setQcRequested] = useState(false);

  if (!wo) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <PageHeader title="Work Order Not Found" />
        <p className="text-muted-foreground">The work order you are looking for does not exist.</p>
        <Button variant="outline" onClick={() => router.push("/manufacturing/work-orders")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Work Orders
        </Button>
      </div>
    );
  }

  const overdue = isWOOverdue(wo);
  const progress = getWOProgress(wo);
  const completedStages = getCompletedStages(wo);
  const hasMRPShortfall = wo.mrpLines.some((l) => l.status === "SHORTFALL");
  const currentStage = wo.wipStages[wo.currentStageIndex];
  const currentStageNeedsQC = currentStage?.requiresQCSignOff && currentStage?.status === "IN_PROGRESS";

  // Status transition actions
  const statusActions: Partial<Record<WOStatus, { label: string; nextStatus: WOStatus; variant?: "default" | "outline" | "destructive" }[]>> = {
    PLANNED: [{ label: "Release to Material Check", nextStatus: "MATERIAL_CHECK" }],
    MATERIAL_CHECK: [{ label: "Approve Materials & Start Production", nextStatus: "IN_PROGRESS" }],
    IN_PROGRESS: [
      { label: "Put on QC Hold", nextStatus: "QC_HOLD", variant: "outline" },
      { label: "Mark Complete", nextStatus: "COMPLETED" },
    ],
    QC_HOLD: [
      { label: "Approve Rework", nextStatus: "REWORK", variant: "outline" },
      { label: "Mark QC Passed", nextStatus: "IN_PROGRESS" },
    ],
    REWORK: [{ label: "Return to In Progress", nextStatus: "IN_PROGRESS" }],
  };

  function handleStatusChange(nextStatus: WOStatus) {
    // REWORK LIMIT CHECK: block if would be 3rd rework
    if (nextStatus === "REWORK" && wo!.reworkCount >= 2) {
      toast.error(
        "Rework limit reached (3 maximum). This unit must be scrapped. Initiating Finance write-off…"
      );
      setWO((prev) =>
        prev
          ? { ...prev, status: "CANCELLED", reworkLimitExceeded: true }
          : prev
      );
      return;
    }

    setWO((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: nextStatus,
        reworkCount: nextStatus === "REWORK" ? prev.reworkCount + 1 : prev.reworkCount,
        completedAt: nextStatus === "COMPLETED" ? new Date().toISOString() : prev.completedAt,
      };
    });
  }

  function handleAdvanceStage() {
    const stages = wo!.wipStages;
    const idx = wo!.currentStageIndex;
    const currentStageCopy = stages[idx];

    // HARD BLOCK: QC gate cannot be self-approved
    if (currentStageCopy?.requiresQCSignOff && !currentStageCopy?.qcInspectionId) {
      toast.error(
        "QC gate: This stage requires a QC inspection sign-off before advancing. Request a QC inspection first."
      );
      return; // STOP — do not advance
    }

    setWO((prev) => {
      if (!prev) return prev;
      const updatedStages = [...prev.wipStages];
      const currIdx = prev.currentStageIndex;

      // Complete current IN_PROGRESS stage
      if (updatedStages[currIdx]?.status === "IN_PROGRESS") {
        updatedStages[currIdx] = {
          ...updatedStages[currIdx],
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          qcResult: updatedStages[currIdx].requiresQCSignOff ? "PASS" : updatedStages[currIdx].qcResult,
        };
        // Start next stage if exists
        if (currIdx + 1 < updatedStages.length) {
          updatedStages[currIdx + 1] = {
            ...updatedStages[currIdx + 1],
            status: "IN_PROGRESS",
            startedAt: new Date().toISOString(),
          };
          return { ...prev, wipStages: updatedStages, currentStageIndex: currIdx + 1 };
        } else {
          // All stages done
          return {
            ...prev,
            wipStages: updatedStages,
            status: "COMPLETED",
            completedAt: new Date().toISOString(),
          };
        }
      }
      return prev;
    });
  }

  function handleRequestQCInspection() {
    setQcRequested(true);
    toast.info("QC inspection requested. QC team has been notified.");
  }

  function getDaysRelative(dateStr: string) {
    const target = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  const actions = statusActions[wo.status] ?? [];
  const daysRelative = getDaysRelative(wo.targetDate);

  // Static activity feed
  const activityFeed = [
    { time: wo.createdAt, label: "Work Order Created", by: wo.createdBy, color: "bg-blue-500" },
    ...(wo.startedAt
      ? [{ time: wo.startedAt, label: "MRP Run & Materials Checked", by: "System", color: "bg-amber-500" }]
      : []),
    ...wo.wipStages
      .filter((s) => s.status === "COMPLETED" && s.completedAt)
      .map((s) => ({
        time: s.completedAt!,
        label: `Stage Completed: ${s.stageName}`,
        by: s.assignedTo ?? wo.assignedTo,
        color: "bg-green-500",
      })),
    ...wo.wipStages
      .filter((s) => s.qcResult === "FAIL")
      .map((s) => ({
        time: s.startedAt ?? wo.startedAt ?? wo.createdAt,
        label: `QC FAIL at ${s.stageName}`,
        by: "QC Team",
        color: "bg-red-500",
      })),
    ...(wo.completedAt
      ? [{ time: wo.completedAt, label: "Work Order Completed", by: wo.assignedTo, color: "bg-green-600" }]
      : []),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/manufacturing/work-orders")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <PageHeader
            title={wo.pid}
            description={wo.productName}
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={wo.status} />
                <StatusBadge status={wo.priority} />
                {overdue && (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {Math.abs(daysRelative)}d Overdue
                  </Badge>
                )}
                {wo.reworkLimitExceeded && (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Rework Limit Exceeded
                  </Badge>
                )}
              </div>
            }
          />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: 2/3 */}
        <div className="lg:col-span-2 space-y-6">

          {/* WIP Stage Tracker */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">WIP Stage Tracker</CardTitle>
                  <CardDescription className="mt-0.5">
                    {completedStages} of {wo.wipStages.length} stages complete — {progress}%
                  </CardDescription>
                </div>
                <div className="text-right">
                  <Progress value={progress} className="h-2 w-32" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[15px] top-4 bottom-4 w-px bg-border" />

                <div className="space-y-3">
                  {wo.wipStages.map((stage, idx) => {
                    const isDone = stage.status === "COMPLETED";
                    const isActive = stage.status === "IN_PROGRESS";
                    const isHold = stage.status === "QC_HOLD" || stage.status === "REWORK";
                    const isPending = stage.status === "PENDING";
                    const isCurrentActiveStage =
                      isActive && idx === wo.currentStageIndex;

                    return (
                      <div key={stage.id}>
                        <div
                          className={`relative flex items-start gap-4 p-3 rounded-lg border transition-colors ${
                            isActive
                              ? "border-amber-200 bg-amber-50/40"
                              : isDone
                              ? "border-green-200 bg-green-50/20"
                              : isHold
                              ? "border-orange-200 bg-orange-50/30"
                              : "border-border bg-background"
                          }`}
                        >
                          {/* Circle icon */}
                          <div
                            className={`relative z-10 flex items-center justify-center h-8 w-8 rounded-full shrink-0 text-xs font-bold ${
                              isDone
                                ? "bg-green-100 text-green-700"
                                : isActive
                                ? "bg-amber-100 text-amber-700 ring-2 ring-amber-300 ring-offset-1"
                                : isHold
                                ? "bg-orange-100 text-orange-700"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {isDone ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : isActive ? (
                              <span className="animate-pulse">●</span>
                            ) : isHold ? (
                              <RotateCcw className="h-3.5 w-3.5" />
                            ) : (
                              idx + 1
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">
                                {stage.sequenceNumber}. {stage.stageName}
                              </span>
                              {stage.requiresQCSignOff && (
                                <Shield className="h-3.5 w-3.5 text-indigo-500" />
                              )}
                              <StatusBadge status={stage.status} />
                              {stage.qcResult && (
                                <Badge
                                  variant="outline"
                                  className={
                                    stage.qcResult === "PASS"
                                      ? "bg-green-50 text-green-700 border-green-200 text-xs"
                                      : "bg-red-50 text-red-700 border-red-200 text-xs"
                                  }
                                >
                                  QC: {stage.qcResult}
                                </Badge>
                              )}
                              {stage.reworkCount > 0 && (
                                <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
                                  ↺ Rework ×{stage.reworkCount}
                                </Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                              <span>{stage.expectedDurationHours}h expected</span>
                              {stage.assignedTo && <span>by {stage.assignedTo}</span>}
                              {stage.startedAt && <span>Started {formatDateTime(stage.startedAt)}</span>}
                              {stage.completedAt && <span>Completed {formatDateTime(stage.completedAt)}</span>}
                            </div>

                            {stage.notes && (
                              <p className="text-xs text-muted-foreground italic mt-1.5 border-l-2 border-muted pl-2">
                                {stage.notes}
                              </p>
                            )}

                            {/* Controls for active stage */}
                            {isCurrentActiveStage && (
                              <div className="mt-3 space-y-2">
                                {/* QC gate warning */}
                                {stage.requiresQCSignOff && !stage.qcInspectionId && (
                                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                                    <Shield className="h-3.5 w-3.5 shrink-0" />
                                    <span>QC Sign-off required before advancing</span>
                                  </div>
                                )}

                                {/* QC requested badge */}
                                {qcRequested && stage.requiresQCSignOff && !stage.qcInspectionId && (
                                  <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                                    <Clock className="h-3.5 w-3.5 shrink-0" />
                                    <span>QC Inspection Pending…</span>
                                  </div>
                                )}

                                <div className="flex gap-2 flex-wrap">
                                  {/* Request QC Inspection button */}
                                  {stage.requiresQCSignOff && !stage.qcInspectionId && !qcRequested && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-amber-300 text-amber-700 hover:bg-amber-50"
                                      onClick={handleRequestQCInspection}
                                    >
                                      <Shield className="h-4 w-4 mr-1" />
                                      Request QC Inspection
                                    </Button>
                                  )}

                                  {/* Advance stage button */}
                                  <Button size="sm" onClick={handleAdvanceStage}>
                                    <ChevronRight className="h-4 w-4 mr-1" />
                                    Complete Stage &amp; Advance
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        {isPending && idx > 0 && (
                          <div className="ml-4 h-2" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* MRP / Material Check */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">MRP / Material Check</CardTitle>
                {hasMRPShortfall ? (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Shortfall Detected — Indents Raised
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    All Materials Available
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {wo.mrpLines.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No MRP lines for this work order.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Required</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="text-right">Shortfall</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Batch / Indent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wo.mrpLines.map((line) => (
                        <TableRow key={line.itemId}>
                          <TableCell className="font-mono text-xs">{line.itemCode}</TableCell>
                          <TableCell className="text-sm">{line.itemName}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{line.qtyRequired}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{line.qtyAvailable}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {line.qtyShortfall > 0 ? (
                              <span className="text-red-600 font-semibold">{line.qtyShortfall}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                line.status === "SUFFICIENT"
                                  ? "bg-green-50 text-green-700 border-green-200 text-xs"
                                  : line.status === "RESERVED"
                                  ? "bg-blue-50 text-blue-700 border-blue-200 text-xs"
                                  : "bg-red-50 text-red-700 border-red-200 text-xs"
                              }
                            >
                              {line.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {line.reservedBatch ?? line.indentNumber ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Component Assignment Panel */}
          <ComponentAssignmentPanel woId={wo.id} />

          {/* Component Assignments (from EnhancedWO) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Component Assignments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {wo.componentAssignments.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead>Component Code</TableHead>
                        <TableHead>Component Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Serial / Batch ID</TableHead>
                        <TableHead>Assigned At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wo.componentAssignments.map((ca, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs">{ca.componentCode}</TableCell>
                          <TableCell className="text-sm">{ca.componentName}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                ca.assignmentType === "SERIAL"
                                  ? "bg-purple-50 text-purple-700 border-purple-200 text-xs"
                                  : "bg-blue-50 text-blue-700 border-blue-200 text-xs"
                              }
                            >
                              {ca.assignmentType}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {ca.serialId ?? ca.batchNumber ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(ca.assignedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No component assignments yet.</p>
              )}

              {/* Unit Serials (Device = MCC · Module = MBA/MBM/MBC/CFG) */}
              {wo.deviceSerials.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Unit Serials</div>
                  <div className="flex flex-wrap gap-2">
                    {wo.deviceSerials.map((serial) => (
                      <Badge key={serial} variant="outline" className="font-mono text-xs">
                        {serial}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: 1/3 */}
        <div className="space-y-6">

          {/* Work Order Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Work Order Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow icon={Package} label="Product" value={wo.productName} />
              <InfoRow icon={Hash} label="Product Code" value={wo.productCode} />
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">BOM Version</p>
                  <Badge variant="outline" className="font-mono text-xs mt-0.5">{wo.bomVersion}</Badge>
                </div>
              </div>
              <InfoRow icon={Hash} label="Quantity" value={String(wo.quantity)} />
              <InfoRow icon={User} label="Created By" value={wo.createdBy} />
              <InfoRow icon={Calendar} label="Created At" value={formatDate(wo.createdAt)} />
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Target Date</p>
                  <p className={`text-sm font-medium ${overdue ? "text-red-600" : ""}`}>
                    {formatDate(wo.targetDate)}
                    {overdue && " (Overdue)"}
                  </p>
                </div>
              </div>
              {wo.startedAt && (
                <InfoRow icon={Clock} label="Started At" value={formatDate(wo.startedAt)} />
              )}
              {wo.completedAt && (
                <InfoRow icon={CheckCircle2} label="Completed At" value={formatDate(wo.completedAt)} />
              )}
              {wo.dealId && (
                <div className="flex items-start gap-3">
                  <Link2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Deal ID</p>
                    <Badge variant="outline" className="font-mono text-xs mt-0.5">{wo.dealId}</Badge>
                  </div>
                </div>
              )}
              {wo.lotNumber && (
                <div className="flex items-start gap-3">
                  <Hash className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Lot Number</p>
                    <Badge variant="outline" className="font-mono text-xs mt-0.5">{wo.lotNumber}</Badge>
                  </div>
                </div>
              )}
              {wo.notes && (
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">{wo.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {actions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {actions.map((action) => (
                  <Button
                    key={action.nextStatus}
                    variant={action.variant ?? "default"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => handleStatusChange(action.nextStatus)}
                  >
                    {action.label}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Traceability */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Traceability</CardTitle>
              <CardDescription>Full traceability chain available</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {wo.deviceSerials.length > 0 ? (
                wo.deviceSerials.map((serial) => {
                  const relatedAssignments = wo.componentAssignments;
                  return (
                    <div key={serial} className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs font-bold">{serial}</span>
                      </div>
                      {relatedAssignments.map((ca, i) => (
                        <div key={i} className="ml-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ChevronRight className="h-3 w-3 shrink-0" />
                          <span className="font-mono">{ca.componentCode}</span>
                          <span>→</span>
                          <span className="font-mono">{ca.serialId ?? ca.batchNumber ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground">No unit serials assigned yet.</p>
              )}

              {wo.componentAssignments.length > 0 && wo.deviceSerials.length === 0 && (
                <div className="space-y-2">
                  {wo.componentAssignments.map((ca, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono">{ca.componentCode}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono">{ca.serialId ?? ca.batchNumber ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative space-y-0">
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
                {activityFeed.map((event, idx) => (
                  <div key={idx} className="relative flex items-start gap-3 pb-4">
                    <div className={`relative z-10 h-5 w-5 rounded-full shrink-0 mt-0.5 ${event.color}`} />
                    <div>
                      <p className="text-xs font-medium">{event.label}</p>
                      <p className="text-xs text-muted-foreground">{event.by} · {formatDate(event.time)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* Helper component */
function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
