"use client";

// TODO(phase-5): Shop-floor execution (line-level stage logs, scan-in/scan-out)
// has no backend routes yet. Expected routes:
//   GET  /mfg/lines/:line/active-work - current WOs on a line
//   POST /mfg/stage-logs - scan event at a stage
//   GET  /mfg/stage-logs?workOrderId= - audit trail for a WO
// Mock imports left in place until the shop-floor slice ships in
// apps/api/src/modules/mfg.

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  mobiWorkOrders,
  lineStageTemplates,
  mobiOperators,
  isFinishedDevice,
  isModule,
  type AssemblyLine,
  type MobiStageLog,
  type LineStageTemplate,
  type MobiDeviceID,
} from "@/data/instigenie-mock";
import {
  AlertTriangle,
  Users,
  Clock,
  Wrench,
  ClipboardCheck,
  Scan,
  RotateCcw,
  CheckCircle2,
  ChevronRight,
  Play,
  Truck,
} from "lucide-react";
import { useDeviceIDs, useStageLogsForLine, useSendToRework, useReleaseDevice, useDispatchDevice } from "@/hooks/useMfg";
import { StageCompletionSheet } from "@/components/mfg/StageCompletionSheet";
import { ComponentIdSheet } from "@/components/mfg/ComponentIdSheet";
import { StartProductionSheet } from "@/components/mfg/StartProductionSheet";

// ─── Line metadata ────────────────────────────────────────────────────────────

const LINE_META: Record<AssemblyLine, { label: string; product: string; isBottleneck: boolean }> = {
  L1: { label: "L1 — Mobimix",         product: "MBM",      isBottleneck: false },
  L2: { label: "L2 — Analyser",         product: "MBA",      isBottleneck: true  },
  L3: { label: "L3 — Incubator",        product: "MBC",      isBottleneck: false },
  L4: { label: "L4 — Final Assembly",   product: "MCC",      isBottleneck: false },
  L5: { label: "L5 — Final Device QC",  product: "MCC/CFG",  isBottleneck: false },
};

const ALL_LINES: AssemblyLine[] = ["L1", "L2", "L3", "L4", "L5"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLineActiveWOs(line: AssemblyLine) {
  return mobiWorkOrders.filter(
    (wo) =>
      wo.lineAssignments.some((la) => la.line === line) &&
      wo.status !== "COMPLETED" &&
      wo.status !== "CANCELLED"
  );
}

function getLineOperators(line: AssemblyLine): string[] {
  const names = new Set<string>();
  mobiWorkOrders.forEach((wo) => {
    wo.lineAssignments
      .filter((la) => la.line === line)
      .forEach((la) => {
        names.add(la.leadOperator);
        la.supportOperators.forEach((op) => names.add(op));
      });
  });
  return Array.from(names);
}

function getAvgCycleTime(logs: MobiStageLog[]): number | null {
  const completed = logs.filter((l) => l.status === "COMPLETED" && l.cycleTimeMin != null);
  if (completed.length === 0) return null;
  return Math.round(completed.reduce((s, l) => s + (l.cycleTimeMin ?? 0), 0) / completed.length);
}

/** Action buttons shown per unit (Device or Module) */
function canLogStage(device: MobiDeviceID) {
  return ["CREATED", "IN_PRODUCTION", "IN_REWORK", "FINAL_ASSEMBLY"].includes(device.status);
}

function canUpdateComponentIds(device: MobiDeviceID) {
  return !["DISPATCHED", "SCRAPPED", "RECALLED"].includes(device.status);
}

function canSendToRework(device: MobiDeviceID) {
  return ["SUB_QC_FAIL", "FINAL_QC_FAIL"].includes(device.status);
}

function canRelease(device: MobiDeviceID) {
  return device.status === "FINAL_QC_PASS";
}

function canDispatch(device: MobiDeviceID) {
  return device.status === "RELEASED";
}

// ─── Unit Row Card (Device or Module) ─────────────────────────────────────────

function DeviceActionRow({
  device,
  lineTemplates,
}: {
  device: MobiDeviceID;
  lineTemplates: LineStageTemplate[];
}) {
  const [stageSheetOpen, setStageSheetOpen] = useState(false);
  const [componentSheetOpen, setComponentSheetOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<LineStageTemplate | null>(null);

  const sendToRework = useSendToRework();
  const releaseDevice = useReleaseDevice();
  const dispatchDevice = useDispatchDevice();

  // Suggest the next stage template (first non-trivial one in sequence)
  const nextTemplate = lineTemplates[0] ?? null;

  function handleLogStage(template: LineStageTemplate) {
    setSelectedTemplate(template);
    setStageSheetOpen(true);
  }

  async function handleRework() {
    const reason = window.prompt(
      `Enter rework reason for ${device.deviceId}:`
    );
    if (!reason) return;
    try {
      const updated = await sendToRework.mutateAsync({ deviceId: device.deviceId, reason });
      if (updated.status === "SCRAPPED") {
        toast.error(`${device.deviceId} scrapped — rework limit exceeded.`);
      } else {
        toast.success(`${device.deviceId} sent to rework (${updated.reworkCount}/${updated.maxReworkLimit})`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleRelease() {
    try {
      await releaseDevice.mutateAsync(device.deviceId);
      toast.success(`${device.deviceId} released to Finished Goods`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDispatch() {
    try {
      await dispatchDevice.mutateAsync(device.deviceId);
      const kind = isFinishedDevice(device) ? "Device" : "Module";
      toast.success(`${device.deviceId} dispatched to customer ✓`, {
        description: `${kind} removed from active inventory. Ready for delivery.`,
      });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const hasComponentIds =
    !!(device.pcbId || device.machineId || device.analyzerPcbId || device.cfgVendorId);

  return (
    <>
      <div
        className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border px-4 py-3 ${
          device.status === "IN_REWORK"
            ? "border-orange-300 bg-orange-50"
            : device.status.includes("FAIL")
            ? "border-red-300 bg-red-50"
            : device.status === "SUB_QC_PASS" || device.status === "FINAL_QC_PASS"
            ? "border-green-300 bg-green-50"
            : "border-border bg-muted/10"
        }`}
      >
        {/* Unit identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold text-blue-700">
              {device.deviceId}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isFinishedDevice(device)
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  : "bg-slate-50 text-slate-700 border border-slate-200"
              }`}
            >
              {isFinishedDevice(device) ? "Device" : "Module"}
            </span>
            <StatusBadge status={device.productCode} />
            <StatusBadge status={device.status} />
            {device.reworkCount > 0 && (
              <Badge variant="outline" className="text-orange-700 border-orange-300 bg-orange-50 text-xs">
                Rework {device.reworkCount}/{device.maxReworkLimit}
              </Badge>
            )}
          </div>

          {/* Component IDs summary */}
          <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-1.5">
            {!hasComponentIds && (
              <span className="italic text-amber-700">⚠ No component IDs recorded yet</span>
            )}
            {device.pcbId && <span className="font-mono">{device.pcbId}</span>}
            {device.sensorId && <span className="font-mono">{device.sensorId}</span>}
            {device.machineId && <span className="font-mono">{device.machineId}</span>}
            {device.analyzerPcbId && <span className="font-mono">{device.analyzerPcbId}</span>}
            {device.mixerMachineId && <span className="font-mono">{device.mixerMachineId}</span>}
            {device.incubatorPcbId && <span className="font-mono">{device.incubatorPcbId}</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Log Stage — show per-stage picker if multiple templates available */}
          {canLogStage(device) && lineTemplates.length > 0 && (
            <div className="flex items-center gap-1">
              {lineTemplates.length === 1 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2"
                  onClick={() => handleLogStage(lineTemplates[0])}
                >
                  <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                  Log S{lineTemplates[0].sequence}
                </Button>
              ) : (
                /* Dropdown for multi-stage lines */
                <select
                  className="text-xs h-7 border rounded px-2 bg-background cursor-pointer"
                  defaultValue=""
                  onChange={(e) => {
                    const t = lineTemplates.find((t) => t.id === e.target.value);
                    if (t) handleLogStage(t);
                    e.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Log stage…
                  </option>
                  {lineTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      S{t.sequence} — {t.stageName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Update Component IDs */}
          {canUpdateComponentIds(device) && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 px-2"
              onClick={() => setComponentSheetOpen(true)}
            >
              <Scan className="h-3.5 w-3.5 mr-1" />
              {hasComponentIds ? "Edit IDs" : "Add IDs"}
            </Button>
          )}

          {/* Send to Rework */}
          {canSendToRework(device) && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 px-2 text-orange-700 border-orange-300 hover:bg-orange-100"
              onClick={handleRework}
              disabled={sendToRework.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Send to Rework
            </Button>
          )}

          {/* Release */}
          {canRelease(device) && (
            <Button
              size="sm"
              className="text-xs h-7 px-2 bg-green-600 hover:bg-green-700"
              onClick={handleRelease}
              disabled={releaseDevice.isPending}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Release
            </Button>
          )}

          {/* Dispatch */}
          {canDispatch(device) && (
            <Button
              size="sm"
              className="text-xs h-7 px-2 bg-blue-600 hover:bg-blue-700"
              onClick={handleDispatch}
              disabled={dispatchDevice.isPending}
            >
              <Truck className="h-3.5 w-3.5 mr-1" />
              Dispatch
            </Button>
          )}
        </div>
      </div>

      {/* Stage Completion Sheet */}
      {selectedTemplate && (
        <StageCompletionSheet
          open={stageSheetOpen}
          onOpenChange={setStageSheetOpen}
          device={device}
          template={selectedTemplate}
        />
      )}

      {/* Component ID Sheet */}
      <ComponentIdSheet
        open={componentSheetOpen}
        onOpenChange={setComponentSheetOpen}
        device={device}
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ShopFloorPage() {
  const [selectedLine, setSelectedLine] = useState<AssemblyLine>("L2");
  const [startProductionOpen, setStartProductionOpen] = useState(false);

  // React Query — live data from mutable service store
  const { data: allDevices = [], isLoading: devicesLoading } = useDeviceIDs();
  const { data: lineLogs = [], isLoading: logsLoading } = useStageLogsForLine(selectedLine);

  const lineTemplates = lineStageTemplates.filter((t) => t.line === selectedLine);
  const lineActiveWOs = getLineActiveWOs(selectedLine);
  const lineOperatorNames = getLineOperators(selectedLine);
  const permittedOps = mobiOperators.filter((op) => op.permittedLines.includes(selectedLine));
  const avgCycleTime = getAvgCycleTime(lineLogs);
  const meta = LINE_META[selectedLine];

  // Active devices on this line (not scrapped/dispatched)
  const lineDevices = allDevices.filter(
    (d) =>
      d.assignedLine === selectedLine &&
      !["DISPATCHED", "SCRAPPED", "RECALLED"].includes(d.status)
  );

  const reworkDevices = lineDevices.filter(
    (d) => d.status === "IN_REWORK" || d.status === "REWORK_LIMIT_EXCEEDED"
  );

  const isLoading = devicesLoading || logsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Shop Floor — Unit Entry"
          description="Log stage completions, record component IDs, and track Device (MCC) / Module (MBA/MBM/MBC/CFG) progress | ISO 13485 | Guwahati Plant"
        />
        <Button
          onClick={() => setStartProductionOpen(true)}
          className="shrink-0 bg-green-600 hover:bg-green-700"
        >
          <Play className="h-4 w-4 mr-2" />
          Start Production
        </Button>
      </div>

      <Tabs
        value={selectedLine}
        onValueChange={(v) => setSelectedLine((v ?? "L2") as AssemblyLine)}
      >
        {/* Line Selector */}
        <TabsList className="w-full justify-start gap-1 h-auto p-1">
          {ALL_LINES.map((line) => {
            const m = LINE_META[line];
            const lineDevCount = allDevices.filter(
              (d) =>
                d.assignedLine === line &&
                !["DISPATCHED", "SCRAPPED", "RECALLED"].includes(d.status)
            ).length;
            return (
              <TabsTrigger
                key={line}
                value={line}
                className="flex flex-col gap-0.5 px-4 py-2 h-auto"
              >
                <span className="font-semibold text-xs">{line}</span>
                <span className="text-[10px] font-normal opacity-70">{m.product}</span>
                {lineDevCount > 0 && (
                  <span className="text-[9px] font-bold text-blue-600">
                    {lineDevCount} active
                  </span>
                )}
                {m.isBottleneck && (
                  <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wide">
                    Bottleneck
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {ALL_LINES.map((line) => (
          <TabsContent key={line} value={line} className="mt-4 space-y-6">

            {/* ── Line Status Cards ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold">Active Work Orders</span>
                  </div>
                  {lineActiveWOs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active WOs on this line</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {lineActiveWOs.map((wo) => (
                        <span
                          key={wo.id}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-mono font-medium text-blue-800"
                        >
                          {wo.woNumber}
                          <StatusBadge status={wo.priority} />
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4 text-indigo-600" />
                    <span className="text-sm font-semibold">Operators</span>
                  </div>
                  {lineOperatorNames.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No operators assigned</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {lineOperatorNames.map((name) => {
                        const op = permittedOps.find((o) => o.name === name);
                        return (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
                          >
                            {name}
                            {op && <StatusBadge status={op.tier} />}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-teal-600" />
                    <span className="text-sm font-semibold">Avg Cycle Time</span>
                  </div>
                  <p className="text-2xl font-bold tracking-tight">
                    {avgCycleTime != null ? (
                      <>
                        {avgCycleTime}
                        <span className="text-sm font-normal text-muted-foreground ml-1">min</span>
                      </>
                    ) : (
                      <span className="text-sm font-normal text-muted-foreground">No completed stages</span>
                    )}
                  </p>
                  {meta.isBottleneck && (
                    <p className="text-xs text-amber-700 mt-1 font-medium">
                      ⚠ Primary bottleneck — target ≥4 parallel fixtures
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Bottleneck Banner ─────────────────────────────────────────── */}
            {meta.isBottleneck && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold">Bottleneck Line — L2 (Analyser)</span>
                  {" — "}
                  QC Analyser stage takes 180 min/unit. Use fixtures FIXTURE-QCA-001 to 004 in parallel.
                  All L2 stage completions require a Fixture ID.
                </div>
              </div>
            )}

            {/* ── Stage Template Reference ──────────────────────────────────── */}
            {lineTemplates.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <ChevronRight className="h-4 w-4" />
                  Stage Sequence — {LINE_META[line].label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {lineTemplates.map((t) => (
                    <div
                      key={t.id}
                      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
                        t.isBottleneck
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : "border-border bg-muted/30"
                      }`}
                    >
                      <span className="font-mono text-muted-foreground">S{t.sequence}</span>
                      <span className="font-medium">{t.stageName}</span>
                      <span className="text-muted-foreground">
                        {t.stdTimeMin > 0 ? `${t.stdTimeMin}m` : "—"}
                      </span>
                      {t.requiresQCGate && (
                        <span className="rounded-full bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.5 text-[10px] font-medium">QC Gate</span>
                      )}
                      {t.requiresMeasurement && (
                        <span className="rounded-full bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 text-[10px] font-medium">Measurement</span>
                      )}
                      {t.requiresPhoto && (
                        <span className="rounded-full bg-sky-100 text-sky-700 border border-sky-200 px-1.5 py-0.5 text-[10px] font-medium">Photo</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Active Units with Action Buttons ─────────────────────────── */}
            <div className="space-y-3">
              {(() => {
                const activeDeviceCount = lineDevices.filter(isFinishedDevice).length;
                const activeModuleCount = lineDevices.filter(isModule).length;
                return (
                  <h3 className="text-base font-semibold flex items-center gap-2">
                    <Scan className="h-4 w-4" />
                    Active Units on {line}
                    {lineDevices.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {activeDeviceCount} Device · {activeModuleCount} Module
                      </Badge>
                    )}
                  </h3>
                );
              })()}

              {lineDevices.length === 0 ? (
                <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                  No active units on this line
                </div>
              ) : (
                <div className="space-y-2">
                  {lineDevices.map((device) => (
                    <DeviceActionRow
                      key={device.id}
                      device={device}
                      lineTemplates={lineTemplates}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Rework Alert ──────────────────────────────────────────────── */}
            {reworkDevices.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Units in Rework on {line}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {reworkDevices.map((dev) => (
                    <div
                      key={dev.id}
                      className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs"
                    >
                      <span className="font-mono font-bold text-red-800">{dev.deviceId}</span>
                      <StatusBadge status={dev.status} />
                      <span className="text-red-600">
                        {dev.reworkCount}/{dev.maxReworkLimit} reworks
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Stage Log History ─────────────────────────────────────────── */}
            <div className="space-y-3">
              <h3 className="text-base font-semibold">
                Stage Log History — {LINE_META[line].label}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({lineLogs.length} entries)
                </span>
              </h3>
              <Card>
                <CardContent className="p-0">
                  {lineLogs.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground text-sm">
                      No stage logs for {line} yet
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b">
                          <tr>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Unit ID</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stage</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Operator</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Cycle (min)</th>
                            <th className="text-right px-4 py-3 font-medium text-muted-foreground">OC Gap (mm)</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fixture</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Completed</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {lineLogs.map((log) => {
                            const template = lineStageTemplates.find((t) => t.id === log.stageTemplateId);
                            const overCycle = log.cycleTimeMin != null && log.cycleTimeMin > log.stdTimeMin;
                            return (
                              <tr
                                key={log.id}
                                className={`transition-colors ${
                                  template?.isBottleneck ? "bg-amber-50/50 hover:bg-amber-100/50" : "hover:bg-muted/30"
                                }`}
                              >
                                <td className="px-4 py-3">
                                  {log.deviceId ? (
                                    <span className="font-mono text-xs font-medium text-blue-700">{log.deviceId}</span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">Batch</span>
                                  )}
                                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{log.workOrderNumber}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-xs text-muted-foreground">S{log.stageSequence}</span>
                                    <span className="text-sm font-medium">{log.stageName}</span>
                                    {template?.isBottleneck && (
                                      <span className="rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                                        Bottleneck
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm">{log.operator}</td>
                                <td className="px-4 py-3">
                                  <StatusBadge status={log.status} />
                                  {log.qcResult && (
                                    <span className="ml-1"><StatusBadge status={log.qcResult} /></span>
                                  )}
                                </td>
                                <td className={`px-4 py-3 text-right font-mono text-xs ${overCycle ? "text-red-700 font-bold" : "text-muted-foreground"}`}>
                                  {log.cycleTimeMin != null ? log.cycleTimeMin : "—"}
                                  {overCycle && <span className="ml-0.5 text-red-400">▲</span>}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs">
                                  {log.ocGapMm != null ? (
                                    <span className={log.ocGapMm >= 0.10 && log.ocGapMm <= 0.15 ? "text-green-700" : "text-red-700 font-bold"}>
                                      {log.ocGapMm.toFixed(2)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                  {log.fixtureId ?? "—"}
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                  {log.completedAt
                                    ? new Date(log.completedAt).toLocaleString("en-IN", {
                                        day: "2-digit",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : log.actualStartAt
                                    ? new Date(log.actualStartAt).toLocaleString("en-IN", {
                                        day: "2-digit",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      }) + " (started)"
                                    : "—"}
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
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Start Production Sheet */}
      <StartProductionSheet
        open={startProductionOpen}
        onOpenChange={setStartProductionOpen}
      />
    </div>
  );
}
