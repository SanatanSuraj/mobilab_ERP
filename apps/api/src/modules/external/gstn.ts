/**
 * GSTN (e-invoice) client. ARCHITECTURE.md §3.4.
 *
 * Breaker config (per spec):
 *   - failureThreshold: 3
 *   - cooldownMs:       60_000    (1 minute)
 *   - windowMs:         60_000    (default)
 *
 * Fallback: the spec does NOT call out a user-visible fallback for GSTN
 * — failed e-invoice calls still hurt (the invoice can't go out without
 * an IRN) so we surface a `DependencyUnavailableError` to the caller and
 * also park the payload in `manual_entry_queue` with source='gstn' so
 * finance ops can retry/escalate. This is the same "don't silently drop"
 * discipline we use for EWB.
 */

import type pg from "pg";
import { CircuitBreaker } from "@instigenie/resilience";
import { DependencyUnavailableError } from "@instigenie/errors";
import { withOrg } from "@instigenie/db";
import { httpJson, type HttpFetch, HttpTimeoutError, HttpStatusError } from "./http.js";
import {
  manualEntryQueueRepo,
  type ManualEntryRow,
} from "./manual-entry-queue.js";

export interface GstnIrnPayload {
  sellerGstin: string;
  buyerGstin: string;
  invoiceNo: string;
  invoiceDate: string; // dd/mm/yyyy
  totalValue: string;
  /** Caller metadata forwarded verbatim — line items, HSN, etc. */
  extra?: Record<string, unknown>;
  referenceType?: string;
  referenceId?: string;
}

export interface GstnIrnResponse {
  irn: string;
  ackNo: string;
  ackDate: string;
  signedInvoice: string;
  signedQrCode: string;
}

export interface GstnClientResult {
  status: "GENERATED" | "QUEUED";
  response?: GstnIrnResponse;
  queued?: ManualEntryRow;
}

export interface GstnClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  transport?: HttpFetch;
  breakerName?: string;
  breakerOverrides?: Partial<{
    failureThreshold: number;
    windowMs: number;
    cooldownMs: number;
  }>;
}

export const GSTN_BREAKER_DEFAULTS = Object.freeze({
  failureThreshold: 3,
  cooldownMs: 60_000,
  windowMs: 60_000,
});

export class GstnClient {
  readonly breaker: CircuitBreaker;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly transport?: HttpFetch;

  constructor(
    private readonly pool: pg.Pool,
    opts: GstnClientOptions,
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.transport = opts.transport;
    const over = opts.breakerOverrides ?? {};
    this.breaker = new CircuitBreaker({
      name: opts.breakerName ?? "gstn-einv",
      failureThreshold:
        over.failureThreshold ?? GSTN_BREAKER_DEFAULTS.failureThreshold,
      cooldownMs: over.cooldownMs ?? GSTN_BREAKER_DEFAULTS.cooldownMs,
      windowMs: over.windowMs ?? GSTN_BREAKER_DEFAULTS.windowMs,
    });
  }

  async generateIrn(
    orgId: string,
    payload: GstnIrnPayload,
    context: { actorId?: string | null } = {},
  ): Promise<GstnClientResult> {
    try {
      const response = await this.breaker.execute(() =>
        httpJson<GstnIrnResponse>(
          `${this.baseUrl}/einvapi/v1/invoice`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({
              sellerGstin: payload.sellerGstin,
              buyerGstin: payload.buyerGstin,
              invoiceNo: payload.invoiceNo,
              invoiceDate: payload.invoiceDate,
              totalValue: payload.totalValue,
              ...(payload.extra ?? {}),
            }),
          },
          { timeoutMs: this.timeoutMs, transport: this.transport },
        ),
      );
      return { status: "GENERATED", response };
    } catch (err) {
      const queued = await this.enqueueFallback(orgId, payload, err, context);
      return { status: "QUEUED", queued };
    }
  }

  private async enqueueFallback(
    orgId: string,
    payload: GstnIrnPayload,
    err: unknown,
    context: { actorId?: string | null },
  ): Promise<ManualEntryRow> {
    const message = describeError(err);
    return withOrg(this.pool, orgId, async (client) =>
      manualEntryQueueRepo.enqueue(client, {
        orgId,
        source: "gstn",
        payload: payload as unknown as Record<string, unknown>,
        referenceType: payload.referenceType ?? null,
        referenceId: payload.referenceId ?? null,
        lastError: message,
        enqueuedBy: context.actorId ?? null,
      }),
    );
  }
}

function describeError(err: unknown): string {
  if (err instanceof DependencyUnavailableError) return `breaker_open: ${err.message}`;
  if (err instanceof HttpTimeoutError) return `timeout: ${err.message}`;
  if (err instanceof HttpStatusError)
    return `http_${err.status}: ${err.body.slice(0, 240)}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
