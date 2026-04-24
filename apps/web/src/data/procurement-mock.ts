// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

export type VendorStatus = "ACTIVE" | "ON_PROBATION" | "BLACKLISTED" | "INACTIVE";
export type VendorCategory =
  | "PCB Manufacturer" | "Mechanical" | "Electronic Components"
  | "Reagent Supplier" | "Packaging" | "Logistics" | "Service" | "Other";

export interface VendorRatingPeriod {
  period: string; // e.g. "Q4-FY2025"
  qcPassRate: number;
  onTimeRate: number;
  rejectionRate: number;
  score: number;
}

export interface Vendor {
  id: string;
  code: string;
  legalName: string;
  tradeName: string;
  gstin: string;
  pan: string;
  category: VendorCategory;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  paymentTerms: "Net 15" | "Net 30" | "Net 45" | "Advance" | "On Delivery";
  leadTimeDays: number;
  status: VendorStatus;
  ratingScore: number;
  ratingPeriods: VendorRatingPeriod[];
  totalPOValue: number;
  totalGRNs: number;
  msmeRegistered: boolean;
  bankName: string;
  bankAccount: string; // masked
  ifsc: string;
  createdAt: string;
}

export type IndentStatus =
  | "DRAFT" | "SUBMITTED" | "APPROVED" | "PO_RAISED"
  | "PARTIALLY_RECEIVED" | "FULFILLED" | "CANCELLED";
export type IndentUrgency = "NORMAL" | "URGENT";
export type IndentSource = "MANUAL" | "MRP_AUTO" | "REORDER_AUTO";

export interface Indent {
  id: string;
  indentNumber: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyRequired: number;
  uom: string;
  requiredByDate: string;
  reason: string;
  urgency: IndentUrgency;
  source: IndentSource;
  status: IndentStatus;
  workOrderId?: string;
  warehouseId: string;
  warehouseName: string;
  requestedBy: string;
  approvedBy?: string;
  poNumber?: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export type POStatus =
  | "DRAFT" | "PENDING_FINANCE" | "PENDING_MGMT" | "APPROVED"
  | "PO_SENT" | "PARTIALLY_RECEIVED" | "FULFILLED" | "CANCELLED" | "AMENDED";

export interface POLine {
  id: string;
  indentId?: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qty: number;
  unit: string;
  unitPrice: number;
  hsnCode: string;
  gstRate: number;
  lineTotal: number;
  qtyReceived: number;
}

export interface POApprovalLog {
  id: string;
  approver: string;
  role: string;
  action: "APPROVED" | "REJECTED" | "ESCALATED" | "PENDING";
  note?: string;
  actionedAt?: string;
  threshold: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  vendorGstin: string;
  warehouseId: string;
  warehouseName: string;
  requiredDeliveryDate: string;
  status: POStatus;
  lines: POLine[];
  subtotal: number;
  gstAmount: number;
  totalValue: number;
  approvalLogs: POApprovalLog[];
  proformaInvoiceRef?: string;
  proformaUploaded: boolean;
  createdBy: string;
  createdAt: string;
  approvedAt?: string;
  sentAt?: string;
  notes?: string;
  costCentre: string;
}

export type InwardStatus = "RECEIVED" | "QC_IN_PROGRESS" | "QC_DONE" | "GRN_CREATED";

export interface InwardLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyOrdered: number;
  qtyReceived: number;
  unit: string;
  vendorBatchRef?: string;
  condition: "GOOD" | "DAMAGED" | "EXCESS";
}

export interface InwardEntry {
  id: string;
  inwardNumber: string;
  poId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  warehouseId: string;
  warehouseName: string;
  vehicleNumber: string;
  driverName: string;
  challanRef: string;
  receivedAt: string;
  status: InwardStatus;
  lines: InwardLine[];
  receivedBy: string;
  qcTaskId?: string;
  grnId?: string;
  remarks?: string;
}

export type QCStatus = "PENDING" | "IN_PROGRESS" | "PASSED" | "PARTIALLY_PASSED" | "FAILED";

export interface QCCheckItem {
  id: string;
  checkName: string;
  category: string;
  result: "PASS" | "FAIL" | "NA";
  remarks?: string;
}

export interface QCInspection {
  id: string;
  inwardId: string;
  inwardNumber: string;
  poNumber: string;
  vendorName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyInspected: number;
  qtyAccepted: number;
  qtyRejected: number;
  status: QCStatus;
  checklist: QCCheckItem[];
  inspectedBy?: string;
  inspectedAt?: string;
  defectReason?: string;
  grnId?: string;
}

export type GRNStatus = "DRAFT" | "CONFIRMED";

export interface GRNLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyAccepted: number;
  qtyRejected: number;
  unit: string;
  batchNumber: string;
  expiryDate?: string;
  unitPrice: number;
  lineValue: number;
  qcResult: "PASSED" | "PARTIALLY_PASSED" | "FAILED";
}

export interface GRN {
  id: string;
  grnNumber: string;
  inwardId: string;
  inwardNumber: string;
  poId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  qcInspectionId: string;
  warehouseId: string;
  warehouseName: string;
  status: GRNStatus;
  lines: GRNLine[];
  totalAcceptedValue: number;
  purchaseInvoiceDraft?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  stockUpdated: boolean;
}

export type RTVReason = "QC_REJECTION" | "WRONG_ITEM" | "EXCESS" | "DAMAGED_IN_TRANSIT" | "EXPIRED";
export type RTVStatus = "DRAFT" | "DISPATCHED" | "VENDOR_ACKNOWLEDGED" | "DEBIT_NOTE_RAISED";

export interface RTVLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyReturned: number;
  unit: string;
  unitPrice: number;
  lineValue: number;
  reasonDetail: string;
}

export interface ReturnToVendor {
  id: string;
  rtvNumber: string;
  inwardId: string;
  inwardNumber: string;
  grnId?: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  reason: RTVReason;
  status: RTVStatus;
  lines: RTVLine[];
  totalReturnValue: number;
  debitNoteRef?: string;
  debitNoteCreated: boolean;
  createdBy: string;
  createdAt: string;
  dispatchedAt?: string;
}

export const vendors: Vendor[] = [];
export const indents: Indent[] = [];
export const purchaseOrders: PurchaseOrder[] = [];
export const inwardEntries: InwardEntry[] = [];
export const qcInspections: QCInspection[] = [];
export const procurementGRNs: GRN[] = [];
export const rtvList: ReturnToVendor[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getVendorById(_id: string): Vendor | undefined {
  return undefined;
}

export function getPOById(_id: string): PurchaseOrder | undefined {
  return undefined;
}

export function getInwardById(_id: string): InwardEntry | undefined {
  return undefined;
}

export function getQCByInwardId(_inwardId: string): QCInspection | undefined {
  return undefined;
}

export function getGRNByInwardId(_inwardId: string): GRN | undefined {
  return undefined;
}

export function getRatingColor(score: number): string {
  if (score >= 85) return "text-green-600";
  if (score >= 70) return "text-amber-600";
  if (score >= 60) return "text-orange-600";
  return "text-red-600";
}

export function getRatingLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 60) return "Acceptable";
  return "Poor";
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
