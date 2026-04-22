/**
 * delivery_challan.confirmed handlers — ARCHITECTURE.md §3.1 + §3.4.
 *
 *   delivery_challan.confirmed →
 *     inventory.recordDispatch +
 *     finance.generateEwb +
 *     crm.whatsappNotify
 *
 * Two of the three handlers call out to circuit-breaker-wrapped external
 * APIs (NIC e-Way Bill, WhatsApp Business). Per §3.4 those clients
 * *never throw on transport failure* — they enqueue into
 * manual_entry_queue and return a `status='QUEUED'` result. So the
 * handler body always succeeds as long as the DB write before the call
 * (if any) and the breaker-state bookkeeping within the client succeed.
 *
 * The external clients are injected through `ctx.clients` so Gate 38
 * can provide FakeTransport-backed instances without the handler body
 * needing to know the difference.
 */

import type {
  EventHandler,
  DeliveryChallanConfirmedPayload,
} from "./types.js";

/**
 * Negative stock_ledger entry at txn_type CUSTOMER_ISSUE. The schema
 * requires quantity <> 0 and CUSTOMER_ISSUE is the enum value for an
 * outbound sales delivery, per 03-inventory.sql.
 */
export const recordDispatch: EventHandler<
  DeliveryChallanConfirmedPayload
> = async (client, payload, ctx) => {
  const signedQty = `-${payload.quantity}`;
  await client.query(
    `INSERT INTO stock_ledger
       (org_id, item_id, warehouse_id, quantity, uom, txn_type,
        ref_doc_type, ref_doc_id, unit_cost, reason)
     VALUES ($1, $2, $3, $4::numeric, $5, 'CUSTOMER_ISSUE',
             'DC', $6, $7::numeric, $8)`,
    [
      payload.orgId,
      payload.itemId,
      payload.warehouseId,
      signedQty,
      payload.uom,
      payload.dcId,
      payload.unitCost ?? null,
      `delivery_challan.confirmed (DC ${payload.dcNumber})`,
    ],
  );
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      dcId: payload.dcId,
      itemId: payload.itemId,
      qty: signedQty,
    },
    "handler delivery_challan.confirmed → inventory.recordDispatch",
  );
};

/**
 * Generate an e-Way Bill through the §3.4 breaker-wrapped client. The
 * client handles the OPEN-breaker / transport-error fallback by parking
 * the payload in manual_entry_queue — so this handler does not need to
 * try/catch transport errors itself. If `ctx.clients.ewb` is absent
 * (test or dev run with no external wiring) we skip with a warning
 * rather than throwing, because the idempotency slot has already been
 * taken and re-running wouldn't fix the missing client.
 */
export const generateEwb: EventHandler<
  DeliveryChallanConfirmedPayload
> = async (_client, payload, ctx) => {
  const ewb = ctx.clients?.ewb;
  if (!ewb) {
    ctx.log.warn(
      { outboxId: ctx.outboxId, dcId: payload.dcId },
      "delivery_challan.confirmed: no NicEwbClient wired — skipping generateEwb",
    );
    return;
  }
  const result = await ewb.generate(payload.orgId, {
    gstin: payload.fromGstin,
    docType: "CHL",
    docNo: payload.ewbDocNo,
    docDate: payload.ewbDocDate,
    fromGstin: payload.fromGstin,
    toGstin: payload.toGstin,
    totalValue: payload.totalValue,
    referenceType: "delivery_challan",
    referenceId: payload.dcId,
  });
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      dcId: payload.dcId,
      status: result.status,
      ewbNo: result.response?.ewbNo,
      queuedId: result.queued?.id,
    },
    "handler delivery_challan.confirmed → finance.generateEwb",
  );
};

/**
 * WhatsApp the customer that dispatch is complete. Like generateEwb
 * above, the client handles its own fallback (email re-route, then
 * manual_entry_queue) so this handler just fires-and-forgets and logs
 * the outcome. Skipping when no client is wired is intentional — a
 * missing client is a wiring bug, not a retryable failure.
 */
export const whatsappNotify: EventHandler<
  DeliveryChallanConfirmedPayload
> = async (_client, payload, ctx) => {
  const wa = ctx.clients?.whatsapp;
  if (!wa) {
    ctx.log.warn(
      { outboxId: ctx.outboxId, dcId: payload.dcId },
      "delivery_challan.confirmed: no WhatsAppClient wired — skipping whatsappNotify",
    );
    return;
  }
  if (!payload.customerPhone) {
    ctx.log.info(
      { outboxId: ctx.outboxId, dcId: payload.dcId },
      "delivery_challan.confirmed: no customerPhone on payload — skipping whatsappNotify",
    );
    return;
  }
  const result = await wa.send(payload.orgId, {
    to: payload.customerPhone,
    template: "dispatch_confirmation",
    variables: [
      payload.customerName ?? "Customer",
      payload.dcNumber,
      payload.quantity,
      payload.uom,
    ],
    referenceType: "delivery_challan",
    referenceId: payload.dcId,
  });
  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      dcId: payload.dcId,
      status: result.status,
      messageId: result.response?.messageId,
      emailedTo: result.emailedTo,
      queuedId: result.queued?.id,
    },
    "handler delivery_challan.confirmed → crm.whatsappNotify",
  );
};
