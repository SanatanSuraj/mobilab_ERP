/**
 * Types for the Phase 3 §3.1 event-handler catalogue.
 *
 * Each handler takes a PoolClient that is already inside a withOrg()
 * transaction (so RLS is scoped + the idempotency slot is in the same
 * txn as the domain writes) plus the decoded payload and a context
 * object carrying logger / outbox id / optional injected external
 * clients.
 */

import type { PoolClient } from "pg";
import type { Logger } from "@instigenie/observability";

/**
 * Structural shape of the NIC e-Way Bill client the worker needs. The
 * concrete class lives in `@instigenie/api/external` but we intentionally
 * re-describe the minimal surface here so the worker package doesn't
 * depend on the API package (which would invert the dependency graph —
 * the API enqueues outbox rows that the worker drains, not the reverse).
 * Only `generate()` is used from handlers; see the class in
 * apps/api/src/modules/external/nic-ewb.ts for the full implementation.
 */
export interface EwbClientLike {
  generate(
    orgId: string,
    payload: {
      gstin: string;
      docType: "INV" | "CHL" | "BIL" | "BOE";
      docNo: string;
      docDate: string;
      fromGstin: string;
      toGstin: string;
      totalValue: string;
      extra?: Record<string, unknown>;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<{
    status: "GENERATED" | "QUEUED";
    response?: { ewbNo: string; ewbDate: string; validUpto: string };
    queued?: { id: string };
  }>;
}

/**
 * Supported doc-types for the pdf-render queue. Kept structural rather
 * than imported from the processor so that the handler package stays
 * independent of the processor package.
 */
export type PdfDocTypeLike =
  | "qc_cert"
  | "purchase_order"
  | "sales_invoice"
  | "delivery_challan"
  | "grn";

/**
 * Enqueue a pdf-render job. Wired in `apps/worker/src/index.ts` to a
 * BullMQ Queue with the §4.1 retry policy (attempts:3, backoff:60s).
 * The adapter stamps the jobId from (docType, docId) so outbox
 * re-delivery is idempotent at the queue layer — the processor layer
 * has its own ledger (pdf_render_runs) as a defence-in-depth fence.
 */
export interface EnqueuePdfRender {
  (job: {
    docType: PdfDocTypeLike;
    docId: string;
    orgId: string;
  }): Promise<void>;
}

/**
 * Structural shape of the WhatsApp client — see comment on EwbClientLike
 * for why this is duplicated structurally instead of imported.
 */
export interface WhatsAppClientLike {
  send(
    orgId: string,
    payload: {
      to: string;
      template: string;
      variables?: string[];
      emailFallback?: { to: string; subject: string; body: string };
      referenceType?: string;
      referenceId?: string;
    },
    context?: { actorId?: string | null },
  ): Promise<{
    status: "SENT" | "EMAIL_FALLBACK" | "QUEUED";
    response?: { messageId: string; status: string };
    queued?: { id: string };
    emailedTo?: string;
  }>;
}

export interface HandlerContext {
  /** Outbox row id — part of the idempotency key. */
  outboxId: string;
  log: Logger;
  /**
   * Injected external clients — handlers for §3.4 breaker-wrapped APIs
   * use these instead of constructing their own so tests can swap in
   * fakes without touching the handler body.
   *
   * Production wiring passes real clients built from env. Tests pass
   * clients built with a FakeTransport.
   */
  clients?: {
    ewb?: EwbClientLike;
    whatsapp?: WhatsAppClientLike;
    /**
     * Phase 4.1 — §3.1 compliance handler uses this to queue PDF
     * rendering for a freshly-issued QC certificate (and later PO /
     * SI / DC / GRN). Optional so environments that don't run the
     * pdf-render worker locally can still exercise the rest of the
     * catalogue.
     */
    enqueuePdfRender?: EnqueuePdfRender;
  };
}

/**
 * A handler body. Runs under an already-open transaction with
 * `app.current_org` set to `payload.orgId`.  Throws propagate up to
 * roll back the whole txn (including the idempotency slot) so the next
 * retry re-acquires.
 */
export type EventHandler<TPayload = Record<string, unknown>> = (
  client: PoolClient,
  payload: TPayload,
  ctx: HandlerContext,
) => Promise<void>;

export interface HandlerEntry {
  /** Must match outbox.events.event_type exactly. */
  eventType: string;
  /** Stable identifier for the idempotency ledger. snake_case.dotted. */
  handlerName: string;
  handler: EventHandler;
}

// ─── Payload shapes ──────────────────────────────────────────────────────

export interface DealWonPayload {
  orgId: string;
  dealId: string;
  dealNumber: string;
  /** Primary product to build in the resulting work order. */
  productId: string;
  bomId: string;
  bomVersionLabel: string;
  quantity: string;
  /** MRP indent lines — one row per raw material to procure. */
  indentLines?: Array<{
    itemId: string;
    quantity: string;
    uom: string;
    estimatedCost?: string;
  }>;
  requestedBy?: string;
}

export interface QcInwardPassedPayload {
  orgId: string;
  grnId: string;
  grnNumber: string;
  vendorId?: string;
  vendorName?: string;
  itemId: string;
  warehouseId: string;
  quantity: string;
  uom: string;
  unitPrice?: string;
  grnLineId?: string;
}

export interface QcFinalPassedPayload {
  orgId: string;
  workOrderId: string;
  workOrderPid: string;
  /** Finished-good item id (the WO's output SKU). */
  productItemId: string;
  warehouseId: string;
  quantity: string;
  uom: string;
  unitCost?: string;
  /** Finance user to notify for valuation booking. */
  valuationRecipientUserId: string;
  /** Sales user (deal owner) to notify for customer handoff. */
  salesRecipientUserId: string;
  lotNumber?: string;
  deviceSerials?: string[];
}

export interface QcCertIssuedPayload {
  orgId: string;
  certId: string;
  certNumber: string;
  inspectionId: string;
  workOrderId?: string | null;
  productId?: string | null;
}

export interface DeliveryChallanConfirmedPayload {
  orgId: string;
  dcId: string;
  dcNumber: string;
  itemId: string;
  warehouseId: string;
  /** Positive value; handler writes a negative stock_ledger row. */
  quantity: string;
  uom: string;
  unitCost?: string;
  fromGstin: string;
  toGstin: string;
  customerGstin: string;
  /** Doc payload for NIC EWB generation. */
  ewbDocNo: string;
  ewbDocDate: string;
  totalValue: string;
  /** Customer contact for WhatsApp notification. */
  customerPhone?: string;
  customerName?: string;
  salesOrderId?: string;
}
