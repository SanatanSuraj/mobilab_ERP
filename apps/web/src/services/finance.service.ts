/**
 * Finance Service — Data Access Layer
 *
 * org_id injected via apiFetch() on every real API call.
 * Import { apiFetch, getOrgId } from "@/lib/api-client" when swapping mock.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getOrgId } from "@/lib/api-client";
import {
  salesInvoices,
  purchaseOrders,
  purchaseInvoices,
  finPayments,
  customerLedgerEntries,
  vendorLedgerEntries,
  ewayBills,
  itcEntries,
  finCustomers,
  vendors,
  getFinCustomerById,
  getVendorById,
  type SalesInvoice,
  type PurchaseOrder,
  type PurchaseInvoice,
  type FinPayment,
  type LedgerEntryFin,
  type EWayBill,
  type ITCEntry,
  type FinCustomer,
  type Vendor,
} from "@/data/finance-mock";

import { currentMonthPrefix } from "@/lib/format";

export interface InvoiceFilters {
  status?: string;
  customerId?: string;
  month?: string;
}

export interface POFilters {
  status?: string;
  vendorId?: string;
}

export const financeService = {
  // ── Sales Invoices ────────────────────────────────────────────────────────

  async getSalesInvoices(filters?: InvoiceFilters): Promise<SalesInvoice[]> {
    // API: return fetch(`/api/finance/sales-invoices?${qs}`).then(r => r.json())
    let result = [...salesInvoices];
    if (filters?.status && filters.status !== "ALL") {
      result = result.filter((i) => i.status === filters.status);
    }
    if (filters?.customerId) {
      result = result.filter((i) => i.customerId === filters.customerId);
    }
    if (filters?.month) {
      result = result.filter((i) => i.invoiceDate.startsWith(filters.month!));
    }
    return Promise.resolve(result);
  },

  async getOpenInvoices(): Promise<SalesInvoice[]> {
    // API: return fetch('/api/finance/sales-invoices?status=sent,overdue,partially_paid').then(r => r.json())
    return Promise.resolve(
      salesInvoices.filter((i) => i.status !== "paid" && i.status !== "cancelled")
    );
  },

  async getOverdueInvoices(): Promise<SalesInvoice[]> {
    // API: return fetch('/api/finance/sales-invoices?status=overdue').then(r => r.json())
    return Promise.resolve(salesInvoices.filter((i) => i.status === "overdue"));
  },

  async getTotalReceivables(): Promise<number> {
    const open = await this.getOpenInvoices();
    return open.reduce((s, i) => s + (i.grandTotal - i.paidAmount), 0);
  },

  /** GST from current calendar month — no hardcoded date strings */
  async getMonthlyGST(monthPrefix?: string): Promise<number> {
    const month = monthPrefix ?? currentMonthPrefix();
    const monthInvoices = salesInvoices.filter((i) => i.invoiceDate.startsWith(month));
    return Promise.resolve(monthInvoices.reduce((s, i) => s + i.totalTax, 0));
  },

  // ── Purchase Orders ───────────────────────────────────────────────────────

  async getPurchaseOrders(filters?: POFilters): Promise<PurchaseOrder[]> {
    // API: return fetch(`/api/finance/purchase-orders?${qs}`).then(r => r.json())
    let result = [...purchaseOrders];
    if (filters?.status && filters.status !== "ALL") {
      result = result.filter((p) => p.status === filters.status);
    }
    if (filters?.vendorId) {
      result = result.filter((p) => p.vendorId === filters.vendorId);
    }
    return Promise.resolve(result);
  },

  async getPOsPendingApproval(): Promise<PurchaseOrder[]> {
    // API: return fetch('/api/finance/purchase-orders?status=pending_approval').then(r => r.json())
    return Promise.resolve(purchaseOrders.filter((p) => p.status === "pending_approval"));
  },

  // ── Purchase Invoices ─────────────────────────────────────────────────────

  async getPurchaseInvoices(): Promise<PurchaseInvoice[]> {
    // API: return fetch('/api/finance/purchase-invoices').then(r => r.json())
    return Promise.resolve(purchaseInvoices);
  },

  // ── Payments ─────────────────────────────────────────────────────────────

  async getPayments(): Promise<FinPayment[]> {
    // API: return fetch('/api/finance/payments').then(r => r.json())
    return Promise.resolve(finPayments);
  },

  // ── Ledger ────────────────────────────────────────────────────────────────

  async getCustomerLedger(customerId?: string): Promise<LedgerEntryFin[]> {
    // API: return fetch(`/api/finance/ledger/customer?id=${customerId}`).then(r => r.json())
    let result = [...customerLedgerEntries];
    if (customerId) result = result.filter((e) => e.entityId === customerId);
    return Promise.resolve(result);
  },

  async getVendorLedger(vendorId?: string): Promise<LedgerEntryFin[]> {
    // API: return fetch(`/api/finance/ledger/vendor?id=${vendorId}`).then(r => r.json())
    let result = [...vendorLedgerEntries];
    if (vendorId) result = result.filter((e) => e.entityId === vendorId);
    return Promise.resolve(result);
  },

  // ── E-Way Bills ───────────────────────────────────────────────────────────

  async getEWayBills(): Promise<EWayBill[]> {
    // API: return fetch('/api/finance/eway-bills').then(r => r.json())
    return Promise.resolve(ewayBills);
  },

  // ── ITC ───────────────────────────────────────────────────────────────────

  async getITCEntries(): Promise<ITCEntry[]> {
    // API: return fetch('/api/finance/itc').then(r => r.json())
    return Promise.resolve(itcEntries);
  },

  // ── Customers & Vendors ───────────────────────────────────────────────────

  async getCustomers(): Promise<FinCustomer[]> {
    return Promise.resolve(finCustomers);
  },

  getCustomerById(id: string): FinCustomer | undefined {
    return getFinCustomerById(id);
  },

  async getVendors(): Promise<Vendor[]> {
    return Promise.resolve(vendors);
  },

  getVendorById(id: string): Vendor | undefined {
    return getVendorById(id);
  },
};
