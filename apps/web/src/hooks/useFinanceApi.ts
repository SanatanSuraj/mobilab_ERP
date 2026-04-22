/**
 * Real-API React Query hooks for the Finance module.
 *
 * Mirrors useQcApi / useProductionApi — namespaced query keys
 * (`["finance-api", entity, ...]`), invoice detail reads return the
 * `*WithLines` shape, and line-ish child mutations invalidate the parent
 * header cache so the embedded `lines[]` refreshes in one shot.
 *
 * Cross-cache fan-out:
 *  - Post sales invoice → appends to customer_ledger → invalidate customer
 *    ledger keys + the per-customer balance lookup + overview KPIs.
 *  - Cancel POSTED sales invoice → appends ADJUSTMENT credit → same fan-out
 *    as post().
 *  - Post purchase invoice → appends to vendor_ledger → invalidate vendor
 *    ledger keys + the per-vendor balance lookup + overview KPIs.
 *  - Create payment (CUSTOMER_RECEIPT) → bumps applied sales invoice
 *    `amountPaid` + appends PAYMENT credit → invalidate sales invoices +
 *    customer ledger + overview.
 *  - Create payment (VENDOR_PAYMENT) → symmetric fan-out for vendor side.
 *  - Void payment → reverses invoice applications + appends ADJUSTMENT rows
 *    → same fan-out as create (both sides to be safe — we don't know the
 *    payment_type without reading the cached row).
 *
 * Money fields stay as decimal strings end-to-end; these hooks do no
 * conversion and no formatting. Formatting is a display concern.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  // Overview
  apiGetFinanceOverview,
  // Sales invoices
  apiListSalesInvoices,
  apiGetSalesInvoice,
  apiCreateSalesInvoice,
  apiUpdateSalesInvoice,
  apiDeleteSalesInvoice,
  apiPostSalesInvoice,
  apiCancelSalesInvoice,
  apiListSalesInvoiceLines,
  apiAddSalesInvoiceLine,
  apiUpdateSalesInvoiceLine,
  apiDeleteSalesInvoiceLine,
  // Purchase invoices
  apiListPurchaseInvoices,
  apiGetPurchaseInvoice,
  apiCreatePurchaseInvoice,
  apiUpdatePurchaseInvoice,
  apiDeletePurchaseInvoice,
  apiPostPurchaseInvoice,
  apiCancelPurchaseInvoice,
  apiListPurchaseInvoiceLines,
  apiAddPurchaseInvoiceLine,
  apiUpdatePurchaseInvoiceLine,
  apiDeletePurchaseInvoiceLine,
  // Ledgers
  apiListCustomerLedger,
  apiGetCustomerLedgerEntry,
  apiGetCustomerBalance,
  apiListVendorLedger,
  apiGetVendorLedgerEntry,
  apiGetVendorBalance,
  // Payments
  apiListPayments,
  apiGetPayment,
  apiCreatePayment,
  apiVoidPayment,
  apiDeletePayment,
  type SalesInvoiceListQuery,
  type PurchaseInvoiceListQuery,
  type CustomerLedgerListQuery,
  type VendorLedgerListQuery,
  type PaymentListQuery,
} from "@/lib/api/finance";

import type {
  FinanceOverview,
  SalesInvoice,
  SalesInvoiceWithLines,
  SalesInvoiceLine,
  CreateSalesInvoice,
  UpdateSalesInvoice,
  PostSalesInvoice,
  CancelSalesInvoice,
  CreateSalesInvoiceLine,
  UpdateSalesInvoiceLine,
  PurchaseInvoice,
  PurchaseInvoiceWithLines,
  PurchaseInvoiceLine,
  CreatePurchaseInvoice,
  UpdatePurchaseInvoice,
  PostPurchaseInvoice,
  CancelPurchaseInvoice,
  CreatePurchaseInvoiceLine,
  UpdatePurchaseInvoiceLine,
  CustomerLedgerEntry,
  VendorLedgerEntry,
  Payment,
  CreatePayment,
  VoidPayment,
} from "@instigenie/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────
//
// Namespaced under `["finance-api", ...]`. Every entity exposes at minimum
// `all | list(q) | detail(id)`. Invoice entities expose `lines(id)` sub-keys.
// Ledger balance lookups are customer/vendor-scoped for cheap targeted
// invalidation after payment mutations.

export const financeApiKeys = {
  all: ["finance-api"] as const,
  overview: ["finance-api", "overview"] as const,
  salesInvoices: {
    all: ["finance-api", "salesInvoices"] as const,
    list: (q: SalesInvoiceListQuery) =>
      ["finance-api", "salesInvoices", "list", q] as const,
    detail: (id: string) =>
      ["finance-api", "salesInvoices", "detail", id] as const,
    lines: (id: string) =>
      ["finance-api", "salesInvoices", "lines", id] as const,
  },
  purchaseInvoices: {
    all: ["finance-api", "purchaseInvoices"] as const,
    list: (q: PurchaseInvoiceListQuery) =>
      ["finance-api", "purchaseInvoices", "list", q] as const,
    detail: (id: string) =>
      ["finance-api", "purchaseInvoices", "detail", id] as const,
    lines: (id: string) =>
      ["finance-api", "purchaseInvoices", "lines", id] as const,
  },
  customerLedger: {
    all: ["finance-api", "customerLedger"] as const,
    list: (q: CustomerLedgerListQuery) =>
      ["finance-api", "customerLedger", "list", q] as const,
    detail: (id: string) =>
      ["finance-api", "customerLedger", "detail", id] as const,
    balance: (customerId: string) =>
      ["finance-api", "customerLedger", "balance", customerId] as const,
  },
  vendorLedger: {
    all: ["finance-api", "vendorLedger"] as const,
    list: (q: VendorLedgerListQuery) =>
      ["finance-api", "vendorLedger", "list", q] as const,
    detail: (id: string) =>
      ["finance-api", "vendorLedger", "detail", id] as const,
    balance: (vendorId: string) =>
      ["finance-api", "vendorLedger", "balance", vendorId] as const,
  },
  payments: {
    all: ["finance-api", "payments"] as const,
    list: (q: PaymentListQuery) =>
      ["finance-api", "payments", "list", q] as const,
    detail: (id: string) =>
      ["finance-api", "payments", "detail", id] as const,
  },
};

// ─── Finance Overview ──────────────────────────────────────────────────────

/**
 * Dashboard KPIs (AR/AP outstanding + aging + MTD revenue/expense + per-status
 * invoice counts + recorded payment count). Moderate cache — status counts can
 * change on any invoice post/cancel.
 */
export function useApiFinanceOverview() {
  return useQuery<FinanceOverview>({
    queryKey: financeApiKeys.overview,
    queryFn: () => apiGetFinanceOverview(),
    staleTime: 30_000,
  });
}

// ─── Sales Invoices: reads ─────────────────────────────────────────────────

export function useApiSalesInvoices(query: SalesInvoiceListQuery = {}) {
  return useQuery({
    queryKey: financeApiKeys.salesInvoices.list(query),
    queryFn: () => apiListSalesInvoices(query),
    // Headers flip status DRAFT → POSTED → CANCELLED; 20s keeps the list
    // snappy under concurrent editing without hammering the API.
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `SalesInvoiceWithLines` — header + embedded `lines[]`. */
export function useApiSalesInvoice(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? financeApiKeys.salesInvoices.detail(id)
      : ["finance-api", "salesInvoices", "detail", "__none__"],
    queryFn: () => apiGetSalesInvoice(id!),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

/** Fetch just the lines — useful when header is already in cache. */
export function useApiSalesInvoiceLines(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? financeApiKeys.salesInvoices.lines(id)
      : ["finance-api", "salesInvoices", "lines", "__none__"],
    queryFn: () => apiListSalesInvoiceLines(id!),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

// ─── Sales Invoices: writes ────────────────────────────────────────────────

export function useApiCreateSalesInvoice() {
  const qc = useQueryClient();
  return useMutation<SalesInvoiceWithLines, Error, CreateSalesInvoice>({
    mutationFn: (body) => apiCreateSalesInvoice(body),
    onSuccess: (invoice) => {
      qc.setQueryData(
        financeApiKeys.salesInvoices.detail(invoice.id),
        invoice,
      );
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

export function useApiUpdateSalesInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation<SalesInvoice, Error, UpdateSalesInvoice>({
    mutationFn: (body) => apiUpdateSalesInvoice(id, body),
    onSuccess: () => {
      // Header update; invalidate to refetch WithLines envelope.
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

export function useApiDeleteSalesInvoice() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteSalesInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

/**
 * Post (DRAFT → POSTED). Server appends an INVOICE row to customer_ledger +
 * bumps outstanding. Invalidate ledger AND overview so aging buckets refresh.
 */
export function useApiPostSalesInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation<SalesInvoiceWithLines, Error, PostSalesInvoice>({
    mutationFn: (body) => apiPostSalesInvoice(id, body),
    onSuccess: (invoice) => {
      qc.setQueryData(financeApiKeys.salesInvoices.detail(id), invoice);
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.lines(id),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.customerLedger.all });
      if (invoice.customerId) {
        qc.invalidateQueries({
          queryKey: financeApiKeys.customerLedger.balance(invoice.customerId),
        });
      }
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

/**
 * Cancel. DRAFT→CANCELLED has no ledger impact. POSTED→CANCELLED appends
 * ADJUSTMENT credit for the unpaid portion — always fan out to ledger +
 * overview (the hook doesn't know the pre-state).
 */
export function useApiCancelSalesInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation<SalesInvoice, Error, CancelSalesInvoice>({
    mutationFn: (body) => apiCancelSalesInvoice(id, body),
    onSuccess: (invoice) => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.detail(id),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.customerLedger.all });
      if (invoice.customerId) {
        qc.invalidateQueries({
          queryKey: financeApiKeys.customerLedger.balance(invoice.customerId),
        });
      }
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

// Sales invoice lines

/**
 * Line mutations recompute the parent invoice's totals server-side; we must
 * invalidate the detail header so the recomputed grandTotal/etc. refresh.
 */
export function useApiAddSalesInvoiceLine(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<SalesInvoiceLine, Error, CreateSalesInvoiceLine>({
    mutationFn: (body) => apiAddSalesInvoiceLine(invoiceId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.detail(invoiceId),
      });
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.lines(invoiceId),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
    },
  });
}

export function useApiUpdateSalesInvoiceLine(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<
    SalesInvoiceLine,
    Error,
    { lineId: string; body: UpdateSalesInvoiceLine }
  >({
    mutationFn: ({ lineId, body }) =>
      apiUpdateSalesInvoiceLine(invoiceId, lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.detail(invoiceId),
      });
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.lines(invoiceId),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
    },
  });
}

export function useApiDeleteSalesInvoiceLine(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (lineId) => apiDeleteSalesInvoiceLine(invoiceId, lineId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.detail(invoiceId),
      });
      qc.invalidateQueries({
        queryKey: financeApiKeys.salesInvoices.lines(invoiceId),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
    },
  });
}

// ─── Purchase Invoices: reads ──────────────────────────────────────────────

export function useApiPurchaseInvoices(query: PurchaseInvoiceListQuery = {}) {
  return useQuery({
    queryKey: financeApiKeys.purchaseInvoices.list(query),
    queryFn: () => apiListPurchaseInvoices(query),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `PurchaseInvoiceWithLines` — header + embedded `lines[]`. */
export function useApiPurchaseInvoice(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? financeApiKeys.purchaseInvoices.detail(id)
      : ["finance-api", "purchaseInvoices", "detail", "__none__"],
    queryFn: () => apiGetPurchaseInvoice(id!),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

export function useApiPurchaseInvoiceLines(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? financeApiKeys.purchaseInvoices.lines(id)
      : ["finance-api", "purchaseInvoices", "lines", "__none__"],
    queryFn: () => apiListPurchaseInvoiceLines(id!),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

// ─── Purchase Invoices: writes ─────────────────────────────────────────────

export function useApiCreatePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation<PurchaseInvoiceWithLines, Error, CreatePurchaseInvoice>({
    mutationFn: (body) => apiCreatePurchaseInvoice(body),
    onSuccess: (invoice) => {
      qc.setQueryData(
        financeApiKeys.purchaseInvoices.detail(invoice.id),
        invoice,
      );
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

export function useApiUpdatePurchaseInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseInvoice, Error, UpdatePurchaseInvoice>({
    mutationFn: (body) => apiUpdatePurchaseInvoice(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

export function useApiDeletePurchaseInvoice() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeletePurchaseInvoice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

/**
 * Post (DRAFT → POSTED). Appends BILL row to vendor_ledger. Invalidate vendor
 * ledger + per-vendor balance + overview AP aging buckets.
 */
export function useApiPostPurchaseInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseInvoiceWithLines, Error, PostPurchaseInvoice>({
    mutationFn: (body) => apiPostPurchaseInvoice(id, body),
    onSuccess: (invoice) => {
      qc.setQueryData(financeApiKeys.purchaseInvoices.detail(id), invoice);
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.lines(id),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.vendorLedger.all });
      if (invoice.vendorId) {
        qc.invalidateQueries({
          queryKey: financeApiKeys.vendorLedger.balance(invoice.vendorId),
        });
      }
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

export function useApiCancelPurchaseInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseInvoice, Error, CancelPurchaseInvoice>({
    mutationFn: (body) => apiCancelPurchaseInvoice(id, body),
    onSuccess: (invoice) => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.detail(id),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.vendorLedger.all });
      if (invoice.vendorId) {
        qc.invalidateQueries({
          queryKey: financeApiKeys.vendorLedger.balance(invoice.vendorId),
        });
      }
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

// Purchase invoice lines

export function useApiAddPurchaseInvoiceLine(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseInvoiceLine, Error, CreatePurchaseInvoiceLine>({
    mutationFn: (body) => apiAddPurchaseInvoiceLine(invoiceId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.detail(invoiceId),
      });
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.lines(invoiceId),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
    },
  });
}

export function useApiUpdatePurchaseInvoiceLine(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<
    PurchaseInvoiceLine,
    Error,
    { lineId: string; body: UpdatePurchaseInvoiceLine }
  >({
    mutationFn: ({ lineId, body }) =>
      apiUpdatePurchaseInvoiceLine(invoiceId, lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.detail(invoiceId),
      });
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.lines(invoiceId),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
    },
  });
}

export function useApiDeletePurchaseInvoiceLine(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (lineId) => apiDeletePurchaseInvoiceLine(invoiceId, lineId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.detail(invoiceId),
      });
      qc.invalidateQueries({
        queryKey: financeApiKeys.purchaseInvoices.lines(invoiceId),
      });
      qc.invalidateQueries({ queryKey: financeApiKeys.purchaseInvoices.all });
    },
  });
}

// ─── Customer Ledger (read-only) ───────────────────────────────────────────

export function useApiCustomerLedger(query: CustomerLedgerListQuery = {}) {
  return useQuery({
    queryKey: financeApiKeys.customerLedger.list(query),
    queryFn: () => apiListCustomerLedger(query),
    // Ledger is append-only — list stays stable until a write event.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiCustomerLedgerEntry(id: string | undefined) {
  return useQuery<CustomerLedgerEntry>({
    queryKey: id
      ? financeApiKeys.customerLedger.detail(id)
      : ["finance-api", "customerLedger", "detail", "__none__"],
    queryFn: () => apiGetCustomerLedgerEntry(id!),
    enabled: Boolean(id),
    // Individual rows are immutable once written.
    staleTime: 5 * 60_000,
  });
}

/**
 * Current running balance for a customer. Invalidated by any sales invoice
 * post/cancel or CUSTOMER_RECEIPT payment affecting this customer.
 */
export function useApiCustomerBalance(customerId: string | undefined) {
  return useQuery({
    queryKey: customerId
      ? financeApiKeys.customerLedger.balance(customerId)
      : ["finance-api", "customerLedger", "balance", "__none__"],
    queryFn: () => apiGetCustomerBalance(customerId!),
    enabled: Boolean(customerId),
    staleTime: 30_000,
  });
}

// ─── Vendor Ledger (read-only) ─────────────────────────────────────────────

export function useApiVendorLedger(query: VendorLedgerListQuery = {}) {
  return useQuery({
    queryKey: financeApiKeys.vendorLedger.list(query),
    queryFn: () => apiListVendorLedger(query),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiVendorLedgerEntry(id: string | undefined) {
  return useQuery<VendorLedgerEntry>({
    queryKey: id
      ? financeApiKeys.vendorLedger.detail(id)
      : ["finance-api", "vendorLedger", "detail", "__none__"],
    queryFn: () => apiGetVendorLedgerEntry(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export function useApiVendorBalance(vendorId: string | undefined) {
  return useQuery({
    queryKey: vendorId
      ? financeApiKeys.vendorLedger.balance(vendorId)
      : ["finance-api", "vendorLedger", "balance", "__none__"],
    queryFn: () => apiGetVendorBalance(vendorId!),
    enabled: Boolean(vendorId),
    staleTime: 30_000,
  });
}

// ─── Payments: reads ───────────────────────────────────────────────────────

export function useApiPayments(query: PaymentListQuery = {}) {
  return useQuery({
    queryKey: financeApiKeys.payments.list(query),
    queryFn: () => apiListPayments(query),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiPayment(id: string | undefined) {
  return useQuery<Payment>({
    queryKey: id
      ? financeApiKeys.payments.detail(id)
      : ["finance-api", "payments", "detail", "__none__"],
    queryFn: () => apiGetPayment(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Payments: writes ──────────────────────────────────────────────────────

/**
 * Record a payment. Affects invoice `amount_paid` + appends ledger rows.
 * We don't know payment_type at mutation-call time, so invalidate BOTH
 * sales/purchase invoice caches and BOTH ledger caches. The returned payment
 * lets us target the specific counterparty balance.
 */
export function useApiCreatePayment() {
  const qc = useQueryClient();
  return useMutation<Payment, Error, CreatePayment>({
    mutationFn: (body) => apiCreatePayment(body),
    onSuccess: (payment) => {
      qc.setQueryData(financeApiKeys.payments.detail(payment.id), payment);
      qc.invalidateQueries({ queryKey: financeApiKeys.payments.all });

      if (payment.paymentType === "CUSTOMER_RECEIPT") {
        qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
        qc.invalidateQueries({ queryKey: financeApiKeys.customerLedger.all });
        if (payment.customerId) {
          qc.invalidateQueries({
            queryKey: financeApiKeys.customerLedger.balance(
              payment.customerId,
            ),
          });
        }
      } else {
        qc.invalidateQueries({
          queryKey: financeApiKeys.purchaseInvoices.all,
        });
        qc.invalidateQueries({ queryKey: financeApiKeys.vendorLedger.all });
        if (payment.vendorId) {
          qc.invalidateQueries({
            queryKey: financeApiKeys.vendorLedger.balance(payment.vendorId),
          });
        }
      }
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

/**
 * Void a RECORDED payment. Server reverses every application and appends
 * offsetting ADJUSTMENT rows on the relevant ledger. Same fan-out as
 * create — we use the returned payment to target the balance.
 */
export function useApiVoidPayment(id: string) {
  const qc = useQueryClient();
  return useMutation<Payment, Error, VoidPayment>({
    mutationFn: (body) => apiVoidPayment(id, body),
    onSuccess: (payment) => {
      qc.setQueryData(financeApiKeys.payments.detail(id), payment);
      qc.invalidateQueries({ queryKey: financeApiKeys.payments.all });

      if (payment.paymentType === "CUSTOMER_RECEIPT") {
        qc.invalidateQueries({ queryKey: financeApiKeys.salesInvoices.all });
        qc.invalidateQueries({ queryKey: financeApiKeys.customerLedger.all });
        if (payment.customerId) {
          qc.invalidateQueries({
            queryKey: financeApiKeys.customerLedger.balance(
              payment.customerId,
            ),
          });
        }
      } else {
        qc.invalidateQueries({
          queryKey: financeApiKeys.purchaseInvoices.all,
        });
        qc.invalidateQueries({ queryKey: financeApiKeys.vendorLedger.all });
        if (payment.vendorId) {
          qc.invalidateQueries({
            queryKey: financeApiKeys.vendorLedger.balance(payment.vendorId),
          });
        }
      }
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}

/** Soft-delete a VOIDED payment. 409 server-side if still RECORDED. */
export function useApiDeletePayment() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeletePayment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: financeApiKeys.payments.all });
      qc.invalidateQueries({ queryKey: financeApiKeys.overview });
    },
  });
}
