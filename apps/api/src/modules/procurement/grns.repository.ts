/**
 * GRNs repository (header + lines).
 *
 * Posting flow happens in the service — this file just persists header
 * + line rows and exposes read methods.
 */

import type { PoolClient } from "pg";
import type {
  CreateGrn,
  CreateGrnLine,
  Grn,
  GrnLine,
  GrnLineQcStatus,
  GrnStatus,
  UpdateGrn,
  UpdateGrnLine,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Header ───────────────────────────────────────────────────────────────────

interface GrnRow {
  id: string;
  org_id: string;
  grn_number: string;
  po_id: string;
  vendor_id: string;
  warehouse_id: string;
  status: GrnStatus;
  received_date: Date;
  vehicle_number: string | null;
  invoice_number: string | null;
  invoice_date: Date | null;
  received_by: string | null;
  posted_by: string | null;
  posted_at: Date | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function rowToGrn(r: GrnRow): Grn {
  return {
    id: r.id,
    orgId: r.org_id,
    grnNumber: r.grn_number,
    poId: r.po_id,
    vendorId: r.vendor_id,
    warehouseId: r.warehouse_id,
    status: r.status,
    receivedDate: r.received_date.toISOString().slice(0, 10),
    vehicleNumber: r.vehicle_number,
    invoiceNumber: r.invoice_number,
    invoiceDate: isoDate(r.invoice_date),
    receivedBy: r.received_by,
    postedBy: r.posted_by,
    postedAt: r.posted_at ? r.posted_at.toISOString() : null,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, grn_number, po_id, vendor_id, warehouse_id,
                     status, received_date, vehicle_number, invoice_number,
                     invoice_date, received_by, posted_by, posted_at, notes,
                     version, created_at, updated_at, deleted_at`;

export interface GrnListFilters {
  status?: GrnStatus;
  poId?: string;
  vendorId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  search?: string;
}

// ── Lines ────────────────────────────────────────────────────────────────────

interface GrnLineRow {
  id: string;
  org_id: string;
  grn_id: string;
  po_line_id: string;
  line_no: number;
  item_id: string;
  quantity: string;
  uom: string;
  unit_cost: string;
  batch_no: string | null;
  serial_no: string | null;
  mfg_date: Date | null;
  expiry_date: Date | null;
  qc_status: GrnLineQcStatus | null;
  qc_rejected_qty: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToLine(r: GrnLineRow): GrnLine {
  return {
    id: r.id,
    orgId: r.org_id,
    grnId: r.grn_id,
    poLineId: r.po_line_id,
    lineNo: r.line_no,
    itemId: r.item_id,
    quantity: r.quantity,
    uom: r.uom,
    unitCost: r.unit_cost,
    batchNo: r.batch_no,
    serialNo: r.serial_no,
    mfgDate: isoDate(r.mfg_date),
    expiryDate: isoDate(r.expiry_date),
    qcStatus: r.qc_status,
    qcRejectedQty: r.qc_rejected_qty,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const LINE_COLS = `id, org_id, grn_id, po_line_id, line_no, item_id, quantity,
                   uom, unit_cost, batch_no, serial_no, mfg_date, expiry_date,
                   qc_status, qc_rejected_qty, notes, created_at, updated_at`;

// ── Repo ─────────────────────────────────────────────────────────────────────

export const grnsRepo = {
  // ── Header ─────────────────────────────────────────────────────────────────

  async list(
    client: PoolClient,
    filters: GrnListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Grn[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.poId) {
      where.push(`po_id = $${i}`);
      params.push(filters.poId);
      i++;
    }
    if (filters.vendorId) {
      where.push(`vendor_id = $${i}`);
      params.push(filters.vendorId);
      i++;
    }
    if (filters.warehouseId) {
      where.push(`warehouse_id = $${i}`);
      params.push(filters.warehouseId);
      i++;
    }
    if (filters.from) {
      where.push(`received_date >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`received_date <= $${i}::date`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(grn_number ILIKE $${i} OR invoice_number ILIKE $${i} OR notes ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM grns ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM grns
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<GrnRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToGrn),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Grn | null> {
    const { rows } = await client.query<GrnRow>(
      `SELECT ${SELECT_COLS} FROM grns
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToGrn(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    grnNumber: string,
    receivedByFallback: string | null,
    input: Omit<CreateGrn, "lines" | "grnNumber">
  ): Promise<Grn> {
    const { rows } = await client.query<GrnRow>(
      `INSERT INTO grns (
         org_id, grn_number, po_id, vendor_id, warehouse_id, status,
         received_date, vehicle_number, invoice_number, invoice_date,
         received_by, notes
       ) VALUES ($1,$2,$3,$4,$5,'DRAFT',COALESCE($6::date, current_date),
                 $7,$8,$9,$10,$11)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        grnNumber,
        input.poId,
        input.vendorId,
        input.warehouseId,
        input.receivedDate ?? null,
        input.vehicleNumber ?? null,
        input.invoiceNumber ?? null,
        input.invoiceDate ?? null,
        input.receivedBy ?? receivedByFallback,
        input.notes ?? null,
      ]
    );
    return rowToGrn(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateGrn
  ): Promise<Grn | "version_conflict" | null> {
    const cur = await grnsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.warehouseId !== undefined) col("warehouse_id", input.warehouseId);
    if (input.receivedDate !== undefined)
      col("received_date", input.receivedDate);
    if (input.vehicleNumber !== undefined)
      col("vehicle_number", input.vehicleNumber);
    if (input.invoiceNumber !== undefined)
      col("invoice_number", input.invoiceNumber);
    if (input.invoiceDate !== undefined) col("invoice_date", input.invoiceDate);
    if (input.receivedBy !== undefined) col("received_by", input.receivedBy);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<GrnRow>(
      `UPDATE grns SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToGrn(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE grns SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(`UPDATE grns SET updated_at = now() WHERE id = $1`, [
      id,
    ]);
  },

  async markPosted(
    client: PoolClient,
    id: string,
    postedBy: string
  ): Promise<Grn | null> {
    const { rows } = await client.query<GrnRow>(
      `UPDATE grns
          SET status = 'POSTED',
              posted_by = $2,
              posted_at = now(),
              updated_at = now()
        WHERE id = $1 AND status = 'DRAFT' AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [id, postedBy]
    );
    return rows[0] ? rowToGrn(rows[0]) : null;
  },

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(client: PoolClient, grnId: string): Promise<GrnLine[]> {
    const { rows } = await client.query<GrnLineRow>(
      `SELECT ${LINE_COLS} FROM grn_lines
        WHERE grn_id = $1 ORDER BY line_no ASC`,
      [grnId]
    );
    return rows.map(rowToLine);
  },

  async getLineById(
    client: PoolClient,
    id: string
  ): Promise<GrnLine | null> {
    const { rows } = await client.query<GrnLineRow>(
      `SELECT ${LINE_COLS} FROM grn_lines WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async nextLineNo(client: PoolClient, grnId: string): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(line_no), 0) + 1 AS next
         FROM grn_lines WHERE grn_id = $1`,
      [grnId]
    );
    return rows[0]!.next;
  },

  async addLine(
    client: PoolClient,
    orgId: string,
    grnId: string,
    input: CreateGrnLine
  ): Promise<GrnLine> {
    const lineNo =
      input.lineNo ?? (await grnsRepo.nextLineNo(client, grnId));
    const { rows } = await client.query<GrnLineRow>(
      `INSERT INTO grn_lines (
         org_id, grn_id, po_line_id, line_no, item_id, quantity, uom,
         unit_cost, batch_no, serial_no, mfg_date, expiry_date,
         qc_status, qc_rejected_qty, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${LINE_COLS}`,
      [
        orgId,
        grnId,
        input.poLineId,
        lineNo,
        input.itemId,
        input.quantity,
        input.uom,
        input.unitCost ?? "0",
        input.batchNo ?? null,
        input.serialNo ?? null,
        input.mfgDate ?? null,
        input.expiryDate ?? null,
        input.qcStatus ?? null,
        input.qcRejectedQty ?? "0",
        input.notes ?? null,
      ]
    );
    return rowToLine(rows[0]!);
  },

  async updateLine(
    client: PoolClient,
    lineId: string,
    input: UpdateGrnLine
  ): Promise<GrnLine | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.poLineId !== undefined) col("po_line_id", input.poLineId);
    if (input.itemId !== undefined) col("item_id", input.itemId);
    if (input.lineNo !== undefined) col("line_no", input.lineNo);
    if (input.quantity !== undefined) col("quantity", input.quantity);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.unitCost !== undefined) col("unit_cost", input.unitCost);
    if (input.batchNo !== undefined) col("batch_no", input.batchNo);
    if (input.serialNo !== undefined) col("serial_no", input.serialNo);
    if (input.mfgDate !== undefined) col("mfg_date", input.mfgDate);
    if (input.expiryDate !== undefined) col("expiry_date", input.expiryDate);
    if (input.qcStatus !== undefined) col("qc_status", input.qcStatus);
    if (input.qcRejectedQty !== undefined)
      col("qc_rejected_qty", input.qcRejectedQty);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return grnsRepo.getLineById(client, lineId);

    params.push(lineId);
    const { rows } = await client.query<GrnLineRow>(
      `UPDATE grn_lines SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${LINE_COLS}`,
      params
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async deleteLine(client: PoolClient, lineId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM grn_lines WHERE id = $1`,
      [lineId]
    );
    return (rowCount ?? 0) > 0;
  },
};
