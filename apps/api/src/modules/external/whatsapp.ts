/**
 * WhatsApp Business API client. ARCHITECTURE.md §3.4.
 *
 * Breaker config (per spec):
 *   - failureThreshold: 5
 *   - cooldownMs:       120_000   (2 minutes)
 *   - windowMs:         60_000    (default)
 *
 * Fallback (per spec): when the breaker is OPEN or the call fails, the
 * message is re-routed to email. We don't ship the email transport in
 * Phase 3 — callers supply an `EmailFallback` hook (something that
 * accepts { to, subject, body } and returns a promise). The hook is also
 * injected in tests so we can assert the fallback fired.
 *
 * If no fallback is wired, the call is still logged into manual_entry_queue
 * so ops isn't in the dark. This makes the client safe to use even during
 * early bring-up, before email is wired.
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

export interface WhatsAppSendPayload {
  /** E.164, e.g. "+919876543210". */
  to: string;
  /** Business-approved template name — mandatory for outbound WABA. */
  template: string;
  /** Template variables, in order. */
  variables?: string[];
  /** Optional address fallback for email re-route. */
  emailFallback?: {
    to: string;
    subject: string;
    /** Plaintext body. A richer body can be composed from template +
     * variables on the caller side. */
    body: string;
  };
  referenceType?: string;
  referenceId?: string;
}

export interface WhatsAppSendResponse {
  messageId: string;
  status: "queued" | "sent" | "delivered" | "failed";
}

export interface WhatsAppClientResult {
  status: "SENT" | "EMAIL_FALLBACK" | "QUEUED";
  response?: WhatsAppSendResponse;
  queued?: ManualEntryRow;
  emailedTo?: string;
}

/**
 * Adapter for the email re-route fallback. `@instigenie/notifications` (or
 * any ESP client) supplies an implementation at construction time.
 */
export type EmailFallback = (input: {
  orgId: string;
  to: string;
  subject: string;
  body: string;
}) => Promise<void>;

export interface WhatsAppClientOptions {
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
  /** Injected email fallback. Called when the WhatsApp call can't land. */
  emailFallback?: EmailFallback;
}

export const WHATSAPP_BREAKER_DEFAULTS = Object.freeze({
  failureThreshold: 5,
  cooldownMs: 120_000,
  windowMs: 60_000,
});

export class WhatsAppClient {
  readonly breaker: CircuitBreaker;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly transport?: HttpFetch;
  private readonly emailFallback?: EmailFallback;

  constructor(
    private readonly pool: pg.Pool,
    opts: WhatsAppClientOptions,
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.transport = opts.transport;
    this.emailFallback = opts.emailFallback;
    const over = opts.breakerOverrides ?? {};
    this.breaker = new CircuitBreaker({
      name: opts.breakerName ?? "whatsapp",
      failureThreshold:
        over.failureThreshold ?? WHATSAPP_BREAKER_DEFAULTS.failureThreshold,
      cooldownMs: over.cooldownMs ?? WHATSAPP_BREAKER_DEFAULTS.cooldownMs,
      windowMs: over.windowMs ?? WHATSAPP_BREAKER_DEFAULTS.windowMs,
    });
  }

  async send(
    orgId: string,
    payload: WhatsAppSendPayload,
    context: { actorId?: string | null } = {},
  ): Promise<WhatsAppClientResult> {
    try {
      const response = await this.breaker.execute(() =>
        httpJson<WhatsAppSendResponse>(
          `${this.baseUrl}/messages`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({
              to: payload.to,
              type: "template",
              template: {
                name: payload.template,
                components: payload.variables
                  ? [
                      {
                        type: "body",
                        parameters: payload.variables.map((text) => ({
                          type: "text",
                          text,
                        })),
                      },
                    ]
                  : [],
              },
            }),
          },
          { timeoutMs: this.timeoutMs, transport: this.transport },
        ),
      );
      return { status: "SENT", response };
    } catch (err) {
      // Primary fallback: email. Secondary: park the payload in the
      // manual-entry queue so ops still see it (and so a test without
      // an emailFallback wired still has something observable).
      if (this.emailFallback && payload.emailFallback) {
        try {
          await this.emailFallback({
            orgId,
            to: payload.emailFallback.to,
            subject: payload.emailFallback.subject,
            body: payload.emailFallback.body,
          });
          return { status: "EMAIL_FALLBACK", emailedTo: payload.emailFallback.to };
        } catch (emailErr) {
          // Both paths failed — park the original payload plus both errors.
          const queued = await this.enqueueFallback(orgId, payload, emailErr, context);
          return { status: "QUEUED", queued };
        }
      }
      const queued = await this.enqueueFallback(orgId, payload, err, context);
      return { status: "QUEUED", queued };
    }
  }

  private async enqueueFallback(
    orgId: string,
    payload: WhatsAppSendPayload,
    err: unknown,
    context: { actorId?: string | null },
  ): Promise<ManualEntryRow> {
    const message = describeError(err);
    return withOrg(this.pool, orgId, async (client) =>
      manualEntryQueueRepo.enqueue(client, {
        orgId,
        source: "whatsapp",
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
