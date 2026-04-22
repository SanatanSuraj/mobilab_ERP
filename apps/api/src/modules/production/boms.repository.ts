/**
 * BOMs (bill-of-materials) repository. Header (bom_versions) + lines (bom_lines).
 *
 * The `recomputeTotals()` helper rolls up bom_lines.std_unit_cost × qty_per_unit
 * into bom_versions.total_std_cost so the header stays in lockstep — called
 * after every line mutation + on header activation.
 *
 * `setStatus()` is used by the service's activate() orchestration; it flips
 * status atomically inside the BOMs service transaction (the partial unique
 * index `bom_versions_one_active_per_product` enforces invariants at the DB
 * level in case two concurrent writers race).
 */

import type { PoolClient } from "pg";
import type {
  BomLine,
  BomLineTrackingType,
  BomStatus,
  BomVersion,
  CreateBomLine,
  CreateBomVersion,
  UpdateBomLine,
  UpdateBomVersion,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Header ───────────────────────────────────────────────────────────────────

interface BomVersionRow {
  id: string;
  org_id: string;
  product_id: string;
  version_label: string;
  status: BomStatus;
  effective_from: Date | null;
  effective_to: Date | null;
  total_std_cost: string;
  ecn_ref: string | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function rowToBomVersion(r: BomVersionRow): BomVersion {
  return {
    id: r.id,
    orgId: r.org_id,
    productId: r.product_id,
    versionLabel: r.version_label,
    status: r.status,
    effectiveFrom: isoDate(r.effective_from),
    effectiveTo: isoDate(r.effective_to),
    totalStdCost: r.total_std_cost,
    ecnRef: r.ecn_ref,
    notes: r.notes,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, product_id, version_label, status,
                     effective_from, effective_to, total_std_cost, ecn_ref,
                     notes, created_by, approved_by, approved_at, version,
                     created_at, updated_at, deleted_at`;

export interface BomListFilters {
  productId?: string;
  status?: BomStatus;
  search?: string;
}

// ── Lines ────────────────────────────────────────────────────────────────────

interface BomLineRow {
  id: string;
  org_id: string;
  bom_id: string;
  line_no: number;
  component_item_id: string;
  qty_per_unit: string;
  uom: string;
  reference_designator: string | null;
  is_critical: boolean;
  tracking_type: BomLineTrackingType;
  lead_time_days: number;
  std_unit_cost: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToBomLine(r: BomLineRow): BomLine {
  return {
    id: r.id,
    orgId: r.org_id,
    bomId: r.bom_id,
    lineNo: r.line_no,
    componentItemId: r.component_item_id,
    qtyPerUnit: r.qty_per_unit,
    uom: r.uom,
    referenceDesignator: r.reference_designator,
    isCritical: r.is_critical,
    trackingType: r.tracking_type,
    leadTimeDays: r.lead_time_days,
    stdUnitCost: r.std_unit_cost,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const LINE_COLS = `id, org_id, bom_id, line_no, component_item_id,
                   qty_per_unit, uom, reference_designator, is_critical,
                   tracking_type, lead_time_days, std_unit_cost, notes,
                   created_at, updated_at`;

// ── Repo ─────────────────────────────────────────────────────────────────────

export const bomsRepo = {
  // ── Header ─────────────────────────────────────────────────────────────────

  async list(
    client: PoolClient,
    filters: BomListFilters,
    plan: PaginationPlan
  ): Promise<{ data: BomVersion[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.productId) {
      where.push(`product_id = $${i}`);
      params.push(filters.productId);
      i++;
    }
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.search) {
      where.push(
        `(version_label ILIKE $${i} OR ecn_ref ILIKE $${i} OR notes ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM bom_versions ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM bom_versions
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<BomVersionRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToBomVersion),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string
  ): Promise<BomVersion | null> {
    const { rows } = await client.query<BomVersionRow>(
      `SELECT ${SELECT_COLS} FROM bom_versions
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToBomVersion(rows[0]) : null;
  },

  /** Returns the ACTIVE BOM for a product, if any. */
  async getActiveForProduct(
    client: PoolClient,
    productId: string
  ): Promise<BomVersion | null> {
    const { rows } = await client.query<BomVersionRow>(
      `SELECT ${SELECT_COLS} FROM bom_versions
        WHERE product_id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL
        LIMIT 1`,
      [productId]
    );
    return rows[0] ? rowToBomVersion(rows[0]) : null;
  },

  async getByProductAndLabel(
    client: PoolClient,
    productId: string,
    versionLabel: string
  ): Promise<BomVersion | null> {
    const { rows } = await client.query<BomVersionRow>(
      `SELECT ${SELECT_COLS} FROM bom_versions
        WHERE product_id = $1 AND version_label = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [productId, versionLabel]
    );
    return rows[0] ? rowToBomVersion(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    createdBy: string | null,
    input: Omit<CreateBomVersion, "lines">
  ): Promise<BomVersion> {
    const { rows } = await client.query<BomVersionRow>(
      `INSERT INTO bom_versions (
         org_id, product_id, version_label, status, effective_from,
         effective_to, ecn_ref, notes, created_by
       ) VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.productId,
        input.versionLabel,
        input.effectiveFrom ?? null,
        input.effectiveTo ?? null,
        input.ecnRef ?? null,
        input.notes ?? null,
        createdBy,
      ]
    );
    return rowToBomVersion(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateBomVersion
  ): Promise<BomVersion | "version_conflict" | null> {
    const cur = await bomsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.versionLabel !== undefined)
      col("version_label", input.versionLabel);
    if (input.status !== undefined) col("status", input.status);
    if (input.effectiveFrom !== undefined)
      col("effective_from", input.effectiveFrom);
    if (input.effectiveTo !== undefined)
      col("effective_to", input.effectiveTo);
    if (input.ecnRef !== undefined) col("ecn_ref", input.ecnRef);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<BomVersionRow>(
      `UPDATE bom_versions SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToBomVersion(rows[0]);
  },

  /** Service-layer-only: flip status atomically. */
  async setStatus(
    client: PoolClient,
    id: string,
    status: BomStatus,
    approvedBy: string | null = null
  ): Promise<BomVersion | null> {
    const approveFields =
      status === "ACTIVE" && approvedBy !== null
        ? `, approved_by = $3, approved_at = now()`
        : "";
    const params: unknown[] =
      status === "ACTIVE" && approvedBy !== null
        ? [id, status, approvedBy]
        : [id, status];
    const { rows } = await client.query<BomVersionRow>(
      `UPDATE bom_versions
          SET status = $2,
              updated_at = now()
              ${approveFields}
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    return rows[0] ? rowToBomVersion(rows[0]) : null;
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE bom_versions SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `UPDATE bom_versions SET updated_at = now() WHERE id = $1`,
      [id]
    );
  },

  /**
   * Recompute total_std_cost from the current bom_lines. Cost model:
   *   sum(line.qty_per_unit * line.std_unit_cost)
   * Rounded to NUMERIC(18,2).
   */
  async recomputeTotals(client: PoolClient, bomId: string): Promise<void> {
    await client.query(
      `UPDATE bom_versions
          SET total_std_cost = COALESCE(agg.total, 0)::numeric(18,2),
              updated_at = now()
         FROM (
           SELECT SUM(qty_per_unit * std_unit_cost) AS total
             FROM bom_lines
            WHERE bom_id = $1
         ) agg
        WHERE id = $1`,
      [bomId]
    );
  },

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(client: PoolClient, bomId: string): Promise<BomLine[]> {
    const { rows } = await client.query<BomLineRow>(
      `SELECT ${LINE_COLS} FROM bom_lines
        WHERE bom_id = $1 ORDER BY line_no ASC`,
      [bomId]
    );
    return rows.map(rowToBomLine);
  },

  async getLineById(client: PoolClient, id: string): Promise<BomLine | null> {
    const { rows } = await client.query<BomLineRow>(
      `SELECT ${LINE_COLS} FROM bom_lines WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToBomLine(rows[0]) : null;
  },

  async nextLineNo(client: PoolClient, bomId: string): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(line_no), 0) + 1 AS next
         FROM bom_lines WHERE bom_id = $1`,
      [bomId]
    );
    return rows[0]!.next;
  },

  async addLine(
    client: PoolClient,
    orgId: string,
    bomId: string,
    input: CreateBomLine
  ): Promise<BomLine> {
    const lineNo =
      input.lineNo ?? (await bomsRepo.nextLineNo(client, bomId));
    const { rows } = await client.query<BomLineRow>(
      `INSERT INTO bom_lines (
         org_id, bom_id, line_no, component_item_id, qty_per_unit, uom,
         reference_designator, is_critical, tracking_type, lead_time_days,
         std_unit_cost, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${LINE_COLS}`,
      [
        orgId,
        bomId,
        lineNo,
        input.componentItemId,
        input.qtyPerUnit,
        input.uom,
        input.referenceDesignator ?? null,
        input.isCritical ?? false,
        input.trackingType ?? "NONE",
        input.leadTimeDays ?? 0,
        input.stdUnitCost ?? "0",
        input.notes ?? null,
      ]
    );
    return rowToBomLine(rows[0]!);
  },

  async updateLine(
    client: PoolClient,
    lineId: string,
    input: UpdateBomLine
  ): Promise<BomLine | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.componentItemId !== undefined)
      col("component_item_id", input.componentItemId);
    if (input.lineNo !== undefined) col("line_no", input.lineNo);
    if (input.qtyPerUnit !== undefined) col("qty_per_unit", input.qtyPerUnit);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.referenceDesignator !== undefined)
      col("reference_designator", input.referenceDesignator);
    if (input.isCritical !== undefined) col("is_critical", input.isCritical);
    if (input.trackingType !== undefined)
      col("tracking_type", input.trackingType);
    if (input.leadTimeDays !== undefined)
      col("lead_time_days", input.leadTimeDays);
    if (input.stdUnitCost !== undefined) col("std_unit_cost", input.stdUnitCost);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return bomsRepo.getLineById(client, lineId);

    params.push(lineId);
    const { rows } = await client.query<BomLineRow>(
      `UPDATE bom_lines SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${LINE_COLS}`,
      params
    );
    return rows[0] ? rowToBomLine(rows[0]) : null;
  },

  async deleteLine(client: PoolClient, lineId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM bom_lines WHERE id = $1`,
      [lineId]
    );
    return (rowCount ?? 0) > 0;
  },
};
