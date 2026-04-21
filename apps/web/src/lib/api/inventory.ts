/**
 * Typed wrappers for the real /inventory/* surface exposed by apps/api.
 *
 * Mirrors lib/api/crm.ts: every function routes through tenantFetch (Bearer
 * + X-Org-Id + silent refresh), uses the real contract types from
 * @mobilab/contracts, and returns the shared PaginatedResponse envelope for
 * list endpoints.
 *
 * 14 endpoints across 5 resources:
 *   - warehouses  (GET list, GET by id, POST, PATCH, DELETE)
 *   - items       (GET list, GET by id, POST, PATCH, DELETE)
 *   - bindings    (GET list, POST upsert, DELETE)
 *   - stock ledger (GET list, POST entry)
 *   - stock summary (GET list, GET one for item+warehouse)
 */

import type {
  // Warehouses
  Warehouse,
  CreateWarehouse,
  UpdateWarehouse,
  WarehouseKind,
  // Items
  Item,
  CreateItem,
  UpdateItem,
  ItemCategory,
  ItemUom,
  // Bindings
  ItemWarehouseBinding,
  UpsertItemWarehouseBinding,
  // Stock ledger
  StockLedgerEntry,
  PostStockLedgerEntry,
  StockTxnType,
  // Stock summary
  StockSummary,
  StockSummaryRow,
} from "@mobilab/contracts";

import type { PaginatedResponse, PaginationParams } from "./crm";
import {
  tenantDelete,
  tenantGet,
  tenantPatch,
  tenantPost,
} from "./tenant-fetch";

// Re-export the shared types so inventory callers don't need to import from
// ./crm — keeps the module boundary clean.
export type { PaginatedResponse, PaginationParams } from "./crm";

/**
 * Build a querystring from a plain object. Local copy so this module has no
 * runtime coupling to ./crm. Drops undefined/null/""; booleans are stringified
 * as "true"/"false" (matches the zod coercion on the server).
 */
function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// ─── Warehouses ─────────────────────────────────────────────────────────────

export interface WarehouseListQuery extends PaginationParams {
  kind?: WarehouseKind;
  isActive?: boolean;
  search?: string;
}

export async function apiListWarehouses(
  q: WarehouseListQuery = {}
): Promise<PaginatedResponse<Warehouse>> {
  return tenantGet(`/inventory/warehouses${qs(q)}`);
}

export async function apiGetWarehouse(id: string): Promise<Warehouse> {
  return tenantGet(`/inventory/warehouses/${id}`);
}

export async function apiCreateWarehouse(
  body: CreateWarehouse
): Promise<Warehouse> {
  return tenantPost(`/inventory/warehouses`, body);
}

export async function apiUpdateWarehouse(
  id: string,
  body: UpdateWarehouse
): Promise<Warehouse> {
  return tenantPatch(`/inventory/warehouses/${id}`, body);
}

export async function apiDeleteWarehouse(id: string): Promise<void> {
  return tenantDelete(`/inventory/warehouses/${id}`);
}

// ─── Items ──────────────────────────────────────────────────────────────────

export interface ItemListQuery extends PaginationParams {
  category?: ItemCategory;
  uom?: ItemUom;
  isActive?: boolean;
  search?: string;
}

export async function apiListItems(
  q: ItemListQuery = {}
): Promise<PaginatedResponse<Item>> {
  return tenantGet(`/inventory/items${qs(q)}`);
}

export async function apiGetItem(id: string): Promise<Item> {
  return tenantGet(`/inventory/items/${id}`);
}

export async function apiCreateItem(body: CreateItem): Promise<Item> {
  return tenantPost(`/inventory/items`, body);
}

export async function apiUpdateItem(
  id: string,
  body: UpdateItem
): Promise<Item> {
  return tenantPatch(`/inventory/items/${id}`, body);
}

export async function apiDeleteItem(id: string): Promise<void> {
  return tenantDelete(`/inventory/items/${id}`);
}

// ─── Item-warehouse bindings ────────────────────────────────────────────────

export interface ItemWarehouseBindingListQuery extends PaginationParams {
  itemId?: string;
  warehouseId?: string;
}

export async function apiListBindings(
  q: ItemWarehouseBindingListQuery = {}
): Promise<PaginatedResponse<ItemWarehouseBinding>> {
  return tenantGet(`/inventory/bindings${qs(q)}`);
}

/**
 * UPSERT: backend uses (org_id, item_id, warehouse_id) as the conflict key
 * and returns the row either way. Callers don't need to distinguish create
 * vs update.
 */
export async function apiUpsertBinding(
  body: UpsertItemWarehouseBinding
): Promise<ItemWarehouseBinding> {
  return tenantPost(`/inventory/bindings`, body);
}

export async function apiDeleteBinding(id: string): Promise<void> {
  return tenantDelete(`/inventory/bindings/${id}`);
}

// ─── Stock ledger ───────────────────────────────────────────────────────────

export interface StockLedgerListQuery extends PaginationParams {
  itemId?: string;
  warehouseId?: string;
  txnType?: StockTxnType;
  refDocType?: string;
  refDocId?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
}

export async function apiListStockLedger(
  q: StockLedgerListQuery = {}
): Promise<PaginatedResponse<StockLedgerEntry>> {
  return tenantGet(`/inventory/stock/ledger${qs(q)}`);
}

/**
 * Post a ledger entry. The DB trigger maintains stock_summary on insert —
 * callers don't need to touch the summary separately. Server enforces
 * sign-vs-txn_type + shortage checks; the thrown ApiProblem carries the
 * specific failure code ("inventory.shortage", "inventory.uom_mismatch",
 * etc.).
 */
export async function apiPostStockLedger(
  body: PostStockLedgerEntry
): Promise<StockLedgerEntry> {
  return tenantPost(`/inventory/stock/ledger`, body);
}

// ─── Stock summary ──────────────────────────────────────────────────────────

export interface StockSummaryListQuery extends PaginationParams {
  itemId?: string;
  warehouseId?: string;
  category?: ItemCategory;
  /** Only rows at or below reorder_level — for the "low stock" tab. */
  lowStockOnly?: boolean;
  search?: string;
}

export async function apiListStockSummary(
  q: StockSummaryListQuery = {}
): Promise<PaginatedResponse<StockSummaryRow>> {
  return tenantGet(`/inventory/stock/summary${qs(q)}`);
}

export async function apiGetStockForItemAtWarehouse(
  itemId: string,
  warehouseId: string
): Promise<StockSummary> {
  return tenantGet(`/inventory/stock/summary/${itemId}/${warehouseId}`);
}
