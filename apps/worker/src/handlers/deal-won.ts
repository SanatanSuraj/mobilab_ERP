/**
 * deal.won handlers — ARCHITECTURE.md §3.1.
 *
 *   deal.won → production.createWorkOrder + procurement.createMrpIndent
 *
 * Design:
 *   - Both handlers are idempotent via the outbox.handler_runs slot
 *     managed in runner.ts — they do not need per-row ON CONFLICT
 *     guards to be safe against redelivery.
 *   - PID / indent_number are derived from (outboxId, dealNumber) so
 *     the same event never produces two rows with different ids.
 *   - `work_orders.deal_id` FK is set ON DELETE SET NULL so deleting
 *     the deal does not cascade into production data.
 */

import type { EventHandler } from "./types.js";
import type { DealWonPayload } from "./types.js";

/**
 * Build a stable, per-event pid prefix so the work order and indent
 * are unambiguously linked back to the triggering event. Using the
 * outbox id's first 8 chars keeps the id human-readable without losing
 * uniqueness across the small batch.
 */
function stableSuffix(outboxId: string): string {
  return outboxId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export const createWorkOrder: EventHandler<DealWonPayload> = async (
  client,
  payload,
  ctx,
) => {
  const pid = `WO-${payload.dealNumber}-${stableSuffix(ctx.outboxId)}`;
  await client.query(
    `INSERT INTO work_orders
       (org_id, pid, product_id, bom_id, bom_version_label, quantity,
        status, deal_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::numeric, 'PLANNED', $7, $8)`,
    [
      payload.orgId,
      pid,
      payload.productId,
      payload.bomId,
      payload.bomVersionLabel,
      payload.quantity,
      payload.dealId,
      payload.requestedBy ?? null,
    ],
  );
  ctx.log.info(
    { outboxId: ctx.outboxId, pid, dealId: payload.dealId },
    "handler deal.won → production.createWorkOrder",
  );
};

export const createMrpIndent: EventHandler<DealWonPayload> = async (
  client,
  payload,
  ctx,
) => {
  const indentNumber = `MRP-${payload.dealNumber}-${stableSuffix(ctx.outboxId)}`;
  const {
    rows: [indent],
  } = await client.query<{ id: string }>(
    `INSERT INTO indents
       (org_id, indent_number, department, purpose, status, priority,
        requested_by, notes)
     VALUES ($1, $2, 'PRODUCTION', $3, 'SUBMITTED', 'NORMAL', $4, $5)
     RETURNING id`,
    [
      payload.orgId,
      indentNumber,
      `MRP for deal ${payload.dealNumber}`,
      payload.requestedBy ?? null,
      `Auto-generated from deal.won (outbox ${ctx.outboxId})`,
    ],
  );
  if (!indent) {
    throw new Error("indent insert did not return a row");
  }
  const lines = payload.indentLines ?? [];
  if (lines.length === 0) {
    ctx.log.info(
      { outboxId: ctx.outboxId, indentId: indent.id },
      "deal.won produced MRP indent with zero lines (no raw materials)",
    );
    return;
  }
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let p = 1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    placeholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}::numeric, $${p++}, $${p++}::numeric)`,
    );
    values.push(
      payload.orgId,
      indent.id,
      i + 1,
      ln.itemId,
      ln.quantity,
      ln.uom,
      ln.estimatedCost ?? "0",
    );
  }
  await client.query(
    `INSERT INTO indent_lines
       (org_id, indent_id, line_no, item_id, quantity, uom, estimated_cost)
     VALUES ${placeholders.join(", ")}`,
    values,
  );
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      indentId: indent.id,
      indentNumber,
      lineCount: lines.length,
    },
    "handler deal.won → procurement.createMrpIndent",
  );
};
