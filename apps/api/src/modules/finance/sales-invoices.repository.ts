/**
 * Sales invoices repository (sales_invoices + sales_invoice_lines).
 *
 * Pattern-matches qc/templates.repository.ts. Header carries status + money
 * totals; lines carry their own tax breakup. Line CRUD bumps header
 * updated_at via touchHeader() so invalidation is cache-coherent.
 *
 * Money fields come out of Postgres as strings (via pg type parser) —
 * REPO NEVER calls Number() on them. Totals recomputation is a service
 * concern (not done here).
 */

import type { PoolClient } from "pg";
import type {
  CreateSalesInvoice,
  CreateSalesInvoiceLine,
  InvoiceStatus,
  SalesInvoice,
  SalesInvoiceLine,
  UpdateSalesInvoice,
  UpdateSalesInvoiceLine,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Header ───────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  org_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  customer_id: string | null;
  customer_name: string | null;
  customer_gstin: string | null;
  customer_address: string | null;
  work_order_id: string | null;
  sales_order_id: string | null;
  invoice_date: Date;
  due_date: Date | null;
  currency: string;
  subtotal: string;
  tax_total: string;
  discount_total: string;
  grand_total: string;
  amount_paid: string;
  notes: string | null;
  terms: string | null;
  place_of_supply: string | null;
  posted_at: Date | null;
  posted_by: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  version: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function toDateStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function rowToInvoice(r: InvoiceRow): SalesInvoice {
  return {
    id: r.id,
    orgId: r.org_id,
    invoiceNumber: r.invoice_number,
    status: r.status,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerGstin: r.customer_gstin,
    customerAddress: r.customer_address,
    workOrderId: r.work_order_id,
    salesOrderId: r.sales_order_id,
    invoiceDate: r.invoice_date.toISOString().slice(0, 10),
    dueDate: toDateStr(r.due_date),
    currency: r.currency,
    subtotal: r.subtotal,
    taxTotal: r.tax_total,
    discountTotal: r.discount_total,
    grandTotal: r.grand_total,
    amountPaid: r.amount_paid,
    notes: r.notes,
    terms: r.terms,
    placeOfSupply: r.place_of_supply,
    postedAt: r.posted_at ? r.posted_at.toISOString() : null,
    postedBy: r.posted_by,
    cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
    cancelledBy: r.cancelled_by,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, invoice_number, status,
                     customer_id, customer_name, customer_gstin, customer_address,
                     work_order_id, sales_order_id,
                     invoice_date, due_date, currency,
                     subtotal, tax_total, discount_total, grand_total, amount_paid,
                     notes, terms, place_of_supply,
                     posted_at, posted_by, cancelled_at, cancelled_by,
                     version, created_by, created_at, updated_at, deleted_at`;

// ── Line ─────────────────────────────────────────────────────────────────────

interface LineRow {
  id: string;
  org_id: string;
  invoice_id: string;
  sequence_number: number;
  product_id: string | null;
  item_id: string | null;
  description: string;
  hsn_sac: string | null;
  quantity: string;
  uom: string | null;
  unit_price: string;
  discount_percent: string;
  tax_rate_percent: string;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
  created_at: Date;
  updated_at: Date;
}

function rowToLine(r: LineRow): SalesInvoiceLine {
  return {
    id: r.id,
    orgId: r.org_id,
    invoiceId: r.invoice_id,
    sequenceNumber: r.sequence_number,
    productId: r.product_id,
    itemId: r.item_id,
    description: r.description,
    hsnSac: r.hsn_sac,
    quantity: r.quantity,
    uom: r.uom,
    unitPrice: r.unit_price,
    discountPercent: r.discount_percent,
    taxRatePercent: r.tax_rate_percent,
    lineSubtotal: r.line_subtotal,
    lineTax: r.line_tax,
    lineTotal: r.line_total,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const LINE_COLS = `id, org_id, invoice_id, sequence_number,
                   product_id, item_id, description, hsn_sac,
                   quantity, uom, unit_price, discount_percent, tax_rate_percent,
                   line_subtotal, line_tax, line_total,
                   created_at, updated_at`;

// ── Repo ─────────────────────────────────────────────────────────────────────

export interface SalesInvoiceListFilters {
  status?: InvoiceStatus;
  customerId?: string;
  workOrderId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export const salesInvoicesRepo = {
  // ── Header ─────────────────────────────────────────────────────────────────

  async list(
    client: PoolClient,
    filters: SalesInvoiceListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: SalesInvoice[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.customerId) {
      where.push(`customer_id = $${i}`);
      params.push(filters.customerId);
      i++;
    }
    if (filters.workOrderId) {
      where.push(`work_order_id = $${i}`);
      params.push(filters.workOrderId);
      i++;
    }
    if (filters.from) {
      where.push(`invoice_date >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`invoice_date <= $${i}::date`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(invoice_number ILIKE $${i} OR customer_name ILIKE $${i} OR notes ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM sales_invoices ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM sales_invoices
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<InvoiceRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToInvoice),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<SalesInvoice | null> {
    const { rows } = await client.query<InvoiceRow>(
      `SELECT ${SELECT_COLS} FROM sales_invoices
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToInvoice(rows[0]) : null;
  },

  async getByNumber(
    client: PoolClient,
    invoiceNumber: string,
  ): Promise<SalesInvoice | null> {
    const { rows } = await client.query<InvoiceRow>(
      `SELECT ${SELECT_COLS} FROM sales_invoices
        WHERE invoice_number = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [invoiceNumber],
    );
    return rows[0] ? rowToInvoice(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    createdBy: string | null,
    input: Omit<CreateSalesInvoice, "lines"> & { invoiceNumber: string },
  ): Promise<SalesInvoice> {
    const { rows } = await client.query<InvoiceRow>(
      `INSERT INTO sales_invoices (
         org_id, invoice_number, status,
         customer_id, customer_name, customer_gstin, customer_address,
         work_order_id, sales_order_id,
         invoice_date, due_date, currency,
         notes, terms, place_of_supply,
         created_by
       ) VALUES ($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8,
                 COALESCE($9::date, current_date),
                 $10::date,
                 COALESCE($11, 'INR'),
                 $12,$13,$14,$15)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.invoiceNumber,
        input.customerId ?? null,
        input.customerName ?? null,
        input.customerGstin ?? null,
        input.customerAddress ?? null,
        input.workOrderId ?? null,
        input.salesOrderId ?? null,
        input.invoiceDate ?? null,
        input.dueDate ?? null,
        input.currency ?? null,
        input.notes ?? null,
        input.terms ?? null,
        input.placeOfSupply ?? null,
        createdBy,
      ],
    );
    return rowToInvoice(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateSalesInvoice,
  ): Promise<SalesInvoice | "version_conflict" | "not_draft" | null> {
    const cur = await salesInvoicesRepo.getById(client, id);
    if (!cur) return null;
    if (cur.status !== "DRAFT") return "not_draft";
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.customerId !== undefined) col("customer_id", input.customerId);
    if (input.customerName !== undefined) col("customer_name", input.customerName);
    if (input.customerGstin !== undefined) col("customer_gstin", input.customerGstin);
    if (input.customerAddress !== undefined) col("customer_address", input.customerAddress);
    if (input.workOrderId !== undefined) col("work_order_id", input.workOrderId);
    if (input.salesOrderId !== undefined) col("sales_order_id", input.salesOrderId);
    if (input.invoiceDate !== undefined) col("invoice_date", input.invoiceDate);
    if (input.dueDate !== undefined) col("due_date", input.dueDate);
    if (input.notes !== undefined) col("notes", input.notes);
    if (input.terms !== undefined) col("terms", input.terms);
    if (input.placeOfSupply !== undefined) col("place_of_supply", input.placeOfSupply);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<InvoiceRow>(
      `UPDATE sales_invoices SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params,
    );
    if (!rows[0]) return "version_conflict";
    return rowToInvoice(rows[0]);
  },

  async updateTotals(
    client: PoolClient,
    id: string,
    totals: {
      subtotal: string;
      taxTotal: string;
      discountTotal: string;
      grandTotal: string;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE sales_invoices
          SET subtotal = $2, tax_total = $3, discount_total = $4, grand_total = $5
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, totals.subtotal, totals.taxTotal, totals.discountTotal, totals.grandTotal],
    );
  },

  async markPosted(
    client: PoolClient,
    id: string,
    postedBy: string | null,
    postedAt: string | null,
  ): Promise<SalesInvoice | null> {
    const { rows } = await client.query<InvoiceRow>(
      `UPDATE sales_invoices
          SET status = 'POSTED',
              posted_at = COALESCE($2::timestamptz, now()),
              posted_by = $3
        WHERE id = $1 AND status = 'DRAFT' AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [id, postedAt, postedBy],
    );
    return rows[0] ? rowToInvoice(rows[0]) : null;
  },

  async markCancelled(
    client: PoolClient,
    id: string,
    cancelledBy: string | null,
  ): Promise<SalesInvoice | null> {
    const { rows } = await client.query<InvoiceRow>(
      `UPDATE sales_invoices
          SET status = 'CANCELLED',
              cancelled_at = now(),
              cancelled_by = $2
        WHERE id = $1 AND status <> 'CANCELLED' AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [id, cancelledBy],
    );
    return rows[0] ? rowToInvoice(rows[0]) : null;
  },

  async applyPayment(
    client: PoolClient,
    id: string,
    amount: string,
  ): Promise<void> {
    await client.query(
      `UPDATE sales_invoices
          SET amount_paid = amount_paid + $2::numeric
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, amount],
    );
  },

  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `UPDATE sales_invoices SET updated_at = now() WHERE id = $1`,
      [id],
    );
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE sales_invoices SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(
    client: PoolClient,
    invoiceId: string,
  ): Promise<SalesInvoiceLine[]> {
    const { rows } = await client.query<LineRow>(
      `SELECT ${LINE_COLS} FROM sales_invoice_lines
        WHERE invoice_id = $1 ORDER BY sequence_number ASC`,
      [invoiceId],
    );
    return rows.map(rowToLine);
  },

  async getLineById(
    client: PoolClient,
    id: string,
  ): Promise<SalesInvoiceLine | null> {
    const { rows } = await client.query<LineRow>(
      `SELECT ${LINE_COLS} FROM sales_invoice_lines WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async nextLineSeq(
    client: PoolClient,
    invoiceId: string,
  ): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next
         FROM sales_invoice_lines WHERE invoice_id = $1`,
      [invoiceId],
    );
    return rows[0]!.next;
  },

  async addLine(
    client: PoolClient,
    orgId: string,
    invoiceId: string,
    input: CreateSalesInvoiceLine,
    computed: { lineSubtotal: string; lineTax: string; lineTotal: string },
  ): Promise<SalesInvoiceLine> {
    const seq =
      input.sequenceNumber ??
      (await salesInvoicesRepo.nextLineSeq(client, invoiceId));
    const { rows } = await client.query<LineRow>(
      `INSERT INTO sales_invoice_lines (
         org_id, invoice_id, sequence_number,
         product_id, item_id, description, hsn_sac,
         quantity, uom, unit_price, discount_percent, tax_rate_percent,
         line_subtotal, line_tax, line_total
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${LINE_COLS}`,
      [
        orgId,
        invoiceId,
        seq,
        input.productId ?? null,
        input.itemId ?? null,
        input.description,
        input.hsnSac ?? null,
        input.quantity,
        input.uom ?? null,
        input.unitPrice,
        input.discountPercent ?? "0",
        input.taxRatePercent ?? "0",
        computed.lineSubtotal,
        computed.lineTax,
        computed.lineTotal,
      ],
    );
    return rowToLine(rows[0]!);
  },

  async updateLine(
    client: PoolClient,
    lineId: string,
    input: UpdateSalesInvoiceLine,
    computed: {
      lineSubtotal: string;
      lineTax: string;
      lineTotal: string;
    } | null,
  ): Promise<SalesInvoiceLine | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.sequenceNumber !== undefined) col("sequence_number", input.sequenceNumber);
    if (input.productId !== undefined) col("product_id", input.productId);
    if (input.itemId !== undefined) col("item_id", input.itemId);
    if (input.description !== undefined) col("description", input.description);
    if (input.hsnSac !== undefined) col("hsn_sac", input.hsnSac);
    if (input.quantity !== undefined) col("quantity", input.quantity);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.unitPrice !== undefined) col("unit_price", input.unitPrice);
    if (input.discountPercent !== undefined) col("discount_percent", input.discountPercent);
    if (input.taxRatePercent !== undefined) col("tax_rate_percent", input.taxRatePercent);
    if (computed) {
      col("line_subtotal", computed.lineSubtotal);
      col("line_tax", computed.lineTax);
      col("line_total", computed.lineTotal);
    }
    if (sets.length === 0) return salesInvoicesRepo.getLineById(client, lineId);

    params.push(lineId);
    const { rows } = await client.query<LineRow>(
      `UPDATE sales_invoice_lines SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${LINE_COLS}`,
      params,
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async deleteLine(client: PoolClient, lineId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM sales_invoice_lines WHERE id = $1`,
      [lineId],
    );
    return (rowCount ?? 0) > 0;
  },
};
