/**
 * Portal repository. ARCHITECTURE.md §3.7 (Phase 3).
 *
 * Thin wrappers over the tenant-scoped tables the portal exposes:
 *   - account_portal_users (pivot lookup — bootstraps a portal session)
 *   - accounts             (denormalized customer name for the "me" page)
 *   - sales_orders         (read-only list + detail)
 *   - sales_invoices       (read-only list + detail)
 *   - tickets              (read + create)
 *   - ticket_comments      (portal reads CUSTOMER-visibility only, appends
 *                           comments with visibility=CUSTOMER)
 *
 * Everything below runs inside withPortalRequest, which has set
 *   app.current_org              = portal user's org
 *   app.current_user             = portal user's id
 *   app.current_portal_customer  = account_portal_users.account_id
 *
 * The RLS restrictive predicate in ops/sql/rls/13-portal-rls.sql guarantees
 * we can only see rows whose account_id/customer_id matches the GUC, so
 * the repo queries are shape-wise identical to the internal versions —
 * no explicit customer filter is needed (and adding one would invite
 * drift if the RLS predicate ever changes).
 *
 * One exception: the pivot lookup (`findPivot`) runs BEFORE the portal
 * GUC is set — it's how we discover the customer the portal user belongs
 * to. It runs under withOrg only, which is fine because:
 *   (a) account_portal_users has tenant-isolation RLS (blocks cross-org)
 *   (b) we filter by user_id to scope to the caller (the unique index on
 *       (org_id, user_id) means at most one row is returned).
 */

import type { PoolClient } from "pg";
import type {
  InvoiceStatus,
  PortalInvoiceSummary,
  SalesOrder,
  SalesOrderStatus,
  Ticket,
  TicketComment,
  TicketStatus,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

export type { PortalInvoiceSummary };

// ─── Pivot ──────────────────────────────────────────────────────────────────

export interface PortalPivotRow {
  accountId: string;
  accountName: string;
}

/**
 * Find the account_portal_users row for a portal user. Returns the linked
 * account_id and the account's display name in one query. Run inside
 * withOrg (NOT withPortalRequest — the portal GUC is what this lookup
 * provides).
 */
async function findPivot(
  client: PoolClient,
  userId: string,
): Promise<PortalPivotRow | null> {
  const { rows } = await client.query<{
    account_id: string;
    account_name: string;
  }>(
    `SELECT apu.account_id, a.name AS account_name
       FROM account_portal_users apu
       JOIN accounts a ON a.id = apu.account_id
      WHERE apu.user_id = $1
      LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { accountId: r.account_id, accountName: r.account_name };
}

// ─── Sales orders (read-only) ───────────────────────────────────────────────

interface SalesOrderHeaderRow {
  id: string;
  org_id: string;
  order_number: string;
  quotation_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  company: string;
  contact_name: string;
  status: SalesOrderStatus;
  subtotal: string;
  tax_amount: string;
  grand_total: string;
  expected_delivery: Date | null;
  finance_approved_by: string | null;
  finance_approved_at: Date | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const SO_HEADER_COLS = `id, org_id, order_number, quotation_id, account_id,
                        contact_id, company, contact_name, status, subtotal,
                        tax_amount, grand_total, expected_delivery,
                        finance_approved_by, finance_approved_at, notes,
                        version, created_at, updated_at, deleted_at`;

function rowToSalesOrderHeader(r: SalesOrderHeaderRow): SalesOrder {
  return {
    id: r.id,
    orgId: r.org_id,
    orderNumber: r.order_number,
    quotationId: r.quotation_id,
    accountId: r.account_id,
    contactId: r.contact_id,
    company: r.company,
    contactName: r.contact_name,
    status: r.status,
    subtotal: r.subtotal,
    taxAmount: r.tax_amount,
    grandTotal: r.grand_total,
    expectedDelivery: r.expected_delivery
      ? r.expected_delivery.toISOString().slice(0, 10)
      : null,
    financeApprovedBy: r.finance_approved_by,
    financeApprovedAt: r.finance_approved_at
      ? r.finance_approved_at.toISOString()
      : null,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    lineItems: [],
  };
}

// ─── Sales invoices (read-only) ─────────────────────────────────────────────

interface SalesInvoiceHeaderRow {
  id: string;
  org_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  customer_id: string | null;
  customer_name: string | null;
  invoice_date: Date;
  due_date: Date | null;
  currency: string;
  subtotal: string;
  tax_total: string;
  discount_total: string;
  grand_total: string;
  amount_paid: string;
  posted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const INVOICE_HEADER_COLS = `id, org_id, invoice_number, status, customer_id,
                             customer_name, invoice_date, due_date, currency,
                             subtotal, tax_total, discount_total, grand_total,
                             amount_paid, posted_at, created_at, updated_at`;

/**
 * Portal-shaped invoice summary. We don't need to return the full finance
 * contract — the portal UI only shows number, status, date, grand_total,
 * amount_paid. Keeping the response narrow also means the portal can't
 * inadvertently surface finance-internal fields (posted_by, cancelled_by,
 * etc.) if the schema ever grows.
 */
function rowToInvoiceSummary(r: SalesInvoiceHeaderRow): PortalInvoiceSummary {
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    status: r.status,
    invoiceDate: r.invoice_date.toISOString().slice(0, 10),
    dueDate: r.due_date ? r.due_date.toISOString().slice(0, 10) : null,
    currency: r.currency,
    subtotal: r.subtotal,
    taxTotal: r.tax_total,
    discountTotal: r.discount_total,
    grandTotal: r.grand_total,
    amountPaid: r.amount_paid,
    postedAt: r.posted_at ? r.posted_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Tickets ────────────────────────────────────────────────────────────────

interface TicketHeaderRow {
  id: string;
  org_id: string;
  ticket_number: string;
  account_id: string | null;
  contact_id: string | null;
  subject: string;
  description: string;
  category: Ticket["category"];
  priority: Ticket["priority"];
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

const TICKET_COLS = `id, org_id, ticket_number, account_id, contact_id, subject,
                     description, category, priority, status, device_serial,
                     product_code, assigned_to, sla_deadline, resolved_at,
                     version, created_at, updated_at, deleted_at`;

function rowToTicket(r: TicketHeaderRow): Ticket {
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

interface TicketCommentRow {
  id: string;
  org_id: string;
  ticket_id: string;
  visibility: TicketComment["visibility"];
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

// ─── Ticket numbering (reused) ──────────────────────────────────────────────

async function nextTicketNumber(
  client: PoolClient,
  orgId: string,
  year: number,
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO crm_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, 'TICKET', $2, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = crm_number_sequences.last_seq + 1
     RETURNING last_seq`,
    [orgId, year],
  );
  const seq = rows[0]!.last_seq;
  return `TK-${year}-${String(seq).padStart(4, "0")}`;
}

// ─── Repo surface ───────────────────────────────────────────────────────────

export const portalRepo = {
  findPivot,

  // Orders ──
  async listOrders(
    client: PoolClient,
    filter: { status?: SalesOrderStatus },
    plan: PaginationPlan,
  ): Promise<{ data: SalesOrder[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) {
      where.push(`status = $${i}`);
      params.push(filter.status);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM sales_orders ${whereSql}`;
    const listSql = `
      SELECT ${SO_HEADER_COLS}
        FROM sales_orders
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<SalesOrderHeaderRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToSalesOrderHeader),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getOrderById(
    client: PoolClient,
    id: string,
  ): Promise<SalesOrder | null> {
    const { rows } = await client.query<SalesOrderHeaderRow>(
      `SELECT ${SO_HEADER_COLS} FROM sales_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToSalesOrderHeader(rows[0]) : null;
  },

  // Invoices ──
  async listInvoices(
    client: PoolClient,
    filter: { status?: InvoiceStatus },
    plan: PaginationPlan,
  ): Promise<{ data: PortalInvoiceSummary[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) {
      where.push(`status = $${i}`);
      params.push(filter.status);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM sales_invoices ${whereSql}`;
    const listSql = `
      SELECT ${INVOICE_HEADER_COLS}
        FROM sales_invoices
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<SalesInvoiceHeaderRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToInvoiceSummary),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getInvoiceById(
    client: PoolClient,
    id: string,
  ): Promise<PortalInvoiceSummary | null> {
    const { rows } = await client.query<SalesInvoiceHeaderRow>(
      `SELECT ${INVOICE_HEADER_COLS} FROM sales_invoices
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToInvoiceSummary(rows[0]) : null;
  },

  // Tickets ──
  async listTickets(
    client: PoolClient,
    filter: { status?: TicketStatus },
    plan: PaginationPlan,
  ): Promise<{ data: Ticket[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filter.status) {
      where.push(`status = $${i}`);
      params.push(filter.status);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM tickets ${whereSql}`;
    const listSql = `
      SELECT ${TICKET_COLS}
        FROM tickets
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<TicketHeaderRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToTicket),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getTicketById(
    client: PoolClient,
    id: string,
  ): Promise<Ticket | null> {
    const { rows } = await client.query<TicketHeaderRow>(
      `SELECT ${TICKET_COLS} FROM tickets
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToTicket(rows[0]) : null;
  },

  async createTicket(
    client: PoolClient,
    args: {
      orgId: string;
      accountId: string;
      contactId: string | null;
      subject: string;
      description: string;
      category: Ticket["category"];
      priority: Ticket["priority"];
      productCode: string | null;
    },
  ): Promise<Ticket> {
    const year = new Date().getUTCFullYear();
    const number = await nextTicketNumber(client, args.orgId, year);
    const { rows } = await client.query<TicketHeaderRow>(
      `INSERT INTO tickets (
         org_id, ticket_number, account_id, contact_id, subject, description,
         category, priority, product_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${TICKET_COLS}`,
      [
        args.orgId,
        number,
        args.accountId,
        args.contactId,
        args.subject,
        args.description,
        args.category,
        args.priority,
        args.productCode,
      ],
    );
    return rowToTicket(rows[0]!);
  },

  /**
   * Lists only CUSTOMER-visibility comments — portal users never see
   * INTERNAL notes. RLS makes the ticket_id the hard fence; the visibility
   * filter is the application-layer refinement that hides internal
   * chatter on tickets the customer DOES have access to.
   */
  async listCustomerComments(
    client: PoolClient,
    ticketId: string,
  ): Promise<TicketComment[]> {
    const { rows } = await client.query<TicketCommentRow>(
      `SELECT id, org_id, ticket_id, visibility, actor_id, content, created_at
         FROM ticket_comments
        WHERE ticket_id = $1 AND visibility = 'CUSTOMER'
        ORDER BY created_at ASC`,
      [ticketId],
    );
    return rows.map(rowToComment);
  },

  /**
   * Appends a portal-authored comment. Always visibility=CUSTOMER — the
   * content is echoed in the internal ticket UI so staff see what the
   * customer wrote. actor_id is the portal user (set by withPortalRequest's
   * app.current_user for audit; we also carry it in the row for easy FK).
   */
  async addCustomerComment(
    client: PoolClient,
    args: {
      orgId: string;
      ticketId: string;
      actorId: string;
      content: string;
    },
  ): Promise<TicketComment> {
    const { rows } = await client.query<TicketCommentRow>(
      `INSERT INTO ticket_comments (org_id, ticket_id, visibility, actor_id, content)
       VALUES ($1, $2, 'CUSTOMER', $3, $4)
       RETURNING id, org_id, ticket_id, visibility, actor_id, content, created_at`,
      [args.orgId, args.ticketId, args.actorId, args.content],
    );
    return rowToComment(rows[0]!);
  },

  // Summary counts ──
  async summaryCounts(
    client: PoolClient,
  ): Promise<{
    openOrders: number;
    unpaidInvoices: number;
    openTickets: number;
  }> {
    const { rows: orderRows } = await client.query<{ c: string }>(
      `SELECT count(*)::bigint AS c FROM sales_orders
        WHERE deleted_at IS NULL
          AND status IN ('DRAFT','CONFIRMED','PROCESSING','DISPATCHED','IN_TRANSIT')`,
    );
    const { rows: invoiceRows } = await client.query<{ c: string }>(
      `SELECT count(*)::bigint AS c FROM sales_invoices
        WHERE deleted_at IS NULL
          AND status = 'POSTED'
          AND grand_total > amount_paid`,
    );
    const { rows: ticketRows } = await client.query<{ c: string }>(
      `SELECT count(*)::bigint AS c FROM tickets
        WHERE deleted_at IS NULL
          AND status IN ('OPEN','IN_PROGRESS','WAITING_CUSTOMER')`,
    );
    return {
      openOrders: Number(orderRows[0]!.c),
      unpaidInvoices: Number(invoiceRows[0]!.c),
      openTickets: Number(ticketRows[0]!.c),
    };
  },
};
