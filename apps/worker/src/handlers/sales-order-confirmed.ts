/**
 * sales_order.confirmed handlers — automate.md Track 1 Phase 2.
 *
 *   sales_order.confirmed → inventory.reserveForSo
 *
 * Purpose: when an SO is confirmed, place hard reservations on the finished
 * goods so other orders can't claim the same stock before dispatch.
 *
 * ─── Schema gap (intentional pragmatism) ───────────────────────────────
 *
 * `sales_order_line_items` stores `product_code` as TEXT (no FK to
 * products / items). The stock-reservation layer keys on items.id. So we
 * resolve product_code → items.sku (case-insensitive, where category =
 * FINISHED_GOOD) at runtime. Lines whose code has no matching items row
 * or whose item has no default_warehouse_id are LOGGED AND SKIPPED, not
 * thrown — partial reservations beat forever-retrying on master-data
 * drift. (Track 2 F1 ATP introduces a proper resolver; until then, this
 * handler degrades gracefully.)
 *
 * When the resolver succeeds but the underlying reserve_stock_atomic()
 * raises UR001 (insufficient stock), we also log + skip. Insufficient
 * stock is a business condition, not an infrastructure failure — the
 * right reaction is a `sales_order.stock_flagged` event (Track 2 F1),
 * not a retry loop. This handler is conservative: emit nothing, log
 * loudly.
 *
 * Handler idempotency is via outbox.handler_runs in runner.ts — no
 * per-insert ON CONFLICT needed. But `reserve_stock_atomic` inserts a
 * new row every call, so the outbox slot MUST prevent double-runs.
 */

import type { EventHandler, SalesOrderConfirmedPayload } from "./types.js";

interface SoLineRow {
  id: string;
  product_code: string;
  product_name: string;
  quantity: number;
}

interface ResolvedItemRow {
  id: string;
  sku: string;
  uom: string;
  default_warehouse_id: string | null;
}

export const reserveForSo: EventHandler<SalesOrderConfirmedPayload> = async (
  client,
  payload,
  ctx,
) => {
  // 1. Load SO lines.
  const { rows: lines } = await client.query<SoLineRow>(
    `SELECT id, product_code, product_name, quantity
       FROM sales_order_line_items
      WHERE order_id = $1
      ORDER BY created_at ASC`,
    [payload.salesOrderId],
  );

  if (lines.length === 0) {
    ctx.log.warn(
      { outboxId: ctx.outboxId, salesOrderId: payload.salesOrderId },
      "sales_order.confirmed: no lines on SO, nothing to reserve",
    );
    return;
  }

  let reserved = 0;
  let skippedUnresolved = 0;
  let skippedInsufficient = 0;

  for (const line of lines) {
    // 2. Resolve product_code → items.id via case-insensitive sku match on
    //    a FINISHED_GOOD row. This is loose on purpose — the schema has
    //    no FK today. Track 2 F1 (ATP) tightens this.
    const { rows: items } = await client.query<ResolvedItemRow>(
      `SELECT id, sku, uom, default_warehouse_id
         FROM items
        WHERE org_id = $1
          AND lower(sku) = lower($2)
          AND category = 'FINISHED_GOOD'
          AND deleted_at IS NULL
          AND is_active = true
        LIMIT 1`,
      [payload.orgId, line.product_code],
    );
    const item = items[0];
    if (!item) {
      ctx.log.warn(
        {
          outboxId: ctx.outboxId,
          salesOrderId: payload.salesOrderId,
          lineId: line.id,
          productCode: line.product_code,
        },
        "sales_order.confirmed: no matching FINISHED_GOOD item for product_code; skipping reservation",
      );
      skippedUnresolved += 1;
      continue;
    }
    if (!item.default_warehouse_id) {
      ctx.log.warn(
        {
          outboxId: ctx.outboxId,
          salesOrderId: payload.salesOrderId,
          itemId: item.id,
          sku: item.sku,
        },
        "sales_order.confirmed: item has no default_warehouse_id; skipping reservation",
      );
      skippedUnresolved += 1;
      continue;
    }

    // 3. Reserve. reserve_stock_atomic raises ERRCODE 'UR001' when
    //    available < requested qty; catch and log instead of propagating
    //    (see file header).
    try {
      await client.query(
        `SELECT public.reserve_stock_atomic(
           $1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::text,
           'SO', $6::uuid, $7::uuid, $8::uuid
         )`,
        [
          payload.orgId,
          item.id,
          item.default_warehouse_id,
          line.quantity,
          item.uom,
          payload.salesOrderId,
          line.id,
          payload.actorId ?? null,
        ],
      );
      reserved += 1;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "UR001") {
        ctx.log.warn(
          {
            outboxId: ctx.outboxId,
            salesOrderId: payload.salesOrderId,
            itemId: item.id,
            sku: item.sku,
            qty: line.quantity,
          },
          "sales_order.confirmed: insufficient stock for reservation; skipping (Track 2 F1 will emit stock_flagged)",
        );
        skippedInsufficient += 1;
        continue;
      }
      throw err;
    }
  }

  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      salesOrderId: payload.salesOrderId,
      salesOrderNumber: payload.salesOrderNumber,
      reserved,
      skippedUnresolved,
      skippedInsufficient,
      totalLines: lines.length,
    },
    "handler sales_order.confirmed → inventory.reserveForSo",
  );
};
