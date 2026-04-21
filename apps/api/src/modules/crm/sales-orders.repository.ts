/**
 * Sales orders repository. Structurally similar to quotations.repository.ts
 * but without the approval / converted-to bookkeeping:
 *
 *   1. Line items live in `sales_order_line_items` and are always loaded +
 *      replaced as a set (DELETE + INSERT inside the caller's tx). No per-
 *      line PATCH.
 *   2. `nextSalesOrderNumber(orgId, year)` writes to `crm_number_sequences`
 *      with kind='SALES_ORDER' (atomic UPSERT identical to quotations).
 *   3. `create()` is called from two places:
 *        (a) quotations.service.convertToSalesOrder — passes pre-computed
 *            totals + ComputedLineItem[] copied from the source quotation.
 *            `quotationId` is non-null.
 *        (b) SalesOrdersService.create — standalone order creation without
 *            a source quotation. Totals are computed by the service.
 *
 * Totals (subtotal / tax / grand_total) are always computed by the service
 * from line items and written to the header — the repo trusts whatever the
 * service hands it. Triggers in ops/sql/triggers/04-crm.sql bump `version`
 * on every UPDATE so readers can trust monotonic increase.
 */

import type { PoolClient } from "pg";
import type {
  CreateSalesOrderLineItem,
  SalesOrder,
  SalesOrderLineItem,
  SalesOrderStatus,
  UpdateSalesOrder,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface SalesOrderRow {
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

interface SalesOrderLineItemRow {
  id: string;
  org_id: string;
  order_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  discount_pct: string;
  tax_pct: string;
  tax_amount: string;
  line_total: string;
  created_at: Date;
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function rowToLineItem(r: SalesOrderLineItemRow): SalesOrderLineItem {
  return {
    id: r.id,
    orgId: r.org_id,
    orderId: r.order_id,
    productCode: r.product_code,
    productName: r.product_name,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    discountPct: r.discount_pct,
    taxPct: r.tax_pct,
    taxAmount: r.tax_amount,
    lineTotal: r.line_total,
    createdAt: r.created_at.toISOString(),
  };
}

function rowToSalesOrder(
  r: SalesOrderRow,
  lineItems: SalesOrderLineItem[],
): SalesOrder {
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
    expectedDelivery: toIsoDate(r.expected_delivery),
    financeApprovedBy: r.finance_approved_by,
    financeApprovedAt: r.finance_approved_at
      ? r.finance_approved_at.toISOString()
      : null,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    lineItems,
  };
}

const SELECT_COLS = `id, org_id, order_number, quotation_id, account_id,
                     contact_id, company, contact_name, status, subtotal,
                     tax_amount, grand_total, expected_delivery,
                     finance_approved_by, finance_approved_at, notes, version,
                     created_at, updated_at, deleted_at`;

const LINE_COLS = `id, org_id, order_id, product_code, product_name,
                   quantity, unit_price, discount_pct, tax_pct, tax_amount,
                   line_total, created_at`;

export interface SalesOrderListFilters {
  status?: SalesOrderStatus;
  accountId?: string;
  quotationId?: string;
  search?: string;
}

/**
 * Line item values already computed by the service — line_total +
 * tax_amount land here as decimal strings. The service is responsible for
 * multiplying quantity × unit_price × (1 - discount/100) and applying tax.
 */
export interface ComputedSalesOrderLineItem extends CreateSalesOrderLineItem {
  lineTotal: string;
  taxAmount: string;
}

async function nextSalesOrderNumber(
  client: PoolClient,
  orgId: string,
  year: number,
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO crm_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, 'SALES_ORDER', $2, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = crm_number_sequences.last_seq + 1
     RETURNING last_seq`,
    [orgId, year],
  );
  const seq = rows[0]!.last_seq;
  return `SO-${year}-${String(seq).padStart(4, "0")}`;
}

async function fetchLineItems(
  client: PoolClient,
  orderId: string,
): Promise<SalesOrderLineItem[]> {
  const { rows } = await client.query<SalesOrderLineItemRow>(
    `SELECT ${LINE_COLS}
       FROM sales_order_line_items
      WHERE order_id = $1
      ORDER BY created_at ASC, id ASC`,
    [orderId],
  );
  return rows.map(rowToLineItem);
}

async function insertLineItems(
  client: PoolClient,
  orgId: string,
  orderId: string,
  items: ComputedSalesOrderLineItem[],
): Promise<SalesOrderLineItem[]> {
  if (items.length === 0) return [];
  const values: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  for (const it of items) {
    values.push(
      `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
    );
    params.push(
      orgId,
      orderId,
      it.productCode,
      it.productName,
      it.quantity,
      it.unitPrice,
      it.discountPct,
      it.taxPct,
      it.taxAmount,
      it.lineTotal,
    );
  }
  const { rows } = await client.query<SalesOrderLineItemRow>(
    `INSERT INTO sales_order_line_items
       (org_id, order_id, product_code, product_name, quantity,
        unit_price, discount_pct, tax_pct, tax_amount, line_total)
     VALUES ${values.join(", ")}
     RETURNING ${LINE_COLS}`,
    params,
  );
  return rows.map(rowToLineItem);
}

export const salesOrdersRepo = {
  async list(
    client: PoolClient,
    filters: SalesOrderListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: SalesOrder[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.accountId) {
      where.push(`account_id = $${i}`);
      params.push(filters.accountId);
      i++;
    }
    if (filters.quotationId) {
      where.push(`quotation_id = $${i}`);
      params.push(filters.quotationId);
      i++;
    }
    if (filters.search) {
      where.push(
        `(order_number ILIKE $${i} OR company ILIKE $${i} OR contact_name ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM sales_orders ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM sales_orders
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<SalesOrderRow>(listSql, params),
    ]);
    const lineItemsByO = await Promise.all(
      listRes.rows.map((r) => fetchLineItems(client, r.id)),
    );
    return {
      data: listRes.rows.map((r, idx) =>
        rowToSalesOrder(r, lineItemsByO[idx] ?? []),
      ),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<SalesOrder | null> {
    const { rows } = await client.query<SalesOrderRow>(
      `SELECT ${SELECT_COLS} FROM sales_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) return null;
    const lineItems = await fetchLineItems(client, id);
    return rowToSalesOrder(rows[0], lineItems);
  },

  /**
   * Create a SalesOrder. Called from:
   *   - SalesOrdersService.create (standalone)
   *   - quotations.service.convertToSalesOrder (from quotation, inside the
   *     same tx that flips the quotation to CONVERTED)
   *
   * `status` is optional and defaults to DRAFT. Services can override it
   * (e.g. the convert flow seeds the SO as CONFIRMED because the quotation
   * was already ACCEPTED by the customer).
   */
  async create(
    client: PoolClient,
    orgId: string,
    input: {
      quotationId: string | null;
      accountId: string | null;
      contactId: string | null;
      company: string;
      contactName: string;
      expectedDelivery: string | null;
      notes: string | null;
      subtotal: string;
      taxAmount: string;
      grandTotal: string;
      status?: SalesOrderStatus;
      lineItems: ComputedSalesOrderLineItem[];
    },
  ): Promise<SalesOrder> {
    const year = new Date().getUTCFullYear();
    const orderNumber = await nextSalesOrderNumber(client, orgId, year);
    const status: SalesOrderStatus = input.status ?? "DRAFT";
    const { rows } = await client.query<SalesOrderRow>(
      `INSERT INTO sales_orders (
         org_id, order_number, quotation_id, account_id, contact_id,
         company, contact_name, status, subtotal, tax_amount, grand_total,
         expected_delivery, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        orderNumber,
        input.quotationId,
        input.accountId,
        input.contactId,
        input.company,
        input.contactName,
        status,
        input.subtotal,
        input.taxAmount,
        input.grandTotal,
        input.expectedDelivery,
        input.notes,
      ],
    );
    const inserted = rows[0]!;
    const lineItems = await insertLineItems(
      client,
      orgId,
      inserted.id,
      input.lineItems,
    );
    return rowToSalesOrder(inserted, lineItems);
  },

  /**
   * Header PATCH with optimistic lock. If `replaceLineItems` is provided,
   * the child rows are deleted + re-inserted inside the caller's tx. The
   * service must have already computed totals before calling.
   */
  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateSalesOrder & {
      subtotal?: string;
      taxAmount?: string;
      grandTotal?: string;
      replaceLineItems?: ComputedSalesOrderLineItem[];
    },
  ): Promise<SalesOrder | "version_conflict" | null> {
    const cur = await salesOrdersRepo.getById(client, id);
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
    if (input.company !== undefined) col("company", input.company);
    if (input.contactName !== undefined)
      col("contact_name", input.contactName);
    if (input.expectedDelivery !== undefined)
      col("expected_delivery", input.expectedDelivery);
    if (input.notes !== undefined) col("notes", input.notes);
    if (input.subtotal !== undefined) col("subtotal", input.subtotal);
    if (input.taxAmount !== undefined) col("tax_amount", input.taxAmount);
    if (input.grandTotal !== undefined) col("grand_total", input.grandTotal);

    if (sets.length > 0) {
      params.push(id);
      const idIdx = i++;
      params.push(input.expectedVersion);
      const verIdx = i;
      const { rows } = await client.query<SalesOrderRow>(
        `UPDATE sales_orders SET ${sets.join(", ")}
          WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
          RETURNING ${SELECT_COLS}`,
        params,
      );
      if (!rows[0]) return "version_conflict";
    }

    if (input.replaceLineItems) {
      await client.query(
        `DELETE FROM sales_order_line_items WHERE order_id = $1`,
        [id],
      );
      await insertLineItems(client, cur.orgId, id, input.replaceLineItems);
    }

    return salesOrdersRepo.getById(client, id);
  },

  async transitionStatus(
    client: PoolClient,
    id: string,
    args: {
      status: SalesOrderStatus;
      expectedVersion: number;
    },
  ): Promise<SalesOrder | "version_conflict" | null> {
    const cur = await salesOrdersRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const { rows } = await client.query<SalesOrderRow>(
      `UPDATE sales_orders
          SET status = $1
        WHERE id = $2 AND version = $3 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [args.status, id, args.expectedVersion],
    );
    if (!rows[0]) return "version_conflict";
    const lineItems = await fetchLineItems(client, id);
    return rowToSalesOrder(rows[0], lineItems);
  },

  /**
   * Finance approval is orthogonal to the fulfillment status graph — stamps
   * the approver + timestamp but does not change the SO status. The SO can
   * progress through CONFIRMED → PROCESSING → DISPATCHED etc. while finance
   * signs off asynchronously.
   */
  async financeApprove(
    client: PoolClient,
    id: string,
    args: { approverId: string; expectedVersion: number },
  ): Promise<SalesOrder | "version_conflict" | null> {
    const cur = await salesOrdersRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const { rows } = await client.query<SalesOrderRow>(
      `UPDATE sales_orders
          SET finance_approved_by = $1,
              finance_approved_at = now()
        WHERE id = $2 AND version = $3 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [args.approverId, id, args.expectedVersion],
    );
    if (!rows[0]) return "version_conflict";
    const lineItems = await fetchLineItems(client, id);
    return rowToSalesOrder(rows[0], lineItems);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE sales_orders SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },
};

export { nextSalesOrderNumber };
