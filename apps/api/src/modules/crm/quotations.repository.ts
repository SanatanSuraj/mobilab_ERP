/**
 * Quotations repository. Mirrors deals.repository.ts with two additions:
 *
 *   1. Line items live in a child table (`quotation_line_items`) and are
 *      always loaded + replaced as a set — there's no per-line PATCH.
 *      `replaceLineItems()` deletes and re-inserts inside the caller's tx.
 *   2. `nextQuotationNumber(orgId, year)` writes to `crm_number_sequences`
 *      with kind='QUOTATION' (atomic UPSERT identical to deals).
 *
 * Totals (subtotal / tax / grand_total) are always computed by the service
 * from line items and written to the header — the repo trusts whatever the
 * service hands it. Triggers in ops/sql/triggers/04-crm.sql bump `version`
 * on every UPDATE so readers can trust monotonic increase.
 */

import type { PoolClient } from "pg";
import type {
  CreateQuotationLineItem,
  Quotation,
  QuotationLineItem,
  QuotationStatus,
  UpdateQuotation,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface QuotationRow {
  id: string;
  org_id: string;
  quotation_number: string;
  deal_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  company: string;
  contact_name: string;
  status: QuotationStatus;
  subtotal: string;
  tax_amount: string;
  grand_total: string;
  valid_until: Date | null;
  notes: string | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: Date | null;
  converted_to_order_id: string | null;
  rejected_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface QuotationLineItemRow {
  id: string;
  org_id: string;
  quotation_id: string;
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

function rowToLineItem(r: QuotationLineItemRow): QuotationLineItem {
  return {
    id: r.id,
    orgId: r.org_id,
    quotationId: r.quotation_id,
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

function rowToQuotation(r: QuotationRow, lineItems: QuotationLineItem[]): Quotation {
  return {
    id: r.id,
    orgId: r.org_id,
    quotationNumber: r.quotation_number,
    dealId: r.deal_id,
    accountId: r.account_id,
    contactId: r.contact_id,
    company: r.company,
    contactName: r.contact_name,
    status: r.status,
    subtotal: r.subtotal,
    taxAmount: r.tax_amount,
    grandTotal: r.grand_total,
    validUntil: toIsoDate(r.valid_until),
    notes: r.notes,
    requiresApproval: r.requires_approval,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    convertedToOrderId: r.converted_to_order_id,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    lineItems,
  };
}

const SELECT_COLS = `id, org_id, quotation_number, deal_id, account_id,
                     contact_id, company, contact_name, status, subtotal,
                     tax_amount, grand_total, valid_until, notes,
                     requires_approval, approved_by, approved_at,
                     converted_to_order_id, rejected_reason, version,
                     created_at, updated_at, deleted_at`;

const LINE_COLS = `id, org_id, quotation_id, product_code, product_name,
                   quantity, unit_price, discount_pct, tax_pct, tax_amount,
                   line_total, created_at`;

export interface QuotationListFilters {
  status?: QuotationStatus;
  accountId?: string;
  dealId?: string;
  requiresApproval?: boolean;
  search?: string;
}

/**
 * Line item values already computed by the service — line_total +
 * tax_amount land here as decimal strings. The service is responsible for
 * multiplying quantity × unit_price × (1 - discount/100) and applying tax.
 */
export interface ComputedLineItem extends CreateQuotationLineItem {
  lineTotal: string;
  taxAmount: string;
}

async function nextQuotationNumber(
  client: PoolClient,
  orgId: string,
  year: number,
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO crm_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, 'QUOTATION', $2, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = crm_number_sequences.last_seq + 1
     RETURNING last_seq`,
    [orgId, year],
  );
  const seq = rows[0]!.last_seq;
  return `Q-${year}-${String(seq).padStart(4, "0")}`;
}

async function fetchLineItems(
  client: PoolClient,
  quotationId: string,
): Promise<QuotationLineItem[]> {
  const { rows } = await client.query<QuotationLineItemRow>(
    `SELECT ${LINE_COLS}
       FROM quotation_line_items
      WHERE quotation_id = $1
      ORDER BY created_at ASC, id ASC`,
    [quotationId],
  );
  return rows.map(rowToLineItem);
}

async function insertLineItems(
  client: PoolClient,
  orgId: string,
  quotationId: string,
  items: ComputedLineItem[],
): Promise<QuotationLineItem[]> {
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
      quotationId,
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
  const { rows } = await client.query<QuotationLineItemRow>(
    `INSERT INTO quotation_line_items
       (org_id, quotation_id, product_code, product_name, quantity,
        unit_price, discount_pct, tax_pct, tax_amount, line_total)
     VALUES ${values.join(", ")}
     RETURNING ${LINE_COLS}`,
    params,
  );
  return rows.map(rowToLineItem);
}

export const quotationsRepo = {
  async list(
    client: PoolClient,
    filters: QuotationListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: Quotation[]; total: number }> {
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
    if (filters.dealId) {
      where.push(`deal_id = $${i}`);
      params.push(filters.dealId);
      i++;
    }
    if (filters.requiresApproval !== undefined) {
      where.push(`requires_approval = $${i}`);
      params.push(filters.requiresApproval);
      i++;
    }
    if (filters.search) {
      where.push(
        `(quotation_number ILIKE $${i} OR company ILIKE $${i} OR contact_name ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM quotations ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM quotations
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<QuotationRow>(listSql, params),
    ]);
    // Fan-out line items in parallel. For list views the caller doesn't
    // usually need them, but paying the N parallel SELECTs is still fast
    // enough (<=25 rows × 1 query each) and keeps the API shape uniform
    // between list + detail.
    const lineItemsByQ = await Promise.all(
      listRes.rows.map((r) => fetchLineItems(client, r.id)),
    );
    return {
      data: listRes.rows.map((r, idx) =>
        rowToQuotation(r, lineItemsByQ[idx] ?? []),
      ),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<Quotation | null> {
    const { rows } = await client.query<QuotationRow>(
      `SELECT ${SELECT_COLS} FROM quotations
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) return null;
    const lineItems = await fetchLineItems(client, id);
    return rowToQuotation(rows[0], lineItems);
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: {
      dealId: string | null;
      accountId: string | null;
      contactId: string | null;
      company: string;
      contactName: string;
      validUntil: string | null;
      notes: string | null;
      subtotal: string;
      taxAmount: string;
      grandTotal: string;
      requiresApproval: boolean;
      status: QuotationStatus;
      lineItems: ComputedLineItem[];
    },
  ): Promise<Quotation> {
    const year = new Date().getUTCFullYear();
    const quotationNumber = await nextQuotationNumber(client, orgId, year);
    const { rows } = await client.query<QuotationRow>(
      `INSERT INTO quotations (
         org_id, quotation_number, deal_id, account_id, contact_id,
         company, contact_name, status, subtotal, tax_amount, grand_total,
         valid_until, notes, requires_approval
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        quotationNumber,
        input.dealId,
        input.accountId,
        input.contactId,
        input.company,
        input.contactName,
        input.status,
        input.subtotal,
        input.taxAmount,
        input.grandTotal,
        input.validUntil,
        input.notes,
        input.requiresApproval,
      ],
    );
    const inserted = rows[0]!;
    const lineItems = await insertLineItems(
      client,
      orgId,
      inserted.id,
      input.lineItems,
    );
    return rowToQuotation(inserted, lineItems);
  },

  /**
   * Header PATCH with optimistic lock. If `replaceLineItems` is provided,
   * the child rows are deleted + re-inserted inside the caller's tx. The
   * service must have already computed totals before calling.
   */
  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateQuotation & {
      subtotal?: string;
      taxAmount?: string;
      grandTotal?: string;
      requiresApproval?: boolean;
      replaceLineItems?: ComputedLineItem[];
    },
  ): Promise<Quotation | "version_conflict" | null> {
    const cur = await quotationsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";
    // Edits after approval-required states risk racing with the approval
    // flow; the service layer enforces the allowed statuses. Repo stays
    // loose so the service can decide.

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.dealId !== undefined) col("deal_id", input.dealId);
    if (input.accountId !== undefined) col("account_id", input.accountId);
    if (input.contactId !== undefined) col("contact_id", input.contactId);
    if (input.company !== undefined) col("company", input.company);
    if (input.contactName !== undefined) col("contact_name", input.contactName);
    if (input.validUntil !== undefined) col("valid_until", input.validUntil);
    if (input.notes !== undefined) col("notes", input.notes);
    if (input.subtotal !== undefined) col("subtotal", input.subtotal);
    if (input.taxAmount !== undefined) col("tax_amount", input.taxAmount);
    if (input.grandTotal !== undefined) col("grand_total", input.grandTotal);
    if (input.requiresApproval !== undefined)
      col("requires_approval", input.requiresApproval);

    if (sets.length > 0) {
      params.push(id);
      const idIdx = i++;
      params.push(input.expectedVersion);
      const verIdx = i;
      const { rows } = await client.query<QuotationRow>(
        `UPDATE quotations SET ${sets.join(", ")}
          WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
          RETURNING ${SELECT_COLS}`,
        params,
      );
      if (!rows[0]) return "version_conflict";
    }

    if (input.replaceLineItems) {
      await client.query(
        `DELETE FROM quotation_line_items WHERE quotation_id = $1`,
        [id],
      );
      await insertLineItems(client, cur.orgId, id, input.replaceLineItems);
    }

    // Re-read with bumped version/line items.
    return quotationsRepo.getById(client, id);
  },

  async transitionStatus(
    client: PoolClient,
    id: string,
    args: {
      status: QuotationStatus;
      expectedVersion: number;
      rejectedReason: string | null;
    },
  ): Promise<Quotation | "version_conflict" | null> {
    const cur = await quotationsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const { rows } = await client.query<QuotationRow>(
      `UPDATE quotations
          SET status = $1,
              rejected_reason = CASE WHEN $1 = 'REJECTED' THEN $2 ELSE rejected_reason END
        WHERE id = $3 AND version = $4 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [args.status, args.rejectedReason, id, args.expectedVersion],
    );
    if (!rows[0]) return "version_conflict";
    const lineItems = await fetchLineItems(client, id);
    return rowToQuotation(rows[0], lineItems);
  },

  async approve(
    client: PoolClient,
    id: string,
    args: { approverId: string; expectedVersion: number },
  ): Promise<Quotation | "version_conflict" | null> {
    const cur = await quotationsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const { rows } = await client.query<QuotationRow>(
      `UPDATE quotations
          SET status = 'APPROVED',
              approved_by = $1,
              approved_at = now()
        WHERE id = $2 AND version = $3 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [args.approverId, id, args.expectedVersion],
    );
    if (!rows[0]) return "version_conflict";
    const lineItems = await fetchLineItems(client, id);
    return rowToQuotation(rows[0], lineItems);
  },

  /**
   * Flip to CONVERTED and stamp the resulting sales-order id. Called by the
   * quotations service inside the same tx that creates the SO.
   */
  async markConverted(
    client: PoolClient,
    id: string,
    args: { orderId: string; expectedVersion: number },
  ): Promise<Quotation | "version_conflict" | null> {
    const cur = await quotationsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const { rows } = await client.query<QuotationRow>(
      `UPDATE quotations
          SET status = 'CONVERTED',
              converted_to_order_id = $1
        WHERE id = $2 AND version = $3 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [args.orderId, id, args.expectedVersion],
    );
    if (!rows[0]) return "version_conflict";
    const lineItems = await fetchLineItems(client, id);
    return rowToQuotation(rows[0], lineItems);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE quotations SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },
};

export { nextQuotationNumber };
