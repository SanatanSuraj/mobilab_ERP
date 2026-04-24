// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

export type MobicaseProduct = "MBA" | "MBM" | "MBC" | "MCC" | "CFG";

export type MobiWOStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PENDING_RM"
  | "RM_ISSUED"
  | "RM_QC_IN_PROGRESS"
  | "IN_PROGRESS"
  | "ASSEMBLY_COMPLETE"
  | "QC_HANDOVER_PENDING"
  | "QC_IN_PROGRESS"
  | "QC_COMPLETED"
  | "COMPLETED"
  | "PARTIAL_COMPLETE"
  | "ON_HOLD"
  | "CANCELLED";

export type MobiWOPriority = "NORMAL" | "URGENT" | "CRITICAL";
export type AssemblyLine = "L1" | "L2" | "L3" | "L4" | "L5";
export type OperatorTier = "T1" | "T2" | "T3";
export type ShiftType = "SHIFT_1" | "SHIFT_2";

export type DeviceIDStatus =
  | "CREATED"
  | "IN_PRODUCTION"
  | "SUB_QC_PASS"
  | "SUB_QC_FAIL"
  | "IN_REWORK"
  | "REWORK_LIMIT_EXCEEDED"
  | "FINAL_ASSEMBLY"
  | "FINAL_QC_PASS"
  | "FINAL_QC_FAIL"
  | "RELEASED"
  | "DISPATCHED"
  | "SCRAPPED"
  | "RECALLED";

export type ScrapRootCause =
  | "OC_FITMENT"
  | "PCB_ASSEMBLY_ERROR"
  | "INCOMING_MATERIAL"
  | "DIMENSIONAL"
  | "PROCESS_ERROR"
  | "HANDLING_ESD"
  | "FIRMWARE_ERROR"
  | "OTHER";

export type DowntimeCategory =
  | "RM_DELAY_INVENTORY"
  | "RM_DELAY_QUALITY"
  | "EQUIPMENT_FAILURE"
  | "OPERATOR_ABSENCE_PLANNED"
  | "OPERATOR_ABSENCE_UNPLANNED"
  | "POWER_INFRASTRUCTURE"
  | "REWORK_HOLD"
  | "MANAGEMENT_HOLD";

export type BMRStatus = "DRAFT" | "PRODUCTION_SIGNED" | "QC_SIGNED" | "CLOSED";

export interface MobiOperator {
  id: string;
  name: string;
  role: string;
  tier: OperatorTier;
  permittedLines: AssemblyLine[];
  canPCBRework: boolean;
  canOCAssembly: boolean;
  isDeputyHOD: boolean;
}

export interface LineStageTemplate {
  id: string;
  line: AssemblyLine;
  sequence: number;
  stageName: string;
  product: MobicaseProduct;
  stdTimeMin: number;
  requiresQCGate: boolean;
  minTier: OperatorTier;
  ocAssemblyOnly?: boolean;
  requiresPhoto: boolean;
  requiresMeasurement: boolean;
  isBottleneck: boolean;
  notes?: string;
}

export interface MobiDeviceID {
  id: string;
  deviceId: string;
  productCode: MobicaseProduct;
  workOrderId: string;
  workOrderNumber: string;
  status: DeviceIDStatus;
  reworkCount: number;
  maxReworkLimit: number;
  createdAt: string;
  assignedLine: AssemblyLine;
  pcbId?: string;
  sensorId?: string;
  detectorId?: string;
  machineId?: string;
  cfgVendorId?: string;
  cfgSerialNo?: string;
  analyzerPcbId?: string;
  analyzerSensorId?: string;
  analyzerDetectorId?: string;
  mixerMachineId?: string;
  mixerPcbId?: string;
  incubatorPcbId?: string;
  micropipetteId?: string;
  centrifugeId?: string;
  finishedGoodsRef?: string;
  invoiceRef?: string;
  deliveryChallanRef?: string;
  salesOrderRef?: string;
  scrappedAt?: string;
  scrappedReason?: string;
  dispatchedAt?: string;
}

export interface MobiRMLine {
  itemCode: string;
  itemName: string;
  qtyRequired: number;
  qtyIssued: number;
  lotNumber?: string;
  issuedAt?: string;
  status: "PENDING" | "ISSUED" | "SHORTAGE";
}

export interface MobiApprovalLog {
  step: string;
  approver: string;
  action: "PENDING" | "APPROVED" | "REJECTED";
  note?: string;
  timestamp?: string;
}

export interface MobiLineAssignment {
  line: AssemblyLine;
  leadOperator: string;
  supportOperators: string[];
  shift: ShiftType;
  targetQty: number;
}

export interface MobiWorkOrder {
  id: string;
  woNumber: string;
  dmrVersion: string;
  productCodes: MobicaseProduct[];
  batchQty: number;
  priority: MobiWOPriority;
  status: MobiWOStatus;
  targetStartDate: string;
  targetEndDate: string;
  createdAt: string;
  createdBy: string;
  deputyId?: string;
  approvedBy?: string;
  approvedAt?: string;
  linkedSalesOrder?: string;
  customerName?: string;
  onHoldReason?: string;
  rmLines: MobiRMLine[];
  approvalLog: MobiApprovalLog[];
  lineAssignments: MobiLineAssignment[];
  deviceIds: string[];
  scrapCount: number;
  reworkCount: number;
  firstPassYield?: number;
  bmrId?: string;
  notes?: string;
}

export interface MobiStageLog {
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  line: AssemblyLine;
  stageTemplateId: string;
  stageName: string;
  stageSequence: number;
  deviceId?: string;
  operator: string;
  shift: ShiftType;
  plannedStartAt: string;
  actualStartAt?: string;
  completedAt?: string;
  waitTimeMin?: number;
  cycleTimeMin?: number;
  stdTimeMin: number;
  qtyCompleted: number;
  qtyScrap: number;
  status: "PENDING" | "IN_PROGRESS" | "QC_GATE_PENDING" | "COMPLETED" | "QC_FAIL" | "ON_HOLD";
  qcResult?: "PASS" | "FAIL";
  qcInspector?: string;
  fixtureId?: string;
  firmwareVersion?: string;
  ocGapMm?: number;
  measurementData?: Record<string, string>;
  reworkReason?: string;
  notes?: string;
}

export interface ScrapEntry {
  id: string;
  scrapNumber: string;
  workOrderId: string;
  workOrderNumber: string;
  line: AssemblyLine;
  stageName: string;
  deviceId?: string;
  itemCode: string;
  itemName: string;
  qtyScrap: number;
  rootCause: ScrapRootCause;
  rootCauseDescription: string;
  materialType: "ELECTRONIC" | "PLASTIC" | "METAL" | "HAZARDOUS" | "OTHER";
  operator: string;
  scrapValueINR: number;
  autoCAPATriggered: boolean;
  linkedCAPANumber?: string;
  scrappedAt: string;
  approvedBy: string;
  notes?: string;
}

export interface BMRSection {
  sectionName: string;
  status: "COMPLETE" | "INCOMPLETE" | "PENDING";
  completedBy?: string;
  completedAt?: string;
}

export interface BMR {
  id: string;
  bmrNumber: string;
  workOrderId: string;
  workOrderNumber: string;
  dmrVersion: string;
  productName: string;
  batchQty: number;
  startDate: string;
  endDate?: string;
  status: BMRStatus;
  productionHODSign?: string;
  productionHODSignAt?: string;
  qcHODSign?: string;
  qcHODSignAt?: string;
  passQty: number;
  failQty: number;
  scrapQty: number;
  firstPassYield?: number;
  sections: BMRSection[];
  auditTrailEntries: number;
  notes?: string;
}

export interface DowntimeEntry {
  id: string;
  downtimeNumber: string;
  workOrderId?: string;
  line: AssemblyLine;
  category: DowntimeCategory;
  description: string;
  startedAt: string;
  resolvedAt?: string;
  durationHours?: number;
  reportedBy: string;
  resolvedBy?: string;
  impactedUnits?: number;
}

export interface OEERecord {
  id: string;
  date: string;
  shift: ShiftType;
  line: AssemblyLine;
  availableHours: number;
  downtimeHours: number;
  availability: number;
  theoreticalUnits: number;
  actualUnits: number;
  performance: number;
  unitsStarted: number;
  unitsPassedFPY: number;
  quality: number;
  oee: number;
}

export interface COPQRecord {
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  batchQty: number;
  scrapCostINR: number;
  reworkLabourCostINR: number;
  appraisalCostINR: number;
  preventionCostINR: number;
  totalCOPQINR: number;
  standardBatchCostINR: number;
  copqPercent: number;
}

export const mobiOperators: MobiOperator[] = [];
export const lineStageTemplates: LineStageTemplate[] = [];
export const mobiDeviceIDs: MobiDeviceID[] = [];
export const mobiWorkOrders: MobiWorkOrder[] = [];
export const mobiStageLogs: MobiStageLog[] = [];
export const scrapEntries: ScrapEntry[] = [];
export const bmrRecords: BMR[] = [];
export const downtimeEntries: DowntimeEntry[] = [];
export const oeeRecords: OEERecord[] = [];
export const copqRecords: COPQRecord[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getMobiWOById(_id: string): MobiWorkOrder | undefined {
  return undefined;
}

export function getDeviceIDsByWO(_workOrderId: string): MobiDeviceID[] {
  return [];
}

export function getStageLogsByWO(_workOrderId: string): MobiStageLog[] {
  return [];
}

export function getScrapByWO(_workOrderId: string): ScrapEntry[] {
  return [];
}

export function getActiveWOs(): MobiWorkOrder[] {
  return [];
}

export function getOnHoldWOs(): MobiWorkOrder[] {
  return [];
}

export function getWOProgress(wo: MobiWorkOrder): number {
  const statusOrder: MobiWOStatus[] = [
    "DRAFT", "PENDING_APPROVAL", "APPROVED", "PENDING_RM", "RM_ISSUED",
    "RM_QC_IN_PROGRESS", "IN_PROGRESS", "ASSEMBLY_COMPLETE",
    "QC_HANDOVER_PENDING", "QC_IN_PROGRESS", "QC_COMPLETED", "COMPLETED",
  ];
  const idx = statusOrder.indexOf(wo.status);
  if (idx < 0) return 0;
  return Math.round((idx / (statusOrder.length - 1)) * 100);
}

export function getOEEAvg(): number {
  return 0;
}

export function getTotalScrapValue(): number {
  return 0;
}

export function getBMRById(_id: string): BMR | undefined {
  return undefined;
}

export function getOperatorById(_id: string): MobiOperator | undefined {
  return undefined;
}

export function isWOOverdue(wo: MobiWorkOrder): boolean {
  if (wo.status === "COMPLETED" || wo.status === "CANCELLED") return false;
  return new Date(wo.targetEndDate) < new Date("2026-04-17");
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ─── Device vs Module Classification ──────────────────────────────────────────

export const DEVICE_PRODUCT_CODES: readonly MobicaseProduct[] = ["MCC"] as const;
export const MODULE_PRODUCT_CODES: readonly MobicaseProduct[] = ["MBA", "MBM", "MBC", "CFG"] as const;

/**
 * MCC BOM — the canonical 4-module composition.
 * Every MCC device consumes exactly one of each of these modules.
 */
export const MCC_MODULE_BOM: readonly MobicaseProduct[] = ["MBA", "MBM", "MBC", "CFG"] as const;

/**
 * Module sourcing model: in-house (manufactured on one of our lines)
 * vs vendor (externally purchased, scanned in by vendor lot ID).
 */
export const VENDOR_SOURCED_PRODUCT_CODES: readonly MobicaseProduct[] = ["CFG"] as const;

export function isFinishedDeviceCode(code: MobicaseProduct): boolean {
  return DEVICE_PRODUCT_CODES.includes(code);
}

export function isModuleCode(code: MobicaseProduct): boolean {
  return !DEVICE_PRODUCT_CODES.includes(code);
}

/**
 * Is this product externally purchased from a vendor (vs manufactured in-house)?
 * Currently only CFG (Centrifuge) is vendor-sourced — we buy them ready-made
 * and integrate them into the MCC device.
 */
export function isVendorSourcedCode(code: MobicaseProduct): boolean {
  return VENDOR_SOURCED_PRODUCT_CODES.includes(code);
}

/** "In-house" vs "Vendor" label for a module code. */
export function getSourcingLabel(code: MobicaseProduct): "In-house" | "Vendor" {
  return isVendorSourcedCode(code) ? "Vendor" : "In-house";
}

export function isFinishedDevice(d: Pick<MobiDeviceID, "productCode">): boolean {
  return isFinishedDeviceCode(d.productCode);
}

export function isModule(d: Pick<MobiDeviceID, "productCode">): boolean {
  return isModuleCode(d.productCode);
}

export type UnitKind = "DEVICE" | "MODULE";

export function getUnitKind(code: MobicaseProduct): UnitKind {
  return isFinishedDeviceCode(code) ? "DEVICE" : "MODULE";
}

export function getUnitKindLabel(code: MobicaseProduct): "Device" | "Module" {
  return isFinishedDeviceCode(code) ? "Device" : "Module";
}

export function getUnitKindLabelPlural(code: MobicaseProduct): "Devices" | "Modules" {
  return isFinishedDeviceCode(code) ? "Devices" : "Modules";
}
