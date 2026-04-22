/**
 * Real-API React Query hooks for the Procurement module.
 *
 * Deliberately separate from the mock-backed `useProcurement.ts`: the mock
 * hooks still power the older prototype pages, and their query keys, types,
 * and shapes diverge from the real contract. The two can coexist because of
 * the namespacing below.
 *
 * Query-key namespace: `["proc-api", entity, ...]`. The mock hooks use
 * `["procurement", ...]`, so there is zero overlap and both sets can coexist
 * without cross-invalidation.
 *
 * Header/line caching strategy — mutations on lines invalidate the parent
 * header's detail cache too, because `getById` returns `*WithLines` (header
 * plus embedded lines[]) and the embedded copy would go stale otherwise.
 * The `lines` sub-key is maintained so callers that fetch lines alone (e.g.
 * GRN posting UI) also refresh. PO line mutations additionally invalidate
 * the parent PO detail because the server recomputes header totals.
 *
 * When a page is migrated, flip its imports from `@/hooks/useProcurement` →
 * `@/hooks/useProcurementApi` and adjust type usage.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiAddGrnLine,
  apiAddIndentLine,
  apiAddPoLine,
  apiCreateGrn,
  apiCreateIndent,
  apiCreatePurchaseOrder,
  apiCreateVendor,
  apiDeleteGrn,
  apiDeleteGrnLine,
  apiDeleteIndent,
  apiDeleteIndentLine,
  apiDeletePoLine,
  apiDeletePurchaseOrder,
  apiDeleteVendor,
  apiGetGrn,
  apiGetIndent,
  apiGetPurchaseOrder,
  apiGetVendor,
  apiListGrnLines,
  apiListGrns,
  apiListIndentLines,
  apiListIndents,
  apiListPoLines,
  apiListPurchaseOrders,
  apiListVendors,
  apiPostGrn,
  apiUpdateGrn,
  apiUpdateGrnLine,
  apiUpdateIndent,
  apiUpdateIndentLine,
  apiUpdatePoLine,
  apiUpdatePurchaseOrder,
  apiUpdateVendor,
  type GrnListQuery,
  type IndentListQuery,
  type PurchaseOrderListQuery,
  type VendorListQuery,
} from "@/lib/api/procurement";

import type {
  CreateGrn,
  CreateGrnLine,
  CreateIndent,
  CreateIndentLine,
  CreatePoLine,
  CreatePurchaseOrder,
  CreateVendor,
  Grn,
  GrnLine,
  GrnWithLines,
  Indent,
  IndentLine,
  IndentWithLines,
  PoLine,
  PostGrn,
  PurchaseOrder,
  PurchaseOrderWithLines,
  UpdateGrn,
  UpdateGrnLine,
  UpdateIndent,
  UpdateIndentLine,
  UpdatePoLine,
  UpdatePurchaseOrder,
  UpdateVendor,
  Vendor,
} from "@instigenie/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────
//
// Namespaced `["proc-api", entity, ...]` so they never collide with the mock
// hooks in useProcurement.ts (`["procurement", ...]`). Every entity uses the
// `all | list(q) | detail(id)` triple for targeted invalidation. Header
// entities with lines additionally expose a `lines(id)` sub-key.

export const procurementApiKeys = {
  all: ["proc-api"] as const,
  vendors: {
    all: ["proc-api", "vendors"] as const,
    list: (q: VendorListQuery) => ["proc-api", "vendors", "list", q] as const,
    detail: (id: string) => ["proc-api", "vendors", "detail", id] as const,
  },
  indents: {
    all: ["proc-api", "indents"] as const,
    list: (q: IndentListQuery) => ["proc-api", "indents", "list", q] as const,
    detail: (id: string) => ["proc-api", "indents", "detail", id] as const,
    lines: (id: string) => ["proc-api", "indents", "lines", id] as const,
  },
  purchaseOrders: {
    all: ["proc-api", "purchase-orders"] as const,
    list: (q: PurchaseOrderListQuery) =>
      ["proc-api", "purchase-orders", "list", q] as const,
    detail: (id: string) =>
      ["proc-api", "purchase-orders", "detail", id] as const,
    lines: (id: string) =>
      ["proc-api", "purchase-orders", "lines", id] as const,
  },
  grns: {
    all: ["proc-api", "grns"] as const,
    list: (q: GrnListQuery) => ["proc-api", "grns", "list", q] as const,
    detail: (id: string) => ["proc-api", "grns", "detail", id] as const,
    lines: (id: string) => ["proc-api", "grns", "lines", id] as const,
  },
};

// ─── Vendors: reads ─────────────────────────────────────────────────────────

export function useApiVendors(query: VendorListQuery = {}) {
  return useQuery({
    queryKey: procurementApiKeys.vendors.list(query),
    queryFn: () => apiListVendors(query),
    // Vendor master barely changes — 5 min matches warehouses.
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiVendor(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? procurementApiKeys.vendors.detail(id)
      : ["proc-api", "vendors", "detail", "__none__"],
    queryFn: () => apiGetVendor(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Vendors: writes ────────────────────────────────────────────────────────

export function useApiCreateVendor() {
  const qc = useQueryClient();
  return useMutation<Vendor, Error, CreateVendor>({
    mutationFn: (body) => apiCreateVendor(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementApiKeys.vendors.all });
    },
  });
}

export function useApiUpdateVendor(id: string) {
  const qc = useQueryClient();
  return useMutation<Vendor, Error, UpdateVendor>({
    mutationFn: (body) => apiUpdateVendor(id, body),
    onSuccess: (vendor) => {
      qc.setQueryData(procurementApiKeys.vendors.detail(id), vendor);
      qc.invalidateQueries({ queryKey: procurementApiKeys.vendors.all });
    },
  });
}

export function useApiDeleteVendor() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteVendor(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementApiKeys.vendors.all });
    },
  });
}

// ─── Indents: reads ─────────────────────────────────────────────────────────

export function useApiIndents(query: IndentListQuery = {}) {
  return useQuery({
    queryKey: procurementApiKeys.indents.list(query),
    queryFn: () => apiListIndents(query),
    // Indents change with workflow transitions but not every second.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `IndentWithLines` — header + embedded `lines[]`. */
export function useApiIndent(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? procurementApiKeys.indents.detail(id)
      : ["proc-api", "indents", "detail", "__none__"],
    queryFn: () => apiGetIndent(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Fetch just the lines — useful when the header is already in cache. */
export function useApiIndentLines(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? procurementApiKeys.indents.lines(id)
      : ["proc-api", "indents", "lines", "__none__"],
    queryFn: () => apiListIndentLines(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Indents: writes ────────────────────────────────────────────────────────

export function useApiCreateIndent() {
  const qc = useQueryClient();
  return useMutation<IndentWithLines, Error, CreateIndent>({
    mutationFn: (body) => apiCreateIndent(body),
    onSuccess: (indent) => {
      qc.setQueryData(procurementApiKeys.indents.detail(indent.id), indent);
      qc.invalidateQueries({ queryKey: procurementApiKeys.indents.all });
    },
  });
}

export function useApiUpdateIndent(id: string) {
  const qc = useQueryClient();
  return useMutation<Indent, Error, UpdateIndent>({
    mutationFn: (body) => apiUpdateIndent(id, body),
    onSuccess: () => {
      // Update drops lines from the response, so don't setQueryData —
      // invalidate instead so the next read refetches WithLines.
      qc.invalidateQueries({ queryKey: procurementApiKeys.indents.all });
    },
  });
}

export function useApiDeleteIndent() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteIndent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementApiKeys.indents.all });
    },
  });
}

/**
 * Line mutations bump the parent header's version, so invalidate the
 * detail query too — the embedded lines[] inside `IndentWithLines` would
 * go stale otherwise.
 */
export function useApiAddIndentLine(indentId: string) {
  const qc = useQueryClient();
  return useMutation<IndentLine, Error, CreateIndentLine>({
    mutationFn: (body) => apiAddIndentLine(indentId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.indents.detail(indentId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.indents.lines(indentId),
      });
      qc.invalidateQueries({ queryKey: procurementApiKeys.indents.all });
    },
  });
}

export function useApiUpdateIndentLine(indentId: string) {
  const qc = useQueryClient();
  return useMutation<
    IndentLine,
    Error,
    { lineId: string; body: UpdateIndentLine }
  >({
    mutationFn: ({ lineId, body }) =>
      apiUpdateIndentLine(indentId, lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.indents.detail(indentId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.indents.lines(indentId),
      });
    },
  });
}

export function useApiDeleteIndentLine(indentId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (lineId) => apiDeleteIndentLine(indentId, lineId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.indents.detail(indentId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.indents.lines(indentId),
      });
    },
  });
}

// ─── Purchase Orders: reads ─────────────────────────────────────────────────

export function useApiPurchaseOrders(query: PurchaseOrderListQuery = {}) {
  return useQuery({
    queryKey: procurementApiKeys.purchaseOrders.list(query),
    queryFn: () => apiListPurchaseOrders(query),
    // Status transitions + GRN postings keep POs moving — 20 s.
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `PurchaseOrderWithLines` — header + embedded `lines[]`. */
export function useApiPurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? procurementApiKeys.purchaseOrders.detail(id)
      : ["proc-api", "purchase-orders", "detail", "__none__"],
    queryFn: () => apiGetPurchaseOrder(id!),
    enabled: Boolean(id),
    // Totals + received_qty change underneath us on GRN posting, so keep
    // the detail fresher than the vendor/indent masters.
    staleTime: 15_000,
  });
}

export function useApiPoLines(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? procurementApiKeys.purchaseOrders.lines(id)
      : ["proc-api", "purchase-orders", "lines", "__none__"],
    queryFn: () => apiListPoLines(id!),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

// ─── Purchase Orders: writes ────────────────────────────────────────────────

export function useApiCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<PurchaseOrderWithLines, Error, CreatePurchaseOrder>({
    mutationFn: (body) => apiCreatePurchaseOrder(body),
    onSuccess: (po) => {
      qc.setQueryData(procurementApiKeys.purchaseOrders.detail(po.id), po);
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.all,
      });
    },
  });
}

export function useApiUpdatePurchaseOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<PurchaseOrder, Error, UpdatePurchaseOrder>({
    mutationFn: (body) => apiUpdatePurchaseOrder(id, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.all,
      });
    },
  });
}

export function useApiDeletePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeletePurchaseOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.all,
      });
    },
  });
}

/**
 * Line mutations on POs additionally re-denormalise the header totals
 * (subtotal/tax_total/discount_total/grand_total). Invalidate the detail
 * so the next read gets the refreshed header.
 */
export function useApiAddPoLine(poId: string) {
  const qc = useQueryClient();
  return useMutation<PoLine, Error, CreatePoLine>({
    mutationFn: (body) => apiAddPoLine(poId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.detail(poId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.lines(poId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.all,
      });
    },
  });
}

export function useApiUpdatePoLine(poId: string) {
  const qc = useQueryClient();
  return useMutation<PoLine, Error, { lineId: string; body: UpdatePoLine }>({
    mutationFn: ({ lineId, body }) => apiUpdatePoLine(poId, lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.detail(poId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.lines(poId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.all,
      });
    },
  });
}

export function useApiDeletePoLine(poId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (lineId) => apiDeletePoLine(poId, lineId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.detail(poId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.lines(poId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.all,
      });
    },
  });
}

// ─── GRNs: reads ────────────────────────────────────────────────────────────

export function useApiGrns(query: GrnListQuery = {}) {
  return useQuery({
    queryKey: procurementApiKeys.grns.list(query),
    queryFn: () => apiListGrns(query),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `GrnWithLines` — header + embedded `lines[]`. */
export function useApiGrn(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? procurementApiKeys.grns.detail(id)
      : ["proc-api", "grns", "detail", "__none__"],
    queryFn: () => apiGetGrn(id!),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useApiGrnLines(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? procurementApiKeys.grns.lines(id)
      : ["proc-api", "grns", "lines", "__none__"],
    queryFn: () => apiListGrnLines(id!),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

// ─── GRNs: writes ───────────────────────────────────────────────────────────

export function useApiCreateGrn() {
  const qc = useQueryClient();
  return useMutation<GrnWithLines, Error, CreateGrn>({
    mutationFn: (body) => apiCreateGrn(body),
    onSuccess: (grn) => {
      qc.setQueryData(procurementApiKeys.grns.detail(grn.id), grn);
      qc.invalidateQueries({ queryKey: procurementApiKeys.grns.all });
    },
  });
}

export function useApiUpdateGrn(id: string) {
  const qc = useQueryClient();
  return useMutation<Grn, Error, UpdateGrn>({
    mutationFn: (body) => apiUpdateGrn(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementApiKeys.grns.all });
    },
  });
}

export function useApiDeleteGrn() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteGrn(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementApiKeys.grns.all });
    },
  });
}

export function useApiAddGrnLine(grnId: string) {
  const qc = useQueryClient();
  return useMutation<GrnLine, Error, CreateGrnLine>({
    mutationFn: (body) => apiAddGrnLine(grnId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.grns.detail(grnId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.grns.lines(grnId),
      });
      qc.invalidateQueries({ queryKey: procurementApiKeys.grns.all });
    },
  });
}

export function useApiUpdateGrnLine(grnId: string) {
  const qc = useQueryClient();
  return useMutation<
    GrnLine,
    Error,
    { lineId: string; body: UpdateGrnLine }
  >({
    mutationFn: ({ lineId, body }) => apiUpdateGrnLine(grnId, lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.grns.detail(grnId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.grns.lines(grnId),
      });
    },
  });
}

export function useApiDeleteGrnLine(grnId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (lineId) => apiDeleteGrnLine(grnId, lineId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: procurementApiKeys.grns.detail(grnId),
      });
      qc.invalidateQueries({
        queryKey: procurementApiKeys.grns.lines(grnId),
      });
    },
  });
}

/**
 * Post a DRAFT GRN. Atomic server-side:
 *   1. Writes one stock_ledger row per grn_line (txn_type = GRN_RECEIPT).
 *   2. Bumps po_lines.received_qty on the parent PO.
 *   3. Recomputes parent PO status (PARTIALLY_RECEIVED / RECEIVED).
 *   4. Flips GRN status DRAFT → POSTED.
 *
 * Invalidate procurement (GRN header + parent PO) AND inventory (ledger +
 * summary) caches — the posting writes across both modules. The inventory
 * cache keys live in `inventoryApiKeys.*` but we invalidate by prefix
 * using the root `["inv-api"]` key so we don't pull a circular import.
 */
export function useApiPostGrn(grnId: string) {
  const qc = useQueryClient();
  return useMutation<GrnWithLines, Error, PostGrn>({
    mutationFn: (body) => apiPostGrn(grnId, body),
    onSuccess: (grn) => {
      qc.setQueryData(procurementApiKeys.grns.detail(grnId), grn);
      qc.invalidateQueries({ queryKey: procurementApiKeys.grns.all });
      // Parent PO status + received_qty may have flipped.
      qc.invalidateQueries({
        queryKey: procurementApiKeys.purchaseOrders.all,
      });
      // Inventory ledger + summary picked up fresh rows.
      qc.invalidateQueries({ queryKey: ["inv-api"] });
    },
  });
}
