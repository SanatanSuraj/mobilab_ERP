// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

export type ProductFamily = "INSTIGENIE_INSTRUMENT" | "CBL_DEVICE" | "REAGENT";
export type BOMStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED" | "OBSOLETE";
export type WOStatus =
  | "PLANNED" | "MATERIAL_CHECK" | "IN_PROGRESS"
  | "QC_HOLD" | "REWORK" | "COMPLETED" | "CANCELLED";
export type WIPStageStatus = "PENDING" | "IN_PROGRESS" | "QC_HOLD" | "REWORK" | "COMPLETED";
export type ECNStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "IMPLEMENTED";
export type WOPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export interface MfgProduct {
  id: string;
  productCode: string;
  name: string;
  family: ProductFamily;
  hasSerialTracking: boolean;
  activeBomVersion: string;
  standardCycleDays: number;
}

export interface BOMLine {
  id: string;
  componentItemId: string;
  componentCode: string;
  componentName: string;
  qtyPerUnit: number;
  uom: string;
  referenceDesignator?: string;
  isCritical: boolean;
  trackingType: "SERIAL" | "BATCH" | "NONE";
  leadTimeDays: number;
}

export interface BOM {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  version: string;
  status: BOMStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  lines: BOMLine[];
  createdBy: string;
  approvedBy?: string;
  totalStdCost: number;
  notes?: string;
  ecnRef?: string;
}

export interface WIPStageTemplate {
  id: string;
  productFamily: ProductFamily;
  sequenceNumber: number;
  stageName: string;
  requiresQCSignOff: boolean;
  expectedDurationHours: number;
  responsibleRole: string;
}

export interface WIPStage {
  id: string;
  templateId: string;
  stageName: string;
  sequenceNumber: number;
  requiresQCSignOff: boolean;
  expectedDurationHours: number;
  status: WIPStageStatus;
  startedAt?: string;
  completedAt?: string;
  qcResult?: "PASS" | "FAIL";
  reworkCount: number;
  assignedTo?: string;
  notes?: string;
}

export interface ComponentAssignment {
  componentItemId: string;
  componentCode: string;
  componentName: string;
  assignmentType: "SERIAL" | "BATCH";
  serialId?: string;
  batchId?: string;
  batchNumber?: string;
  assignedAt: string;
}

export interface MRPLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyRequired: number;
  qtyAvailable: number;
  qtyShortfall: number;
  status: "SUFFICIENT" | "SHORTFALL" | "RESERVED";
  indentNumber?: string;
  reservedBatch?: string;
}

export interface EnhancedWorkOrder {
  id: string;
  pid: string;
  productId: string;
  productName: string;
  productCode: string;
  productFamily: ProductFamily;
  bomId: string;
  bomVersion: string;
  quantity: number;
  status: WOStatus;
  priority: WOPriority;
  targetDate: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  dealId?: string;
  assignedTo: string;
  createdBy: string;
  wipStages: WIPStage[];
  mrpLines: MRPLine[];
  componentAssignments: ComponentAssignment[];
  deviceSerials: string[];
  currentStageIndex: number;
  reworkCount: number;
  notes?: string;
  lotNumber?: string;
}

export interface ECNApprovalStep {
  role: string;
  approver: string;
  action: "PENDING" | "APPROVED" | "REJECTED";
  note?: string;
  actionedAt?: string;
}

export interface ECN {
  id: string;
  ecnNumber: string;
  title: string;
  reason: string;
  reasonCode: "QUALITY_IMPROVEMENT" | "COST_REDUCTION" | "SUPPLIER_CHANGE" | "REGULATORY" | "SAFETY" | "PERFORMANCE";
  affectedProductIds: string[];
  affectedProductNames: string[];
  fromBomId: string;
  fromBomVersion: string;
  toBomVersion: string;
  changeDescription: string;
  impact: string;
  status: ECNStatus;
  isUrgent: boolean;
  effectiveDate?: string;
  initiatedBy: string;
  createdAt: string;
  implementedAt?: string;
  approvalSteps: ECNApprovalStep[];
}

export const mfgProducts: MfgProduct[] = [];
export const boms: BOM[] = [];
export const wipStageTemplates: WIPStageTemplate[] = [];
export const enhancedWorkOrders: EnhancedWorkOrder[] = [];
export const ecns: ECN[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getMfgProductById(_id: string): MfgProduct | undefined {
  return undefined;
}

export function getBOMById(_id: string): BOM | undefined {
  return undefined;
}

export function getBOMsForProduct(_productId: string): BOM[] {
  return [];
}

export function getWIPTemplatesForFamily(_family: ProductFamily): WIPStageTemplate[] {
  return [];
}

export function getWOById(_id: string): EnhancedWorkOrder | undefined {
  return undefined;
}

export function getCompletedStages(wo: EnhancedWorkOrder): number {
  return wo.wipStages.filter((s) => s.status === "COMPLETED").length;
}

export function getWOProgress(wo: EnhancedWorkOrder): number {
  if (wo.wipStages.length === 0) return 0;
  return Math.round((getCompletedStages(wo) / wo.wipStages.length) * 100);
}

export function isWOOverdue(wo: EnhancedWorkOrder): boolean {
  if (wo.status === "COMPLETED" || wo.status === "CANCELLED") return false;
  return new Date(wo.targetDate) < new Date();
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
