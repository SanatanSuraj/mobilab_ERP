/**
 * Stock reservations repository.
 *
 * Thin wrapper over three Postgres stored functions defined in
 * ops/sql/init/03-inventory.sql:
 *
 *   reserve_stock_atomic(org, item, wh, qty, uom, ref_type, ref_id, line, by)
 *     → uuid (reservation id)
 *   release_stock_reservation(res_id, by)               → void
 *   consume_stock_reservation(res_id, by, batch?, serial?, unitCost?) → uuid
 *                                                          (new ledger row id)
 *
 * The functions own the concurrency logic (FOR UPDATE NOWAIT, summary
 * counter updates). This repo just marshals arguments and re-throws
 * Postgres errors so the service layer can classify them by SQLSTATE.
 *
 * Custom SQLSTATEs to know about:
 *   UR001 — insufficient stock (becomes ShortageError)
 *   UR002 — reservation not ACTIVE (becomes StateTransitionError)
 *   55P03 — lock_not_available (service retries with backoff)
 *   40P01 — deadlock_detected  (service retries with backoff)
 */

import type { PoolClient } from "pg";
import type {
  ReservationStatus,
  StockReservation,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface ReservationRow {
  id: string;
  org_id: string;
  item_id: string;
  warehouse_id: string;
  quantity: string;
  uom: string;
  status: ReservationStatus;
  ref_doc_type: string;
  ref_doc_id: string;
  ref_line_id: string | null;
  reserved_by: string | null;
  reserved_at: Date;
  released_at: Date | null;
  released_by: string | null;
  consumed_at: Date | null;
  consumed_by: string | null;
  consumed_ledger_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToReservation(r: ReservationRow): StockReservation {
  return {
    id: r.id,
    orgId: r.org_id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    quantity: r.quantity,
    uom: r.uom as StockReservation["uom"],
    status: r.status,
    refDocType: r.ref_doc_type,
    refDocId: r.ref_doc_id,
    refLineId: r.ref_line_id,
    reservedBy: r.reserved_by,
    reservedAt: r.reserved_at.toISOString(),
    releasedAt: r.released_at ? r.released_at.toISOString() : null,
    releasedBy: r.released_by,
    consumedAt: r.consumed_at ? r.consumed_at.toISOString() : null,
    consumedBy: r.consumed_by,
    consumedLedgerId: r.consumed_ledger_id,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const RESERVATION_COLS = `id, org_id, item_id, warehouse_id, quantity, uom,
                          status, ref_doc_type, ref_doc_id, ref_line_id,
                          reserved_by, reserved_at, released_at, released_by,
                          consumed_at, consumed_by, consumed_ledger_id, notes,
                          created_at, updated_at`;

export interface ReservationListFilters {
  itemId?: string;
  warehouseId?: string;
  status?: ReservationStatus;
  refDocType?: string;
  refDocId?: string;
}

export interface ReservationLineInput {
  itemId: string;
  warehouseId: string;
  quantity: string;
  uom: string;
  refLineId?: string | undefined;
}

export const reservationsRepo = {
  /**
   * Invoke reserve_stock_atomic. The SQL function locks the summary row
   * with FOR UPDATE NOWAIT, checks available, inserts the reservation
   * row, and updates the counters — all in the current transaction.
   *
   * Throws raw pg.DatabaseError on SQLSTATE conditions; the service
   * layer catches `55P03`/`40P01` (retry), `UR001` (shortage),
   * `UR002` (already released/consumed).
   */
  async reserveAtomic(
    client: PoolClient,
    args: {
      orgId: string;
      itemId: string;
      warehouseId: string;
      quantity: string;
      uom: string;
      refDocType: string;
      refDocId: string;
      refLineId: string | null;
      reservedBy: string;
    }
  ): Promise<string> {
    const { rows } = await client.query<{ reserve_stock_atomic: string }>(
      `SELECT reserve_stock_atomic(
         $1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::text,
         $6::text, $7::uuid, $8::uuid, $9::uuid
       ) AS reserve_stock_atomic`,
      [
        args.orgId,
        args.itemId,
        args.warehouseId,
        args.quantity,
        args.uom,
        args.refDocType,
        args.refDocId,
        args.refLineId,
        args.reservedBy,
      ]
    );
    return rows[0]!.reserve_stock_atomic;
  },

  async release(
    client: PoolClient,
    reservationId: string,
    releasedBy: string
  ): Promise<void> {
    await client.query(
      `SELECT release_stock_reservation($1::uuid, $2::uuid)`,
      [reservationId, releasedBy]
    );
  },

  async consume(
    client: PoolClient,
    reservationId: string,
    consumedBy: string,
    opts?: {
      batchNo?: string | undefined;
      serialNo?: string | undefined;
      unitCost?: string | undefined;
    }
  ): Promise<string> {
    const { rows } = await client.query<{ consume_stock_reservation: string }>(
      `SELECT consume_stock_reservation(
         $1::uuid, $2::uuid, $3::text, $4::text, $5::numeric
       ) AS consume_stock_reservation`,
      [
        reservationId,
        consumedBy,
        opts?.batchNo ?? null,
        opts?.serialNo ?? null,
        opts?.unitCost ?? null,
      ]
    );
    return rows[0]!.consume_stock_reservation;
  },

  /**
   * Bulk release every ACTIVE reservation tagged with a given ref doc.
   * The SQL function sorts by id before releasing so two concurrent
   * bulk-releases of the same doc acquire locks in the same order →
   * no deadlock.
   */
  async releaseByRef(
    client: PoolClient,
    orgId: string,
    refDocType: string,
    refDocId: string,
    releasedBy: string
  ): Promise<number> {
    const { rows } = await client.query<{
      release_stock_reservations_by_ref: number;
    }>(
      `SELECT release_stock_reservations_by_ref(
         $1::uuid, $2::text, $3::uuid, $4::uuid
       ) AS release_stock_reservations_by_ref`,
      [orgId, refDocType, refDocId, releasedBy]
    );
    return Number(rows[0]!.release_stock_reservations_by_ref);
  },

  async getById(
    client: PoolClient,
    id: string
  ): Promise<StockReservation | null> {
    const { rows } = await client.query<ReservationRow>(
      `SELECT ${RESERVATION_COLS}
         FROM stock_reservations
        WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToReservation(rows[0]) : null;
  },

  async list(
    client: PoolClient,
    filters: ReservationListFilters,
    plan: PaginationPlan
  ): Promise<{ data: StockReservation[]; total: number }> {
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
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
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
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countSql = `SELECT count(*)::bigint AS total FROM stock_reservations ${whereSql}`;
    const listSql = `
      SELECT ${RESERVATION_COLS}
        FROM stock_reservations
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<ReservationRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToReservation),
      total: Number(countRes.rows[0]!.total),
    };
  },
};
