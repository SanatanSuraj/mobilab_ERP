/**
 * ECN repository — engineering_change_notices.
 *
 * Phase-5 read-only register. The list query left-joins products + bom_versions
 * so the page can show "affecting <product>@<bomLabel>" without the page firing
 * extra requests.
 */

import type { PoolClient } from "pg";
import type {
  CreateEcn,
  EcnChangeType,
  EcnSeverity,
  EcnStatus,
  EngineeringChangeNotice,
  UpdateEcn,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface EcnRow {
  id: string;
  org_id: string;
  ecn_number: string;
  title: string;
  description: string | null;
  change_type: EcnChangeType;
  severity: EcnSeverity;
  status: EcnStatus;
  affected_product_id: string | null;
  affected_product_code: string | null;
  affected_product_name: string | null;
  affected_bom_id: string | null;
  affected_bom_version_label: string | null;
  reason: string | null;
  proposed_change: string | null;
  impact_summary: string | null;
  raised_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  implemented_at: Date | null;
  target_implementation_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToEcn(r: EcnRow): EngineeringChangeNotice {
  return {
    id: r.id,
    orgId: r.org_id,
    ecnNumber: r.ecn_number,
    title: r.title,
    description: r.description,
    changeType: r.change_type,
    severity: r.severity,
    status: r.status,
    affectedProductId: r.affected_product_id,
    affectedProductCode: r.affected_product_code,
    affectedProductName: r.affected_product_name,
    affectedBomId: r.affected_bom_id,
    affectedBomVersionLabel: r.affected_bom_version_label,
    reason: r.reason,
    proposedChange: r.proposed_change,
    impactSummary: r.impact_summary,
    raisedBy: r.raised_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    implementedAt: r.implemented_at ? r.implemented_at.toISOString() : null,
    targetImplementationDate: r.target_implementation_date
      ? r.target_implementation_date.toISOString().slice(0, 10)
      : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const ECN_SELECT = `
  e.id, e.org_id, e.ecn_number, e.title, e.description, e.change_type,
  e.severity, e.status, e.affected_product_id,
  p.product_code AS affected_product_code,
  p.name         AS affected_product_name,
  e.affected_bom_id,
  b.version_label AS affected_bom_version_label,
  e.reason, e.proposed_change, e.impact_summary,
  e.raised_by, e.approved_by, e.approved_at, e.implemented_at,
  e.target_implementation_date, e.created_at, e.updated_at
`;

const ECN_FROM = `
  FROM engineering_change_notices e
  LEFT JOIN products p     ON p.id = e.affected_product_id
  LEFT JOIN bom_versions b ON b.id = e.affected_bom_id
`;

export interface EcnListFilters {
  status?: EcnStatus;
  severity?: EcnSeverity;
  changeType?: EcnChangeType;
  affectedProductId?: string;
  search?: string;
}

export const ecnsRepo = {
  async list(
    client: PoolClient,
    filters: EcnListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: EngineeringChangeNotice[]; total: number }> {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`e.status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.severity) {
      where.push(`e.severity = $${i}`);
      params.push(filters.severity);
      i++;
    }
    if (filters.changeType) {
      where.push(`e.change_type = $${i}`);
      params.push(filters.changeType);
      i++;
    }
    if (filters.affectedProductId) {
      where.push(`e.affected_product_id = $${i}`);
      params.push(filters.affectedProductId);
      i++;
    }
    if (filters.search) {
      where.push(
        `(e.ecn_number ILIKE $${i} OR e.title ILIKE $${i} OR p.product_code ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total ${ECN_FROM} ${whereSql}`;
    const listSql = `
      SELECT ${ECN_SELECT}
       ${ECN_FROM}
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<EcnRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToEcn),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<EngineeringChangeNotice | null> {
    const { rows } = await client.query<EcnRow>(
      `SELECT ${ECN_SELECT} ${ECN_FROM} WHERE e.id = $1`,
      [id],
    );
    return rows[0] ? rowToEcn(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    ecnNumber: string,
    body: CreateEcn,
  ): Promise<EngineeringChangeNotice> {
    // Insert returns just the base row; re-select via getById so the
    // affected_product_code / bom_version_label joins resolve consistently.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO engineering_change_notices (
         org_id, ecn_number, title, description, change_type, severity,
         status, affected_product_id, affected_bom_id, reason,
         proposed_change, impact_summary, raised_by, target_implementation_date
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         'DRAFT', $7, $8, $9,
         $10, $11, $12, $13
       )
       RETURNING id`,
      [
        orgId,
        ecnNumber,
        body.title,
        body.description ?? null,
        body.changeType,
        body.severity ?? "MEDIUM",
        body.affectedProductId ?? null,
        body.affectedBomId ?? null,
        body.reason ?? null,
        body.proposedChange ?? null,
        body.impactSummary ?? null,
        body.raisedBy ?? null,
        body.targetImplementationDate ?? null,
      ],
    );
    const created = await this.getById(client, rows[0]!.id);
    if (!created) {
      // Belt-and-braces — the row was just inserted, so this is unreachable
      // unless RLS rejects the read after the write.
      throw new Error("ecn-create-readback-failed");
    }
    return created;
  },

  async update(
    client: PoolClient,
    id: string,
    body: UpdateEcn,
  ): Promise<EngineeringChangeNotice | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    function add(col: string, value: unknown) {
      sets.push(`${col} = $${i}`);
      params.push(value);
      i++;
    }
    if (body.title !== undefined) add("title", body.title);
    if (body.description !== undefined) add("description", body.description);
    if (body.changeType !== undefined) add("change_type", body.changeType);
    if (body.severity !== undefined) add("severity", body.severity);
    if (body.affectedProductId !== undefined)
      add("affected_product_id", body.affectedProductId);
    if (body.affectedBomId !== undefined)
      add("affected_bom_id", body.affectedBomId);
    if (body.reason !== undefined) add("reason", body.reason);
    if (body.proposedChange !== undefined)
      add("proposed_change", body.proposedChange);
    if (body.impactSummary !== undefined)
      add("impact_summary", body.impactSummary);
    if (body.raisedBy !== undefined) add("raised_by", body.raisedBy);
    if (body.targetImplementationDate !== undefined)
      add("target_implementation_date", body.targetImplementationDate);

    if (sets.length === 0) {
      return this.getById(client, id);
    }
    sets.push(`updated_at = now()`);
    params.push(id);
    const { rowCount } = await client.query(
      `UPDATE engineering_change_notices
         SET ${sets.join(", ")}
       WHERE id = $${i}`,
      params,
    );
    if (rowCount === 0) return null;
    return this.getById(client, id);
  },

  /**
   * Apply a status transition. Stamps approved_at / implemented_at as a
   * side-effect when the new status warrants it. The repo trusts that the
   * service has already validated the move (FROM → TO).
   */
  async transition(
    client: PoolClient,
    id: string,
    toStatus: EcnStatus,
    approvedBy: string | null,
  ): Promise<EngineeringChangeNotice | null> {
    const sets: string[] = ["status = $1", "updated_at = now()"];
    const params: unknown[] = [toStatus];
    let i = 2;
    if (toStatus === "APPROVED") {
      sets.push(`approved_at = now()`);
      sets.push(`approved_by = $${i}`);
      params.push(approvedBy);
      i++;
    } else if (toStatus === "IMPLEMENTED") {
      sets.push(`implemented_at = now()`);
    }
    params.push(id);
    const { rowCount } = await client.query(
      `UPDATE engineering_change_notices
         SET ${sets.join(", ")}
       WHERE id = $${i}`,
      params,
    );
    if (rowCount === 0) return null;
    return this.getById(client, id);
  },

  async findByNumber(
    client: PoolClient,
    orgId: string,
    ecnNumber: string,
  ): Promise<EngineeringChangeNotice | null> {
    const { rows } = await client.query<EcnRow>(
      `SELECT ${ECN_SELECT} ${ECN_FROM}
        WHERE e.org_id = $1 AND lower(e.ecn_number) = lower($2)
        LIMIT 1`,
      [orgId, ecnNumber],
    );
    return rows[0] ? rowToEcn(rows[0]) : null;
  },
};
