/**
 * sales_order.dispatched handlers — automate.md Track 1 Phase 2.
 *
 *   sales_order.dispatched →
 *     finance.draftSalesInvoice   (auto-raise DRAFT invoice so AR flow can start)
 *     inventory.releaseReservations (release any active SO stock holds)
 *
 * ─── Why not "commit" reservations? ───────────────────────────────────
 *
 * The original plan (automate.md Part C Phase 2) said "flip ALLOCATED →
 * DISPATCHED". The stock_reservations schema has no DISPATCHED state
 * (only ACTIVE | RELEASED | CONSUMED) — CONSUMING needs a stock_ledger
 * row, which needs real item/warehouse/quantity numbers, which today
 * live on the delivery challan (not here). So the right split is:
 *
 *   dispatched    → release the SO-scoped hold (free the number)
 *   DC confirmed  → write the stock_ledger OUT row (physical movement)
 *
 * The DC-confirmed handler already exists. The release here unblocks
 * those units for other reservations in the meantime — if dispatch
 * ultimately cancels the DC won't fire and stock never goes out, so the
 * reservation release is the safe default.
 *
 * ─── Invoice numbering ────────────────────────────────────────────────
 *
 * We inline the SI-YYYY-NNNN bump rather than import the API's
 * nextFinanceNumber — the worker package must not depend on the API
 * package (see types.ts comment). The SQL is the single source of truth
 * at ops/sql/init/07-finance.sql:41-49.
 */

import type {
  EventHandler,
  SalesOrderDispatchedPayload,
} from "./types.js";

interface SoRow {
  id: string;
  order_number: string;
  account_id: string | null;
  company: string;
  contact_name: string;
  subtotal: string;
  tax_amount: string;
  grand_total: string;
  expected_delivery: string | null;
  notes: string | null;
}

interface SoLineRow {
  id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  discount_pct: string;
  tax_pct: string;
  tax_amount: string;
  line_total: string;
}

interface InvoiceRow {
  id: string;
}

async function nextInvoiceNumber(
  client: Parameters<EventHandler>[0],
  orgId: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO finance_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, 'SI', $2, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = finance_number_sequences.last_seq + 1,
                   updated_at = now()
     RETURNING last_seq`,
    [orgId, year],
  );
  return `SI-${year}-${String(rows[0]!.last_seq).padStart(4, "0")}`;
}

export const draftSalesInvoice: EventHandler<
  SalesOrderDispatchedPayload
> = async (client, payload, ctx) => {
  // 1. Short-circuit if we've already drafted an invoice for this SO.
  //    outbox.handler_runs already guards against double-runs of THIS
  //    handler, but an operator could have drafted a manual invoice —
  //    don't double up.
  const { rows: existing } = await client.query<{ id: string }>(
    `SELECT id FROM sales_invoices
      WHERE sales_order_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [payload.salesOrderId],
  );
  if (existing.length > 0) {
    ctx.log.info(
      {
        outboxId: ctx.outboxId,
        salesOrderId: payload.salesOrderId,
        existingInvoiceId: existing[0]!.id,
      },
      "sales_order.dispatched: invoice already exists for SO; skipping draft",
    );
    return;
  }

  // 2. Load SO header + lines.
  const { rows: soRows } = await client.query<SoRow>(
    `SELECT id, order_number, account_id, company, contact_name,
            subtotal, tax_amount, grand_total, expected_delivery, notes
       FROM sales_orders
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [payload.salesOrderId],
  );
  const so = soRows[0];
  if (!so) {
    throw new Error(
      `sales_order.dispatched: SO ${payload.salesOrderId} not found`,
    );
  }
  const { rows: lines } = await client.query<SoLineRow>(
    `SELECT id, product_code, product_name, quantity, unit_price,
            discount_pct, tax_pct, tax_amount, line_total
       FROM sales_order_line_items
      WHERE order_id = $1
      ORDER BY created_at ASC`,
    [payload.salesOrderId],
  );
  if (lines.length === 0) {
    ctx.log.warn(
      { outboxId: ctx.outboxId, salesOrderId: payload.salesOrderId },
      "sales_order.dispatched: SO has no lines, skipping invoice draft",
    );
    return;
  }

  // 3. Create DRAFT invoice header.
  const invoiceNumber = await nextInvoiceNumber(client, payload.orgId);
  const { rows: invRows } = await client.query<InvoiceRow>(
    `INSERT INTO sales_invoices
       (org_id, invoice_number, status,
        customer_id, customer_name,
        sales_order_id,
        subtotal, tax_total, discount_total, grand_total,
        currency, notes)
     VALUES ($1, $2, 'DRAFT',
             $3, $4,
             $5,
             $6::numeric, $7::numeric, 0, $8::numeric,
             'INR', $9)
     RETURNING id`,
    [
      payload.orgId,
      invoiceNumber,
      so.account_id,
      so.company,
      payload.salesOrderId,
      so.subtotal,
      so.tax_amount,
      so.grand_total,
      `Auto-drafted from SO ${so.order_number} on dispatch (outbox ${ctx.outboxId})`,
    ],
  );
  const invoiceId = invRows[0]!.id;

  // 4. Copy lines. SO lines don't carry item_id / product_id FKs — we
  //    leave those NULL and put the product identity in description +
  //    hsn_sac is unknown. Finance can edit before POST.
  const linePlaceholders: string[] = [];
  const lineValues: unknown[] = [];
  let p = 1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    linePlaceholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}::numeric, $${p++}::numeric, $${p++}::numeric, $${p++}::numeric, $${p++}::numeric, $${p++}::numeric, $${p++}::numeric)`,
    );
    const subtotal = Number(ln.line_total) - Number(ln.tax_amount);
    lineValues.push(
      payload.orgId,
      invoiceId,
      i + 1,
      `${ln.product_code} — ${ln.product_name}`,
      ln.quantity,
      ln.unit_price,
      ln.discount_pct,
      ln.tax_pct,
      subtotal.toFixed(4),
      ln.tax_amount,
      ln.line_total,
    );
  }
  await client.query(
    `INSERT INTO sales_invoice_lines
       (org_id, invoice_id, sequence_number, description,
        quantity, unit_price, discount_percent, tax_rate_percent,
        line_subtotal, line_tax, line_total)
     VALUES ${linePlaceholders.join(", ")}`,
    lineValues,
  );

  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      salesOrderId: payload.salesOrderId,
      invoiceId,
      invoiceNumber,
      lineCount: lines.length,
      grandTotal: so.grand_total,
    },
    "handler sales_order.dispatched → finance.draftSalesInvoice",
  );
};

/**
 * Release any ACTIVE reservations against this SO. Uses the
 * released_by_ref stored function which flips matching rows and keeps
 * stock_summary.reserved in sync.
 *
 * Called after dispatch so the hold doesn't linger; actual stock-out
 * happens when the linked DC is CONFIRMED (separate handler family).
 */
export const releaseReservations: EventHandler<
  SalesOrderDispatchedPayload
> = async (client, payload, ctx) => {
  const { rows } = await client.query<{ release_stock_reservations_by_ref: number }>(
    `SELECT public.release_stock_reservations_by_ref(
       $1::uuid, 'SO', $2::uuid, $3::uuid
     )`,
    [payload.orgId, payload.salesOrderId, payload.actorId ?? null],
  );
  const released = rows[0]?.release_stock_reservations_by_ref ?? 0;
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      salesOrderId: payload.salesOrderId,
      released,
    },
    "handler sales_order.dispatched → inventory.releaseReservations",
  );
};
