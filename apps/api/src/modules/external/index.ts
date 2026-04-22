/**
 * External-API clients. ARCHITECTURE.md §3.4.
 *
 * Re-exports + shared types for the three external integrations that sit
 * behind circuit breakers:
 *
 *   - NIC e-Way Bill   → NicEwbClient    (threshold 5, cooldown 5min)
 *   - GSTN e-Invoice   → GstnClient      (threshold 3, cooldown 60s)
 *   - WhatsApp Business→ WhatsAppClient  (threshold 5, cooldown 2min)
 *
 * Each client owns a CircuitBreaker (@instigenie/resilience) and a
 * fallback path into `manual_entry_queue` (or email, for WhatsApp).
 */

export {
  NicEwbClient,
  NIC_EWB_BREAKER_DEFAULTS,
  type NicEwbClientOptions,
  type NicEwbClientResult,
  type NicEwbGeneratePayload,
  type NicEwbGenerateResponse,
} from "./nic-ewb.js";

export {
  GstnClient,
  GSTN_BREAKER_DEFAULTS,
  type GstnClientOptions,
  type GstnClientResult,
  type GstnIrnPayload,
  type GstnIrnResponse,
} from "./gstn.js";

export {
  WhatsAppClient,
  WHATSAPP_BREAKER_DEFAULTS,
  type WhatsAppClientOptions,
  type WhatsAppClientResult,
  type WhatsAppSendPayload,
  type WhatsAppSendResponse,
  type EmailFallback,
} from "./whatsapp.js";

export {
  manualEntryQueueRepo,
  type ManualEntryRow,
  type ManualEntrySource,
  type EnqueueManualEntryInput,
} from "./manual-entry-queue.js";

export {
  httpJson,
  HttpStatusError,
  HttpTimeoutError,
  type HttpFetch,
  type HttpInit,
  type HttpResponse,
  type HttpCallOptions,
} from "./http.js";
