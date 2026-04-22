/**
 * qc_final.passed handlers — ARCHITECTURE.md §3.1.
 *
 *   qc_final.passed →
 *     inventory.recordFinishedGoods +
 *     finance.notifyValuation +
 *     crm.notifySales
 *
 * Triggered when a work order's outbound QC is marked passed. The three
 * fan-out handlers handle, respectively:
 *   1. Positive stock_ledger row at txn_type WO_OUTPUT so the finished
 *      good appears in stock_summary and is available to sales/dispatch.
 *   2. An INFO notification to finance so they can book the inventory
 *      value into the WIP → FG move (finance journal itself is beyond
 *      Phase 3, §3.1 spec only mandates the notification).
 *   3. An INFO notification to the deal's sales owner so customer
 *      handoff / dispatch can proceed.
 *
 * Each handler is guarded by the runner's outbox.handler_runs slot —
 * they do not share state, so partial success in one does not block
 * the others on retry.
 */

import type { EventHandler, QcFinalPassedPayload } from "./types.js";

export const recordFinishedGoods: EventHandler<QcFinalPassedPayload> = async (
  client,
  payload,
  ctx,
) => {
  await client.query(
    `INSERT INTO stock_ledger
       (org_id, item_id, warehouse_id, quantity, uom, txn_type,
        ref_doc_type, ref_doc_id, batch_no, unit_cost, reason)
     VALUES ($1, $2, $3, $4::numeric, $5, 'WO_OUTPUT',
             'WO', $6, $7, $8::numeric, $9)`,
    [
      payload.orgId,
      payload.productItemId,
      payload.warehouseId,
      payload.quantity,
      payload.uom,
      payload.workOrderId,
      payload.lotNumber ?? null,
      payload.unitCost ?? null,
      `qc_final.passed (WO ${payload.workOrderPid})`,
    ],
  );
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      workOrderId: payload.workOrderId,
      itemId: payload.productItemId,
      qty: payload.quantity,
    },
    "handler qc_final.passed → inventory.recordFinishedGoods",
  );
};

/**
 * Emit an in-app INFO notification to the finance user responsible for
 * valuation so they can book the WIP → FG move. The reference_* columns
 * let the inbox deep-link back to the originating work order.
 */
export const notifyValuation: EventHandler<QcFinalPassedPayload> = async (
  client,
  payload,
  ctx,
) => {
  await client.query(
    `INSERT INTO notifications
       (org_id, user_id, event_type, severity, title, body,
        link_url, reference_type, reference_id)
     VALUES ($1, $2, 'qc_final.passed', 'INFO', $3, $4,
             $5, 'work_order', $6)`,
    [
      payload.orgId,
      payload.valuationRecipientUserId,
      `WO ${payload.workOrderPid} completed QC — book valuation`,
      `Work order ${payload.workOrderPid} produced ${payload.quantity} ${payload.uom}. ` +
        `Record the WIP → FG valuation move.`,
      `/work-orders/${payload.workOrderId}`,
      payload.workOrderId,
    ],
  );
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      userId: payload.valuationRecipientUserId,
      workOrderId: payload.workOrderId,
    },
    "handler qc_final.passed → finance.notifyValuation",
  );
};

/**
 * Emit an in-app SUCCESS notification to the deal/sales owner so they
 * can proceed with customer handoff or dispatch. Separate from the
 * finance notification so the two can heal independently on retry.
 */
export const notifySales: EventHandler<QcFinalPassedPayload> = async (
  client,
  payload,
  ctx,
) => {
  await client.query(
    `INSERT INTO notifications
       (org_id, user_id, event_type, severity, title, body,
        link_url, reference_type, reference_id)
     VALUES ($1, $2, 'qc_final.passed', 'SUCCESS', $3, $4,
             $5, 'work_order', $6)`,
    [
      payload.orgId,
      payload.salesRecipientUserId,
      `WO ${payload.workOrderPid} ready for dispatch`,
      `Finished goods (${payload.quantity} ${payload.uom}) are QC-cleared and ` +
        `available in the warehouse. You may schedule customer handoff.`,
      `/work-orders/${payload.workOrderId}`,
      payload.workOrderId,
    ],
  );
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      userId: payload.salesRecipientUserId,
      workOrderId: payload.workOrderId,
    },
    "handler qc_final.passed → crm.notifySales",
  );
};
