/**
 * qc_inward.passed handlers — ARCHITECTURE.md §3.1.
 *
 *   qc_inward.passed → inventory.recordStockIn + finance.draftPurchaseInvoice
 *
 * Triggered after inward QC on a GRN has been marked passed.
 *   1. recordStockIn posts a positive stock_ledger row (txn_type GRN_RECEIPT)
 *      so stock_summary picks up the accepted quantity.
 *   2. draftPurchaseInvoice materialises a DRAFT purchase_invoices row for
 *      finance to review — three-way match is still deferred (Phase 3 spec
 *      explicitly notes match_status starts 'PENDING').
 *
 * Idempotency is handled by the runner's outbox.handler_runs slot.
 * Deterministic names (PI number derived from grnNumber + outboxId) make
 * accidental double-INSERTs noisy instead of silently duplicating.
 */

import type { EventHandler, QcInwardPassedPayload } from "./types.js";

function stableSuffix(outboxId: string): string {
  return outboxId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export const recordStockIn: EventHandler<QcInwardPassedPayload> = async (
  client,
  payload,
  ctx,
) => {
  await client.query(
    `INSERT INTO stock_ledger
       (org_id, item_id, warehouse_id, quantity, uom, txn_type,
        ref_doc_type, ref_doc_id, ref_line_id, unit_cost, reason)
     VALUES ($1, $2, $3, $4::numeric, $5, 'GRN_RECEIPT',
             'GRN', $6, $7, $8::numeric, $9)`,
    [
      payload.orgId,
      payload.itemId,
      payload.warehouseId,
      payload.quantity,
      payload.uom,
      payload.grnId,
      payload.grnLineId ?? null,
      payload.unitPrice ?? null,
      `qc_inward.passed (GRN ${payload.grnNumber})`,
    ],
  );
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      grnId: payload.grnId,
      itemId: payload.itemId,
      qty: payload.quantity,
    },
    "handler qc_inward.passed → inventory.recordStockIn",
  );
};

export const draftPurchaseInvoice: EventHandler<
  QcInwardPassedPayload
> = async (client, payload, ctx) => {
  const invoiceNumber = `PI-${payload.grnNumber}-${stableSuffix(ctx.outboxId)}`;
  const quantityNum = Number(payload.quantity);
  const unitPriceNum = Number(payload.unitPrice ?? "0");
  const lineSubtotal = (quantityNum * unitPriceNum).toFixed(4);
  const {
    rows: [invoice],
  } = await client.query<{ id: string }>(
    `INSERT INTO purchase_invoices
       (org_id, invoice_number, status, match_status,
        vendor_id, vendor_name, grn_id,
        subtotal, tax_total, discount_total, grand_total,
        notes)
     VALUES ($1, $2, 'DRAFT', 'PENDING',
             $3, $4, $5,
             $6::numeric, 0, 0, $6::numeric,
             $7)
     RETURNING id`,
    [
      payload.orgId,
      invoiceNumber,
      payload.vendorId ?? null,
      payload.vendorName ?? null,
      payload.grnId,
      lineSubtotal,
      `Auto-drafted from qc_inward.passed on GRN ${payload.grnNumber} (outbox ${ctx.outboxId})`,
    ],
  );
  if (!invoice) {
    throw new Error("purchase_invoices insert did not return a row");
  }
  await client.query(
    `INSERT INTO purchase_invoice_lines
       (org_id, invoice_id, sequence_number, item_id, grn_line_id,
        description, quantity, uom, unit_price,
        line_subtotal, line_tax, line_total)
     VALUES ($1, $2, 1, $3, $4,
             $5, $6::numeric, $7, $8::numeric,
             $9::numeric, 0, $9::numeric)`,
    [
      payload.orgId,
      invoice.id,
      payload.itemId,
      payload.grnLineId ?? null,
      `Received on GRN ${payload.grnNumber}`,
      payload.quantity,
      payload.uom,
      payload.unitPrice ?? "0",
      lineSubtotal,
    ],
  );
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      grnId: payload.grnId,
      invoiceId: invoice.id,
      invoiceNumber,
    },
    "handler qc_inward.passed → finance.draftPurchaseInvoice",
  );
};
