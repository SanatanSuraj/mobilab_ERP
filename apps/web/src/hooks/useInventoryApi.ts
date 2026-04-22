/**
 * Real-API React Query hooks for the Inventory module.
 *
 * Deliberately separate from the mock-backed `useInventory.ts`: the mock
 * hooks still power the older prototype pages (batches, serials, GRN,
 * reorder, transfers), and their query keys, types, and shapes diverge
 * from the real contract. Colocating the two in one file invited bugs
 * during early migration experiments — every mutation touched both caches
 * and state got mixed up.
 *
 * Query-key namespace: `["inv-api", entity, ...]`. The mock hooks use
 * `["inventory", ...]`, so there is zero overlap and both sets can coexist
 * without cross-invalidation.
 *
 * When a page is migrated, flip its imports from `@/hooks/useInventory` →
 * `@/hooks/useInventoryApi` and adjust type usage. No cache cleanup needed —
 * unused keys age out naturally.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiCreateItem,
  apiCreateWarehouse,
  apiDeleteBinding,
  apiDeleteItem,
  apiDeleteWarehouse,
  apiGetItem,
  apiGetStockForItemAtWarehouse,
  apiGetWarehouse,
  apiListBindings,
  apiListItems,
  apiListStockLedger,
  apiListStockSummary,
  apiListWarehouses,
  apiPostStockLedger,
  apiUpdateItem,
  apiUpdateWarehouse,
  apiUpsertBinding,
  type ItemListQuery,
  type ItemWarehouseBindingListQuery,
  type StockLedgerListQuery,
  type StockSummaryListQuery,
  type WarehouseListQuery,
} from "@/lib/api/inventory";

import type {
  CreateItem,
  CreateWarehouse,
  Item,
  ItemWarehouseBinding,
  PostStockLedgerEntry,
  StockLedgerEntry,
  UpdateItem,
  UpdateWarehouse,
  UpsertItemWarehouseBinding,
  Warehouse,
} from "@instigenie/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────
//
// Namespaced `["inv-api", entity, ...]` so they never collide with the mock
// hooks in useInventory.ts (`["inventory", ...]`). Every new entity added
// here follows the `all | list(q) | detail(id)` triple so react-query
// invalidations can target either the whole entity or a specific row.

export const inventoryApiKeys = {
  all: ["inv-api"] as const,
  warehouses: {
    all: ["inv-api", "warehouses"] as const,
    list: (q: WarehouseListQuery) =>
      ["inv-api", "warehouses", "list", q] as const,
    detail: (id: string) => ["inv-api", "warehouses", "detail", id] as const,
  },
  items: {
    all: ["inv-api", "items"] as const,
    list: (q: ItemListQuery) => ["inv-api", "items", "list", q] as const,
    detail: (id: string) => ["inv-api", "items", "detail", id] as const,
  },
  bindings: {
    all: ["inv-api", "bindings"] as const,
    list: (q: ItemWarehouseBindingListQuery) =>
      ["inv-api", "bindings", "list", q] as const,
  },
  ledger: {
    all: ["inv-api", "ledger"] as const,
    list: (q: StockLedgerListQuery) =>
      ["inv-api", "ledger", "list", q] as const,
  },
  summary: {
    all: ["inv-api", "summary"] as const,
    list: (q: StockSummaryListQuery) =>
      ["inv-api", "summary", "list", q] as const,
    pair: (itemId: string, warehouseId: string) =>
      ["inv-api", "summary", "pair", itemId, warehouseId] as const,
  },
};

// ─── Warehouses: reads ─────────────────────────────────────────────────────

export function useApiWarehouses(query: WarehouseListQuery = {}) {
  return useQuery({
    queryKey: inventoryApiKeys.warehouses.list(query),
    queryFn: () => apiListWarehouses(query),
    // Warehouses barely change — 5 min is fine, matches the mock hook's
    // staleTime.
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiWarehouse(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? inventoryApiKeys.warehouses.detail(id)
      : ["inv-api", "warehouses", "detail", "__none__"],
    queryFn: () => apiGetWarehouse(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Warehouses: writes ────────────────────────────────────────────────────

export function useApiCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation<Warehouse, Error, CreateWarehouse>({
    mutationFn: (body) => apiCreateWarehouse(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryApiKeys.warehouses.all });
    },
  });
}

export function useApiUpdateWarehouse(id: string) {
  const qc = useQueryClient();
  return useMutation<Warehouse, Error, UpdateWarehouse>({
    mutationFn: (body) => apiUpdateWarehouse(id, body),
    onSuccess: (wh) => {
      qc.setQueryData(inventoryApiKeys.warehouses.detail(id), wh);
      qc.invalidateQueries({ queryKey: inventoryApiKeys.warehouses.all });
    },
  });
}

export function useApiDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteWarehouse(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryApiKeys.warehouses.all });
    },
  });
}

// ─── Items: reads ──────────────────────────────────────────────────────────

export function useApiItems(query: ItemListQuery = {}) {
  return useQuery({
    queryKey: inventoryApiKeys.items.list(query),
    queryFn: () => apiListItems(query),
    // Items drift slowly but mutations go through the same list view,
    // so 30s keeps the UI responsive without hammering the API.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiItem(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? inventoryApiKeys.items.detail(id)
      : ["inv-api", "items", "detail", "__none__"],
    queryFn: () => apiGetItem(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Items: writes ─────────────────────────────────────────────────────────

export function useApiCreateItem() {
  const qc = useQueryClient();
  return useMutation<Item, Error, CreateItem>({
    mutationFn: (body) => apiCreateItem(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryApiKeys.items.all });
    },
  });
}

export function useApiUpdateItem(id: string) {
  const qc = useQueryClient();
  return useMutation<Item, Error, UpdateItem>({
    mutationFn: (body) => apiUpdateItem(id, body),
    onSuccess: (item) => {
      qc.setQueryData(inventoryApiKeys.items.detail(id), item);
      qc.invalidateQueries({ queryKey: inventoryApiKeys.items.all });
    },
  });
}

export function useApiDeleteItem() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryApiKeys.items.all });
    },
  });
}

// ─── Item-warehouse bindings ───────────────────────────────────────────────

export function useApiBindings(
  query: ItemWarehouseBindingListQuery = {}
) {
  return useQuery({
    queryKey: inventoryApiKeys.bindings.list(query),
    queryFn: () => apiListBindings(query),
    // Bindings rarely change; align with warehouses.
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * UPSERT: backend resolves (org_id, item_id, warehouse_id) and returns the
 * row either way. We invalidate both bindings and the summary list because
 * reorder_level shows up in stock_summary_row.reorderLevel.
 */
export function useApiUpsertBinding() {
  const qc = useQueryClient();
  return useMutation<
    ItemWarehouseBinding,
    Error,
    UpsertItemWarehouseBinding
  >({
    mutationFn: (body) => apiUpsertBinding(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryApiKeys.bindings.all });
      qc.invalidateQueries({ queryKey: inventoryApiKeys.summary.all });
    },
  });
}

export function useApiDeleteBinding() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteBinding(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryApiKeys.bindings.all });
      qc.invalidateQueries({ queryKey: inventoryApiKeys.summary.all });
    },
  });
}

// ─── Stock ledger: reads ───────────────────────────────────────────────────

export function useApiStockLedger(query: StockLedgerListQuery = {}) {
  return useQuery({
    queryKey: inventoryApiKeys.ledger.list(query),
    queryFn: () => apiListStockLedger(query),
    // Ledger is append-only — new rows matter, so keep fresh.
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

// ─── Stock ledger: writes ──────────────────────────────────────────────────

/**
 * Post a stock-ledger entry. The DB trigger maintains stock_summary on
 * insert, so we invalidate BOTH the ledger list and the summary list
 * caches. Server-side sign-vs-txn_type and shortage checks throw as
 * ApiProblem — callers should catch and toast problem.detail.
 */
export function useApiPostStockLedger() {
  const qc = useQueryClient();
  return useMutation<StockLedgerEntry, Error, PostStockLedgerEntry>({
    mutationFn: (body) => apiPostStockLedger(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventoryApiKeys.ledger.all });
      qc.invalidateQueries({ queryKey: inventoryApiKeys.summary.all });
    },
  });
}

// ─── Stock summary: reads ──────────────────────────────────────────────────

export function useApiStockSummary(query: StockSummaryListQuery = {}) {
  return useQuery({
    queryKey: inventoryApiKeys.summary.list(query),
    queryFn: () => apiListStockSummary(query),
    // Summary is trigger-maintained; 15s matches the ledger cadence.
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiStockForItemAtWarehouse(
  itemId: string | undefined,
  warehouseId: string | undefined
) {
  return useQuery({
    queryKey:
      itemId && warehouseId
        ? inventoryApiKeys.summary.pair(itemId, warehouseId)
        : ["inv-api", "summary", "pair", "__none__", "__none__"],
    queryFn: () => apiGetStockForItemAtWarehouse(itemId!, warehouseId!),
    enabled: Boolean(itemId && warehouseId),
    staleTime: 10_000,
  });
}
