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
import { enqueuePdfRender } from "./qc-cert-issued.js";
// Track 1 Phase 2 handlers (automate.md)
import { reserveForSo } from "./sales-order-confirmed.js";
import {
  draftSalesInvoice,
  releaseReservations,
} from "./sales-order-dispatched.js";
import { openTicket as openQuotationApprovalTicket } from "./quotation-approval-requested.js";
import { observeSettlement } from "./payment-received.js";
import { makeSendInvitationEmail } from "./user-invite-created.js";
import { loadEnv } from "../env.js";
import type { HandlerEntry } from "./types.js";

// The user.invite.created handler needs the web origin to render accept
// URLs. Build the handler once at module load from the same env source the
// rest of the worker uses, then register it below like any other entry.
// (No DI wiring needed: webOrigin is static per process.)
const sendInvitationEmail = makeSendInvitationEmail({
  webOrigin: loadEnv().webOrigin,
});

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

  // qc_cert.issued → compliance (pdf-render queue fan-out, §4.1)
  {
    eventType: "qc_cert.issued",
    handlerName: "compliance.enqueuePdfRender",
    handler: enqueuePdfRender as unknown as HandlerEntry["handler"],
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

  // ─── Track 1 Phase 2 (automate.md) ────────────────────────────────────
  // sales_order.confirmed → inventory.reserveForSo
  {
    eventType: "sales_order.confirmed",
    handlerName: "inventory.reserveForSo",
    handler: reserveForSo as unknown as HandlerEntry["handler"],
  },

  // sales_order.dispatched → finance (draft SI) + inventory (release reservations)
  // Order matters lightly: drafting the invoice first means observers that
  // poll finance see the AR entry before the reservation disappears.
  {
    eventType: "sales_order.dispatched",
    handlerName: "finance.draftSalesInvoice",
    handler: draftSalesInvoice as unknown as HandlerEntry["handler"],
  },
  {
    eventType: "sales_order.dispatched",
    handlerName: "inventory.releaseReservations",
    handler: releaseReservations as unknown as HandlerEntry["handler"],
  },

  // quotation.submitted_for_approval → approvals.openTicket
  {
    eventType: "quotation.submitted_for_approval",
    handlerName: "approvals.openQuotationTicket",
    handler: openQuotationApprovalTicket as unknown as HandlerEntry["handler"],
  },

  // payment.received → finance.observeSettlement (read-only shell — see file
  // header; the real apply-to-ledger + maybe-settle logic can't land until
  // the schema gap in sales_invoices.status is closed in Track 2).
  {
    eventType: "payment.received",
    handlerName: "finance.observeSettlement",
    handler: observeSettlement as unknown as HandlerEntry["handler"],
  },

  // user.invite.created → admin.sendInvitationEmail
  // Writes a row to invitation_emails (dev mailbox). Production swaps this
  // for a transactional-email adapter; the handler contract is unchanged.
  {
    eventType: "user.invite.created",
    handlerName: "admin.sendInvitationEmail",
    handler: sendInvitationEmail as unknown as HandlerEntry["handler"],
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
  EnqueuePdfRender,
  PdfDocTypeLike,
  DealWonPayload,
  QcInwardPassedPayload,
  QcFinalPassedPayload,
  QcCertIssuedPayload,
  DeliveryChallanConfirmedPayload,
  // Track 1 Phase 1 payloads (automate.md)
  LeadConvertedPayload,
  DealStageChangedPayload,
  QuotationApprovalRequestedPayload,
  SalesOrderConfirmedPayload,
  SalesOrderDispatchedPayload,
  PoIssuedPayload,
  GrnPostedPayload,
  WoStageChangedPayload,
  PaymentReceivedPayload,
} from "./types.js";
