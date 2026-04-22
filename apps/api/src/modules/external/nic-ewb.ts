/**
 * NIC e-Way Bill client. ARCHITECTURE.md §3.4.
 *
 * Breaker config (per spec):
 *   - failureThreshold: 5
 *   - cooldownMs:       300_000   (5 minutes)
 *   - windowMs:         60_000    (default)
 *
 * Fallback strategy (per spec): when the breaker is OPEN or the call
 * fails past the client's one-shot budget, park the original payload
 * in `manual_entry_queue` with source='nic_ewb' so ops can either wait
 * for the breaker to heal and drain the row, or key the e-way bill into
 * the NIC portal by hand.
 *
 * Auth / transport details are out of scope for Phase 3 — the client
 * takes a transport hook so integration tests and the gate can drive
 * it without touching real NIC infrastructure.
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

/** NIC-facing request payload — intentionally loose; the NIC contract
 * is schema-versioned outside this repo and we don't want to couple. */
export interface NicEwbGeneratePayload {
  gstin: string;
  docType: "INV" | "CHL" | "BIL" | "BOE";
  docNo: string;
  docDate: string; // dd/mm/yyyy per NIC spec
  fromGstin: string;
  toGstin: string;
  totalValue: string;
  /** Caller-specific metadata — forwarded verbatim to NIC. */
  extra?: Record<string, unknown>;
  /** Traceable back-reference, persisted on the queue row. */
  referenceType?: string;
  referenceId?: string;
}

export interface NicEwbGenerateResponse {
  ewbNo: string;
  ewbDate: string;
  validUpto: string;
}

export interface NicEwbClientResult {
  status: "GENERATED" | "QUEUED";
  response?: NicEwbGenerateResponse;
  queued?: ManualEntryRow;
}

export interface NicEwbClientOptions {
  baseUrl: string;
  /** Bearer token / API key header — caller-supplied. */
  apiKey?: string;
  /** Per-call timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  transport?: HttpFetch;
  /** Breaker name override (for logs). Default "nic-ewb". */
  breakerName?: string;
  /** Override breaker settings — tests tune windowMs down. */
  breakerOverrides?: Partial<{
    failureThreshold: number;
    windowMs: number;
    cooldownMs: number;
  }>;
  /**
   * Observability hook: fires on every breaker state transition
   * (CLOSED↔OPEN↔HALF_OPEN). Intended for ops telemetry and Gate 36
   * which asserts the full recovery lifecycle — callers should
   * forward these to whatever log / metrics sink they use.
   */
  onBreakerStateChange?: (prev: BreakerState, next: BreakerState) => void;
}

/** Re-exported for callers wiring an onBreakerStateChange hook. */
export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export const NIC_EWB_BREAKER_DEFAULTS = Object.freeze({
  failureThreshold: 5,
  cooldownMs: 300_000,
  windowMs: 60_000,
});

export class NicEwbClient {
  readonly breaker: CircuitBreaker;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly transport?: HttpFetch;

  constructor(
    private readonly pool: pg.Pool,
    opts: NicEwbClientOptions,
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.transport = opts.transport;
    const over = opts.breakerOverrides ?? {};
    this.breaker = new CircuitBreaker({
      name: opts.breakerName ?? "nic-ewb",
      failureThreshold:
        over.failureThreshold ?? NIC_EWB_BREAKER_DEFAULTS.failureThreshold,
      cooldownMs: over.cooldownMs ?? NIC_EWB_BREAKER_DEFAULTS.cooldownMs,
      windowMs: over.windowMs ?? NIC_EWB_BREAKER_DEFAULTS.windowMs,
      ...(opts.onBreakerStateChange
        ? { onStateChange: opts.onBreakerStateChange }
        : {}),
    });
  }

  /**
   * Generate an e-Way Bill. On success: returns the NIC response and
   * nothing else happens. On failure OR when the breaker is already
   * OPEN: the payload is enqueued into manual_entry_queue and the
   * returned `status='QUEUED'` carries the queue row.
   *
   * The method NEVER throws on transport/breaker errors — the whole
   * point of the fallback is to keep the originating business
   * transaction moving. It DOES throw on programmer errors (bad orgId,
   * DB unavailable, etc.) because those aren't survivable.
   */
  async generate(
    orgId: string,
    payload: NicEwbGeneratePayload,
    context: { actorId?: string | null } = {},
  ): Promise<NicEwbClientResult> {
    try {
      const response = await this.breaker.execute(() =>
        httpJson<NicEwbGenerateResponse>(
          `${this.baseUrl}/ewayapi/v1/ewb`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({
              gstin: payload.gstin,
              docType: payload.docType,
              docNo: payload.docNo,
              docDate: payload.docDate,
              fromGstin: payload.fromGstin,
              toGstin: payload.toGstin,
              totalValue: payload.totalValue,
              ...(payload.extra ?? {}),
            }),
          },
          { timeoutMs: this.timeoutMs, transport: this.transport },
        ),
      );
      return { status: "GENERATED", response };
    } catch (err) {
      // Everything — breaker OPEN, 5xx, timeout — falls through to the
      // manual queue. We record the error so ops can triage.
      const queued = await this.enqueueFallback(orgId, payload, err, context);
      return { status: "QUEUED", queued };
    }
  }

  private async enqueueFallback(
    orgId: string,
    payload: NicEwbGeneratePayload,
    err: unknown,
    context: { actorId?: string | null },
  ): Promise<ManualEntryRow> {
    const message = describeError(err);
    return withOrg(this.pool, orgId, async (client) =>
      manualEntryQueueRepo.enqueue(client, {
        orgId,
        source: "nic_ewb",
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
