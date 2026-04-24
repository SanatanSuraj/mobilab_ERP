// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

export type TrackingType = "NONE" | "BATCH" | "SERIAL";
export type ItemStatus = "active" | "inactive";
export type AbcClass = "A" | "B" | "C";

export interface InvItem {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  subCategory: string;
  trackingType: TrackingType;
  unit: string;
  standardCost: number;
  hsnCode: string;
  abcClass: AbcClass;
  status: ItemStatus;
  isSlowMoving: boolean;
  isDeadStock: boolean;
  description: string;
  reorderPoints: { warehouseId: string; reorderPoint: number; reorderQty: number; safetyStock: number }[];
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  city: string;
  gstin: string;
  isPrimary: boolean;
  zones: Zone[];
}

export interface Zone {
  id: string;
  warehouseId: string;
  name: string;
  code: string;
  allowedTxnTypes: string[];
}

export type LedgerTxnType =
  | "IN" | "OUT" | "TRANSFER_OUT" | "TRANSFER_IN"
  | "ADJUSTMENT" | "RESERVATION" | "RESERVATION_RELEASE" | "RETURN";

export type LedgerRefDocType =
  | "GRN" | "WORK_ORDER" | "DELIVERY_CHALLAN" | "TRANSFER" | "ADJUSTMENT" | "RETURN";

export interface StockLedgerEntry {
  id: string;
  itemId: string;
  warehouseId: string;
  zoneId: string;
  txnType: LedgerTxnType;
  qty: number; // positive = IN, negative = OUT
  balanceQty: number;
  refDocType: LedgerRefDocType;
  refDocId: string;
  batchId?: string;
  serialId?: string;
  reasonCode?: string;
  remarks?: string;
  createdBy: string;
  txnAt: string;
  status: "CONFIRMED" | "PENDING";
}

export interface StockSummary {
  itemId: string;
  warehouseId: string;
  totalQty: number;
  reservedQty: number;
  availableQty: number;
}

export type BatchStatus =
  | "ACTIVE" | "PARTIALLY_CONSUMED" | "FULLY_CONSUMED"
  | "QUARANTINED" | "EXPIRED" | "RETURNED_TO_VENDOR";

export interface InvBatch {
  id: string;
  batchNumber: string;
  itemId: string;
  warehouseId: string;
  zoneId: string;
  vendorLotNumber: string;
  vendorId: string;
  vendorName: string;
  grnId: string;
  mfgDate: string;
  expiryDate: string;
  receivedQty: number;
  currentQty: number;
  consumedQty: number;
  status: BatchStatus;
  qcInspectionId?: string;
  qcStatus: "PENDING" | "PASSED" | "FAILED";
  // Reagent-specific
  catalogueNumber?: string;
  storageTemp?: string;
  reconstitutionDate?: string;
}

export type SerialStatus =
  | "CREATED" | "IN_PRODUCTION" | "QC_HOLD" | "FINISHED"
  | "RESERVED" | "DISPATCHED" | "RETURNED" | "SCRAPPED";

export interface InvSerial {
  id: string;
  serialNumber: string;
  itemId: string;
  warehouseId: string;
  workOrderId?: string;
  status: SerialStatus;
  pcbId?: string;
  mechId?: string;
  sensorId?: string;
  qcCertUrl?: string;
  accountId?: string;
  accountName?: string;
  deliveryChallanId?: string;
  manufacturedDate?: string;
  dispatchedDate?: string;
  returnedDate?: string;
  scrapReason?: string;
}

export type GrnStatus = "DRAFT" | "CONFIRMED" | "PARTIALLY_QC" | "QC_DONE";

export interface GrnLineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unit: string;
  batchId?: string;
  batchNumber?: string;
  expiryDate?: string;
  unitCost: number;
  totalCost: number;
}

export interface Grn {
  id: string;
  grnNumber: string;
  vendorId: string;
  vendorName: string;
  poNumber: string;
  warehouseId: string;
  warehouseName: string;
  receivedDate: string;
  status: GrnStatus;
  lines: GrnLineItem[];
  totalValue: number;
  receivedBy: string;
  inspectedBy?: string;
  remarks?: string;
}

export type TransferStatus = "DRAFT" | "APPROVED" | "IN_TRANSIT" | "RECEIVED" | "DISCREPANCY";

export interface StockTransfer {
  id: string;
  transferNumber: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  status: TransferStatus;
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
  shippedAt?: string;
  receivedAt?: string;
  lines: TransferLine[];
  totalValue: number;
  eWayBillRequired: boolean;
  eWayBillNumber?: string;
  remarks?: string;
}

export interface TransferLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  requestedQty: number;
  shippedQty?: number;
  receivedQty?: number;
  unit: string;
  batchId?: string;
  batchNumber?: string;
}

export type AdjustmentStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export interface StockAdjustment {
  id: string;
  adjNumber: string;
  warehouseId: string;
  warehouseName: string;
  status: AdjustmentStatus;
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
  approvedAt?: string;
  reasonCode: string;
  remarks: string;
  lines: AdjustmentLine[];
  requiresApproval: boolean;
}

export interface AdjustmentLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  systemQty: number;
  physicalQty: number;
  varianceQty: number;
  unit: string;
  batchId?: string;
}

export interface ReorderAlert {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  availableQty: number;
  reorderPoint: number;
  safetyStock: number;
  reorderQty: number;
  severity: "CRITICAL" | "WARNING";
  isSuppressed: boolean;
  suppressedUntil?: string;
  indentCreated: boolean;
  indentNumber?: string;
  lastCheckedAt: string;
}

export const warehouses: Warehouse[] = [];
export const invItems: InvItem[] = [];
export const stockSummaries: StockSummary[] = [];
export const invBatches: InvBatch[] = [];
export const invSerials: InvSerial[] = [];
export const grns: Grn[] = [];
export const stockLedger: StockLedgerEntry[] = [];
export const stockTransfers: StockTransfer[] = [];
export const stockAdjustments: StockAdjustment[] = [];
export const reorderAlerts: ReorderAlert[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getInvItemById(_id: string): InvItem | undefined {
  return undefined;
}

export function getWarehouseById(_id: string): Warehouse | undefined {
  return undefined;
}

export function getStockSummaryForItem(_itemId: string): StockSummary[] {
  return [];
}

export function getTotalStockForItem(_itemId: string): { total: number; reserved: number; available: number } {
  return { total: 0, reserved: 0, available: 0 };
}

export function getBatchesForItem(_itemId: string): InvBatch[] {
  return [];
}

export function getSerialsForItem(_itemId: string): InvSerial[] {
  return [];
}

export function getLedgerForItem(_itemId: string, _warehouseId?: string): StockLedgerEntry[] {
  return [];
}

export function getExpiringBatches(_daysThreshold: number): InvBatch[] {
  return [];
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function getDaysToExpiry(expiryDate: string): number {
  const today = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function getExpiryUrgency(expiryDate: string): "expired" | "urgent" | "warning" | "ok" {
  const days = getDaysToExpiry(expiryDate);
  if (days <= 0) return "expired";
  if (days <= 30) return "urgent";
  if (days <= 90) return "warning";
  return "ok";
}
