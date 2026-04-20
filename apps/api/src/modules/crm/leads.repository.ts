/**
 * Leads repository. Includes:
 *   - standard CRUD
 *   - findDuplicate(email, phone) for lead dedup (status != LOST and != CONVERTED)
 *   - insertActivity + listActivities for the append-only activity feed
 *   - markConverted(leadId, dealId, accountId?) — used by convertLead() service
 *   - markLost(leadId, reason)
 */

import type { PoolClient } from "pg";
import type {
  CreateLead,
  Lead,
  LeadActivity,
  LeadActivityType,
  LeadStatus,
  UpdateLead,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface LeadRow {
  id: string;
  org_id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: LeadStatus;
  source: string | null;
  assigned_to: string | null;
  estimated_value: string;
  is_duplicate: boolean;
  duplicate_of_lead_id: string | null;
  converted_to_account_id: string | null;
  converted_to_deal_id: string | null;
  lost_reason: string | null;
  last_activity_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToLead(r: LeadRow): Lead {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    company: r.company,
    email: r.email,
    phone: r.phone,
    status: r.status,
    source: r.source,
    assignedTo: r.assigned_to,
    estimatedValue: r.estimated_value,
    isDuplicate: r.is_duplicate,
    duplicateOfLeadId: r.duplicate_of_lead_id,
    convertedToAccountId: r.converted_to_account_id,
    convertedToDealId: r.converted_to_deal_id,
    lostReason: r.lost_reason,
    lastActivityAt: r.last_activity_at ? r.last_activity_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, name, company, email, phone, status, source,
                     assigned_to, estimated_value, is_duplicate,
                     duplicate_of_lead_id, converted_to_account_id,
                     converted_to_deal_id, lost_reason, last_activity_at,
                     created_at, updated_at, deleted_at`;

interface LeadActivityRow {
  id: string;
  org_id: string;
  lead_id: string;
  type: LeadActivityType;
  content: string;
  actor_id: string | null;
  created_at: Date;
}

function rowToActivity(r: LeadActivityRow): LeadActivity {
  return {
    id: r.id,
    orgId: r.org_id,
    leadId: r.lead_id,
    type: r.type,
    content: r.content,
    actorId: r.actor_id,
    createdAt: r.created_at.toISOString(),
  };
}

export interface LeadListFilters {
  status?: LeadStatus;
  assignedTo?: string;
  search?: string;
}

export const leadsRepo = {
  async list(
    client: PoolClient,
    filters: LeadListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Lead[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.assignedTo) {
      where.push(`assigned_to = $${i}`);
      params.push(filters.assignedTo);
      i++;
    }
    if (filters.search) {
      where.push(
        `(name ILIKE $${i} OR company ILIKE $${i} OR email ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM leads ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM leads
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<LeadRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToLead),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Lead | null> {
    const { rows } = await client.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM leads
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToLead(rows[0]) : null;
  },

  /**
   * Dedup lookup: "same email OR same phone, still in the active funnel".
   * Returns the most recent match so the service can flag `is_duplicate=true`
   * and set `duplicate_of_lead_id`.
   */
  async findDuplicate(
    client: PoolClient,
    email: string,
    phone: string
  ): Promise<Lead | null> {
    const { rows } = await client.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM leads
        WHERE deleted_at IS NULL
          AND status NOT IN ('CONVERTED', 'LOST')
          AND (lower(email) = lower($1) OR phone = $2)
        ORDER BY created_at DESC
        LIMIT 1`,
      [email, phone]
    );
    return rows[0] ? rowToLead(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateLead,
    dedup: { isDuplicate: boolean; duplicateOfLeadId: string | null }
  ): Promise<Lead> {
    const { rows } = await client.query<LeadRow>(
      `INSERT INTO leads (
         org_id, name, company, email, phone, source, assigned_to,
         estimated_value, is_duplicate, duplicate_of_lead_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.name,
        input.company,
        input.email,
        input.phone,
        input.source ?? null,
        input.assignedTo ?? null,
        input.estimatedValue ?? "0",
        dedup.isDuplicate,
        dedup.duplicateOfLeadId,
      ]
    );
    return rowToLead(rows[0]!);
  },

  async update(
    client: PoolClient,
    id: string,
    input: UpdateLead
  ): Promise<Lead | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.name !== undefined) col("name", input.name);
    if (input.company !== undefined) col("company", input.company);
    if (input.email !== undefined) col("email", input.email);
    if (input.phone !== undefined) col("phone", input.phone);
    if (input.source !== undefined) col("source", input.source);
    if (input.assignedTo !== undefined) col("assigned_to", input.assignedTo);
    if (input.estimatedValue !== undefined)
      col("estimated_value", input.estimatedValue);
    if (sets.length === 0) return leadsRepo.getById(client, id);
    params.push(id);
    const { rows } = await client.query<LeadRow>(
      `UPDATE leads SET ${sets.join(", ")}
        WHERE id = $${i} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    return rows[0] ? rowToLead(rows[0]) : null;
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE leads SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  /** status-only update — used on CONTACTED/QUALIFIED transitions. */
  async setStatus(
    client: PoolClient,
    id: string,
    status: LeadStatus
  ): Promise<Lead | null> {
    const { rows } = await client.query<LeadRow>(
      `UPDATE leads SET status = $1
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [status, id]
    );
    return rows[0] ? rowToLead(rows[0]) : null;
  },

  async markConverted(
    client: PoolClient,
    id: string,
    accountId: string | null,
    dealId: string
  ): Promise<Lead | null> {
    const { rows } = await client.query<LeadRow>(
      `UPDATE leads
          SET status = 'CONVERTED',
              converted_to_account_id = $1,
              converted_to_deal_id = $2
        WHERE id = $3 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [accountId, dealId, id]
    );
    return rows[0] ? rowToLead(rows[0]) : null;
  },

  async markLost(
    client: PoolClient,
    id: string,
    reason: string
  ): Promise<Lead | null> {
    const { rows } = await client.query<LeadRow>(
      `UPDATE leads SET status = 'LOST', lost_reason = $1
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [reason, id]
    );
    return rows[0] ? rowToLead(rows[0]) : null;
  },

  // ─── Activities ────────────────────────────────────────────────────────────

  async insertActivity(
    client: PoolClient,
    args: {
      orgId: string;
      leadId: string;
      type: LeadActivityType;
      content: string;
      actorId: string | null;
    }
  ): Promise<LeadActivity> {
    const { rows } = await client.query<LeadActivityRow>(
      `INSERT INTO lead_activities (org_id, lead_id, type, content, actor_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, org_id, lead_id, type, content, actor_id, created_at`,
      [args.orgId, args.leadId, args.type, args.content, args.actorId]
    );
    // Bump last_activity_at on the lead so list views can sort by it.
    await client.query(
      `UPDATE leads SET last_activity_at = now() WHERE id = $1`,
      [args.leadId]
    );
    return rowToActivity(rows[0]!);
  },

  async listActivities(
    client: PoolClient,
    leadId: string
  ): Promise<LeadActivity[]> {
    const { rows } = await client.query<LeadActivityRow>(
      `SELECT id, org_id, lead_id, type, content, actor_id, created_at
         FROM lead_activities
        WHERE lead_id = $1
        ORDER BY created_at DESC`,
      [leadId]
    );
    return rows.map(rowToActivity);
  },
};
