/**
 * Indents repository (header + lines).
 *
 * Lines are stored in a sibling table, manipulated through dedicated
 * addLine/updateLine/deleteLine methods. The service layer bumps the
 * header.version + updated_at on line changes so the UI can pick up
 * the concurrency signal.
 */

import type { PoolClient } from "pg";
import type {
  CreateIndent,
  CreateIndentLine,
  Indent,
  IndentLine,
  IndentPriority,
  IndentStatus,
  UpdateIndent,
  UpdateIndentLine,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Header ───────────────────────────────────────────────────────────────────

interface IndentRow {
  id: string;
  org_id: string;
  indent_number: string;
  department: string | null;
  purpose: string | null;
  status: IndentStatus;
  priority: IndentPriority;
  required_by: Date | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToIndent(r: IndentRow): Indent {
  return {
    id: r.id,
    orgId: r.org_id,
    indentNumber: r.indent_number,
    department: r.department,
    purpose: r.purpose,
    status: r.status,
    priority: r.priority,
    requiredBy: r.required_by ? r.required_by.toISOString().slice(0, 10) : null,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, indent_number, department, purpose, status,
                     priority, required_by, requested_by, approved_by,
                     approved_at, notes, version, created_at, updated_at,
                     deleted_at`;

export interface IndentListFilters {
  status?: IndentStatus;
  priority?: IndentPriority;
  department?: string;
  requestedBy?: string;
  from?: string;
  to?: string;
  search?: string;
}

// ── Lines ────────────────────────────────────────────────────────────────────

interface IndentLineRow {
  id: string;
  org_id: string;
  indent_id: string;
  line_no: number;
  item_id: string;
  quantity: string;
  uom: string;
  estimated_cost: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToLine(r: IndentLineRow): IndentLine {
  return {
    id: r.id,
    orgId: r.org_id,
    indentId: r.indent_id,
    lineNo: r.line_no,
    itemId: r.item_id,
    quantity: r.quantity,
    uom: r.uom,
    estimatedCost: r.estimated_cost,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const LINE_COLS = `id, org_id, indent_id, line_no, item_id, quantity, uom,
                   estimated_cost, notes, created_at, updated_at`;

// ── Repo ─────────────────────────────────────────────────────────────────────

export const indentsRepo = {
  // ── Header ─────────────────────────────────────────────────────────────────

  async list(
    client: PoolClient,
    filters: IndentListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Indent[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.priority) {
      where.push(`priority = $${i}`);
      params.push(filters.priority);
      i++;
    }
    if (filters.department) {
      where.push(`department = $${i}`);
      params.push(filters.department);
      i++;
    }
    if (filters.requestedBy) {
      where.push(`requested_by = $${i}`);
      params.push(filters.requestedBy);
      i++;
    }
    if (filters.from) {
      where.push(`created_at >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`created_at < ($${i}::date + interval '1 day')`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(indent_number ILIKE $${i} OR purpose ILIKE $${i} OR department ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM indents ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM indents
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<IndentRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToIndent),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Indent | null> {
    const { rows } = await client.query<IndentRow>(
      `SELECT ${SELECT_COLS} FROM indents
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToIndent(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    indentNumber: string,
    requestedBy: string | null,
    input: Pick<
      CreateIndent,
      "department" | "purpose" | "priority" | "requiredBy" | "notes"
    >
  ): Promise<Indent> {
    const { rows } = await client.query<IndentRow>(
      `INSERT INTO indents (
         org_id, indent_number, department, purpose, status, priority,
         required_by, requested_by, notes
       ) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        indentNumber,
        input.department ?? null,
        input.purpose ?? null,
        input.priority ?? "NORMAL",
        input.requiredBy ?? null,
        requestedBy,
        input.notes ?? null,
      ]
    );
    return rowToIndent(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateIndent
  ): Promise<Indent | "version_conflict" | null> {
    const cur = await indentsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.department !== undefined) col("department", input.department);
    if (input.purpose !== undefined) col("purpose", input.purpose);
    if (input.status !== undefined) col("status", input.status);
    if (input.priority !== undefined) col("priority", input.priority);
    if (input.requiredBy !== undefined) col("required_by", input.requiredBy);
    if (input.requestedBy !== undefined)
      col("requested_by", input.requestedBy);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<IndentRow>(
      `UPDATE indents SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToIndent(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE indents SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Bump header.updated_at so the optimistic-lock version check on the
   * next UPDATE fires against the fresh value. Version itself is bumped
   * by the tg_bump_version trigger.
   */
  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(`UPDATE indents SET updated_at = now() WHERE id = $1`, [
      id,
    ]);
  },

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(
    client: PoolClient,
    indentId: string
  ): Promise<IndentLine[]> {
    const { rows } = await client.query<IndentLineRow>(
      `SELECT ${LINE_COLS} FROM indent_lines
        WHERE indent_id = $1 ORDER BY line_no ASC`,
      [indentId]
    );
    return rows.map(rowToLine);
  },

  async getLineById(
    client: PoolClient,
    id: string
  ): Promise<IndentLine | null> {
    const { rows } = await client.query<IndentLineRow>(
      `SELECT ${LINE_COLS} FROM indent_lines WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async addLine(
    client: PoolClient,
    orgId: string,
    indentId: string,
    input: CreateIndentLine
  ): Promise<IndentLine> {
    const lineNo = input.lineNo ?? (await indentsRepo.nextLineNo(client, indentId));
    const { rows } = await client.query<IndentLineRow>(
      `INSERT INTO indent_lines (
         org_id, indent_id, line_no, item_id, quantity, uom,
         estimated_cost, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${LINE_COLS}`,
      [
        orgId,
        indentId,
        lineNo,
        input.itemId,
        input.quantity,
        input.uom,
        input.estimatedCost ?? "0",
        input.notes ?? null,
      ]
    );
    return rowToLine(rows[0]!);
  },

  async updateLine(
    client: PoolClient,
    lineId: string,
    input: UpdateIndentLine
  ): Promise<IndentLine | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.itemId !== undefined) col("item_id", input.itemId);
    if (input.lineNo !== undefined) col("line_no", input.lineNo);
    if (input.quantity !== undefined) col("quantity", input.quantity);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.estimatedCost !== undefined)
      col("estimated_cost", input.estimatedCost);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return indentsRepo.getLineById(client, lineId);

    params.push(lineId);
    const { rows } = await client.query<IndentLineRow>(
      `UPDATE indent_lines SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${LINE_COLS}`,
      params
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async deleteLine(client: PoolClient, lineId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM indent_lines WHERE id = $1`,
      [lineId]
    );
    return (rowCount ?? 0) > 0;
  },

  async nextLineNo(
    client: PoolClient,
    indentId: string
  ): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(line_no), 0) + 1 AS next
         FROM indent_lines WHERE indent_id = $1`,
      [indentId]
    );
    return rows[0]!.next;
  },
};
