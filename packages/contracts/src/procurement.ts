/**
 * Procurement contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §13.5. Matches ops/sql/init/04-procurement.sql.
 *
 * Scope (Phase 2):
 *   - vendors (master)
 *   - indents (+ indent_lines)
 *   - purchase_orders (+ po_lines)
 *   - grns (+ grn_lines)
 *
 * Rules (same as crm.ts / inventory.ts):
 *   - Money + quantities are decimal-strings. NEVER Number().
 *   - Enums are UPPER_SNAKE to match DB CHECK constraints.
 *   - Headers have optimistic concurrency via expectedVersion.
 *   - Line CRUD is siblings-of-header: separate endpoints, bumps
 *     header.version via service-layer side-effects.
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** NUMERIC(18,2) money-style. */
const decimalStr = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/u, 'must be a decimal string like "1000.50"');

/** NUMERIC(18,3) quantity — three decimals for metres / grams. */
const qtyStr = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,3})?$/u, 'must be a quantity string like "12.500"');

const uuid = z.string().uuid();

// ─── Enums ───────────────────────────────────────────────────────────────────

export const VENDOR_TYPES = [
  "SUPPLIER",
  "SERVICE",
  "LOGISTICS",
  "BOTH",
] as const;
export const VendorTypeSchema = z.enum(VENDOR_TYPES);
export type VendorType = z.infer<typeof VendorTypeSchema>;

export const PROCUREMENT_NUMBER_KINDS = ["INDENT", "PO", "GRN"] as const;
export const ProcurementNumberKindSchema = z.enum(PROCUREMENT_NUMBER_KINDS);
export type ProcurementNumberKind = z.infer<typeof ProcurementNumberKindSchema>;

export const INDENT_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
] as const;
export const IndentStatusSchema = z.enum(INDENT_STATUSES);
export type IndentStatus = z.infer<typeof IndentStatusSchema>;

export const INDENT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const IndentPrioritySchema = z.enum(INDENT_PRIORITIES);
export type IndentPriority = z.infer<typeof IndentPrioritySchema>;

export const PO_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;
export const PoStatusSchema = z.enum(PO_STATUSES);
export type PoStatus = z.infer<typeof PoStatusSchema>;

export const PO_APPROVAL_ACTIONS = ["APPROVE", "REJECT"] as const;
export const PoApprovalActionSchema = z.enum(PO_APPROVAL_ACTIONS);
export type PoApprovalAction = z.infer<typeof PoApprovalActionSchema>;

export const GRN_STATUSES = ["DRAFT", "POSTED"] as const;
export const GrnStatusSchema = z.enum(GRN_STATUSES);
export type GrnStatus = z.infer<typeof GrnStatusSchema>;

export const GRN_LINE_QC_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "PARTIAL",
] as const;
export const GrnLineQcStatusSchema = z.enum(GRN_LINE_QC_STATUSES);
export type GrnLineQcStatus = z.infer<typeof GrnLineQcStatusSchema>;

// ─── Vendors ─────────────────────────────────────────────────────────────────

export const VendorSchema = z.object({
  id: uuid,
  orgId: uuid,
  code: z.string(),
  name: z.string(),
  vendorType: VendorTypeSchema,
  gstin: z.string().nullable(),
  pan: z.string().nullable(),
  msmeNumber: z.string().nullable(),
  isMsme: z.boolean(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string(),
  postalCode: z.string().nullable(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  paymentTermsDays: z.number().int(),
  creditLimit: decimalStr,
  bankAccount: z.string().nullable(),
  bankIfsc: z.string().nullable(),
  bankName: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const CreateVendorSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  vendorType: VendorTypeSchema.default("SUPPLIER"),
  gstin: z.string().trim().max(20).optional(),
  pan: z.string().trim().max(20).optional(),
  msmeNumber: z.string().trim().max(40).optional(),
  isMsme: z.boolean().default(false),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  country: z.string().trim().length(2).default("IN"),
  postalCode: z.string().trim().max(20).optional(),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().url().max(200).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  creditLimit: decimalStr.default("0"),
  bankAccount: z.string().trim().max(40).optional(),
  bankIfsc: z.string().trim().max(20).optional(),
  bankName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
});
export type CreateVendor = z.infer<typeof CreateVendorSchema>;

export const UpdateVendorSchema = CreateVendorSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateVendor = z.infer<typeof UpdateVendorSchema>;

export const VendorListQuerySchema = PaginationQuerySchema.extend({
  vendorType: VendorTypeSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  isMsme: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Indents ─────────────────────────────────────────────────────────────────

export const IndentSchema = z.object({
  id: uuid,
  orgId: uuid,
  indentNumber: z.string(),
  department: z.string().nullable(),
  purpose: z.string().nullable(),
  status: IndentStatusSchema,
  priority: IndentPrioritySchema,
  requiredBy: z.string().nullable(), // ISO date
  requestedBy: uuid.nullable(),
  approvedBy: uuid.nullable(),
  approvedAt: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Indent = z.infer<typeof IndentSchema>;

export const IndentLineSchema = z.object({
  id: uuid,
  orgId: uuid,
  indentId: uuid,
  lineNo: z.number().int().positive(),
  itemId: uuid,
  quantity: qtyStr,
  uom: z.string(),
  estimatedCost: decimalStr,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IndentLine = z.infer<typeof IndentLineSchema>;

/**
 * Indent header + embedded lines. Used for read-detail and the richer
 * create-with-lines endpoint (`POST /procurement/indents` with `lines: []`).
 */
export const IndentWithLinesSchema = IndentSchema.extend({
  lines: z.array(IndentLineSchema),
});
export type IndentWithLines = z.infer<typeof IndentWithLinesSchema>;

export const CreateIndentLineSchema = z.object({
  itemId: uuid,
  lineNo: z.number().int().positive().optional(), // auto-assigned if absent
  quantity: qtyStr,
  uom: z.string().trim().min(1).max(16),
  estimatedCost: decimalStr.default("0"),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateIndentLine = z.infer<typeof CreateIndentLineSchema>;

export const UpdateIndentLineSchema = CreateIndentLineSchema.partial();
export type UpdateIndentLine = z.infer<typeof UpdateIndentLineSchema>;

export const CreateIndentSchema = z.object({
  /**
   * Optional — service layer auto-generates IND-YYYY-NNNN via the
   * procurement_number_sequences table if omitted.
   */
  indentNumber: z.string().trim().min(1).max(32).optional(),
  department: z.string().trim().max(120).optional(),
  purpose: z.string().trim().max(500).optional(),
  priority: IndentPrioritySchema.default("NORMAL"),
  requiredBy: z.string().date().optional(),
  requestedBy: uuid.optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(CreateIndentLineSchema).default([]),
});
export type CreateIndent = z.infer<typeof CreateIndentSchema>;

export const UpdateIndentSchema = z.object({
  department: z.string().trim().max(120).optional(),
  purpose: z.string().trim().max(500).optional(),
  status: IndentStatusSchema.optional(),
  priority: IndentPrioritySchema.optional(),
  requiredBy: z.string().date().optional(),
  requestedBy: uuid.optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateIndent = z.infer<typeof UpdateIndentSchema>;

export const IndentListQuerySchema = PaginationQuerySchema.extend({
  status: IndentStatusSchema.optional(),
  priority: IndentPrioritySchema.optional(),
  department: z.string().trim().max(120).optional(),
  requestedBy: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Purchase Orders ────────────────────────────────────────────────────────

export const PurchaseOrderSchema = z.object({
  id: uuid,
  orgId: uuid,
  poNumber: z.string(),
  indentId: uuid.nullable(),
  vendorId: uuid,
  status: PoStatusSchema,
  currency: z.string(),
  orderDate: z.string(),
  expectedDate: z.string().nullable(),
  deliveryWarehouseId: uuid.nullable(),
  billingAddress: z.string().nullable(),
  shippingAddress: z.string().nullable(),
  paymentTermsDays: z.number().int(),
  subtotal: decimalStr,
  taxTotal: decimalStr,
  discountTotal: decimalStr,
  grandTotal: decimalStr,
  createdBy: uuid.nullable(),
  approvedBy: uuid.nullable(),
  approvedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export const PoLineSchema = z.object({
  id: uuid,
  orgId: uuid,
  poId: uuid,
  indentLineId: uuid.nullable(),
  lineNo: z.number().int().positive(),
  itemId: uuid,
  description: z.string().nullable(),
  quantity: qtyStr,
  uom: z.string(),
  unitPrice: decimalStr,
  discountPct: decimalStr,
  taxPct: decimalStr,
  lineSubtotal: decimalStr,
  lineTax: decimalStr,
  lineTotal: decimalStr,
  receivedQty: qtyStr,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PoLine = z.infer<typeof PoLineSchema>;

export const PurchaseOrderWithLinesSchema = PurchaseOrderSchema.extend({
  lines: z.array(PoLineSchema),
});
export type PurchaseOrderWithLines = z.infer<
  typeof PurchaseOrderWithLinesSchema
>;

export const CreatePoLineSchema = z.object({
  itemId: uuid,
  indentLineId: uuid.optional(),
  lineNo: z.number().int().positive().optional(),
  description: z.string().trim().max(500).optional(),
  quantity: qtyStr,
  uom: z.string().trim().min(1).max(16),
  unitPrice: decimalStr,
  discountPct: decimalStr.default("0"),
  taxPct: decimalStr.default("0"),
  notes: z.string().trim().max(2000).optional(),
});
export type CreatePoLine = z.infer<typeof CreatePoLineSchema>;

export const UpdatePoLineSchema = CreatePoLineSchema.partial();
export type UpdatePoLine = z.infer<typeof UpdatePoLineSchema>;

export const CreatePurchaseOrderSchema = z.object({
  /** Auto-generated if omitted. */
  poNumber: z.string().trim().min(1).max(32).optional(),
  indentId: uuid.optional(),
  vendorId: uuid,
  currency: z.string().trim().length(3).default("INR"),
  orderDate: z.string().date().optional(),
  expectedDate: z.string().date().optional(),
  deliveryWarehouseId: uuid.optional(),
  billingAddress: z.string().trim().max(500).optional(),
  shippingAddress: z.string().trim().max(500).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(CreatePoLineSchema).default([]),
});
export type CreatePurchaseOrder = z.infer<typeof CreatePurchaseOrderSchema>;

export const UpdatePurchaseOrderSchema = z.object({
  indentId: uuid.optional(),
  vendorId: uuid.optional(),
  status: PoStatusSchema.optional(),
  currency: z.string().trim().length(3).optional(),
  orderDate: z.string().date().optional(),
  expectedDate: z.string().date().optional(),
  deliveryWarehouseId: uuid.optional(),
  billingAddress: z.string().trim().max(500).optional(),
  shippingAddress: z.string().trim().max(500).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  cancelReason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdatePurchaseOrder = z.infer<typeof UpdatePurchaseOrderSchema>;

export const PurchaseOrderListQuerySchema = PaginationQuerySchema.extend({
  status: PoStatusSchema.optional(),
  vendorId: uuid.optional(),
  indentId: uuid.optional(),
  deliveryWarehouseId: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  /** Inclusive lower bound on grand_total — drives the finance-approvals view. */
  minTotal: decimalStr.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── PO Approvals ───────────────────────────────────────────────────────────
//
// Append-only audit of approve/reject actions against a PO. The PO header
// also carries `approved_by` / `approved_at` (denormalised on APPROVE) so
// list views don't have to join — this table preserves the full who/when/
// why trail and the prior/new status pair for compliance.

export const ApprovePurchaseOrderSchema = z.object({
  /** Optimistic-concurrency token; mirrors the rest of the PO surface. */
  expectedVersion: z.number().int().positive(),
  remarks: z.string().trim().max(2000).optional(),
});
export type ApprovePurchaseOrder = z.infer<typeof ApprovePurchaseOrderSchema>;

export const RejectPurchaseOrderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  /** Required for REJECT — auditors expect a reason. */
  remarks: z.string().trim().min(1).max(2000),
});
export type RejectPurchaseOrder = z.infer<typeof RejectPurchaseOrderSchema>;

export const PoApprovalSchema = z.object({
  id: uuid,
  orgId: uuid,
  poId: uuid,
  action: PoApprovalActionSchema,
  userId: uuid.nullable(),
  priorStatus: PoStatusSchema,
  newStatus: PoStatusSchema,
  remarks: z.string().nullable(),
  createdAt: z.string(),
});
export type PoApproval = z.infer<typeof PoApprovalSchema>;

export const PoApprovalHistorySchema = z.object({
  poId: uuid,
  data: z.array(PoApprovalSchema),
});
export type PoApprovalHistory = z.infer<typeof PoApprovalHistorySchema>;

// ─── GRNs ────────────────────────────────────────────────────────────────────

export const GrnSchema = z.object({
  id: uuid,
  orgId: uuid,
  grnNumber: z.string(),
  poId: uuid,
  vendorId: uuid,
  warehouseId: uuid,
  status: GrnStatusSchema,
  receivedDate: z.string(),
  vehicleNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  receivedBy: uuid.nullable(),
  postedBy: uuid.nullable(),
  postedAt: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Grn = z.infer<typeof GrnSchema>;

export const GrnLineSchema = z.object({
  id: uuid,
  orgId: uuid,
  grnId: uuid,
  poLineId: uuid,
  lineNo: z.number().int().positive(),
  itemId: uuid,
  quantity: qtyStr,
  uom: z.string(),
  unitCost: decimalStr,
  batchNo: z.string().nullable(),
  serialNo: z.string().nullable(),
  mfgDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  qcStatus: GrnLineQcStatusSchema.nullable(),
  qcRejectedQty: qtyStr,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GrnLine = z.infer<typeof GrnLineSchema>;

export const GrnWithLinesSchema = GrnSchema.extend({
  lines: z.array(GrnLineSchema),
});
export type GrnWithLines = z.infer<typeof GrnWithLinesSchema>;

export const CreateGrnLineSchema = z.object({
  poLineId: uuid,
  itemId: uuid,
  lineNo: z.number().int().positive().optional(),
  quantity: qtyStr,
  uom: z.string().trim().min(1).max(16),
  unitCost: decimalStr.default("0"),
  batchNo: z.string().trim().max(64).optional(),
  serialNo: z.string().trim().max(64).optional(),
  mfgDate: z.string().date().optional(),
  expiryDate: z.string().date().optional(),
  qcStatus: GrnLineQcStatusSchema.optional(),
  qcRejectedQty: qtyStr.default("0"),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateGrnLine = z.infer<typeof CreateGrnLineSchema>;

export const UpdateGrnLineSchema = CreateGrnLineSchema.partial();
export type UpdateGrnLine = z.infer<typeof UpdateGrnLineSchema>;

export const CreateGrnSchema = z.object({
  /** Auto-generated if omitted. */
  grnNumber: z.string().trim().min(1).max(32).optional(),
  poId: uuid,
  vendorId: uuid,
  warehouseId: uuid,
  receivedDate: z.string().date().optional(),
  vehicleNumber: z.string().trim().max(40).optional(),
  invoiceNumber: z.string().trim().max(64).optional(),
  invoiceDate: z.string().date().optional(),
  receivedBy: uuid.optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(CreateGrnLineSchema).default([]),
});
export type CreateGrn = z.infer<typeof CreateGrnSchema>;

export const UpdateGrnSchema = z.object({
  warehouseId: uuid.optional(),
  receivedDate: z.string().date().optional(),
  vehicleNumber: z.string().trim().max(40).optional(),
  invoiceNumber: z.string().trim().max(64).optional(),
  invoiceDate: z.string().date().optional(),
  receivedBy: uuid.optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateGrn = z.infer<typeof UpdateGrnSchema>;

/**
 * Post a DRAFT GRN. Atomic: writes one stock_ledger row per grn_line
 * (txn_type = 'GRN_RECEIPT'), bumps the parent PO's po_lines.received_qty
 * and header status (→ PARTIALLY_RECEIVED / RECEIVED), flips the GRN's
 * own status to POSTED. Audit trail from triggers.
 */
export const PostGrnSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type PostGrn = z.infer<typeof PostGrnSchema>;

export const GrnListQuerySchema = PaginationQuerySchema.extend({
  status: GrnStatusSchema.optional(),
  poId: uuid.optional(),
  vendorId: uuid.optional(),
  warehouseId: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Procurement reports (date-windowed PO + vendor rollup) ──────────────────

export const ProcurementReportsQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ProcurementReportsQuery = z.infer<
  typeof ProcurementReportsQuerySchema
>;

export const ProcurementReportsSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** PO throughput across the window (by order_date). */
  poThroughput: z.object({
    total: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
    pendingApproval: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    partiallyReceived: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    totalSpend: decimalStr,
    receivedSpend: decimalStr,
  }),
  /** GRN posting cadence and on-time delivery (received vs expected). */
  delivery: z.object({
    grnsPosted: z.number().int().nonnegative(),
    onTimePct: z.number(),
    avgLeadDays: z.number().nullable(),
    lateGrns: z.number().int().nonnegative(),
  }),
  /** Top vendors by spend (POs) in window. */
  topVendors: z.array(
    z.object({
      vendorId: uuid,
      vendorName: z.string(),
      vendorCode: z.string(),
      poCount: z.number().int().nonnegative(),
      totalSpend: decimalStr,
    }),
  ),
});
export type ProcurementReports = z.infer<typeof ProcurementReportsSchema>;

// ─── Procurement overview (dashboard top-of-funnel counts) ────────────────────

/**
 * Lightweight aggregate that backs /procurement/dashboard. Distinct from
 * `ProcurementReports`: no date window, no vendor breakdown, just the
 * four counts the cards show. Spend stays in the reports endpoint.
 */
export const ProcurementOverviewSchema = z.object({
  totalPOs: z.number().int().nonnegative(),
  pendingPOs: z.number().int().nonnegative(),
  totalGRNs: z.number().int().nonnegative(),
  pendingIndents: z.number().int().nonnegative(),
});
export type ProcurementOverview = z.infer<typeof ProcurementOverviewSchema>;
