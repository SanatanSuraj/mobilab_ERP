/**
 * Typed wrappers for the real /finance/* surface exposed by apps/api.
 *
 * Pattern-matches lib/api/qc.ts: every function routes through tenantFetch
 * (Bearer + X-Org-Id + silent refresh), uses the real contract types from
 * @instigenie/contracts, and returns the shared PaginatedResponse envelope
 * for list endpoints.
 *
 * Surface (Phase 2):
 *   - Overview                    (GET /finance/overview)
 *   - Sales invoices              (CRUD + /post + /cancel)
 *     └─ lines                    (GET/POST/PATCH/DELETE)
 *   - Purchase invoices           (CRUD + /post + /cancel)
 *     └─ lines                    (GET/POST/PATCH/DELETE)
 *   - Customer ledger             (list + getById + balance)
 *   - Vendor ledger               (list + getById + balance)
 *   - Payments                    (CRUD + /void)
 *
 * Money fields are decimal strings on the wire — callers MUST not call
 * Number() on them. Formatting is a display concern handled per-component.
 */

import type {
  // Overview
  FinanceOverview,
  // Sales invoices
  SalesInvoice,
  SalesInvoiceWithLines,
  SalesInvoiceLine,
  InvoiceStatus,
  CreateSalesInvoice,
  UpdateSalesInvoice,
  PostSalesInvoice,
  CancelSalesInvoice,
  CreateSalesInvoiceLine,
  UpdateSalesInvoiceLine,
  // Purchase invoices
  PurchaseInvoice,
  PurchaseInvoiceWithLines,
  PurchaseInvoiceLine,
  PurchaseInvoiceMatchStatus,
  CreatePurchaseInvoice,
  UpdatePurchaseInvoice,
  PostPurchaseInvoice,
  CancelPurchaseInvoice,
  CreatePurchaseInvoiceLine,
  UpdatePurchaseInvoiceLine,
  // Ledgers
  CustomerLedgerEntry,
  CustomerLedgerEntryType,
  VendorLedgerEntry,
  VendorLedgerEntryType,
  // Payments
  Payment,
  PaymentMode,
  PaymentStatus,
  PaymentType,
  CreatePayment,
  VoidPayment,
} from "@instigenie/contracts";

import type { PaginatedResponse, PaginationParams } from "./crm";
import {
  tenantDelete,
  tenantGet,
  tenantPatch,
  tenantPost,
} from "./tenant-fetch";

// Re-export shared envelope types so finance callers don't need to import
// from ./crm directly.
export type { PaginatedResponse, PaginationParams } from "./crm";

/** Ad-hoc sub-resource envelope. */
interface DataEnvelope<T> {
  data: T[];
}

function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// ─── Finance Overview ────────────────────────────────────────────────────────

/**
 * Flat KPI payload: AR/AP outstanding + 30/60/90 aging buckets, MTD
 * revenue + expenses, per-status invoice counts, recorded payment count.
 * Currency is org-default (Phase 2 is INR-only).
 */
export async function apiGetFinanceOverview(): Promise<FinanceOverview> {
  return tenantGet(`/finance/overview`);
}

// ─── Sales Invoices ──────────────────────────────────────────────────────────

export interface SalesInvoiceListQuery extends PaginationParams {
  status?: InvoiceStatus;
  customerId?: string;
  workOrderId?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
  search?: string;
}

export async function apiListSalesInvoices(
  q: SalesInvoiceListQuery = {},
): Promise<PaginatedResponse<SalesInvoice>> {
  return tenantGet(`/finance/sales-invoices${qs(q)}`);
}

/** GET returns `SalesInvoiceWithLines` — header + embedded `lines[]`. */
export async function apiGetSalesInvoice(
  id: string,
): Promise<SalesInvoiceWithLines> {
  return tenantGet(`/finance/sales-invoices/${id}`);
}

/**
 * POST — service auto-generates SI-YYYY-NNNN if `invoiceNumber` omitted.
 * Any `lines[]` are seeded in the same transaction and totals recomputed.
 */
export async function apiCreateSalesInvoice(
  body: CreateSalesInvoice,
): Promise<SalesInvoiceWithLines> {
  return tenantPost(`/finance/sales-invoices`, body);
}

/** Header update. DRAFT-only; 409 on POSTED / CANCELLED. */
export async function apiUpdateSalesInvoice(
  id: string,
  body: UpdateSalesInvoice,
): Promise<SalesInvoice> {
  return tenantPatch(`/finance/sales-invoices/${id}`, body);
}

export async function apiDeleteSalesInvoice(id: string): Promise<void> {
  return tenantDelete(`/finance/sales-invoices/${id}`);
}

/**
 * Post (DRAFT → POSTED). Appends an INVOICE row to customer_ledger.
 * Requires ≥1 line and positive grandTotal.
 */
export async function apiPostSalesInvoice(
  id: string,
  body: PostSalesInvoice,
): Promise<SalesInvoiceWithLines> {
  return tenantPost(`/finance/sales-invoices/${id}/post`, body);
}

/**
 * Cancel. DRAFT → CANCELLED has no ledger impact. POSTED → CANCELLED
 * appends an ADJUSTMENT credit for the unpaid outstanding portion.
 */
export async function apiCancelSalesInvoice(
  id: string,
  body: CancelSalesInvoice,
): Promise<SalesInvoice> {
  return tenantPost(`/finance/sales-invoices/${id}/cancel`, body);
}

// Sales invoice lines (sibling)

export async function apiListSalesInvoiceLines(
  invoiceId: string,
): Promise<SalesInvoiceLine[]> {
  const res = await tenantGet<DataEnvelope<SalesInvoiceLine>>(
    `/finance/sales-invoices/${invoiceId}/lines`,
  );
  return res.data;
}

export async function apiAddSalesInvoiceLine(
  invoiceId: string,
  body: CreateSalesInvoiceLine,
): Promise<SalesInvoiceLine> {
  return tenantPost(`/finance/sales-invoices/${invoiceId}/lines`, body);
}

export async function apiUpdateSalesInvoiceLine(
  invoiceId: string,
  lineId: string,
  body: UpdateSalesInvoiceLine,
): Promise<SalesInvoiceLine> {
  return tenantPatch(
    `/finance/sales-invoices/${invoiceId}/lines/${lineId}`,
    body,
  );
}

export async function apiDeleteSalesInvoiceLine(
  invoiceId: string,
  lineId: string,
): Promise<void> {
  return tenantDelete(
    `/finance/sales-invoices/${invoiceId}/lines/${lineId}`,
  );
}

// ─── Purchase Invoices (Vendor Bills) ────────────────────────────────────────

export interface PurchaseInvoiceListQuery extends PaginationParams {
  status?: InvoiceStatus;
  matchStatus?: PurchaseInvoiceMatchStatus;
  vendorId?: string;
  purchaseOrderId?: string;
  grnId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export async function apiListPurchaseInvoices(
  q: PurchaseInvoiceListQuery = {},
): Promise<PaginatedResponse<PurchaseInvoice>> {
  return tenantGet(`/finance/purchase-invoices${qs(q)}`);
}

export async function apiGetPurchaseInvoice(
  id: string,
): Promise<PurchaseInvoiceWithLines> {
  return tenantGet(`/finance/purchase-invoices/${id}`);
}

/** POST — service auto-generates PI-YYYY-NNNN if `invoiceNumber` omitted. */
export async function apiCreatePurchaseInvoice(
  body: CreatePurchaseInvoice,
): Promise<PurchaseInvoiceWithLines> {
  return tenantPost(`/finance/purchase-invoices`, body);
}

export async function apiUpdatePurchaseInvoice(
  id: string,
  body: UpdatePurchaseInvoice,
): Promise<PurchaseInvoice> {
  return tenantPatch(`/finance/purchase-invoices/${id}`, body);
}

export async function apiDeletePurchaseInvoice(id: string): Promise<void> {
  return tenantDelete(`/finance/purchase-invoices/${id}`);
}

/** Post (DRAFT → POSTED). Appends a BILL row to vendor_ledger. */
export async function apiPostPurchaseInvoice(
  id: string,
  body: PostPurchaseInvoice,
): Promise<PurchaseInvoiceWithLines> {
  return tenantPost(`/finance/purchase-invoices/${id}/post`, body);
}

export async function apiCancelPurchaseInvoice(
  id: string,
  body: CancelPurchaseInvoice,
): Promise<PurchaseInvoice> {
  return tenantPost(`/finance/purchase-invoices/${id}/cancel`, body);
}

// Purchase invoice lines (sibling)

export async function apiListPurchaseInvoiceLines(
  invoiceId: string,
): Promise<PurchaseInvoiceLine[]> {
  const res = await tenantGet<DataEnvelope<PurchaseInvoiceLine>>(
    `/finance/purchase-invoices/${invoiceId}/lines`,
  );
  return res.data;
}

export async function apiAddPurchaseInvoiceLine(
  invoiceId: string,
  body: CreatePurchaseInvoiceLine,
): Promise<PurchaseInvoiceLine> {
  return tenantPost(`/finance/purchase-invoices/${invoiceId}/lines`, body);
}

export async function apiUpdatePurchaseInvoiceLine(
  invoiceId: string,
  lineId: string,
  body: UpdatePurchaseInvoiceLine,
): Promise<PurchaseInvoiceLine> {
  return tenantPatch(
    `/finance/purchase-invoices/${invoiceId}/lines/${lineId}`,
    body,
  );
}

export async function apiDeletePurchaseInvoiceLine(
  invoiceId: string,
  lineId: string,
): Promise<void> {
  return tenantDelete(
    `/finance/purchase-invoices/${invoiceId}/lines/${lineId}`,
  );
}

// ─── Customer Ledger (read-only) ─────────────────────────────────────────────

export interface CustomerLedgerListQuery extends PaginationParams {
  customerId?: string;
  entryType?: CustomerLedgerEntryType;
  from?: string;
  to?: string;
  search?: string;
}

export async function apiListCustomerLedger(
  q: CustomerLedgerListQuery = {},
): Promise<PaginatedResponse<CustomerLedgerEntry>> {
  return tenantGet(`/finance/customer-ledger${qs(q)}`);
}

export async function apiGetCustomerLedgerEntry(
  id: string,
): Promise<CustomerLedgerEntry> {
  return tenantGet(`/finance/customer-ledger/${id}`);
}

/** Current running balance for a single customer. */
export async function apiGetCustomerBalance(
  customerId: string,
): Promise<{ customerId: string; balance: string }> {
  return tenantGet(
    `/finance/customer-ledger/customers/${customerId}/balance`,
  );
}

// ─── Vendor Ledger (read-only) ───────────────────────────────────────────────

export interface VendorLedgerListQuery extends PaginationParams {
  vendorId?: string;
  entryType?: VendorLedgerEntryType;
  from?: string;
  to?: string;
  search?: string;
}

export async function apiListVendorLedger(
  q: VendorLedgerListQuery = {},
): Promise<PaginatedResponse<VendorLedgerEntry>> {
  return tenantGet(`/finance/vendor-ledger${qs(q)}`);
}

export async function apiGetVendorLedgerEntry(
  id: string,
): Promise<VendorLedgerEntry> {
  return tenantGet(`/finance/vendor-ledger/${id}`);
}

export async function apiGetVendorBalance(
  vendorId: string,
): Promise<{ vendorId: string; balance: string }> {
  return tenantGet(`/finance/vendor-ledger/vendors/${vendorId}/balance`);
}

// ─── Payments ────────────────────────────────────────────────────────────────

export interface PaymentListQuery extends PaginationParams {
  paymentType?: PaymentType;
  status?: PaymentStatus;
  customerId?: string;
  vendorId?: string;
  mode?: PaymentMode;
  from?: string;
  to?: string;
  search?: string;
}

export async function apiListPayments(
  q: PaymentListQuery = {},
): Promise<PaginatedResponse<Payment>> {
  return tenantGet(`/finance/payments${qs(q)}`);
}

export async function apiGetPayment(id: string): Promise<Payment> {
  return tenantGet(`/finance/payments/${id}`);
}

/**
 * Record a payment. Polymorphic: CUSTOMER_RECEIPT applies to SALES_INVOICE(s),
 * VENDOR_PAYMENT applies to PURCHASE_INVOICE(s). The entire operation is
 * transactional — allocation errors 409 without partial persistence.
 * Service auto-generates PAY-YYYY-NNNN if `paymentNumber` omitted.
 */
export async function apiCreatePayment(
  body: CreatePayment,
): Promise<Payment> {
  return tenantPost(`/finance/payments`, body);
}

/**
 * Void a RECORDED payment. Reverses all invoice applications + appends
 * offsetting ledger rows. The original row is flipped to VOIDED (applied_to
 * JSONB kept intact for audit).
 */
export async function apiVoidPayment(
  id: string,
  body: VoidPayment,
): Promise<Payment> {
  return tenantPost(`/finance/payments/${id}/void`, body);
}

/** Soft-delete a VOIDED payment. 409 if the payment is still RECORDED. */
export async function apiDeletePayment(id: string): Promise<void> {
  return tenantDelete(`/finance/payments/${id}`);
}
