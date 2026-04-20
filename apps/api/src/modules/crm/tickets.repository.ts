/**
 * Tickets repository. Structurally identical to deals:
 *   - nextTicketNumber(orgId, year)            TK-YYYY-NNNN
 *   - updateWithVersion                        optimistic concurrency
 *   - transitionStatus                         sets resolved_at on RESOLVED
 *
 * Plus ticket_comments helpers (insert + list).
 */

import type { PoolClient } from "pg";
import type {
  AddTicketComment,
  CreateTicket,
  Ticket,
  TicketCategory,
  TicketComment,
  TicketCommentVisibility,
  TicketPriority,
  TicketStatus,
  UpdateTicket,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface TicketRow {
  id: string;
  org_id: string;
  ticket_number: string;
  account_id: string | null;
  contact_id: string | null;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  device_serial: string | null;
  product_code: string | null;
  assigned_to: string | null;
  sla_deadline: Date | null;
  resolved_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    orgId: r.org_id,
    ticketNumber: r.ticket_number,
    accountId: r.account_id,
    contactId: r.contact_id,
    subject: r.subject,
    description: r.description,
    category: r.category,
    priority: r.priority,
    status: r.status,
    deviceSerial: r.device_serial,
    productCode: r.product_code,
    assignedTo: r.assigned_to,
    slaDeadline: r.sla_deadline ? r.sla_deadline.toISOString() : null,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, ticket_number, account_id, contact_id,
                     subject, description, category, priority, status,
                     device_serial, product_code, assigned_to, sla_deadline,
                     resolved_at, version, created_at, updated_at, deleted_at`;

interface TicketCommentRow {
  id: string;
  org_id: string;
  ticket_id: string;
  visibility: TicketCommentVisibility;
  actor_id: string | null;
  content: string;
  created_at: Date;
}

function rowToComment(r: TicketCommentRow): TicketComment {
  return {
    id: r.id,
    orgId: r.org_id,
    ticketId: r.ticket_id,
    visibility: r.visibility,
    actorId: r.actor_id,
    content: r.content,
    createdAt: r.created_at.toISOString(),
  };
}

export interface TicketListFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedTo?: string;
  accountId?: string;
  search?: string;
}

async function nextTicketNumber(
  client: PoolClient,
  orgId: string,
  year: number
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO crm_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, 'TICKET', $2, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = crm_number_sequences.last_seq + 1
     RETURNING last_seq`,
    [orgId, year]
  );
  const seq = rows[0]!.last_seq;
  return `TK-${year}-${String(seq).padStart(4, "0")}`;
}

export const ticketsRepo = {
  async list(
    client: PoolClient,
    filters: TicketListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Ticket[]; total: number }> {
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
    if (filters.assignedTo) {
      where.push(`assigned_to = $${i}`);
      params.push(filters.assignedTo);
      i++;
    }
    if (filters.accountId) {
      where.push(`account_id = $${i}`);
      params.push(filters.accountId);
      i++;
    }
    if (filters.search) {
      where.push(
        `(subject ILIKE $${i} OR ticket_number ILIKE $${i} OR device_serial ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM tickets ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM tickets
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<TicketRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToTicket),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Ticket | null> {
    const { rows } = await client.query<TicketRow>(
      `SELECT ${SELECT_COLS} FROM tickets
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToTicket(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateTicket
  ): Promise<Ticket> {
    const year = new Date().getUTCFullYear();
    const ticketNumber = await nextTicketNumber(client, orgId, year);
    const { rows } = await client.query<TicketRow>(
      `INSERT INTO tickets (
         org_id, ticket_number, account_id, contact_id, subject, description,
         category, priority, device_serial, product_code, assigned_to,
         sla_deadline
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        ticketNumber,
        input.accountId ?? null,
        input.contactId ?? null,
        input.subject,
        input.description,
        input.category,
        input.priority ?? "MEDIUM",
        input.deviceSerial ?? null,
        input.productCode ?? null,
        input.assignedTo ?? null,
        input.slaDeadline ?? null,
      ]
    );
    return rowToTicket(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateTicket
  ): Promise<Ticket | "version_conflict" | null> {
    const cur = await ticketsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.accountId !== undefined) col("account_id", input.accountId);
    if (input.contactId !== undefined) col("contact_id", input.contactId);
    if (input.subject !== undefined) col("subject", input.subject);
    if (input.description !== undefined) col("description", input.description);
    if (input.category !== undefined) col("category", input.category);
    if (input.priority !== undefined) col("priority", input.priority);
    if (input.deviceSerial !== undefined)
      col("device_serial", input.deviceSerial);
    if (input.productCode !== undefined)
      col("product_code", input.productCode);
    if (input.assignedTo !== undefined) col("assigned_to", input.assignedTo);
    if (input.slaDeadline !== undefined) col("sla_deadline", input.slaDeadline);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<TicketRow>(
      `UPDATE tickets SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToTicket(rows[0]);
  },

  async transitionStatus(
    client: PoolClient,
    id: string,
    args: {
      status: TicketStatus;
      expectedVersion: number;
    }
  ): Promise<Ticket | "version_conflict" | null> {
    const cur = await ticketsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const resolving = args.status === "RESOLVED" || args.status === "CLOSED";
    const { rows } = await client.query<TicketRow>(
      `UPDATE tickets
          SET status = $1,
              resolved_at = CASE
                              WHEN $2::boolean AND resolved_at IS NULL THEN now()
                              ELSE resolved_at
                            END
        WHERE id = $3 AND version = $4 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [args.status, resolving, id, args.expectedVersion]
    );
    if (!rows[0]) return "version_conflict";
    return rowToTicket(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE tickets SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  // ─── Comments ──────────────────────────────────────────────────────────────

  async addComment(
    client: PoolClient,
    args: {
      orgId: string;
      ticketId: string;
      actorId: string | null;
      input: AddTicketComment;
    }
  ): Promise<TicketComment> {
    const { rows } = await client.query<TicketCommentRow>(
      `INSERT INTO ticket_comments (
         org_id, ticket_id, visibility, actor_id, content
       ) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, org_id, ticket_id, visibility, actor_id, content, created_at`,
      [
        args.orgId,
        args.ticketId,
        args.input.visibility ?? "INTERNAL",
        args.actorId,
        args.input.content,
      ]
    );
    return rowToComment(rows[0]!);
  },

  async listComments(
    client: PoolClient,
    ticketId: string
  ): Promise<TicketComment[]> {
    const { rows } = await client.query<TicketCommentRow>(
      `SELECT id, org_id, ticket_id, visibility, actor_id, content, created_at
         FROM ticket_comments
        WHERE ticket_id = $1
        ORDER BY created_at ASC`,
      [ticketId]
    );
    return rows.map(rowToComment);
  },
};

export { nextTicketNumber };
