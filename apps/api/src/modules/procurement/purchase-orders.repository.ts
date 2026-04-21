/**
 * Purchase orders repository (header + lines).
 *
 * Header totals (subtotal, tax_total, discount_total, grand_total) are
 * denormalised — recomputed in the service layer on every line mutation
 * via recomputeHeaderTotals(). The DB trigger only handles version bumps
 * on header UPDATE.
 */

import type { PoolClient } from "pg";
import type {
  CreatePoLine,
  CreatePurchaseOrder,
  PoLine,
  PoStatus,
  PurchaseOrder,
  UpdatePoLine,
  UpdatePurchaseOrder,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Header ───────────────────────────────────────────────────────────────────

interface PoRow {
  id: string;
  org_id: string;
  po_number: string;
  indent_id: string | null;
  vendor_id: string;
  status: PoStatus;
  currency: string;
  order_date: Date;
  expected_date: Date | null;
  delivery_warehouse_id: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  payment_terms_days: number;
  subtotal: string;
  tax_total: string;
  discount_total: string;
  grand_total: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  sent_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function rowToPo(r: PoRow): PurchaseOrder {
  return {
    id: r.id,
    orgId: r.org_id,
    poNumber: r.po_number,
    indentId: r.indent_id,
    vendorId: r.vendor_id,
    status: r.status,
    currency: r.currency,
    orderDate: r.order_date.toISOString().slice(0, 10),
    expectedDate: isoDate(r.expected_date),
    deliveryWarehouseId: r.delivery_warehouse_id,
    billingAddress: r.billing_address,
    shippingAddress: r.shipping_address,
    paymentTermsDays: r.payment_terms_days,
    subtotal: r.subtotal,
    taxTotal: r.tax_total,
    discountTotal: r.discount_total,
    grandTotal: r.grand_total,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    sentAt: r.sent_at ? r.sent_at.toISOString() : null,
    cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
    cancelReason: r.cancel_reason,
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, po_number, indent_id, vendor_id, status,
                     currency, order_date, expected_date, delivery_warehouse_id,
                     billing_address, shipping_address, payment_terms_days,
                     subtotal, tax_total, discount_total, grand_total,
                     created_by, approved_by, approved_at, sent_at,
                     cancelled_at, cancel_reason, notes, version,
                     created_at, updated_at, deleted_at`;

export interface PoListFilters {
  status?: PoStatus;
  vendorId?: string;
  indentId?: string;
  deliveryWarehouseId?: string;
  from?: string;
  to?: string;
  search?: string;
}

// ── Lines ────────────────────────────────────────────────────────────────────

interface PoLineRow {
  id: string;
  org_id: string;
  po_id: string;
  indent_line_id: string | null;
  line_no: number;
  item_id: string;
  description: string | null;
  quantity: string;
  uom: string;
  unit_price: string;
  discount_pct: string;
  tax_pct: string;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
  received_qty: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToLine(r: PoLineRow): PoLine {
  return {
    id: r.id,
    orgId: r.org_id,
    poId: r.po_id,
    indentLineId: r.indent_line_id,
    lineNo: r.line_no,
    itemId: r.item_id,
    description: r.description,
    quantity: r.quantity,
    uom: r.uom,
    unitPrice: r.unit_price,
    discountPct: r.discount_pct,
    taxPct: r.tax_pct,
    lineSubtotal: r.line_subtotal,
    lineTax: r.line_tax,
    lineTotal: r.line_total,
    receivedQty: r.received_qty,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const LINE_COLS = `id, org_id, po_id, indent_line_id, line_no, item_id,
                   description, quantity, uom, unit_price, discount_pct,
                   tax_pct, line_subtotal, line_tax, line_total,
                   received_qty, notes, created_at, updated_at`;

// ── Line total math ──────────────────────────────────────────────────────────

/** Returns the { subtotal, tax, total } for a single PO line as strings. */
export function computeLineTotals(
  quantity: string,
  unitPrice: string,
  discountPct: string,
  taxPct: string
): { lineSubtotal: string; lineTax: string; lineTotal: string } {
  const qty = Number.parseFloat(quantity);
  const price = Number.parseFloat(unitPrice);
  const disc = Number.parseFloat(discountPct);
  const tax = Number.parseFloat(taxPct);
  const gross = qty * price;
  const afterDiscount = gross * (1 - disc / 100);
  const lineTax = afterDiscount * (tax / 100);
  const total = afterDiscount + lineTax;
  return {
    lineSubtotal: afterDiscount.toFixed(2),
    lineTax: lineTax.toFixed(2),
    lineTotal: total.toFixed(2),
  };
}

// ── Repo ─────────────────────────────────────────────────────────────────────

export const purchaseOrdersRepo = {
  // ── Header ─────────────────────────────────────────────────────────────────

  async list(
    client: PoolClient,
    filters: PoListFilters,
    plan: PaginationPlan
  ): Promise<{ data: PurchaseOrder[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.vendorId) {
      where.push(`vendor_id = $${i}`);
      params.push(filters.vendorId);
      i++;
    }
    if (filters.indentId) {
      where.push(`indent_id = $${i}`);
      params.push(filters.indentId);
      i++;
    }
    if (filters.deliveryWarehouseId) {
      where.push(`delivery_warehouse_id = $${i}`);
      params.push(filters.deliveryWarehouseId);
      i++;
    }
    if (filters.from) {
      where.push(`order_date >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`order_date <= $${i}::date`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(`(po_number ILIKE $${i} OR notes ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM purchase_orders ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM purchase_orders
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<PoRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToPo),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string
  ): Promise<PurchaseOrder | null> {
    const { rows } = await client.query<PoRow>(
      `SELECT ${SELECT_COLS} FROM purchase_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToPo(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    poNumber: string,
    createdBy: string | null,
    input: Omit<CreatePurchaseOrder, "lines" | "poNumber">
  ): Promise<PurchaseOrder> {
    const { rows } = await client.query<PoRow>(
      `INSERT INTO purchase_orders (
         org_id, po_number, indent_id, vendor_id, currency, order_date,
         expected_date, delivery_warehouse_id, billing_address,
         shipping_address, payment_terms_days, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, current_date),$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        poNumber,
        input.indentId ?? null,
        input.vendorId,
        input.currency ?? "INR",
        input.orderDate ?? null,
        input.expectedDate ?? null,
        input.deliveryWarehouseId ?? null,
        input.billingAddress ?? null,
        input.shippingAddress ?? null,
        input.paymentTermsDays ?? 30,
        input.notes ?? null,
        createdBy,
      ]
    );
    return rowToPo(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdatePurchaseOrder
  ): Promise<PurchaseOrder | "version_conflict" | null> {
    const cur = await purchaseOrdersRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.indentId !== undefined) col("indent_id", input.indentId);
    if (input.vendorId !== undefined) col("vendor_id", input.vendorId);
    if (input.status !== undefined) {
      col("status", input.status);
      if (input.status === "CANCELLED") {
        col("cancelled_at", new Date().toISOString());
        if (input.cancelReason !== undefined)
          col("cancel_reason", input.cancelReason);
      }
      if (input.status === "SENT") col("sent_at", new Date().toISOString());
    }
    if (input.currency !== undefined) col("currency", input.currency);
    if (input.orderDate !== undefined) col("order_date", input.orderDate);
    if (input.expectedDate !== undefined)
      col("expected_date", input.expectedDate);
    if (input.deliveryWarehouseId !== undefined)
      col("delivery_warehouse_id", input.deliveryWarehouseId);
    if (input.billingAddress !== undefined)
      col("billing_address", input.billingAddress);
    if (input.shippingAddress !== undefined)
      col("shipping_address", input.shippingAddress);
    if (input.paymentTermsDays !== undefined)
      col("payment_terms_days", input.paymentTermsDays);
    if (input.cancelReason !== undefined && input.status !== "CANCELLED") {
      col("cancel_reason", input.cancelReason);
    }
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<PoRow>(
      `UPDATE purchase_orders SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToPo(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE purchase_orders SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `UPDATE purchase_orders SET updated_at = now() WHERE id = $1`,
      [id]
    );
  },

  /**
   * Recompute header totals from the current po_lines and write them
   * back. Called after every add/update/delete line to keep
   * subtotal/tax_total/grand_total in lockstep.
   */
  async recomputeHeaderTotals(
    client: PoolClient,
    poId: string
  ): Promise<void> {
    await client.query(
      `UPDATE purchase_orders
          SET subtotal = agg.subtotal,
              tax_total = agg.tax_total,
              discount_total = agg.discount_total,
              grand_total = agg.subtotal + agg.tax_total,
              updated_at = now()
         FROM (
           SELECT COALESCE(SUM(line_subtotal), 0)::numeric(18,2) AS subtotal,
                  COALESCE(SUM(line_tax), 0)::numeric(18,2) AS tax_total,
                  COALESCE(SUM(quantity * unit_price * (discount_pct/100)), 0)::numeric(18,2) AS discount_total
             FROM po_lines
            WHERE po_id = $1
         ) agg
        WHERE id = $1`,
      [poId]
    );
  },

  async setStatus(
    client: PoolClient,
    id: string,
    status: PoStatus
  ): Promise<void> {
    await client.query(
      `UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1`,
      [id, status]
    );
  },

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(client: PoolClient, poId: string): Promise<PoLine[]> {
    const { rows } = await client.query<PoLineRow>(
      `SELECT ${LINE_COLS} FROM po_lines
        WHERE po_id = $1 ORDER BY line_no ASC`,
      [poId]
    );
    return rows.map(rowToLine);
  },

  async getLineById(client: PoolClient, id: string): Promise<PoLine | null> {
    const { rows } = await client.query<PoLineRow>(
      `SELECT ${LINE_COLS} FROM po_lines WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async nextLineNo(client: PoolClient, poId: string): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(line_no), 0) + 1 AS next
         FROM po_lines WHERE po_id = $1`,
      [poId]
    );
    return rows[0]!.next;
  },

  async addLine(
    client: PoolClient,
    orgId: string,
    poId: string,
    input: CreatePoLine
  ): Promise<PoLine> {
    const lineNo =
      input.lineNo ?? (await purchaseOrdersRepo.nextLineNo(client, poId));
    const totals = computeLineTotals(
      input.quantity,
      input.unitPrice,
      input.discountPct ?? "0",
      input.taxPct ?? "0"
    );
    const { rows } = await client.query<PoLineRow>(
      `INSERT INTO po_lines (
         org_id, po_id, indent_line_id, line_no, item_id, description,
         quantity, uom, unit_price, discount_pct, tax_pct,
         line_subtotal, line_tax, line_total, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${LINE_COLS}`,
      [
        orgId,
        poId,
        input.indentLineId ?? null,
        lineNo,
        input.itemId,
        input.description ?? null,
        input.quantity,
        input.uom,
        input.unitPrice,
        input.discountPct ?? "0",
        input.taxPct ?? "0",
        totals.lineSubtotal,
        totals.lineTax,
        totals.lineTotal,
        input.notes ?? null,
      ]
    );
    return rowToLine(rows[0]!);
  },

  async updateLine(
    client: PoolClient,
    lineId: string,
    input: UpdatePoLine
  ): Promise<PoLine | null> {
    const cur = await purchaseOrdersRepo.getLineById(client, lineId);
    if (!cur) return null;

    const qty = input.quantity ?? cur.quantity;
    const price = input.unitPrice ?? cur.unitPrice;
    const disc = input.discountPct ?? cur.discountPct;
    const tax = input.taxPct ?? cur.taxPct;
    const totals = computeLineTotals(qty, price, disc, tax);

    const sets: string[] = [
      "quantity = $1",
      "unit_price = $2",
      "discount_pct = $3",
      "tax_pct = $4",
      "line_subtotal = $5",
      "line_tax = $6",
      "line_total = $7",
    ];
    const params: unknown[] = [
      qty,
      price,
      disc,
      tax,
      totals.lineSubtotal,
      totals.lineTax,
      totals.lineTotal,
    ];
    let i = 8;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.itemId !== undefined) col("item_id", input.itemId);
    if (input.indentLineId !== undefined)
      col("indent_line_id", input.indentLineId);
    if (input.lineNo !== undefined) col("line_no", input.lineNo);
    if (input.description !== undefined) col("description", input.description);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.notes !== undefined) col("notes", input.notes);

    params.push(lineId);
    const { rows } = await client.query<PoLineRow>(
      `UPDATE po_lines SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${LINE_COLS}`,
      params
    );
    return rows[0] ? rowToLine(rows[0]) : null;
  },

  async deleteLine(client: PoolClient, lineId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM po_lines WHERE id = $1`,
      [lineId]
    );
    return (rowCount ?? 0) > 0;
  },

  async incrementReceivedQty(
    client: PoolClient,
    lineId: string,
    delta: string
  ): Promise<void> {
    await client.query(
      `UPDATE po_lines
          SET received_qty = (received_qty + $2::numeric(18,3)),
              updated_at = now()
        WHERE id = $1`,
      [lineId, delta]
    );
  },
};
