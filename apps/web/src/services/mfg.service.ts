/**
 * Manufacturing / Production Service — Data Access Layer
 *
 * Canonical module name per architecture doc: `production`
 * Routes served: /production/work-orders, /production/shop-floor …
 *
 * org_id injected via apiFetch() on every real API call.
 * Import { apiFetch, getOrgId } from "@/lib/api-client" when swapping mock.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getOrgId } from "@/lib/api-client";
import {
  mobiWorkOrders as _seedWorkOrders,
  mobiDeviceIDs as _seedDevices,
  scrapEntries,
  mobiStageLogs as _seedStageLogs,
  getOnHoldWOs,
  getOEEAvg,
  isWOOverdue,
  getWOProgress,
  oeeRecords,
  type MobiWorkOrder,
  type MobiDeviceID,
  type MobicaseProduct,
  type ScrapEntry,
  type MobiStageLog,
  type OEERecord,
  type AssemblyLine,
  type DeviceIDStatus,
  type ShiftType,
} from "@/data/instigenie-mock";

// ─── Mutable in-memory stores (seeded once) ───────────────────────────────────

let _devices: MobiDeviceID[] = _seedDevices.map((d) => ({ ...d }));
let _stageLogs: MobiStageLog[] = _seedStageLogs.map((l) => ({ ...l }));
let _workOrders: MobiWorkOrder[] = _seedWorkOrders.map((w) => ({ ...w }));
let _logIdCounter = 1000;

// Per-product device ID sequence counters (seeded from existing device IDs)
const _deviceSeq: Record<string, number> = {};
_seedDevices.forEach((d) => {
  // Extract the 4-digit sequence number from the device ID, e.g. MBA-2026-04-0003-0 → 3
  const parts = d.deviceId.split("-");
  if (parts.length >= 4) {
    const seq = parseInt(parts[3], 10);
    if (!isNaN(seq)) {
      const key = d.productCode;
      _deviceSeq[key] = Math.max(_deviceSeq[key] ?? 0, seq);
    }
  }
});

function nextLogId(): string {
  return `sl-dyn-${++_logIdCounter}`;
}

function delayMs(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Input types for mutations ────────────────────────────────────────────────

export interface LogStageInput {
  deviceId: string;
  line: AssemblyLine;
  stageTemplateId: string;
  stageName: string;
  stageSequence: number;
  stdTimeMin: number;
  operator: string;
  shift?: ShiftType;
  actualStartAt?: string;
  cycleTimeMin: number;
  qcResult?: "PASS" | "FAIL";
  qcInspector?: string;
  fixtureId?: string;
  firmwareVersion?: string;
  ocGapMm?: number;
  measurementData?: Record<string, string>;
  reworkReason?: string;
  notes?: string;
}

export type ComponentIdInput = Partial<
  Pick<
    MobiDeviceID,
    | "pcbId"
    | "sensorId"
    | "detectorId"
    | "machineId"
    | "cfgVendorId"
    | "cfgSerialNo"
    | "analyzerPcbId"
    | "analyzerSensorId"
    | "analyzerDetectorId"
    | "mixerMachineId"
    | "mixerPcbId"
    | "incubatorPcbId"
    | "micropipetteId"
    | "centrifugeId"
  >
>;

export interface GenerateDevicesInput {
  woId: string;
  /** Which assembly line each product code runs on for this WO */
  linePerProduct: Partial<Record<MobicaseProduct, AssemblyLine>>;
}

/** After a QC gate stage, determine the next DeviceIDStatus. */
function deriveNextStatus(line: AssemblyLine, qcResult?: "PASS" | "FAIL"): DeviceIDStatus {
  if (!qcResult) return "IN_PRODUCTION";
  if (line === "L5") return qcResult === "PASS" ? "FINAL_QC_PASS" : "FINAL_QC_FAIL";
  return qcResult === "PASS" ? "SUB_QC_PASS" : "SUB_QC_FAIL";
}

export interface WOFilters {
  status?: string;
  productCode?: string;
  search?: string;
  isOverdue?: boolean;
}

export interface DeviceIDFilters {
  status?: string;
  productCode?: string;
  type?: "DEVICE" | "MODULE" | "ALL";
}

const DEVICE_CODES = ["MCC"] as const;

export const mfgService = {
  // ── Instigenie Work Orders (reads from mutable store) ───────────────────────

  async getMobiWorkOrders(filters?: WOFilters): Promise<MobiWorkOrder[]> {
    let result = [..._workOrders];
    if (filters?.status && filters.status !== "ALL") {
      result = result.filter((w) => w.status === filters.status);
    }
    if (filters?.productCode) {
      result = result.filter((w) =>
        w.productCodes.includes(filters.productCode as never)
      );
    }
    if (filters?.isOverdue) {
      result = result.filter((w) => isWOOverdue(w));
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter((w) => w.woNumber.toLowerCase().includes(q));
    }
    return Promise.resolve(result);
  },

  async getMobiWorkOrder(id: string): Promise<MobiWorkOrder | null> {
    return Promise.resolve(_workOrders.find((w) => w.id === id) ?? null);
  },

  /** Returns WOs eligible for device generation: approved/RM-issued with < full devices */
  async getProductionReadyWOs(): Promise<MobiWorkOrder[]> {
    const ELIGIBLE = new Set(["APPROVED", "RM_ISSUED", "IN_PROGRESS", "RM_QC_IN_PROGRESS"]);
    // Merge any seed WOs not yet in _workOrders (handles HMR re-seeding)
    const knownIds = new Set(_workOrders.map((w) => w.id));
    _seedWorkOrders.forEach((w) => {
      if (!knownIds.has(w.id)) _workOrders = [..._workOrders, { ...w }];
    });
    return Promise.resolve(
      _workOrders.filter(
        (wo) =>
          ELIGIBLE.has(wo.status) &&
          wo.productCodes.length > 0 &&
          wo.batchQty > 0
      )
    );
  },

  /**
   * generateDeviceIds — called when production starts on a WO.
   *
   * Creates one device record per (productCode × batchQty) combination.
   * Device ID format: {PRODUCT}-{YYYY}-{MM}-{SEQ4}-0
   *   e.g. MBA-2026-04-0007-0
   *
   * Also advances the WO status to IN_PROGRESS.
   */
  async generateDeviceIds(input: GenerateDevicesInput): Promise<MobiDeviceID[]> {
    await delayMs(350);

    const wo = _workOrders.find((w) => w.id === input.woId);
    if (!wo) throw new Error(`Work Order not found: ${input.woId}`);

    const now = new Date().toISOString();
    const year = now.slice(0, 4);
    const month = now.slice(5, 7);

    const created: MobiDeviceID[] = [];

    for (const productCode of wo.productCodes) {
      const line = input.linePerProduct[productCode];
      if (!line) continue; // skip products with no line assigned

      for (let unit = 0; unit < wo.batchQty; unit++) {
        _deviceSeq[productCode] = (_deviceSeq[productCode] ?? 0) + 1;
        const seq = String(_deviceSeq[productCode]).padStart(4, "0");
        const deviceId = `${productCode}-${year}-${month}-${seq}-0`;

        const device: MobiDeviceID = {
          id: `dev-dyn-${deviceId}`,
          deviceId,
          productCode,
          workOrderId: wo.id,
          workOrderNumber: wo.woNumber,
          status: "CREATED",
          reworkCount: 0,
          maxReworkLimit: 3,
          createdAt: now,
          assignedLine: line,
        };

        _devices = [..._devices, device];
        created.push(device);
      }
    }

    // Advance WO status → IN_PROGRESS if it was APPROVED or RM_ISSUED
    const woIdx = _workOrders.findIndex((w) => w.id === wo.id);
    if (woIdx !== -1 && ["APPROVED", "RM_ISSUED", "RM_QC_IN_PROGRESS"].includes(wo.status)) {
      _workOrders[woIdx] = { ..._workOrders[woIdx], status: "IN_PROGRESS" };
    }

    return created;
  },

  async getOnHoldWorkOrders(): Promise<MobiWorkOrder[]> {
    // API: return fetch('/api/mfg/work-orders?status=ON_HOLD').then(r => r.json())
    return Promise.resolve(getOnHoldWOs());
  },

  getWOProgress: getWOProgress,
  isWOOverdue: isWOOverdue,

  // ── Device IDs (reads from mutable store) ─────────────────────────────────

  async getDeviceIDs(filters?: DeviceIDFilters): Promise<MobiDeviceID[]> {
    // API: return fetch(`/api/mfg/device-ids?${qs}`).then(r => r.json())
    let result = [..._devices];
    if (filters?.type === "DEVICE") {
      result = result.filter((d) =>
        DEVICE_CODES.includes(d.productCode as typeof DEVICE_CODES[number])
      );
    } else if (filters?.type === "MODULE") {
      result = result.filter(
        (d) => !DEVICE_CODES.includes(d.productCode as typeof DEVICE_CODES[number])
      );
    }
    if (filters?.status && filters.status !== "ALL") {
      result = result.filter((d) => d.status === filters.status);
    }
    if (filters?.productCode) {
      result = result.filter((d) => d.productCode === filters.productCode);
    }
    return Promise.resolve(result);
  },

  async getDeviceID(deviceId: string): Promise<MobiDeviceID | null> {
    // API: return fetch(`/api/mfg/device-ids/${id}`).then(r => r.json())
    return Promise.resolve(
      _devices.find((d) => d.id === deviceId || d.deviceId === deviceId) ?? null
    );
  },

  // ── Scrap ─────────────────────────────────────────────────────────────────

  async getScrapEntries(monthPrefix?: string): Promise<ScrapEntry[]> {
    // API: return fetch(`/api/mfg/scrap?month=${monthPrefix}`).then(r => r.json())
    let result = [...scrapEntries];
    if (monthPrefix) {
      result = result.filter((s) => s.scrappedAt.startsWith(monthPrefix));
    }
    return Promise.resolve(result);
  },

  // ── Stage Logs (reads from mutable store) ─────────────────────────────────

  async getStageLogs(workOrderId?: string): Promise<MobiStageLog[]> {
    // API: return fetch(`/api/mfg/stage-logs?workOrderId=${workOrderId}`).then(r => r.json())
    let result = [..._stageLogs];
    if (workOrderId) {
      result = result.filter((s) => s.workOrderId === workOrderId);
    }
    return Promise.resolve(result);
  },

  async getStageLogsForLine(line: AssemblyLine): Promise<MobiStageLog[]> {
    return Promise.resolve(_stageLogs.filter((l) => l.line === line));
  },

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * logStageCompletion — technician completes a manufacturing stage.
   * Creates a MobiStageLog and advances the device status.
   */
  async logStageCompletion(input: LogStageInput): Promise<{ log: MobiStageLog; device: MobiDeviceID }> {
    await delayMs(300);

    const deviceIdx = _devices.findIndex(
      (d) => d.deviceId === input.deviceId || d.id === input.deviceId
    );
    if (deviceIdx === -1) throw new Error(`Device not found: ${input.deviceId}`);
    const device = _devices[deviceIdx];

    const now = new Date().toISOString();

    const log: MobiStageLog = {
      id: nextLogId(),
      workOrderId: device.workOrderId,
      workOrderNumber: device.workOrderNumber,
      line: input.line,
      stageTemplateId: input.stageTemplateId,
      stageName: input.stageName,
      stageSequence: input.stageSequence,
      deviceId: device.deviceId,
      operator: input.operator,
      shift: input.shift ?? "SHIFT_1",
      plannedStartAt: input.actualStartAt ?? now,
      actualStartAt: input.actualStartAt ?? now,
      completedAt: now,
      cycleTimeMin: input.cycleTimeMin,
      stdTimeMin: input.stdTimeMin,
      qtyCompleted: 1,
      qtyScrap: 0,
      status: input.qcResult === "FAIL" ? "QC_FAIL" : "COMPLETED",
      qcResult: input.qcResult,
      qcInspector: input.qcInspector,
      fixtureId: input.fixtureId,
      firmwareVersion: input.firmwareVersion,
      ocGapMm: input.ocGapMm,
      measurementData: input.measurementData,
      reworkReason: input.reworkReason,
      notes: input.notes,
    };

    _stageLogs = [..._stageLogs, log];

    const newStatus = deriveNextStatus(input.line, input.qcResult);
    const updatedDevice = { ..._devices[deviceIdx], status: newStatus };
    _devices[deviceIdx] = updatedDevice;

    return { log, device: updatedDevice };
  },

  /**
   * updateComponentIds — scan/enter serial numbers onto a device record.
   */
  async updateComponentIds(
    deviceId: string,
    data: ComponentIdInput
  ): Promise<MobiDeviceID> {
    await delayMs(200);

    const idx = _devices.findIndex(
      (d) => d.deviceId === deviceId || d.id === deviceId
    );
    if (idx === -1) throw new Error(`Device not found: ${deviceId}`);

    _devices[idx] = { ..._devices[idx], ...data };
    return _devices[idx];
  },

  /**
   * sendToRework — move a QC-failed device into rework.
   * Auto-scraps if reworkCount >= maxReworkLimit.
   */
  async sendToRework(deviceId: string, reason: string): Promise<MobiDeviceID> {
    await delayMs(200);

    const idx = _devices.findIndex(
      (d) => d.deviceId === deviceId || d.id === deviceId
    );
    if (idx === -1) throw new Error(`Device not found: ${deviceId}`);

    const device = _devices[idx];
    const newCount = device.reworkCount + 1;

    if (newCount > device.maxReworkLimit) {
      _devices[idx] = {
        ...device,
        status: "SCRAPPED",
        reworkCount: newCount,
        scrappedAt: new Date().toISOString().slice(0, 10),
        scrappedReason: `REWORK_LIMIT_EXCEEDED — ${reason}`,
      };
    } else {
      _devices[idx] = { ...device, status: "IN_REWORK", reworkCount: newCount };
    }

    return _devices[idx];
  },

  /**
   * releaseDevice — QC Inspector approves, device moves FINAL_QC_PASS → RELEASED.
   */
  async releaseDevice(deviceId: string): Promise<MobiDeviceID> {
    await delayMs(150);

    const idx = _devices.findIndex(
      (d) => d.deviceId === deviceId || d.id === deviceId
    );
    if (idx === -1) throw new Error(`Device not found: ${deviceId}`);

    _devices[idx] = { ..._devices[idx], status: "RELEASED" };
    return _devices[idx];
  },

  /**
   * dispatchDevice — Logistics dispatches a RELEASED device to customer. RELEASED → DISPATCHED.
   */
  async dispatchDevice(deviceId: string): Promise<MobiDeviceID> {
    await delayMs(150);

    const idx = _devices.findIndex(
      (d) => d.deviceId === deviceId || d.id === deviceId
    );
    if (idx === -1) throw new Error(`Device not found: ${deviceId}`);
    if (_devices[idx].status !== "RELEASED")
      throw new Error(`Device ${deviceId} is not RELEASED (current: ${_devices[idx].status})`);

    _devices[idx] = { ..._devices[idx], status: "DISPATCHED" };
    return _devices[idx];
  },

  // ── OEE ───────────────────────────────────────────────────────────────────

  async getOEEAverage(): Promise<number> {
    // API: return fetch('/api/mfg/oee/average').then(r => r.json()).then(r => r.average)
    return Promise.resolve(getOEEAvg());
  },

  async getOEERecords(): Promise<OEERecord[]> {
    // API: return fetch('/api/mfg/oee').then(r => r.json())
    return Promise.resolve(oeeRecords);
  },
};
