/**
 * Stock repository.
 *
 * Bundles three read/write surfaces that all touch the same pair of tables
 * (stock_ledger + stock_summary):
 *
 *   1. Ledger post + list — the only writer for stock_ledger. Readers use
 *      the same paginated list shape as other modules.
 *   2. Summary list — reads stock_summary joined to items + warehouses so
 *      the UI has a one-row-per-stock-position view without N+1.
 *   3. Item/warehouse bindings — CRUD on the reorder-level table.
 *
 * Keep this file boring: no business logic. The service layer decides
 * *when* a WO_ISSUE is allowed; this layer just writes the row.
 */

import type { PoolClient } from "pg";
import type {
  ItemCategory,
  ItemUom,
  ItemWarehouseBinding,
  PostStockLedgerEntry,
  StockLedgerEntry,
  StockSummary,
  StockSummaryRow,
  StockTxnType,
  UpsertItemWarehouseBinding,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ─── Ledger ─────────────────────────────────────────────────────────────────

interface StockLedgerRow {
  id: string;
  org_id: string;
  item_id: string;
  warehouse_id: string;
  quantity: string;
  uom: ItemUom;
  txn_type: StockTxnType;
  ref_doc_type: string | null;
  ref_doc_id: string | null;
  ref_line_id: string | null;
  batch_no: string | null;
  serial_no: string | null;
  reason: string | null;
  unit_cost: string | null;
  posted_by: string | null;
  posted_at: Date;
  signature_hash: string | null;
  created_at: Date;
}

function rowToLedgerEntry(r: StockLedgerRow): StockLedgerEntry {
  return {
    id: r.id,
    orgId: r.org_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    quantity: r.quantity,
    uom: r.uom,
    txnType: r.txn_type,
    refDocType: r.ref_doc_type,
    refDocId: r.ref_doc_id,
    refLineId: r.ref_line_id,
    batchNo: r.batch_no,
    serialNo: r.serial_no,
    reason: r.reason,
    unitCost: r.unit_cost,
    postedBy: r.posted_by,
    postedAt: r.posted_at.toISOString(),
    signatureHash: r.signature_hash,
    createdAt: r.created_at.toISOString(),
  };
}

const LEDGER_COLS = `id, org_id, item_id, warehouse_id, quantity, uom,
                     txn_type, ref_doc_type, ref_doc_id, ref_line_id,
                     batch_no, serial_no, reason, unit_cost, posted_by,
                     posted_at, signature_hash, created_at`;

export interface StockLedgerListFilters {
  itemId?: string;
  warehouseId?: string;
  txnType?: StockTxnType;
  refDocType?: string;
  refDocId?: string;
  from?: string; // ISO date, inclusive
  to?: string;   // ISO date, inclusive
}

// ─── Summary ────────────────────────────────────────────────────────────────

interface StockSummaryRowDb {
  id: string;
  org_id: string;
  item_id: string;
  warehouse_id: string;
  on_hand: string;
  reserved: string;
  available: string;
  last_movement_at: Date | null;
  updated_at: Date;
}

interface StockSummaryJoinedRow extends StockSummaryRowDb {
  item_sku: string;
  item_name: string;
  item_uom: ItemUom;
  item_category: ItemCategory;
  warehouse_code: string;
  warehouse_name: string;
  reorder_level: string | null;
}

function rowToSummary(r: StockSummaryRowDb): StockSummary {
  return {
    id: r.id,
    orgId: r.org_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    onHand: r.on_hand,
    reserved: r.reserved,
    available: r.available,
    lastMovementAt: r.last_movement_at ? r.last_movement_at.toISOString() : null,
    updatedAt: r.updated_at.toISOString(),
  };
}

function joinedRowToSummaryRow(r: StockSummaryJoinedRow): StockSummaryRow {
  return {
    ...rowToSummary(r),
    itemSku: r.item_sku,
    itemName: r.item_name,
    itemUom: r.item_uom,
    itemCategory: r.item_category,
    warehouseCode: r.warehouse_code,
    warehouseName: r.warehouse_name,
    reorderLevel: r.reorder_level,
  };
}

export interface StockSummaryListFilters {
  itemId?: string;
  warehouseId?: string;
  category?: ItemCategory;
  lowStockOnly?: boolean;
  search?: string;
}

// ─── Bindings ───────────────────────────────────────────────────────────────

interface BindingRow {
  id: string;
  org_id: string;
  item_id: string;
  warehouse_id: string;
  reorder_level: string;
  reorder_qty: string;
  max_level: string | null;
  bin_location: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToBinding(r: BindingRow): ItemWarehouseBinding {
  return {
    id: r.id,
    orgId: r.org_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    reorderLevel: r.reorder_level,
    reorderQty: r.reorder_qty,
    maxLevel: r.max_level,
    binLocation: r.bin_location,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const BINDING_COLS = `id, org_id, item_id, warehouse_id, reorder_level,
                      reorder_qty, max_level, bin_location, created_at,
                      updated_at`;

export interface BindingListFilters {
  itemId?: string;
  warehouseId?: string;
}

// ─── Repo methods ───────────────────────────────────────────────────────────

export const stockRepo = {
  // ── Ledger ────────────────────────────────────────────────────────────────

  /**
   * Insert a stock_ledger row. The DB trigger tg_stock_summary_from_ledger
   * updates the projection atomically in the same transaction.
   *
   * `postedBy` should be the current user id (from requireUser(req)).
   *
   * `opts.postedAt` / `opts.signatureHash` (Phase 4 §9.5):
   *   - When the service has an EsignatureService wired AND the
   *     txn_type is in the critical set (SCRAP, CUSTOMER_ISSUE), the
   *     service computes an HMAC-SHA256 bound to an ISO timestamp and
   *     hands BOTH values here so the stored row uses the exact same
   *     string that went into the hash. An auditor recomputing the
   *     HMAC against (reason || userIdentityId || posted_at) gets back
   *     the stored signature_hash bit-for-bit.
   *   - When opts is omitted the DB defaults fire (posted_at = now(),
   *     signature_hash = NULL) for pre-§4.2c callers that haven't
   *     adopted the deps-struct constructor yet.
   */
  async postLedgerEntry(
    client: PoolClient,
    orgId: string,
    postedBy: string,
    input: PostStockLedgerEntry,
    opts?: { postedAt: string; signatureHash: string | null },
  ): Promise<StockLedgerEntry> {
    const { rows } = await client.query<StockLedgerRow>(
      `INSERT INTO stock_ledger (
         org_id, item_id, warehouse_id, quantity, uom, txn_type,
         ref_doc_type, ref_doc_id, ref_line_id, batch_no, serial_no,
         reason, unit_cost, posted_by,
         posted_at, signature_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 COALESCE($15::timestamptz, now()),
                 $16)
       RETURNING ${LEDGER_COLS}`,
      [
        orgId,
        input.itemId,
        input.warehouseId,
        input.quantity,
        input.uom,
        input.txnType,
        input.refDocType ?? null,
        input.refDocId ?? null,
        input.refLineId ?? null,
        input.batchNo ?? null,
        input.serialNo ?? null,
        input.reason ?? null,
        input.unitCost ?? null,
        postedBy,
        opts?.postedAt ?? null,
        opts?.signatureHash ?? null,
      ]
    );
    return rowToLedgerEntry(rows[0]!);
  },

  async listLedger(
    client: PoolClient,
    filters: StockLedgerListFilters,
    plan: PaginationPlan
  ): Promise<{ data: StockLedgerEntry[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.itemId) {
      where.push(`item_id = $${i}`);
      params.push(filters.itemId);
      i++;
    }
    if (filters.warehouseId) {
      where.push(`warehouse_id = $${i}`);
      params.push(filters.warehouseId);
      i++;
    }
    if (filters.txnType) {
      where.push(`txn_type = $${i}`);
      params.push(filters.txnType);
      i++;
    }
    if (filters.refDocType) {
      where.push(`ref_doc_type = $${i}`);
      params.push(filters.refDocType);
      i++;
    }
    if (filters.refDocId) {
      where.push(`ref_doc_id = $${i}`);
      params.push(filters.refDocId);
      i++;
    }
    if (filters.from) {
      where.push(`posted_at >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      // inclusive: shift upper bound by +1 day
      where.push(`posted_at < ($${i}::date + interval '1 day')`);
      params.push(filters.to);
      i++;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countSql = `SELECT count(*)::bigint AS total FROM stock_ledger ${whereSql}`;
    const listSql = `
      SELECT ${LEDGER_COLS}
        FROM stock_ledger
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<StockLedgerRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToLedgerEntry),
      total: Number(countRes.rows[0]!.total),
    };
  },

  // ── Summary ───────────────────────────────────────────────────────────────

  async listSummary(
    client: PoolClient,
    filters: StockSummaryListFilters,
    plan: PaginationPlan
  ): Promise<{ data: StockSummaryRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.itemId) {
      where.push(`ss.item_id = $${i}`);
      params.push(filters.itemId);
      i++;
    }
    if (filters.warehouseId) {
      where.push(`ss.warehouse_id = $${i}`);
      params.push(filters.warehouseId);
      i++;
    }
    if (filters.category) {
      where.push(`it.category = $${i}`);
      params.push(filters.category);
      i++;
    }
    if (filters.lowStockOnly) {
      // Shows rows where available <= reorder_level (binding). If no binding
      // exists we still surface rows <= 0 so true stock-outs show up.
      where.push(
        `(COALESCE(iwb.reorder_level, 0) >= ss.available OR ss.available <= 0)`
      );
    }
    if (filters.search) {
      where.push(
        `(it.name ILIKE $${i} OR it.sku ILIKE $${i} OR wh.code ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // Sort on summary columns is column-prefixed in the allowed map.
    const countSql = `
      SELECT count(*)::bigint AS total
        FROM stock_summary ss
        JOIN items it ON it.id = ss.item_id
        JOIN warehouses wh ON wh.id = ss.warehouse_id
   LEFT JOIN item_warehouse_bindings iwb
          ON iwb.item_id = ss.item_id AND iwb.warehouse_id = ss.warehouse_id
       ${whereSql}
    `;
    const listSql = `
      SELECT ss.id, ss.org_id, ss.item_id, ss.warehouse_id, ss.on_hand,
             ss.reserved, ss.available, ss.last_movement_at, ss.updated_at,
             it.sku AS item_sku, it.name AS item_name, it.uom AS item_uom,
             it.category AS item_category,
             wh.code AS warehouse_code, wh.name AS warehouse_name,
             iwb.reorder_level AS reorder_level
        FROM stock_summary ss
        JOIN items it ON it.id = ss.item_id
        JOIN warehouses wh ON wh.id = ss.warehouse_id
   LEFT JOIN item_warehouse_bindings iwb
          ON iwb.item_id = ss.item_id AND iwb.warehouse_id = ss.warehouse_id
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<StockSummaryJoinedRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(joinedRowToSummaryRow),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getSummaryForItemAtWarehouse(
    client: PoolClient,
    itemId: string,
    warehouseId: string
  ): Promise<StockSummary | null> {
    const { rows } = await client.query<StockSummaryRowDb>(
      `SELECT id, org_id, item_id, warehouse_id, on_hand, reserved,
              available, last_movement_at, updated_at
         FROM stock_summary
        WHERE item_id = $1 AND warehouse_id = $2`,
      [itemId, warehouseId]
    );
    return rows[0] ? rowToSummary(rows[0]) : null;
  },

  // ── Bindings ──────────────────────────────────────────────────────────────

  async listBindings(
    client: PoolClient,
    filters: BindingListFilters,
    plan: PaginationPlan
  ): Promise<{ data: ItemWarehouseBinding[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.itemId) {
      where.push(`item_id = $${i}`);
      params.push(filters.itemId);
      i++;
    }
    if (filters.warehouseId) {
      where.push(`warehouse_id = $${i}`);
      params.push(filters.warehouseId);
      i++;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countSql = `SELECT count(*)::bigint AS total FROM item_warehouse_bindings ${whereSql}`;
    const listSql = `
      SELECT ${BINDING_COLS}
        FROM item_warehouse_bindings
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<BindingRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToBinding),
      total: Number(countRes.rows[0]!.total),
    };
  },

  /**
   * UPSERT an item/warehouse binding. A single (item_id, warehouse_id) pair
   * has at most one binding per org; we key on that uniqueness to merge.
   */
  async upsertBinding(
    client: PoolClient,
    orgId: string,
    input: UpsertItemWarehouseBinding
  ): Promise<ItemWarehouseBinding> {
    const { rows } = await client.query<BindingRow>(
      `INSERT INTO item_warehouse_bindings (
         org_id, item_id, warehouse_id, reorder_level, reorder_qty,
         max_level, bin_location
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (org_id, item_id, warehouse_id) DO UPDATE
          SET reorder_level = EXCLUDED.reorder_level,
              reorder_qty   = EXCLUDED.reorder_qty,
              max_level     = EXCLUDED.max_level,
              bin_location  = EXCLUDED.bin_location,
              updated_at    = now()
       RETURNING ${BINDING_COLS}`,
      [
        orgId,
        input.itemId,
        input.warehouseId,
        input.reorderLevel ?? "0",
        input.reorderQty ?? "0",
        input.maxLevel ?? null,
        input.binLocation ?? null,
      ]
    );
    return rowToBinding(rows[0]!);
  },

  async deleteBinding(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM item_warehouse_bindings WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },
};
