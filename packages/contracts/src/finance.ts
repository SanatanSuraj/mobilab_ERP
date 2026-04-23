/**
 * Finance contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §13.6. Matches ops/sql/init/07-finance.sql.
 *
 * Scope (Phase 2):
 *   - sales_invoices (+ sales_invoice_lines)
 *   - purchase_invoices (+ purchase_invoice_lines)
 *   - customer_ledger (append-only)
 *   - vendor_ledger (append-only)
 *   - payments (polymorphic CUSTOMER_RECEIPT | VENDOR_PAYMENT)
 *
 * Explicitly deferred to Phase 3:
 *   - EWB (e-Way Bill) generation via NIC API
 *   - GST returns (GSTR-1, GSTR-3B)
 *   - TDS entries (Form 26Q feed)
 *   - Credit notes / debit notes
 *   - Multi-step approval workflow
 *   - Three-way match validator (PO ↔ GRN ↔ PI tolerance-based)
 *   - Materialised-view backed dashboard
 *
 * Rules (same as qc.ts):
 *   - Money amounts are decimal-strings. NEVER Number().
 *   - Enums are UPPER_SNAKE to match DB CHECK constraints.
 *   - Headers have optimistic concurrency via expectedVersion.
 *   - Line CRUD is siblings-of-header with service-layer version bumps.
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** NUMERIC(18,4) monetary value as a decimal string. */
const moneyStr = z
  .string()
  .trim()
  .regex(
    /^-?\d+(\.\d{1,4})?$/u,
    'must be a money string like "1234.5600" (up to 4 decimals)',
  );

/** Non-negative-only variant for fields that can't go negative. */
const moneyStrNonNeg = z
  .string()
  .trim()
  .regex(
    /^\d+(\.\d{1,4})?$/u,
    'must be a non-negative money string like "1234.5600"',
  );

/** Percentage (0..100) with up to 4 decimals. */
const percentStr = z
  .string()
  .trim()
  .regex(
    /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/u,
    'must be a percentage string 0..100 with up to 4 decimals',
  );

const uuid = z.string().uuid();
const isoDate = z.string().date();
const currencyCode = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Z]{3}$/u, "must be a 3-letter ISO currency code");

// ─── Enums ───────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ["DRAFT", "POSTED", "CANCELLED"] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const PURCHASE_INVOICE_MATCH_STATUSES = [
  "PENDING",
  "MATCHED",
  "MATCH_FAILED",
  "BYPASSED",
] as const;
export const PurchaseInvoiceMatchStatusSchema = z.enum(
  PURCHASE_INVOICE_MATCH_STATUSES,
);
export type PurchaseInvoiceMatchStatus = z.infer<
  typeof PurchaseInvoiceMatchStatusSchema
>;

export const CUSTOMER_LEDGER_ENTRY_TYPES = [
  "INVOICE",
  "PAYMENT",
  "CREDIT_NOTE",
  "OPENING_BALANCE",
  "ADJUSTMENT",
] as const;
export const CustomerLedgerEntryTypeSchema = z.enum(
  CUSTOMER_LEDGER_ENTRY_TYPES,
);
export type CustomerLedgerEntryType = z.infer<
  typeof CustomerLedgerEntryTypeSchema
>;

export const CUSTOMER_LEDGER_REFERENCE_TYPES = [
  "SALES_INVOICE",
  "PAYMENT",
  "CREDIT_NOTE",
  "MANUAL",
] as const;
export const CustomerLedgerReferenceTypeSchema = z.enum(
  CUSTOMER_LEDGER_REFERENCE_TYPES,
);
export type CustomerLedgerReferenceType = z.infer<
  typeof CustomerLedgerReferenceTypeSchema
>;

export const VENDOR_LEDGER_ENTRY_TYPES = [
  "BILL",
  "PAYMENT",
  "DEBIT_NOTE",
  "OPENING_BALANCE",
  "ADJUSTMENT",
] as const;
export const VendorLedgerEntryTypeSchema = z.enum(VENDOR_LEDGER_ENTRY_TYPES);
export type VendorLedgerEntryType = z.infer<typeof VendorLedgerEntryTypeSchema>;

export const VENDOR_LEDGER_REFERENCE_TYPES = [
  "PURCHASE_INVOICE",
  "PAYMENT",
  "DEBIT_NOTE",
  "MANUAL",
] as const;
export const VendorLedgerReferenceTypeSchema = z.enum(
  VENDOR_LEDGER_REFERENCE_TYPES,
);
export type VendorLedgerReferenceType = z.infer<
  typeof VendorLedgerReferenceTypeSchema
>;

export const PAYMENT_TYPES = ["CUSTOMER_RECEIPT", "VENDOR_PAYMENT"] as const;
export const PaymentTypeSchema = z.enum(PAYMENT_TYPES);
export type PaymentType = z.infer<typeof PaymentTypeSchema>;

export const PAYMENT_STATUSES = ["RECORDED", "VOIDED"] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PAYMENT_MODES = [
  "BANK_TRANSFER",
  "CHEQUE",
  "UPI",
  "CASH",
  "CARD",
  "OTHER",
] as const;
export const PaymentModeSchema = z.enum(PAYMENT_MODES);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

export const PAYMENT_APPLIED_INVOICE_TYPES = [
  "SALES_INVOICE",
  "PURCHASE_INVOICE",
] as const;
export const PaymentAppliedInvoiceTypeSchema = z.enum(
  PAYMENT_APPLIED_INVOICE_TYPES,
);
export type PaymentAppliedInvoiceType = z.infer<
  typeof PaymentAppliedInvoiceTypeSchema
>;

export const FINANCE_NUMBER_KINDS = ["SI", "PI", "PAY"] as const;
export const FinanceNumberKindSchema = z.enum(FINANCE_NUMBER_KINDS);
export type FinanceNumberKind = z.infer<typeof FinanceNumberKindSchema>;

// ─── Sales Invoices ──────────────────────────────────────────────────────────

export const SalesInvoiceLineSchema = z.object({
  id: uuid,
  orgId: uuid,
  invoiceId: uuid,
  sequenceNumber: z.number().int().positive(),
  productId: uuid.nullable(),
  itemId: uuid.nullable(),
  description: z.string(),
  hsnSac: z.string().nullable(),
  quantity: moneyStr,
  uom: z.string().nullable(),
  unitPrice: moneyStr,
  discountPercent: moneyStr,
  taxRatePercent: moneyStr,
  lineSubtotal: moneyStr,
  lineTax: moneyStr,
  lineTotal: moneyStr,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SalesInvoiceLine = z.infer<typeof SalesInvoiceLineSchema>;

export const SalesInvoiceSchema = z.object({
  id: uuid,
  orgId: uuid,
  invoiceNumber: z.string(),
  status: InvoiceStatusSchema,
  customerId: uuid.nullable(),
  customerName: z.string().nullable(),
  customerGstin: z.string().nullable(),
  customerAddress: z.string().nullable(),
  workOrderId: uuid.nullable(),
  salesOrderId: uuid.nullable(),
  invoiceDate: z.string(),
  dueDate: z.string().nullable(),
  currency: z.string(),
  subtotal: moneyStrNonNeg,
  taxTotal: moneyStrNonNeg,
  discountTotal: moneyStrNonNeg,
  grandTotal: moneyStrNonNeg,
  amountPaid: moneyStrNonNeg,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  placeOfSupply: z.string().nullable(),
  postedAt: z.string().nullable(),
  postedBy: uuid.nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: uuid.nullable(),
  /**
   * Phase 4 §9.5 — HMAC-SHA256 hash of the re-entered password + reason
   * + postedAt captured at POST time. NULL for DRAFT/CANCELLED rows and
   * for invoices issued before Phase 4 §4.2c shipped.
   */
  signatureHash: z.string().nullable(),
  version: z.number().int().positive(),
  createdBy: uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type SalesInvoice = z.infer<typeof SalesInvoiceSchema>;

export const SalesInvoiceWithLinesSchema = SalesInvoiceSchema.extend({
  lines: z.array(SalesInvoiceLineSchema),
});
export type SalesInvoiceWithLines = z.infer<typeof SalesInvoiceWithLinesSchema>;

export const CreateSalesInvoiceLineSchema = z.object({
  sequenceNumber: z.number().int().positive().optional(),
  productId: uuid.optional(),
  itemId: uuid.optional(),
  description: z.string().trim().min(1).max(500),
  hsnSac: z.string().trim().max(32).optional(),
  quantity: moneyStr,
  uom: z.string().trim().max(32).optional(),
  unitPrice: moneyStrNonNeg,
  discountPercent: percentStr.optional(),
  taxRatePercent: percentStr.optional(),
});
export type CreateSalesInvoiceLine = z.infer<
  typeof CreateSalesInvoiceLineSchema
>;

export const UpdateSalesInvoiceLineSchema =
  CreateSalesInvoiceLineSchema.partial();
export type UpdateSalesInvoiceLine = z.infer<
  typeof UpdateSalesInvoiceLineSchema
>;

export const CreateSalesInvoiceSchema = z.object({
  /** Optional — service auto-generates SI-YYYY-NNNN via finance_number_sequences if absent. */
  invoiceNumber: z.string().trim().min(1).max(32).optional(),
  customerId: uuid.optional(),
  customerName: z.string().trim().max(200).optional(),
  customerGstin: z.string().trim().max(16).optional(),
  customerAddress: z.string().trim().max(500).optional(),
  workOrderId: uuid.optional(),
  salesOrderId: uuid.optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  currency: currencyCode.optional(),
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
  placeOfSupply: z.string().trim().max(64).optional(),
  lines: z.array(CreateSalesInvoiceLineSchema).default([]),
});
export type CreateSalesInvoice = z.infer<typeof CreateSalesInvoiceSchema>;

export const UpdateSalesInvoiceSchema = z.object({
  customerId: uuid.optional(),
  customerName: z.string().trim().max(200).optional(),
  customerGstin: z.string().trim().max(16).optional(),
  customerAddress: z.string().trim().max(500).optional(),
  workOrderId: uuid.optional(),
  salesOrderId: uuid.optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
  placeOfSupply: z.string().trim().max(64).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateSalesInvoice = z.infer<typeof UpdateSalesInvoiceSchema>;

export const PostSalesInvoiceSchema = z.object({
  expectedVersion: z.number().int().positive(),
  postedAt: z.string().optional(),
  /**
   * Phase 4 §9.5 — "Invoice issue" is a critical action requiring
   * password re-entry. The server HMAC-SHA256s (eSignatureReason ||
   * userIdentityId || postedAt) with ESIGNATURE_PEPPER and stores the
   * hex on sales_invoices.signature_hash. Optional at the contract
   * layer so pre-§4.2c tooling still parses; the service rejects
   * missing fields when EsignatureService is wired into DI.
   */
  eSignaturePassword: z.string().min(1).max(256).optional(),
  eSignatureReason: z.string().trim().min(1).max(500).optional(),
});
export type PostSalesInvoice = z.infer<typeof PostSalesInvoiceSchema>;

export const CancelSalesInvoiceSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});
export type CancelSalesInvoice = z.infer<typeof CancelSalesInvoiceSchema>;

export const SalesInvoiceListQuerySchema = PaginationQuerySchema.extend({
  status: InvoiceStatusSchema.optional(),
  customerId: uuid.optional(),
  workOrderId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Purchase Invoices (Vendor Bills) ────────────────────────────────────────

export const PurchaseInvoiceLineSchema = z.object({
  id: uuid,
  orgId: uuid,
  invoiceId: uuid,
  sequenceNumber: z.number().int().positive(),
  itemId: uuid.nullable(),
  grnLineId: uuid.nullable(),
  description: z.string(),
  hsnSac: z.string().nullable(),
  quantity: moneyStr,
  uom: z.string().nullable(),
  unitPrice: moneyStr,
  discountPercent: moneyStr,
  taxRatePercent: moneyStr,
  lineSubtotal: moneyStr,
  lineTax: moneyStr,
  lineTotal: moneyStr,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PurchaseInvoiceLine = z.infer<typeof PurchaseInvoiceLineSchema>;

export const PurchaseInvoiceSchema = z.object({
  id: uuid,
  orgId: uuid,
  invoiceNumber: z.string(),
  vendorInvoiceNo: z.string().nullable(),
  status: InvoiceStatusSchema,
  matchStatus: PurchaseInvoiceMatchStatusSchema,
  matchNotes: z.string().nullable(),
  vendorId: uuid.nullable(),
  vendorName: z.string().nullable(),
  vendorGstin: z.string().nullable(),
  vendorAddress: z.string().nullable(),
  purchaseOrderId: uuid.nullable(),
  grnId: uuid.nullable(),
  invoiceDate: z.string(),
  dueDate: z.string().nullable(),
  currency: z.string(),
  subtotal: moneyStrNonNeg,
  taxTotal: moneyStrNonNeg,
  discountTotal: moneyStrNonNeg,
  grandTotal: moneyStrNonNeg,
  amountPaid: moneyStrNonNeg,
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  placeOfSupply: z.string().nullable(),
  postedAt: z.string().nullable(),
  postedBy: uuid.nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: uuid.nullable(),
  version: z.number().int().positive(),
  createdBy: uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type PurchaseInvoice = z.infer<typeof PurchaseInvoiceSchema>;

export const PurchaseInvoiceWithLinesSchema = PurchaseInvoiceSchema.extend({
  lines: z.array(PurchaseInvoiceLineSchema),
});
export type PurchaseInvoiceWithLines = z.infer<
  typeof PurchaseInvoiceWithLinesSchema
>;

export const CreatePurchaseInvoiceLineSchema = z.object({
  sequenceNumber: z.number().int().positive().optional(),
  itemId: uuid.optional(),
  grnLineId: uuid.optional(),
  description: z.string().trim().min(1).max(500),
  hsnSac: z.string().trim().max(32).optional(),
  quantity: moneyStr,
  uom: z.string().trim().max(32).optional(),
  unitPrice: moneyStrNonNeg,
  discountPercent: percentStr.optional(),
  taxRatePercent: percentStr.optional(),
});
export type CreatePurchaseInvoiceLine = z.infer<
  typeof CreatePurchaseInvoiceLineSchema
>;

export const UpdatePurchaseInvoiceLineSchema =
  CreatePurchaseInvoiceLineSchema.partial();
export type UpdatePurchaseInvoiceLine = z.infer<
  typeof UpdatePurchaseInvoiceLineSchema
>;

export const CreatePurchaseInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(32).optional(),
  vendorInvoiceNo: z.string().trim().max(64).optional(),
  vendorId: uuid.optional(),
  vendorName: z.string().trim().max(200).optional(),
  vendorGstin: z.string().trim().max(16).optional(),
  vendorAddress: z.string().trim().max(500).optional(),
  purchaseOrderId: uuid.optional(),
  grnId: uuid.optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  currency: currencyCode.optional(),
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
  placeOfSupply: z.string().trim().max(64).optional(),
  lines: z.array(CreatePurchaseInvoiceLineSchema).default([]),
});
export type CreatePurchaseInvoice = z.infer<typeof CreatePurchaseInvoiceSchema>;

export const UpdatePurchaseInvoiceSchema = z.object({
  vendorInvoiceNo: z.string().trim().max(64).optional(),
  vendorId: uuid.optional(),
  vendorName: z.string().trim().max(200).optional(),
  vendorGstin: z.string().trim().max(16).optional(),
  vendorAddress: z.string().trim().max(500).optional(),
  purchaseOrderId: uuid.optional(),
  grnId: uuid.optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  matchStatus: PurchaseInvoiceMatchStatusSchema.optional(),
  matchNotes: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().trim().max(2000).optional(),
  placeOfSupply: z.string().trim().max(64).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdatePurchaseInvoice = z.infer<typeof UpdatePurchaseInvoiceSchema>;

export const PostPurchaseInvoiceSchema = z.object({
  expectedVersion: z.number().int().positive(),
  postedAt: z.string().optional(),
});
export type PostPurchaseInvoice = z.infer<typeof PostPurchaseInvoiceSchema>;

export const CancelPurchaseInvoiceSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});
export type CancelPurchaseInvoice = z.infer<
  typeof CancelPurchaseInvoiceSchema
>;

export const PurchaseInvoiceListQuerySchema = PaginationQuerySchema.extend({
  status: InvoiceStatusSchema.optional(),
  matchStatus: PurchaseInvoiceMatchStatusSchema.optional(),
  vendorId: uuid.optional(),
  purchaseOrderId: uuid.optional(),
  grnId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Customer Ledger (append-only) ───────────────────────────────────────────

export const CustomerLedgerEntrySchema = z.object({
  id: uuid,
  orgId: uuid,
  customerId: uuid,
  entryDate: z.string(),
  entryType: CustomerLedgerEntryTypeSchema,
  debit: moneyStrNonNeg,
  credit: moneyStrNonNeg,
  runningBalance: moneyStr,
  currency: z.string(),
  referenceType: CustomerLedgerReferenceTypeSchema,
  referenceId: uuid.nullable(),
  referenceNumber: z.string().nullable(),
  description: z.string().nullable(),
  recordedBy: uuid.nullable(),
  createdAt: z.string(),
});
export type CustomerLedgerEntry = z.infer<typeof CustomerLedgerEntrySchema>;

export const CreateCustomerLedgerEntrySchema = z.object({
  customerId: uuid,
  entryDate: isoDate.optional(),
  entryType: CustomerLedgerEntryTypeSchema,
  debit: moneyStrNonNeg.optional(),
  credit: moneyStrNonNeg.optional(),
  currency: currencyCode.optional(),
  referenceType: CustomerLedgerReferenceTypeSchema,
  referenceId: uuid.optional(),
  referenceNumber: z.string().trim().max(64).optional(),
  description: z.string().trim().max(500).optional(),
});
export type CreateCustomerLedgerEntry = z.infer<
  typeof CreateCustomerLedgerEntrySchema
>;

export const CustomerLedgerListQuerySchema = PaginationQuerySchema.extend({
  customerId: uuid.optional(),
  entryType: CustomerLedgerEntryTypeSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Vendor Ledger (append-only) ─────────────────────────────────────────────

export const VendorLedgerEntrySchema = z.object({
  id: uuid,
  orgId: uuid,
  vendorId: uuid,
  entryDate: z.string(),
  entryType: VendorLedgerEntryTypeSchema,
  debit: moneyStrNonNeg,
  credit: moneyStrNonNeg,
  runningBalance: moneyStr,
  currency: z.string(),
  referenceType: VendorLedgerReferenceTypeSchema,
  referenceId: uuid.nullable(),
  referenceNumber: z.string().nullable(),
  description: z.string().nullable(),
  recordedBy: uuid.nullable(),
  createdAt: z.string(),
});
export type VendorLedgerEntry = z.infer<typeof VendorLedgerEntrySchema>;

export const CreateVendorLedgerEntrySchema = z.object({
  vendorId: uuid,
  entryDate: isoDate.optional(),
  entryType: VendorLedgerEntryTypeSchema,
  debit: moneyStrNonNeg.optional(),
  credit: moneyStrNonNeg.optional(),
  currency: currencyCode.optional(),
  referenceType: VendorLedgerReferenceTypeSchema,
  referenceId: uuid.optional(),
  referenceNumber: z.string().trim().max(64).optional(),
  description: z.string().trim().max(500).optional(),
});
export type CreateVendorLedgerEntry = z.infer<
  typeof CreateVendorLedgerEntrySchema
>;

export const VendorLedgerListQuerySchema = PaginationQuerySchema.extend({
  vendorId: uuid.optional(),
  entryType: VendorLedgerEntryTypeSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Payments (polymorphic) ──────────────────────────────────────────────────

export const PaymentAppliedInvoiceSchema = z.object({
  invoiceId: uuid,
  invoiceType: PaymentAppliedInvoiceTypeSchema,
  amountApplied: moneyStrNonNeg,
});
export type PaymentAppliedInvoice = z.infer<
  typeof PaymentAppliedInvoiceSchema
>;

export const PaymentSchema = z.object({
  id: uuid,
  orgId: uuid,
  paymentNumber: z.string(),
  paymentType: PaymentTypeSchema,
  status: PaymentStatusSchema,
  customerId: uuid.nullable(),
  vendorId: uuid.nullable(),
  counterpartyName: z.string().nullable(),
  paymentDate: z.string(),
  amount: moneyStr,
  currency: z.string(),
  mode: PaymentModeSchema,
  referenceNo: z.string().nullable(),
  appliedTo: z.array(PaymentAppliedInvoiceSchema),
  notes: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidedBy: uuid.nullable(),
  voidReason: z.string().nullable(),
  signatureHash: z.string().nullable(),
  recordedBy: uuid.nullable(),
  recordedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const CreatePaymentSchema = z
  .object({
    /** Optional — service auto-generates PAY-YYYY-NNNN via finance_number_sequences if absent. */
    paymentNumber: z.string().trim().min(1).max(32).optional(),
    paymentType: PaymentTypeSchema,
    customerId: uuid.optional(),
    vendorId: uuid.optional(),
    counterpartyName: z.string().trim().max(200).optional(),
    paymentDate: isoDate.optional(),
    amount: moneyStr,
    currency: currencyCode.optional(),
    mode: PaymentModeSchema,
    referenceNo: z.string().trim().max(64).optional(),
    appliedTo: z.array(PaymentAppliedInvoiceSchema).default([]),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (v) =>
      (v.paymentType === "CUSTOMER_RECEIPT" && !!v.customerId) ||
      (v.paymentType === "VENDOR_PAYMENT" && !!v.vendorId),
    {
      message:
        "customerId required for CUSTOMER_RECEIPT; vendorId required for VENDOR_PAYMENT",
      path: ["customerId"],
    },
  );
export type CreatePayment = z.infer<typeof CreatePaymentSchema>;

export const VoidPaymentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidPayment = z.infer<typeof VoidPaymentSchema>;

export const PaymentListQuerySchema = PaginationQuerySchema.extend({
  paymentType: PaymentTypeSchema.optional(),
  status: PaymentStatusSchema.optional(),
  customerId: uuid.optional(),
  vendorId: uuid.optional(),
  mode: PaymentModeSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Dashboard / aggregates ──────────────────────────────────────────────────

/**
 * Flat KPI payload for /finance/overview. Phase 2 computes at query time
 * from base tables; Phase 3 migrates to a materialised view.
 */
export const FinanceOverviewSchema = z.object({
  // AR
  arOutstanding: moneyStrNonNeg,
  arOverdue30: moneyStrNonNeg,
  arOverdue60: moneyStrNonNeg,
  arOverdue90: moneyStrNonNeg,
  // AP
  apOutstanding: moneyStrNonNeg,
  apOverdue30: moneyStrNonNeg,
  apOverdue60: moneyStrNonNeg,
  apOverdue90: moneyStrNonNeg,
  // Month-to-date
  mtdRevenue: moneyStrNonNeg,
  mtdExpenses: moneyStrNonNeg,
  // Counts
  draftSalesInvoices: z.number().int().nonnegative(),
  postedSalesInvoices: z.number().int().nonnegative(),
  draftPurchaseInvoices: z.number().int().nonnegative(),
  postedPurchaseInvoices: z.number().int().nonnegative(),
  recordedPayments: z.number().int().nonnegative(),
  // Currency the totals are in (org-default)
  currency: z.string(),
});
export type FinanceOverview = z.infer<typeof FinanceOverviewSchema>;
