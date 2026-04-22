/**
 * Event-handler catalogue — ARCHITECTURE.md §3.1.
 *
 * One module = one event type = N handlers. Handlers are registered in
 * this table in the order they should run. The dispatch processor loops
 * through the matching entries for an outbox event and runs them via
 * `runHandlersForEvent`, which wraps each in its own idempotency slot.
 *
 * Deliberately a flat array (not a keyed map) so multiple handlers can
 * fan out from a single event type without special-case lookups, and so
 * iteration order is stable and easy to reason about.
 *
 * To add a handler:
 *   1. Write the body as an `EventHandler<TPayload>` in a sibling file.
 *   2. Append a { eventType, handlerName, handler } row here.
 *   3. Pick a `handlerName` that's unique across the catalogue — it is
 *      the row key in `outbox.handler_runs`, so renaming mid-flight
 *      breaks idempotency for in-flight events.
 */

import { createWorkOrder, createMrpIndent } from "./deal-won.js";
import { recordStockIn, draftPurchaseInvoice } from "./qc-inward-passed.js";
import {
  recordFinishedGoods,
  notifyValuation,
  notifySales,
} from "./qc-final-passed.js";
import {
  recordDispatch,
  generateEwb,
  whatsappNotify,
} from "./delivery-challan-confirmed.js";
import type { HandlerEntry } from "./types.js";

export const HANDLER_CATALOGUE: HandlerEntry[] = [
  // deal.won → production + procurement
  {
    eventType: "deal.won",
    handlerName: "production.createWorkOrder",
    handler: createWorkOrder as unknown as HandlerEntry["handler"],
  },
  {
    eventType: "deal.won",
    handlerName: "procurement.createMrpIndent",
    handler: createMrpIndent as unknown as HandlerEntry["handler"],
  },

  // qc_inward.passed → inventory + finance
  {
    eventType: "qc_inward.passed",
    handlerName: "inventory.recordStockIn",
    handler: recordStockIn as unknown as HandlerEntry["handler"],
  },
  {
    eventType: "qc_inward.passed",
    handlerName: "finance.draftPurchaseInvoice",
    handler: draftPurchaseInvoice as unknown as HandlerEntry["handler"],
  },

  // qc_final.passed → inventory + finance + crm
  {
    eventType: "qc_final.passed",
    handlerName: "inventory.recordFinishedGoods",
    handler: recordFinishedGoods as unknown as HandlerEntry["handler"],
  },
  {
    eventType: "qc_final.passed",
    handlerName: "finance.notifyValuation",
    handler: notifyValuation as unknown as HandlerEntry["handler"],
  },
  {
    eventType: "qc_final.passed",
    handlerName: "crm.notifySales",
    handler: notifySales as unknown as HandlerEntry["handler"],
  },

  // delivery_challan.confirmed → inventory + finance (EWB) + crm (WhatsApp)
  {
    eventType: "delivery_challan.confirmed",
    handlerName: "inventory.recordDispatch",
    handler: recordDispatch as unknown as HandlerEntry["handler"],
  },
  {
    eventType: "delivery_challan.confirmed",
    handlerName: "finance.generateEwb",
    handler: generateEwb as unknown as HandlerEntry["handler"],
  },
  {
    eventType: "delivery_challan.confirmed",
    handlerName: "crm.whatsappNotify",
    handler: whatsappNotify as unknown as HandlerEntry["handler"],
  },
];

export { runHandler, runHandlersForEvent } from "./runner.js";
export type {
  RunHandlerResult,
  RunHandlerOptions,
} from "./runner.js";
export type {
  EventHandler,
  HandlerEntry,
  HandlerContext,
  EwbClientLike,
  WhatsAppClientLike,
  DealWonPayload,
  QcInwardPassedPayload,
  QcFinalPassedPayload,
  DeliveryChallanConfirmedPayload,
} from "./types.js";
