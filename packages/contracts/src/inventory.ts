/**
 * Inventory contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §13.3. Matches ops/sql/init/03-inventory.sql.
 *
 * Scope (Phase 2):
 *   - items master
 *   - warehouses master
 *   - item_warehouse_bindings (reorder thresholds + bin locations)
 *   - stock_ledger (read-only; writes go through ledger-post endpoints)
 *   - stock_summary (read-only; maintained by DB trigger)
 *
 * Reservations, batches/serials per-unit enforcement, adjustments UI,
 * and transfers UI are Phase 3 — the wire shape already carries the
 * columns so Phase 3 doesn't require a contract break.
 *
 * Rules (same as crm.ts):
 *   - Money + quantities are decimal-strings. NEVER Number().
 *   - Enums are UPPER_SNAKE to match DB CHECK constraints.
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";

// ─── Shared helpers (kept private here to avoid crm.ts coupling) ─────────────

/** NUMERIC(18,2) money-style. */
const decimalStr = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/u, 'must be a decimal string like "1000.50"');

/** NUMERIC(18,3) quantity — allows three decimals for metres / grams. */
const qtyStr = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,3})?$/u, 'must be a quantity string like "12.500"');

const uuid = z.string().uuid();

// ─── Enums ───────────────────────────────────────────────────────────────────

export const WAREHOUSE_KINDS = [
  "PRIMARY",
  "SECONDARY",
  "QUARANTINE",
  "SCRAP",
  "VIRTUAL",
] as const;
export const WarehouseKindSchema = z.enum(WAREHOUSE_KINDS);
export type WarehouseKind = z.infer<typeof WarehouseKindSchema>;

export const ITEM_CATEGORIES = [
  "RAW_MATERIAL",
  "SUB_ASSEMBLY",
  "FINISHED_GOOD",
  "CONSUMABLE",
  "PACKAGING",
  "SPARE_PART",
  "TOOL",
] as const;
export const ItemCategorySchema = z.enum(ITEM_CATEGORIES);
export type ItemCategory = z.infer<typeof ItemCategorySchema>;

export const ITEM_UOMS = [
  "EA",
  "BOX",
  "PAIR",
  "SET",
  "ROLL",
  "KG",
  "G",
  "MG",
  "L",
  "ML",
  "M",
  "CM",
  "MM",
] as const;
export const ItemUomSchema = z.enum(ITEM_UOMS);
export type ItemUom = z.infer<typeof ItemUomSchema>;

export const STOCK_TXN_TYPES = [
  "OPENING_BALANCE",
  "GRN_RECEIPT",
  "WO_ISSUE",
  "WO_RETURN",
  "WO_OUTPUT",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "SCRAP",
  "RTV_OUT",
  "CUSTOMER_ISSUE",
  "CUSTOMER_RETURN",
  "REVERSAL",
] as const;
export const StockTxnTypeSchema = z.enum(STOCK_TXN_TYPES);
export type StockTxnType = z.infer<typeof StockTxnTypeSchema>;

// ─── Warehouses ──────────────────────────────────────────────────────────────

export const WarehouseSchema = z.object({
  id: uuid,
  orgId: uuid,
  code: z.string(),
  name: z.string(),
  kind: WarehouseKindSchema,
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string(),
  postalCode: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  managerId: uuid.nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

export const CreateWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  kind: WarehouseKindSchema.default("PRIMARY"),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  country: z.string().trim().length(2).default("IN"),
  postalCode: z.string().trim().max(20).optional(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  managerId: uuid.optional(),
});
export type CreateWarehouse = z.infer<typeof CreateWarehouseSchema>;

export const UpdateWarehouseSchema = CreateWarehouseSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateWarehouse = z.infer<typeof UpdateWarehouseSchema>;

export const WarehouseListQuerySchema = PaginationQuerySchema.extend({
  kind: WarehouseKindSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Items ───────────────────────────────────────────────────────────────────

export const ItemSchema = z.object({
  id: uuid,
  orgId: uuid,
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: ItemCategorySchema,
  uom: ItemUomSchema,
  hsnCode: z.string().nullable(),
  unitCost: decimalStr,
  defaultWarehouseId: uuid.nullable(),
  isSerialised: z.boolean(),
  isBatched: z.boolean(),
  shelfLifeDays: z.number().int().nullable(),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Item = z.infer<typeof ItemSchema>;

export const CreateItemSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  category: ItemCategorySchema.default("RAW_MATERIAL"),
  uom: ItemUomSchema.default("EA"),
  hsnCode: z.string().trim().max(20).optional(),
  unitCost: decimalStr.default("0"),
  defaultWarehouseId: uuid.optional(),
  isSerialised: z.boolean().default(false),
  isBatched: z.boolean().default(false),
  shelfLifeDays: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});
export type CreateItem = z.infer<typeof CreateItemSchema>;

export const UpdateItemSchema = CreateItemSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateItem = z.infer<typeof UpdateItemSchema>;

export const ItemListQuerySchema = PaginationQuerySchema.extend({
  category: ItemCategorySchema.optional(),
  uom: ItemUomSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Item/Warehouse bindings ─────────────────────────────────────────────────

export const ItemWarehouseBindingSchema = z.object({
  id: uuid,
  orgId: uuid,
  itemId: uuid,
  warehouseId: uuid,
  reorderLevel: qtyStr,
  reorderQty: qtyStr,
  maxLevel: qtyStr.nullable(),
  binLocation: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ItemWarehouseBinding = z.infer<typeof ItemWarehouseBindingSchema>;

export const UpsertItemWarehouseBindingSchema = z.object({
  itemId: uuid,
  warehouseId: uuid,
  reorderLevel: qtyStr.default("0"),
  reorderQty: qtyStr.default("0"),
  maxLevel: qtyStr.optional(),
  binLocation: z.string().trim().max(40).optional(),
});
export type UpsertItemWarehouseBinding = z.infer<
  typeof UpsertItemWarehouseBindingSchema
>;

export const ItemWarehouseBindingListQuerySchema =
  PaginationQuerySchema.extend({
    itemId: uuid.optional(),
    warehouseId: uuid.optional(),
  });

// ─── Stock ledger (append-only, read via this module) ────────────────────────

export const StockLedgerEntrySchema = z.object({
  id: uuid,
  orgId: uuid,
  itemId: uuid,
  warehouseId: uuid,
  quantity: qtyStr,             // signed
  uom: ItemUomSchema,
  txnType: StockTxnTypeSchema,
  refDocType: z.string().nullable(),
  refDocId: uuid.nullable(),
  refLineId: uuid.nullable(),
  batchNo: z.string().nullable(),
  serialNo: z.string().nullable(),
  reason: z.string().nullable(),
  unitCost: decimalStr.nullable(),
  postedBy: uuid.nullable(),
  postedAt: z.string(),
  /**
   * Phase 4 §9.5 — HMAC-SHA256 captured when the txn represents a
   * critical action (SCRAP = "stock write-off", CUSTOMER_ISSUE =
   * "device release"). NULL for all other txn_types and for rows
   * posted before Phase 4 §4.2c shipped.
   */
  signatureHash: z.string().nullable(),
  createdAt: z.string(),
});
export type StockLedgerEntry = z.infer<typeof StockLedgerEntrySchema>;

/**
 * Post a stock-ledger entry. This is the single-writer mechanism for
 * inventory movements in Phase 2. Higher-level endpoints (GRN receipt,
 * WO issue, etc.) will internally call the stock service which posts a
 * ledger row and rely on the DB trigger to maintain stock_summary.
 *
 * In Phase 2 the HTTP surface exposes this for:
 *   - Manual adjustments (ADJUSTMENT)
 *   - Opening balances (OPENING_BALANCE)
 *   - Scrap (SCRAP)
 *   - Reversals (REVERSAL)
 *
 * Phase 3 adds GRN/WO-driven variants that go through their own
 * endpoints but share this shape.
 */
export const PostStockLedgerEntrySchema = z.object({
  itemId: uuid,
  warehouseId: uuid,
  quantity: qtyStr.refine((v) => v !== "0" && v !== "-0" && v !== "0.0", {
    message: "quantity must be non-zero",
  }),
  uom: ItemUomSchema,
  txnType: StockTxnTypeSchema,
  refDocType: z.string().trim().max(32).optional(),
  refDocId: uuid.optional(),
  refLineId: uuid.optional(),
  batchNo: z.string().trim().max(64).optional(),
  serialNo: z.string().trim().max(64).optional(),
  reason: z.string().trim().max(500).optional(),
  unitCost: decimalStr.optional(),
  /**
   * Phase 4 §9.5 — password re-entry for critical-action txn_types.
   * Required by the service when EsignatureService is wired AND
   * txnType is in {SCRAP, CUSTOMER_ISSUE}; ignored otherwise. The
   * server HMAC-SHA256s (eSignatureReason || userIdentityId ||
   * postedAt) with ESIGNATURE_PEPPER and stores the hex on
   * stock_ledger.signature_hash.
   */
  eSignaturePassword: z.string().min(1).max(256).optional(),
  eSignatureReason: z.string().trim().min(1).max(500).optional(),
});
export type PostStockLedgerEntry = z.infer<typeof PostStockLedgerEntrySchema>;

export const StockLedgerListQuerySchema = PaginationQuerySchema.extend({
  itemId: uuid.optional(),
  warehouseId: uuid.optional(),
  txnType: StockTxnTypeSchema.optional(),
  refDocType: z.string().trim().max(32).optional(),
  refDocId: uuid.optional(),
  /** Inclusive. ISO-8601 date. */
  from: z.string().date().optional(),
  /** Inclusive. ISO-8601 date. */
  to: z.string().date().optional(),
});

// ─── Stock summary (projection, read-only) ───────────────────────────────────

export const StockSummarySchema = z.object({
  id: uuid,
  orgId: uuid,
  itemId: uuid,
  warehouseId: uuid,
  onHand: qtyStr,
  reserved: qtyStr,
  available: qtyStr,
  lastMovementAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type StockSummary = z.infer<typeof StockSummarySchema>;

/**
 * Summary enriched with item + warehouse names so the frontend can
 * render a single row without N+1 lookups. The API joins when serving
 * the list endpoint.
 */
export const StockSummaryRowSchema = StockSummarySchema.extend({
  itemSku: z.string(),
  itemName: z.string(),
  itemUom: ItemUomSchema,
  itemCategory: ItemCategorySchema,
  warehouseCode: z.string(),
  warehouseName: z.string(),
  reorderLevel: qtyStr.nullable(),
});
export type StockSummaryRow = z.infer<typeof StockSummaryRowSchema>;

export const StockSummaryListQuerySchema = PaginationQuerySchema.extend({
  itemId: uuid.optional(),
  warehouseId: uuid.optional(),
  category: ItemCategorySchema.optional(),
  /** Only rows at or below reorder_level. For the "low stock" tab. */
  lowStockOnly: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Stock reservations (Phase 3) ────────────────────────────────────────────

export const RESERVATION_STATUSES = ["ACTIVE", "RELEASED", "CONSUMED"] as const;
export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES);
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

/**
 * A single outstanding or historical stock reservation. Maintained by the
 * reserve_stock_atomic / release_stock_reservation / consume_stock_reservation
 * stored functions — services never INSERT here directly.
 */
export const StockReservationSchema = z.object({
  id: uuid,
  orgId: uuid,
  itemId: uuid,
  warehouseId: uuid,
  quantity: qtyStr, // always positive
  uom: ItemUomSchema,
  status: ReservationStatusSchema,
  refDocType: z.string(),
  refDocId: uuid,
  refLineId: uuid.nullable(),
  reservedBy: uuid.nullable(),
  reservedAt: z.string(),
  releasedAt: z.string().nullable(),
  releasedBy: uuid.nullable(),
  consumedAt: z.string().nullable(),
  consumedBy: uuid.nullable(),
  consumedLedgerId: uuid.nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StockReservation = z.infer<typeof StockReservationSchema>;

/**
 * Single-line reservation request. Callers either POST this directly
 * (manual holds) or it's built internally by MRP/WO release paths.
 */
export const ReserveStockRequestSchema = z.object({
  itemId: uuid,
  warehouseId: uuid,
  quantity: qtyStr.refine((v) => v !== "0" && v !== "-0" && v !== "0.0", {
    message: "quantity must be > 0",
  }),
  uom: ItemUomSchema,
  refDocType: z.string().trim().min(1).max(32),
  refDocId: uuid,
  refLineId: uuid.optional(),
  notes: z.string().trim().max(500).optional(),
});
export type ReserveStockRequest = z.infer<typeof ReserveStockRequestSchema>;

/**
 * MRP bulk-reserve: multi-line in one atomic call. The service sorts
 * lines by (itemId, warehouseId) before locking so concurrent MRP runs
 * acquire locks in the same order and never deadlock on each other.
 *
 * Semantics: all-or-nothing. If any line fails (shortage or lock
 * timeout after retries) every reservation posted so far in the call
 * rolls back.
 */
export const BulkReserveStockRequestSchema = z.object({
  refDocType: z.string().trim().min(1).max(32),
  refDocId: uuid,
  lines: z
    .array(
      z.object({
        itemId: uuid,
        warehouseId: uuid,
        quantity: qtyStr.refine((v) => v !== "0" && v !== "-0" && v !== "0.0"),
        uom: ItemUomSchema,
        refLineId: uuid.optional(),
      })
    )
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).optional(),
});
export type BulkReserveStockRequest = z.infer<
  typeof BulkReserveStockRequestSchema
>;

export const ConsumeReservationRequestSchema = z.object({
  batchNo: z.string().trim().max(64).optional(),
  serialNo: z.string().trim().max(64).optional(),
  unitCost: decimalStr.optional(),
});
export type ConsumeReservationRequest = z.infer<
  typeof ConsumeReservationRequestSchema
>;

export const StockReservationListQuerySchema = PaginationQuerySchema.extend({
  itemId: uuid.optional(),
  warehouseId: uuid.optional(),
  status: ReservationStatusSchema.optional(),
  refDocType: z.string().trim().max(32).optional(),
  refDocId: uuid.optional(),
});
