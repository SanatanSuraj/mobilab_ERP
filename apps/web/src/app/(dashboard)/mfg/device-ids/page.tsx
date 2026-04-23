"use client";

// TODO(phase-5): Instigenie Mobicase device-ID tracking has no backend routes
// yet. Expected routes (scoped to the mobicase manufacturing domain):
//   GET  /mfg/device-ids?status=&workOrderId=&type=
//   GET  /mfg/device-ids/:id - device detail + stage log trail
//   POST /mfg/device-ids/:id/transition - advance stage / mark scrap
// Mock imports left in place until the mobicase slice ships in
// apps/api/src/modules/mfg (distinct from generic /production).

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
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
  mobiDeviceIDs,
  mobiStageLogs,
  mobiWorkOrders,
  mobiOperators,
  DeviceIDStatus,
  MobiDeviceID,
  formatDate,
  formatDateTime,
  isFinishedDevice,
  isModule,
} from "@/data/instigenie-mock";
import { Search, Cpu, Activity, CheckCircle2, RotateCcw, Trash2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DeviceStatusFilter = DeviceIDStatus | "ALL";
type WOFilter = string; // WO number or "ALL"
type TypeFilter = "ALL" | "DEVICE" | "MODULE";

// ─── Regex: MBA-YYYY-MM-NNNN-R ───────────────────────────────────────────────

const DEVICE_ID_PATTERN = /^[A-Z]{2,3}-\d{4}-\d{2}-\d{4}-\d+$/;

function isValidDeviceIdFormat(id: string): boolean {
  return DEVICE_ID_PATTERN.test(id);
}

// ─── All DeviceID statuses for filter ─────────────────────────────────────────

const ALL_DEVICE_STATUSES: DeviceIDStatus[] = [
  "CREATED",
  "IN_PRODUCTION",
  "SUB_QC_PASS",
  "SUB_QC_FAIL",
  "IN_REWORK",
  "REWORK_LIMIT_EXCEEDED",
  "FINAL_ASSEMBLY",
  "FINAL_QC_PASS",
  "FINAL_QC_FAIL",
  "RELEASED",
  "DISPATCHED",
  "SCRAPPED",
  "RECALLED",
];

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  colorClass,
  onClick,
  isActive = false,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  colorClass: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  return (
    <Card
      onClick={onClick}
      className={[
        "transition-all",
        onClick ? "cursor-pointer" : "",
        isActive
          ? "ring-2 ring-offset-1 ring-indigo-500 shadow-md bg-indigo-50/40"
          : onClick
          ? "hover:shadow-md hover:ring-1 hover:ring-muted-foreground/20"
          : "",
      ].join(" ")}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-lg p-2 ${colorClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
        {isActive && (
          <span className="ml-auto text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-indigo-600 text-white shrink-0">
            ✓
          </span>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Component Tree ───────────────────────────────────────────────────────────

type TreeRowProps = {
  connector: "branch" | "last";
  label: string;
  value: string;
  colorClass: string; // text + border color for the chip
  chipBg: string;     // background of the chip
};

type SectionProps = {
  indent: number;
  isLast: boolean;
  title: string;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  rows: Omit<TreeRowProps, "connector">[];
};

function TreeSection({ indent, isLast, title, accentBg, accentText, accentBorder, rows }: SectionProps) {
  const connector = isLast ? "└──" : "├──";
  const continuationBar = isLast ? "    " : "│   ";
  const indentStr = "    ".repeat(indent);

  return (
    <div className="text-xs font-mono">
      {/* Section header */}
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-muted-foreground select-none whitespace-pre">
          {indentStr}{connector}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold border ${accentBg} ${accentText} ${accentBorder}`}
        >
          {title}
        </span>
      </div>
      {/* Section rows */}
      {rows.map((row, i) => {
        const rowConnector = i === rows.length - 1 ? "└──" : "├──";
        return (
          <div key={row.label} className="flex items-center gap-2 py-0.5">
            <span className="text-muted-foreground select-none whitespace-pre">
              {indentStr}{continuationBar}{rowConnector}
            </span>
            <span className="text-muted-foreground min-w-[90px] font-sans">{row.label}</span>
            <span
              className={`font-mono rounded px-1.5 py-0.5 border text-[11px] font-semibold ${row.chipBg} ${row.colorClass}`}
            >
              {row.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ComponentTree({ device }: { device: MobiDeviceID }) {
  const pc = device.productCode;

  // ── Dispatch chain ────────────────────────────────────────────────────────
  const hasDispatch =
    device.invoiceRef ||
    device.deliveryChallanRef ||
    device.finishedGoodsRef ||
    device.salesOrderRef;

  // ── Sub-unit presence flags ───────────────────────────────────────────────
  // For standalone units: flag is just the product code match
  // For MCC: Analyzer/Mixer/Incubator are INTERNAL assemblies — use prefixed fields
  const showMBA =
    pc === "MBA" ||
    (pc === "MCC" && !!(device.analyzerPcbId || device.analyzerSensorId || device.analyzerDetectorId));

  const showMBM =
    pc === "MBM" ||
    (pc === "MCC" && !!(device.mixerMachineId || device.mixerPcbId));

  const showMBC =
    pc === "MBC" ||
    (pc === "MCC" && !!device.incubatorPcbId);

  const showCFG =
    pc === "CFG" ||
    !!(device.cfgVendorId || device.cfgSerialNo);

  const showAccessories = !!(
    device.micropipetteId ||
    device.centrifugeId ||
    device.cfgSerialNo ||
    device.cfgVendorId
  );

  // ── MBA rows ──────────────────────────────────────────────────────────────
  // MCC: read from analyzerXxx prefixed fields (internal assembly component IDs)
  // MBA standalone: read from flat pcbId/sensorId/detectorId
  const mbaRows: Omit<TreeRowProps, "connector">[] = [];
  const mba_pcb      = pc === "MCC" ? device.analyzerPcbId      : device.pcbId;
  const mba_sensor   = pc === "MCC" ? device.analyzerSensorId   : device.sensorId;
  const mba_detector = pc === "MCC" ? device.analyzerDetectorId : device.detectorId;
  if (mba_pcb) {
    mbaRows.push({ label: "PCB ID",      value: mba_pcb,      colorClass: "text-blue-700 border-blue-200", chipBg: "bg-blue-50" });
  }
  if (mba_sensor) {
    mbaRows.push({ label: "Sensor ID",   value: mba_sensor,   colorClass: "text-blue-700 border-blue-200", chipBg: "bg-blue-50" });
  }
  if (mba_detector) {
    mbaRows.push({ label: "Detector ID", value: mba_detector, colorClass: "text-blue-700 border-blue-200", chipBg: "bg-blue-50" });
  }

  // ── MBM rows ──────────────────────────────────────────────────────────────
  // MCC: read from mixerXxx prefixed fields
  // MBM standalone: read from flat machineId/pcbId
  const mbmRows: Omit<TreeRowProps, "connector">[] = [];
  const mbm_machine = pc === "MCC" ? device.mixerMachineId : device.machineId;
  const mbm_pcb     = pc === "MCC" ? device.mixerPcbId     : device.pcbId;
  if (mbm_machine) {
    mbmRows.push({ label: "Machine ID", value: mbm_machine, colorClass: "text-purple-700 border-purple-200", chipBg: "bg-purple-50" });
  }
  if (mbm_pcb) {
    mbmRows.push({ label: "PCB ID",     value: mbm_pcb,     colorClass: "text-purple-700 border-purple-200", chipBg: "bg-purple-50" });
  }

  // ── MBC rows ──────────────────────────────────────────────────────────────
  // MCC: incubatorPcbId | MBC standalone: pcbId
  const mbcRows: Omit<TreeRowProps, "connector">[] = [];
  const mbc_pcb = pc === "MCC" ? device.incubatorPcbId : device.pcbId;
  if (mbc_pcb) {
    mbcRows.push({ label: "PCB ID", value: mbc_pcb, colorClass: "text-amber-700 border-amber-200", chipBg: "bg-amber-50" });
  }

  // ── CFG rows ──────────────────────────────────────────────────────────────
  const cfgRows: Omit<TreeRowProps, "connector">[] = [];
  const cfgVendorValue = device.cfgVendorId;
  if (cfgVendorValue) {
    cfgRows.push({
      label: "Vendor ID",
      value: cfgVendorValue,
      colorClass: "text-green-700 border-green-200",
      chipBg: "bg-green-50",
    });
  }
  if (device.cfgSerialNo) {
    cfgRows.push({
      label: "Serial No",
      value: device.cfgSerialNo,
      colorClass: "text-green-700 border-green-200",
      chipBg: "bg-green-50",
    });
  }

  // ── Accessories rows ──────────────────────────────────────────────────────
  // Centrifuge in accessories IS the vendor-provided unit — reuse the same ID
  const centrifugeAccessoryId =
    device.cfgSerialNo ?? device.cfgVendorId ?? device.centrifugeId;

  const accRows: Omit<TreeRowProps, "connector">[] = [];
  if (device.micropipetteId) {
    accRows.push({
      label: "Micropipette",
      value: device.micropipetteId,
      colorClass: "text-gray-700 border-gray-200",
      chipBg: "bg-gray-50",
    });
  }
  if (centrifugeAccessoryId) {
    accRows.push({
      label: "Centrifuge",
      value: centrifugeAccessoryId,
      colorClass: "text-green-700 border-green-200",
      chipBg: "bg-green-50",
    });
  }

  // Visible sub-unit sections
  const subUnitSections: { key: string; title: string; rows: Omit<TreeRowProps, "connector">[]; bg: string; text: string; border: string }[] = [];
  if (showMBA && mbaRows.length > 0) {
    subUnitSections.push({ key: "mba", title: "Analyzer (MBA)", rows: mbaRows, bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-200" });
  }
  if (showMBM && mbmRows.length > 0) {
    subUnitSections.push({ key: "mbm", title: "Mixer (MBM)", rows: mbmRows, bg: "bg-purple-50", text: "text-purple-800", border: "border-purple-200" });
  }
  if (showMBC && mbcRows.length > 0) {
    subUnitSections.push({ key: "mbc", title: "Incubator (MBC)", rows: mbcRows, bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200" });
  }
  if (showCFG && cfgRows.length > 0) {
    subUnitSections.push({ key: "cfg", title: "Centrifuge (Vendor)", rows: cfgRows, bg: "bg-green-50", text: "text-green-800", border: "border-green-200" });
  }

  const hasAnyComponents = subUnitSections.length > 0 || showAccessories;

  return (
    <div className="space-y-3">
      {/* ── Dispatch chain badges ─── */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {hasDispatch ? (
          <>
            {device.invoiceRef && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 bg-blue-100 text-blue-800 border border-blue-200 font-medium">
                Invoice: {device.invoiceRef}
              </span>
            )}
            {device.deliveryChallanRef && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 bg-sky-100 text-sky-800 border border-sky-200 font-medium">
                DC: {device.deliveryChallanRef}
              </span>
            )}
            {device.finishedGoodsRef && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 bg-indigo-100 text-indigo-800 border border-indigo-200 font-medium">
                FG Ref: {device.finishedGoodsRef}
              </span>
            )}
            {device.salesOrderRef && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 bg-violet-100 text-violet-800 border border-violet-200 font-medium">
                Sales Order: {device.salesOrderRef}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground italic">Not yet dispatched</span>
        )}
      </div>

      {/* ── Component hierarchy ─── */}
      {hasAnyComponents ? (
        <div className="rounded-lg border bg-muted/20 px-4 py-3 font-mono text-xs space-y-0">
          {/* Root: Device */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="font-mono font-bold text-foreground">{device.deviceId}</span>
            <span className="text-muted-foreground font-sans text-[11px]">({device.productCode})</span>
          </div>

          {/* FG Ref as second level */}
          {device.finishedGoodsRef && (
            <div className="flex items-center gap-2 py-0.5 pl-2">
              <span className="text-muted-foreground select-none">└──</span>
              <span className="text-muted-foreground font-sans min-w-[90px]">FG Ref</span>
              <span className="font-mono rounded px-1.5 py-0.5 border text-[11px] font-semibold bg-indigo-50 text-indigo-700 border-indigo-200">
                {device.finishedGoodsRef}
              </span>
            </div>
          )}

          {/* Sub-unit sections */}
          {subUnitSections.map((section, sIdx) => {
            const allAfter = sIdx < subUnitSections.length - 1 || showAccessories;
            return (
              <TreeSection
                key={section.key}
                indent={1}
                isLast={!allAfter}
                title={section.title}
                accentBg={section.bg}
                accentText={section.text}
                accentBorder={section.border}
                rows={section.rows}
              />
            );
          })}

          {/* Accessories section */}
          {showAccessories && accRows.length > 0 && (
            <TreeSection
              indent={1}
              isLast={true}
              title="Unit Accessories"
              accentBg="bg-gray-100"
              accentText="text-gray-700"
              accentBorder="border-gray-300"
              rows={accRows}
            />
          )}
        </div>
      ) : (
        <div className="rounded-lg border px-4 py-3 text-xs text-muted-foreground italic bg-muted/10">
          No sub-component IDs registered yet for this device.
        </div>
      )}
    </div>
  );
}

// ─── Inline component chips for table rows ────────────────────────────────────

function ComponentChips({ device }: { device: MobiDeviceID }) {
  const pc = device.productCode;

  // Build ordered chip list: primary IDs first
  const chips: { label: string; colorClass: string }[] = [];

  if (pc === "MBA") {
    if (device.pcbId)      chips.push({ label: device.pcbId,      colorClass: "bg-blue-100 text-blue-700 border-blue-200" });
    if (device.sensorId)   chips.push({ label: device.sensorId,   colorClass: "bg-blue-100 text-blue-700 border-blue-200" });
    if (device.detectorId) chips.push({ label: device.detectorId, colorClass: "bg-blue-100 text-blue-700 border-blue-200" });
  } else if (pc === "MBM") {
    if (device.machineId)  chips.push({ label: device.machineId,  colorClass: "bg-purple-100 text-purple-700 border-purple-200" });
    if (device.pcbId)      chips.push({ label: device.pcbId,      colorClass: "bg-purple-100 text-purple-700 border-purple-200" });
  } else if (pc === "MBC") {
    if (device.pcbId)      chips.push({ label: device.pcbId,      colorClass: "bg-amber-100 text-amber-700 border-amber-200" });
  } else if (pc === "CFG") {
    if (device.cfgVendorId)  chips.push({ label: device.cfgVendorId,  colorClass: "bg-green-100 text-green-700 border-green-200" });
    if (device.cfgSerialNo)  chips.push({ label: device.cfgSerialNo,  colorClass: "bg-green-100 text-green-700 border-green-200" });
  } else if (pc === "MCC") {
    // Show one representative ID per sub-assembly (PCB IDs are most stable)
    if (device.analyzerPcbId)  chips.push({ label: device.analyzerPcbId,  colorClass: "bg-blue-100 text-blue-700 border-blue-200" });
    if (device.mixerMachineId) chips.push({ label: device.mixerMachineId, colorClass: "bg-purple-100 text-purple-700 border-purple-200" });
    if (device.incubatorPcbId) chips.push({ label: device.incubatorPcbId, colorClass: "bg-amber-100 text-amber-700 border-amber-200" });
    const cfgVal = device.cfgSerialNo ?? device.cfgVendorId;
    if (cfgVal)                chips.push({ label: cfgVal,                colorClass: "bg-green-100 text-green-700 border-green-200" });
  }

  if (chips.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const MAX_VISIBLE = 2;
  const visible = chips.slice(0, MAX_VISIBLE);
  const overflow = chips.length - MAX_VISIBLE;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((chip) => (
        <span
          key={chip.label}
          className={`inline-block font-mono rounded border px-1.5 py-0.5 text-[10px] font-semibold ${chip.colorClass}`}
          title={chip.label}
        >
          {chip.label.length > 18 ? chip.label.slice(0, 16) + "…" : chip.label}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

// ─── Device Detail Dialog ─────────────────────────────────────────────────────

function DeviceDetailDialog({
  device,
  open,
  onOpenChange,
}: {
  device: MobiDeviceID | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!device) return null;

  const isValid = isValidDeviceIdFormat(device.deviceId);
  const wo = mobiWorkOrders.find((w) => w.id === device.workOrderId);
  const deviceStageLogs = mobiStageLogs.filter(
    (log) => log.deviceId === device.deviceId
  );
  // Also include stage logs for the same WO without explicit deviceId (batch-level logs)
  const batchLogs = mobiStageLogs.filter(
    (log) =>
      log.workOrderId === device.workOrderId && !log.deviceId
  );

  const allLogs = [...deviceStageLogs, ...batchLogs].sort(
    (a, b) => a.stageSequence - b.stageSequence
  );

  const operatorNames = mobiOperators.reduce<Record<string, string>>((acc, op) => {
    acc[op.id] = op.name;
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm font-bold">{device.deviceId}</span>
            {isFinishedDevice(device) ? (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
                Finished Device
              </span>
            ) : (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                Sub-assembly Module
              </span>
            )}
            <StatusBadge status={device.productCode} />
            <StatusBadge status={device.status} />
            {!isValid && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                Non-standard ID format
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Device Info Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm border rounded-lg p-4 bg-muted/30">
          <div>
            <span className="text-muted-foreground">Work Order:</span>{" "}
            <span className="font-mono text-xs">{device.workOrderNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Created At:</span>{" "}
            <span className="text-xs">{formatDateTime(device.createdAt)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Assigned Line:</span>{" "}
            <StatusBadge status={device.assignedLine} />
          </div>
          <div>
            <span className="text-muted-foreground">Rework Count:</span>{" "}
            <span
              className={
                device.reworkCount >= 3
                  ? "font-bold text-red-700"
                  : device.reworkCount > 0
                  ? "font-semibold text-orange-700"
                  : ""
              }
            >
              {device.reworkCount} / {device.maxReworkLimit}
            </span>
          </div>
          {wo && (
            <div>
              <span className="text-muted-foreground">WO Priority:</span>{" "}
              <StatusBadge status={wo.priority} />
            </div>
          )}
          {wo?.customerName && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Customer:</span>{" "}
              <span>{wo.customerName}</span>
            </div>
          )}
          {device.dispatchedAt && (
            <div>
              <span className="text-muted-foreground">Dispatched At:</span>{" "}
              <span className="text-xs">{formatDate(device.dispatchedAt)}</span>
            </div>
          )}
        </div>

        {/* Component Hierarchy Tree */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Device Genealogy</h3>
          <ComponentTree device={device} />
        </div>

        {/* Scrap / Rework Info */}
        {(device.scrappedAt || device.scrappedReason) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm space-y-1">
            <div className="font-semibold text-red-800">Scrapped</div>
            {device.scrappedAt && (
              <div className="text-xs text-red-700">
                <span className="font-medium">Date:</span> {formatDate(device.scrappedAt)}
              </div>
            )}
            {device.scrappedReason && (
              <div className="text-xs text-red-700">
                <span className="font-medium">Reason:</span> {device.scrappedReason}
              </div>
            )}
          </div>
        )}

        {/* Stage Log History */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">
            Stage Log History{" "}
            <span className="font-normal text-muted-foreground">
              ({allLogs.length} entries{batchLogs.length > 0 ? `, incl. ${batchLogs.length} batch-level` : ""})
            </span>
          </h3>
          {allLogs.length === 0 ? (
            <div className="rounded-lg border py-6 text-center text-sm text-muted-foreground">
              No stage logs found for this device
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-right px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">Stage</th>
                    <th className="text-left px-3 py-2 font-medium">Line</th>
                    <th className="text-left px-3 py-2 font-medium">Operator</th>
                    <th className="text-right px-3 py-2 font-medium">Cycle (min)</th>
                    <th className="text-right px-3 py-2 font-medium">Std (min)</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">QC</th>
                    <th className="text-left px-3 py-2 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allLogs.map((log) => (
                    <tr
                      key={log.id}
                      className={`hover:bg-muted/20 ${log.status === "QC_FAIL" ? "bg-red-50" : ""}`}
                    >
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {log.stageSequence}
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[160px]">
                        <span className="block truncate" title={log.stageName}>
                          {log.stageName}
                        </span>
                        {log.reworkReason && (
                          <span className="block text-orange-700 text-xs mt-0.5 truncate" title={log.reworkReason}>
                            Rework: {log.reworkReason}
                          </span>
                        )}
                        {log.notes && (
                          <span className="block text-muted-foreground text-xs mt-0.5 truncate" title={log.notes}>
                            {log.notes}
                          </span>
                        )}
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
                      <td className="px-3 py-2 text-muted-foreground">
                        {log.completedAt ? formatDateTime(log.completedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Operator Reference */}
        <div className="text-xs text-muted-foreground border rounded px-3 py-2 bg-muted/20">
          <span className="font-medium text-foreground">Operators on file:</span>{" "}
          {mobiOperators.map((op) => `${op.name} (${op.role}, ${op.tier})`).join(" · ")}
        </div>

        {/* suppress unused var warning */}
        <span className="hidden">{JSON.stringify(operatorNames)}</span>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rework Count Cell ────────────────────────────────────────────────────────

function ReworkCell({ count, max }: { count: number; max: number }) {
  if (count >= max) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold bg-red-100 text-red-700 border border-red-200">
        {count} LIMIT
      </span>
    );
  }
  if (count > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">
        {count}
      </span>
    );
  }
  return <span className="text-muted-foreground text-xs">{count}</span>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeviceIDsPage() {
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>("ALL");
  const [woFilter, setWOFilter] = useState<WOFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<MobiDeviceID | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Unique WO numbers for dropdown
  const uniqueWOs = useMemo(() => {
    const seen = new Set<string>();
    return mobiDeviceIDs
      .filter((d) => {
        if (seen.has(d.workOrderNumber)) return false;
        seen.add(d.workOrderNumber);
        return true;
      })
      .map((d) => d.workOrderNumber)
      .sort();
  }, []);

  // Summary stats — MCC = finished devices, all others = modules
  const stats = useMemo(() => {
    const devices   = mobiDeviceIDs.filter(isFinishedDevice);
    const modules   = mobiDeviceIDs.filter(isModule);
    return {
      finishedDevices:   devices.length,
      dispatchedDevices: devices.filter((d) => d.status === "DISPATCHED").length,
      modulesInProd:     modules.filter((d) => d.status === "IN_PRODUCTION").length,
      modulesQCPass:     modules.filter((d) => d.status === "SUB_QC_PASS" || d.status === "FINAL_QC_PASS").length,
      inRework:          modules.filter((d) => d.status === "IN_REWORK").length,
      scrapped:          mobiDeviceIDs.filter((d) => d.status === "SCRAPPED").length,
    };
  }, []);

  const filtered = useMemo(() => {
    return mobiDeviceIDs.filter((dev) => {
      const matchesType   = typeFilter === "ALL"
        || (typeFilter === "DEVICE" && isFinishedDevice(dev))
        || (typeFilter === "MODULE" && isModule(dev));
      const matchesStatus = statusFilter === "ALL" || dev.status === statusFilter;
      const matchesWO     = woFilter === "ALL" || dev.workOrderNumber === woFilter;
      const matchesSearch = !search || dev.deviceId.toLowerCase().includes(search.toLowerCase());
      return matchesType && matchesStatus && matchesWO && matchesSearch;
    });
  }, [typeFilter, statusFilter, woFilter, search]);

  function handleRowClick(dev: MobiDeviceID) {
    setSelectedDevice(dev);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Device & Module ID Registry"
        description="Instigenie Mobicase — Devices (MCC) & Modules (MBA/MBM/MBC/CFG). Full genealogy & traceability for every manufactured unit | 21 CFR Part 11"
      />

      {/* Summary Stats — individual clickable filter cards */}
      <div className="space-y-3">
        {/* Row 1: Finished Devices (MCC only) */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Finished Devices (MCC)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Total MCC Units"
              value={stats.finishedDevices}
              icon={Cpu}
              colorClass="bg-blue-100 text-blue-700"
              isActive={typeFilter === "DEVICE" && statusFilter === "ALL"}
              onClick={() => {
                if (typeFilter === "DEVICE" && statusFilter === "ALL") {
                  setTypeFilter("ALL");
                } else {
                  setTypeFilter("DEVICE");
                  setStatusFilter("ALL");
                }
              }}
            />
            <StatCard
              label="Dispatched"
              value={stats.dispatchedDevices}
              icon={CheckCircle2}
              colorClass="bg-green-100 text-green-700"
              isActive={typeFilter === "DEVICE" && statusFilter === "DISPATCHED"}
              onClick={() => {
                if (typeFilter === "DEVICE" && statusFilter === "DISPATCHED") {
                  setTypeFilter("ALL"); setStatusFilter("ALL");
                } else {
                  setTypeFilter("DEVICE"); setStatusFilter("DISPATCHED");
                }
              }}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Row 2: Sub-assembly Modules */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Sub-assembly Modules (MBA · MBM · MBC · CFG)
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Modules in Production"
              value={stats.modulesInProd}
              icon={Activity}
              colorClass="bg-amber-100 text-amber-700"
              isActive={typeFilter === "MODULE" && statusFilter === "IN_PRODUCTION"}
              onClick={() => {
                if (typeFilter === "MODULE" && statusFilter === "IN_PRODUCTION") {
                  setTypeFilter("ALL"); setStatusFilter("ALL");
                } else {
                  setTypeFilter("MODULE"); setStatusFilter("IN_PRODUCTION");
                }
              }}
            />
            <StatCard
              label="Modules QC Pass"
              value={stats.modulesQCPass}
              icon={CheckCircle2}
              colorClass="bg-teal-100 text-teal-700"
              isActive={typeFilter === "MODULE" && statusFilter === "SUB_QC_PASS"}
              onClick={() => {
                if (typeFilter === "MODULE" && statusFilter === "SUB_QC_PASS") {
                  setTypeFilter("ALL"); setStatusFilter("ALL");
                } else {
                  setTypeFilter("MODULE"); setStatusFilter("SUB_QC_PASS");
                }
              }}
            />
            <StatCard
              label="In Rework"
              value={stats.inRework}
              icon={RotateCcw}
              colorClass="bg-orange-100 text-orange-700"
              isActive={statusFilter === "IN_REWORK"}
              onClick={() => {
                if (statusFilter === "IN_REWORK") {
                  setTypeFilter("ALL"); setStatusFilter("ALL");
                } else {
                  setTypeFilter("MODULE"); setStatusFilter("IN_REWORK");
                }
              }}
            />
            <StatCard
              label="Scrapped"
              value={stats.scrapped}
              icon={Trash2}
              colorClass="bg-red-100 text-red-700"
              isActive={statusFilter === "SCRAPPED"}
              onClick={() => {
                if (statusFilter === "SCRAPPED") {
                  setTypeFilter("ALL"); setStatusFilter("ALL");
                } else {
                  setTypeFilter("ALL"); setStatusFilter("SCRAPPED");
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by Device / Module ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 font-mono text-sm"
          />
        </div>

        {/* Type filter — most important, shown first */}
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter((v ?? "ALL") as TypeFilter)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="DEVICE">Devices (MCC)</SelectItem>
            <SelectItem value="MODULE">Modules only</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter((v ?? "ALL") as DeviceStatusFilter)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {ALL_DEVICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={woFilter}
          onValueChange={(v) => setWOFilter((v ?? "ALL") as WOFilter)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by WO#" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Work Orders</SelectItem>
            {uniqueWOs.map((wo) => (
              <SelectItem key={wo} value={wo}>
                {wo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {mobiDeviceIDs.length} entries
        </span>
      </div>

      {/* Device IDs Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              No devices match your filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      ID
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Type
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Product
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      WO #
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Line
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Components
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      Rework
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Operator (Lead)
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Last Updated
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((dev) => {
                    // Find lead operator from WO line assignments
                    const wo = mobiWorkOrders.find((w) => w.id === dev.workOrderId);
                    const lineAssignment = wo?.lineAssignments.find(
                      (la) => la.line === dev.assignedLine
                    );
                    const leadOperator = lineAssignment?.leadOperator ?? "—";

                    // Last updated: most recent stage log completion or dispatch/scrap
                    const deviceLogs = mobiStageLogs.filter(
                      (log) =>
                        log.deviceId === dev.deviceId &&
                        log.completedAt
                    );
                    const lastLogDate =
                      deviceLogs.length > 0
                        ? deviceLogs.reduce((latest, log) =>
                            (log.completedAt ?? "") > (latest.completedAt ?? "")
                              ? log
                              : latest
                          ).completedAt
                        : undefined;
                    const lastUpdated =
                      dev.scrappedAt ?? dev.dispatchedAt ?? lastLogDate ?? dev.createdAt;

                    const isValid = isValidDeviceIdFormat(dev.deviceId);

                    return (
                      <tr
                        key={dev.id}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => handleRowClick(dev)}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-bold text-blue-700">
                            {dev.deviceId}
                          </span>
                          {!isValid && (
                            <span className="ml-1.5 text-xs text-amber-600" title="Non-standard format">
                              ⚠
                            </span>
                          )}
                        </td>
                        {/* Type badge — Device (MCC) vs Module */}
                        <td className="px-4 py-3">
                          {isFinishedDevice(dev) ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700 border border-indigo-200">
                              Device
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                              Module
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={dev.productCode} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {dev.workOrderNumber}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={dev.status} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={dev.assignedLine} />
                        </td>
                        <td className="px-4 py-3 max-w-[200px]">
                          <ComponentChips device={dev} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ReworkCell
                            count={dev.reworkCount}
                            max={dev.maxReworkLimit}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm">{leadOperator}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDate(lastUpdated)}
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

      {/* Device Detail Dialog */}
      <DeviceDetailDialog
        device={selectedDevice}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
