// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

export type InspectionStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "PASSED"
  | "FAILED"
  | "AQL_PASSED"
  | "AQL_FAILED"
  | "ON_HOLD"
  | "PENDING_COUNTERSIGN"
  | "CLOSED";

export type AQLResult = "ACCEPT" | "REJECT" | "MARGINAL";
export type CheckResult = "PASS" | "FAIL" | "NA";
export type CheckSeverity = "CRITICAL" | "MAJOR" | "MINOR";
export type CheckCategory = "DIMENSIONAL" | "ELECTRICAL" | "VISUAL" | "FUNCTIONAL" | "DOCUMENTATION" | "SAFETY";

export type NCRStatus = "OPEN" | "INVESTIGATING" | "PENDING_CAPA" | "CAPA_RAISED" | "CLOSED" | "REJECTED";
export type NCRSeverity = "CRITICAL" | "MAJOR" | "MINOR";
export type NCRSource = "INCOMING_QC" | "WIP_INSPECTION" | "FINAL_QC" | "CUSTOMER_COMPLAINT" | "AUDIT";

export type CAPAStatus = "OPEN" | "ROOT_CAUSE_IDENTIFIED" | "ACTION_PLAN_APPROVED" | "IN_PROGRESS" | "VERIFICATION_PENDING" | "CLOSED" | "OVERDUE";
export type CAPAType = "CORRECTIVE" | "PREVENTIVE";
export type RootCauseMethod = "5_WHY" | "ISHIKAWA" | "FAULT_TREE" | "8D";

export type EquipmentStatus = "CALIBRATED" | "CALIBRATION_DUE" | "CALIBRATION_OVERDUE" | "OUT_OF_SERVICE" | "UNDER_REPAIR";
export type EquipmentCategory = "TEST_EQUIPMENT" | "MEASURING_INSTRUMENT" | "FIXTURE" | "PRODUCTION_TOOL";

export type WIPLine = "L1" | "L2" | "L3" | "L4" | "L5";

export type BatchQCDecision = "ACCEPT" | "REJECT" | "QC_HOLD" | "PENDING";

export interface AQLMeasurement {
  checkId: string;
  checkName: string;
  specification: string;
  unit: string;
  measuredValues: number[];
  lowerLimit?: number;
  upperLimit?: number;
  category: CheckCategory;
  severity: CheckSeverity;
  result: CheckResult;
  remarks?: string;
}

export interface IncomingQCInspection {
  id: string;
  inspectionNumber: string;
  grnNumber: string;
  poNumber: string;
  vendorName: string;
  vendorCode: string;
  itemCode: string;
  itemName: string;
  batchLotNumber: string;
  qtyReceived: number;
  qtySampled: number;
  aqlLevel: string;
  acceptNumber: number;
  rejectNumber: number;
  defectsFound: number;
  aqlResult: AQLResult;
  status: InspectionStatus;
  inspectedBy: string;
  inspectionDate: string;
  completedAt?: string;
  measurements: AQLMeasurement[];
  overallResult: "PASS" | "FAIL" | null;
  linkedNCRId?: string;
  notes?: string;
}

export interface WIPCheckpoint {
  checkId: string;
  checkName: string;
  description: string;
  category: CheckCategory;
  severity: CheckSeverity;
  specification: string;
  measuredValue?: string;
  result: CheckResult;
  remarks?: string;
}

export interface WIPInspection {
  id: string;
  inspectionNumber: string;
  workOrderId: string;
  workOrderPid: string;
  productCode: string;
  productName: string;
  deviceId?: string;
  line: WIPLine;
  stageName: string;
  stageSequence: number;
  qtyUnderInspection: number;
  qtyPassed: number;
  qtyFailed: number;
  status: InspectionStatus;
  inspectedBy: string;
  operatorName: string;
  startedAt: string;
  completedAt?: string;
  overallResult: "PASS" | "FAIL" | null;
  checkpoints: WIPCheckpoint[];
  linkedNCRId?: string;
  reworkRequired: boolean;
  notes?: string;
}

export interface FinalDeviceCheck {
  checkId: string;
  checkName: string;
  description: string;
  category: CheckCategory;
  severity: CheckSeverity;
  specification: string;
  passCount: number;
  failCount: number;
  naCount: number;
  result: CheckResult;
  remarks?: string;
}

export interface DeviceQCResult {
  deviceId: string;
  result: "PASS" | "FAIL";
  defects?: string;
  reworkRevision: number;
}

export interface FinalBatchQC {
  id: string;
  batchQCNumber: string;
  workOrderId: string;
  workOrderPid: string;
  productCode: string;
  productName: string;
  batchQty: number;
  sampleSize: number;
  acceptNumber: number;
  rejectNumber: number;
  samplingPlan: string;
  status: InspectionStatus;
  batchDecision: BatchQCDecision;
  inspectedBy: string;
  countersignedBy?: string;
  handoverDate: string;
  completedAt?: string;
  tatHours?: number;
  checks: FinalDeviceCheck[];
  deviceResults: DeviceQCResult[];
  passQty: number;
  failQty: number;
  linkedNCRId?: string;
  bmrReference: string;
  notes?: string;
}

export interface NCRRecord {
  id: string;
  ncrNumber: string;
  source: NCRSource;
  severity: NCRSeverity;
  status: NCRStatus;
  title: string;
  description: string;
  linkedInspectionId?: string;
  linkedInspectionNumber?: string;
  workOrderId?: string;
  workOrderPid?: string;
  productCode?: string;
  productName?: string;
  itemCode?: string;
  itemName?: string;
  batchLotNumber?: string;
  vendorName?: string;
  qtyAffected?: number;
  containmentAction: string;
  raisedBy: string;
  raisedAt: string;
  assignedTo: string;
  targetClosureDate: string;
  closedAt?: string;
  closedBy?: string;
  linkedCAPAId?: string;
  dispositionDecision?: "USE_AS_IS" | "REWORK" | "SCRAP" | "RETURN_TO_VENDOR" | "PENDING";
  notes?: string;
}

export interface CAPAActionItem {
  id: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  completedAt?: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
  evidence?: string;
}

export interface CAPAApprovalStep {
  role: string;
  approver: string;
  action: "PENDING" | "APPROVED" | "REJECTED";
  note?: string;
  actionedAt?: string;
}

export interface CAPARecord {
  id: string;
  capaNumber: string;
  type: CAPAType;
  status: CAPAStatus;
  linkedNCRId?: string;
  linkedNCRNumber?: string;
  workOrderId?: string;
  workOrderPid?: string;
  productCode?: string;
  problemStatement: string;
  immediateContainment: string;
  rootCauseMethod: RootCauseMethod;
  rootCauseFinding: string;
  rootCauseCategory: "OC_FITMENT" | "PCB_ASSEMBLY" | "INCOMING_MATERIAL" | "DIMENSIONAL" | "PROCESS_ERROR" | "HANDLING_ESD" | "FIRMWARE" | "OTHER";
  correctiveAction: string;
  preventiveAction: string;
  responsiblePerson: string;
  openedBy: string;
  openedAt: string;
  targetClosureDate: string;
  closedAt?: string;
  closedBy?: string;
  effectivenessStatus: "NOT_STARTED" | "MONITORING" | "EFFECTIVE" | "INEFFECTIVE";
  actionItems: CAPAActionItem[];
  approvalSteps: CAPAApprovalStep[];
  batchesMonitored: number;
  recurrenceFound: boolean;
  notes?: string;
}

export interface CalibrationHistory {
  date: string;
  performedBy: string;
  certNumber: string;
  result: "PASS" | "FAIL" | "ADJUSTED";
  nextDueDate: string;
  notes?: string;
}

export interface EquipmentRecord {
  id: string;
  equipmentId: string;
  equipmentName: string;
  category: EquipmentCategory;
  make: string;
  model: string;
  serialNumber: string;
  location: string;
  status: EquipmentStatus;
  lastCalibrationDate: string;
  nextCalibrationDue: string;
  calibrationFrequencyDays: number;
  calibratedBy: string;
  calibrationCertNumber?: string;
  usedInStages: string[];
  calibrationHistory: CalibrationHistory[];
  notes?: string;
}

export const incomingInspections: IncomingQCInspection[] = [];
export const wipInspections: WIPInspection[] = [];
export const finalBatchQCs: FinalBatchQC[] = [];
export const ncrRecords: NCRRecord[] = [];
export const capaRecords: CAPARecord[] = [];
export const equipmentRecords: EquipmentRecord[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getIncomingInspectionById(_id: string): IncomingQCInspection | undefined {
  return undefined;
}

export function getWIPInspectionById(_id: string): WIPInspection | undefined {
  return undefined;
}

export function getNCRById(_id: string): NCRRecord | undefined {
  return undefined;
}

export function getCAPAById(_id: string): CAPARecord | undefined {
  return undefined;
}

export function getEquipmentById(_id: string): EquipmentRecord | undefined {
  return undefined;
}

export function getOpenNCRs(): NCRRecord[] {
  return [];
}

export function getOpenCAPAs(): CAPARecord[] {
  return [];
}

export function getOverdueEquipment(): EquipmentRecord[] {
  return [];
}

export function getCalibrationDueEquipment(): EquipmentRecord[] {
  return [];
}

export function getPendingIncomingInspections(): IncomingQCInspection[] {
  return [];
}

export function getIncomingPassRate(): number {
  return 0;
}

export function getCAPAOverdueCount(): number {
  return 0;
}

export function getDaysUntilCalibration(dueDate: string): number {
  const today = new Date("2026-04-17");
  const due = new Date(dueDate);
  return Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
