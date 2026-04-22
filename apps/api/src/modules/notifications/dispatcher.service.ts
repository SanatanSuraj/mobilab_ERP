/**
 * Notification dispatcher. ARCHITECTURE.md §3.6 (Phase 3).
 *
 * Phase 2 shipped the templates library + per-user inbox with "someone on
 * the inside calls notificationsRepo.create()". This dispatcher is the
 * Phase 3 fan-out engine: given an event and a set of recipients, render
 * every matching active template and ship it through the right channel
 * transport. Failures park in `notification_dispatch_dlq` so ops can see
 * exactly what the recipient would have seen.
 *
 * Channel map:
 *   - IN_APP    → notificationsRepo.create() — the outbox LISTEN/NOTIFY
 *                 trigger already wakes the SSE feed (ops/sql/triggers/
 *                 01-outbox-notify.sql), so there's no extra plumbing.
 *   - EMAIL     → injected EmailSender. On throw / error → DLQ.
 *   - WHATSAPP  → injected WhatsAppClient. WhatsAppClient already has its
 *                 own fallback ladder (email → manual_entry_queue), so the
 *                 dispatcher only DLQs when WhatsAppClient reports QUEUED.
 *
 * Deliberate non-goals:
 *   - No retry loop here; the DLQ drain job (not shipped in this gate) is
 *     what reruns PENDING rows. A single call to `dispatch()` is one
 *     attempt, full stop.
 *   - No subscription/preference matrix — the caller supplies recipients.
 *   - No throttling — BullMQ upstream is the right place for that.
 *   - Template rendering is intentionally dumb {{var}} replacement. We
 *     don't want to ship a full expression language for Phase 3, and the
 *     auditing story ("what exactly did we send?") is cleaner if the
 *     rendering step is obvious.
 */

import type pg from "pg";
import { withOrg } from "@instigenie/db";
import {
  type NotificationChannel,
  type NotificationDispatchAttempt,
  type NotificationDispatchRecipient,
  type NotificationDispatchRequest,
  type NotificationDispatchResult,
  type NotificationSeverity,
  type NotificationTemplate,
  NOTIFICATION_CHANNELS,
} from "@instigenie/contracts";
import { DependencyUnavailableError } from "@instigenie/errors";
import { notificationTemplatesRepo } from "./templates.repository.js";
import { notificationsRepo } from "./notifications.repository.js";
import { notificationDispatchDlqRepo } from "./dispatch.repository.js";
import {
  HttpStatusError,
  HttpTimeoutError,
} from "../external/http.js";
import type { WhatsAppClient } from "../external/whatsapp.js";

// ─── Adapter contracts (transport seam for email + WhatsApp) ─────────────────

/**
 * Minimal shape the dispatcher needs to send an email. Tests and ops
 * wiring pass their own implementation — this keeps SMTP/ESP details
 * completely out of the dispatcher.
 */
export interface EmailSender {
  send(input: {
    orgId: string;
    to: string;
    subject: string;
    body: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Minimal slice of WhatsAppClient the dispatcher depends on. Accepting an
 * interface rather than the class directly keeps the dispatcher testable
 * without standing up a breaker.
 */
export interface WhatsAppSendAdapter {
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
    emailedTo?: string;
    queued?: { id: string; lastError: string | null };
  }>;
}

// ─── Options + service class ────────────────────────────────────────────────

export interface DispatcherServiceOptions {
  emailSender?: EmailSender;
  whatsappClient?: WhatsAppSendAdapter | WhatsAppClient;
  /** Default severity when the template also doesn't declare one. */
  defaultSeverity?: NotificationSeverity;
}

export interface DispatcherCallContext {
  actorId?: string | null;
}

// ─── Template rendering ──────────────────────────────────────────────────────

/**
 * Mustache-style {{var}} replacement. Missing keys render as an empty
 * string — deliberately lenient because templates are author-edited and a
 * typo shouldn't nuke the whole notification.  We do NOT support nested
 * objects or helpers (that's what a real templating engine is for); keep
 * this boring so the security surface stays small.
 */
export function renderTemplate(
  tpl: string,
  variables: Record<string, string>,
): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const v = variables[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

export class DispatcherService {
  private readonly emailSender?: EmailSender;
  private readonly whatsapp?: WhatsAppSendAdapter | WhatsAppClient;
  private readonly defaultSeverity: NotificationSeverity;

  constructor(
    private readonly pool: pg.Pool,
    opts: DispatcherServiceOptions = {},
  ) {
    this.emailSender = opts.emailSender;
    this.whatsapp = opts.whatsappClient;
    this.defaultSeverity = opts.defaultSeverity ?? "INFO";
  }

  /**
   * Fan out one event to every recipient × (every active template that
   * matches the event on one of the requested channels). NEVER throws on
   * transport-level failure — those become DLQ rows. It does throw on
   * programmer errors (bad orgId, DB down, etc.) because those aren't
   * recoverable.
   */
  async dispatch(
    orgId: string,
    input: NotificationDispatchRequest,
    context: DispatcherCallContext = {},
  ): Promise<NotificationDispatchResult> {
    // 1. Resolve templates up front.  We're intentionally doing this in a
    //    short-lived withOrg transaction — once we have the templates,
    //    subsequent DLQ inserts + notification inserts each get their own
    //    txn so a slow email transport can't stall the DB connection.
    const channels = input.channels ?? NOTIFICATION_CHANNELS;
    const templates = await withOrg(this.pool, orgId, async (client) => {
      const entries = await Promise.all(
        channels.map(async (ch) => {
          const tpl = await notificationTemplatesRepo.findByEventChannel(
            client,
            input.eventType,
            ch,
          );
          return [ch, tpl] as const;
        }),
      );
      return new Map<NotificationChannel, NotificationTemplate | null>(entries);
    });

    // 2. Enrich recipient user ids to resolved email / phone / user row,
    //    so the per-channel handlers can do their addressing without
    //    another round-trip.  Only needed if we have EMAIL or WHATSAPP
    //    templates — for IN_APP we just need the userId.
    const needsContactLookup =
      (templates.get("EMAIL") ?? null) !== null ||
      (templates.get("WHATSAPP") ?? null) !== null;
    const contactIndex = needsContactLookup
      ? await this.resolveContacts(orgId, input.recipients)
      : new Map<string, { email: string | null; phone: string | null }>();

    // 3. Iterate recipients × channels and dispatch.
    const attempts: NotificationDispatchAttempt[] = [];
    for (const recipient of input.recipients) {
      for (const channel of channels) {
        const tpl = templates.get(channel) ?? null;
        if (!tpl || !tpl.isActive) {
          attempts.push(skipAttempt(channel, recipient, "SKIPPED_NO_TEMPLATE"));
          continue;
        }
        const resolvedContact = recipient.userId
          ? contactIndex.get(recipient.userId)
          : undefined;
        const result = await this.dispatchOne({
          orgId,
          input,
          recipient,
          channel,
          template: tpl,
          resolvedContact,
          context,
        });
        attempts.push(result);
      }
    }

    // 4. Summary counters.
    const summary = { delivered: 0, emailFallback: 0, dlq: 0, skipped: 0 };
    for (const a of attempts) {
      if (a.outcome === "DELIVERED") summary.delivered++;
      else if (a.outcome === "EMAIL_FALLBACK") summary.emailFallback++;
      else if (a.outcome === "DLQ") summary.dlq++;
      else summary.skipped++;
    }

    return { eventType: input.eventType, attempts, summary };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  /**
   * Hydrate user-id recipients into addressable contacts.  The `users`
   * table carries email only — phone is a WhatsApp-only addressing key
   * that Phase 3 expects the caller to supply per-recipient (or wire in
   * from a contacts/CRM table at a later phase).  For now, phone resolves
   * to null unless the recipient passed one explicitly.
   */
  private async resolveContacts(
    orgId: string,
    recipients: ReadonlyArray<NotificationDispatchRecipient>,
  ): Promise<Map<string, { email: string | null; phone: string | null }>> {
    const userIds = recipients
      .map((r) => r.userId)
      .filter((v): v is string => typeof v === "string");
    if (userIds.length === 0) return new Map();
    return withOrg(this.pool, orgId, async (client) => {
      const { rows } = await client.query<{
        id: string;
        email: string | null;
      }>(
        `SELECT id, email FROM users
          WHERE id = ANY($1::uuid[]) AND is_active = true`,
        [userIds],
      );
      const idx = new Map<
        string,
        { email: string | null; phone: string | null }
      >();
      for (const r of rows) {
        idx.set(r.id, { email: r.email, phone: null });
      }
      return idx;
    });
  }

  private async dispatchOne(args: {
    orgId: string;
    input: NotificationDispatchRequest;
    recipient: NotificationDispatchRecipient;
    channel: NotificationChannel;
    template: NotificationTemplate;
    resolvedContact?: { email: string | null; phone: string | null };
    context: DispatcherCallContext;
  }): Promise<NotificationDispatchAttempt> {
    const { orgId, input, recipient, channel, template, resolvedContact, context } = args;

    // Variable scope: global event vars + per-recipient overrides.
    const vars = {
      ...input.variables,
      ...(recipient.variables ?? {}),
    };
    const subject = template.subjectTemplate
      ? renderTemplate(template.subjectTemplate, vars)
      : null;
    const body = renderTemplate(template.bodyTemplate, vars);
    const severity =
      input.severity ?? template.defaultSeverity ?? this.defaultSeverity;

    switch (channel) {
      case "IN_APP":
        return this.handleInApp({
          orgId,
          input,
          recipient,
          template,
          subject,
          body,
          severity,
        });
      case "EMAIL":
        return this.handleEmail({
          orgId,
          input,
          recipient,
          template,
          subject,
          body,
          resolvedContact,
          context,
        });
      case "WHATSAPP":
        return this.handleWhatsApp({
          orgId,
          input,
          recipient,
          template,
          subject,
          body,
          resolvedContact,
          context,
        });
      default: {
        // Exhaustiveness guard — if a new channel is added to the enum the
        // TS compiler will catch that this switch is no longer total.
        const _exhaustive: never = channel;
        throw new Error(`unhandled channel: ${String(_exhaustive)}`);
      }
    }
  }

  private async handleInApp(args: {
    orgId: string;
    input: NotificationDispatchRequest;
    recipient: NotificationDispatchRecipient;
    template: NotificationTemplate;
    subject: string | null;
    body: string;
    severity: NotificationSeverity;
  }): Promise<NotificationDispatchAttempt> {
    const { orgId, input, recipient, template, subject, body, severity } = args;

    // IN_APP must land in a user inbox. Without a userId there's nothing
    // to target — DLQ it so ops see the ghost.
    if (!recipient.userId) {
      const dlq = await this.enqueueDlq({
        orgId,
        eventType: input.eventType,
        channel: "IN_APP",
        recipientUserId: null,
        templateId: template.id,
        subject,
        body,
        metadata: buildMetadata(input, recipient, null, null),
        lastError: "IN_APP dispatch requires recipient.userId",
      });
      return {
        channel: "IN_APP",
        outcome: "DLQ",
        notificationId: null,
        dlqId: dlq.id,
        recipientUserId: null,
        recipientEmail: null,
        recipientPhone: null,
        error: "IN_APP dispatch requires recipient.userId",
      };
    }

    try {
      const row = await withOrg(this.pool, orgId, async (client) =>
        notificationsRepo.create(client, orgId, {
          userId: recipient.userId!,
          eventType: input.eventType,
          severity,
          title: subject ?? template.name,
          body,
          linkUrl: input.linkUrl,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          templateId: template.id,
        }),
      );
      return {
        channel: "IN_APP",
        outcome: "DELIVERED",
        notificationId: row.id,
        dlqId: null,
        recipientUserId: recipient.userId,
        recipientEmail: null,
        recipientPhone: null,
        error: null,
      };
    } catch (err) {
      const message = describeError(err);
      const dlq = await this.enqueueDlq({
        orgId,
        eventType: input.eventType,
        channel: "IN_APP",
        recipientUserId: recipient.userId,
        templateId: template.id,
        subject,
        body,
        metadata: buildMetadata(input, recipient, null, null),
        lastError: message,
      });
      return {
        channel: "IN_APP",
        outcome: "DLQ",
        notificationId: null,
        dlqId: dlq.id,
        recipientUserId: recipient.userId,
        recipientEmail: null,
        recipientPhone: null,
        error: message,
      };
    }
  }

  private async handleEmail(args: {
    orgId: string;
    input: NotificationDispatchRequest;
    recipient: NotificationDispatchRecipient;
    template: NotificationTemplate;
    subject: string | null;
    body: string;
    resolvedContact?: { email: string | null; phone: string | null };
    context: DispatcherCallContext;
  }): Promise<NotificationDispatchAttempt> {
    const { orgId, input, recipient, template, subject, body, resolvedContact } =
      args;

    const to = recipient.email ?? resolvedContact?.email ?? null;
    if (!to) {
      return {
        channel: "EMAIL",
        outcome: "SKIPPED_NO_ADDRESS",
        notificationId: null,
        dlqId: null,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: null,
        recipientPhone: null,
        error: "no email address for recipient",
      };
    }
    const renderedSubject = subject ?? template.name;

    if (!this.emailSender) {
      const dlq = await this.enqueueDlq({
        orgId,
        eventType: input.eventType,
        channel: "EMAIL",
        recipientUserId: recipient.userId ?? null,
        templateId: template.id,
        subject: renderedSubject,
        body,
        metadata: buildMetadata(input, recipient, to, null),
        lastError: "email_sender_not_configured",
      });
      return {
        channel: "EMAIL",
        outcome: "DLQ",
        notificationId: null,
        dlqId: dlq.id,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: to,
        recipientPhone: null,
        error: "email_sender_not_configured",
      };
    }

    try {
      await this.emailSender.send({
        orgId,
        to,
        subject: renderedSubject,
        body,
        metadata: buildMetadata(input, recipient, to, null),
      });
      return {
        channel: "EMAIL",
        outcome: "DELIVERED",
        notificationId: null,
        dlqId: null,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: to,
        recipientPhone: null,
        error: null,
      };
    } catch (err) {
      const message = describeError(err);
      const dlq = await this.enqueueDlq({
        orgId,
        eventType: input.eventType,
        channel: "EMAIL",
        recipientUserId: recipient.userId ?? null,
        templateId: template.id,
        subject: renderedSubject,
        body,
        metadata: buildMetadata(input, recipient, to, null),
        lastError: message,
      });
      return {
        channel: "EMAIL",
        outcome: "DLQ",
        notificationId: null,
        dlqId: dlq.id,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: to,
        recipientPhone: null,
        error: message,
      };
    }
  }

  private async handleWhatsApp(args: {
    orgId: string;
    input: NotificationDispatchRequest;
    recipient: NotificationDispatchRecipient;
    template: NotificationTemplate;
    subject: string | null;
    body: string;
    resolvedContact?: { email: string | null; phone: string | null };
    context: DispatcherCallContext;
  }): Promise<NotificationDispatchAttempt> {
    const { orgId, input, recipient, template, subject, body, resolvedContact, context } =
      args;

    const to = recipient.phone ?? resolvedContact?.phone ?? null;
    if (!to) {
      return {
        channel: "WHATSAPP",
        outcome: "SKIPPED_NO_ADDRESS",
        notificationId: null,
        dlqId: null,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: null,
        recipientPhone: null,
        error: "no phone number for recipient",
      };
    }

    const renderedSubject = subject ?? template.name;
    const variables = extractWhatsAppVariables(template.bodyTemplate, {
      ...input.variables,
      ...(recipient.variables ?? {}),
    });
    const emailFallbackAddr =
      recipient.email ?? resolvedContact?.email ?? null;

    if (!this.whatsapp) {
      const dlq = await this.enqueueDlq({
        orgId,
        eventType: input.eventType,
        channel: "WHATSAPP",
        recipientUserId: recipient.userId ?? null,
        templateId: template.id,
        subject: renderedSubject,
        body,
        metadata: buildMetadata(input, recipient, emailFallbackAddr, to),
        lastError: "whatsapp_client_not_configured",
      });
      return {
        channel: "WHATSAPP",
        outcome: "DLQ",
        notificationId: null,
        dlqId: dlq.id,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: emailFallbackAddr,
        recipientPhone: to,
        error: "whatsapp_client_not_configured",
      };
    }

    try {
      const res = await this.whatsapp.send(
        orgId,
        {
          to,
          template: template.name,
          variables,
          emailFallback: emailFallbackAddr
            ? {
                to: emailFallbackAddr,
                subject: renderedSubject,
                body,
              }
            : undefined,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
        },
        { actorId: context.actorId ?? null },
      );
      if (res.status === "SENT") {
        return {
          channel: "WHATSAPP",
          outcome: "DELIVERED",
          notificationId: null,
          dlqId: null,
          recipientUserId: recipient.userId ?? null,
          recipientEmail: emailFallbackAddr,
          recipientPhone: to,
          error: null,
        };
      }
      if (res.status === "EMAIL_FALLBACK") {
        return {
          channel: "WHATSAPP",
          outcome: "EMAIL_FALLBACK",
          notificationId: null,
          dlqId: null,
          recipientUserId: recipient.userId ?? null,
          recipientEmail: res.emailedTo ?? emailFallbackAddr,
          recipientPhone: to,
          error: null,
        };
      }
      // QUEUED (WhatsApp + email both failed) → this is a real DLQ hit.
      const dlq = await this.enqueueDlq({
        orgId,
        eventType: input.eventType,
        channel: "WHATSAPP",
        recipientUserId: recipient.userId ?? null,
        templateId: template.id,
        subject: renderedSubject,
        body,
        metadata: {
          ...buildMetadata(input, recipient, emailFallbackAddr, to),
          manualEntryQueueId: res.queued?.id ?? null,
        },
        lastError:
          res.queued?.lastError ?? "whatsapp send QUEUED (manual_entry_queue)",
      });
      return {
        channel: "WHATSAPP",
        outcome: "DLQ",
        notificationId: null,
        dlqId: dlq.id,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: emailFallbackAddr,
        recipientPhone: to,
        error: res.queued?.lastError ?? "whatsapp_queued",
      };
    } catch (err) {
      // WhatsAppClient.send() doesn't normally throw, but an adapter or
      // test double might — belt-and-suspenders path into the DLQ.
      const message = describeError(err);
      const dlq = await this.enqueueDlq({
        orgId,
        eventType: input.eventType,
        channel: "WHATSAPP",
        recipientUserId: recipient.userId ?? null,
        templateId: template.id,
        subject: renderedSubject,
        body,
        metadata: buildMetadata(input, recipient, emailFallbackAddr, to),
        lastError: message,
      });
      return {
        channel: "WHATSAPP",
        outcome: "DLQ",
        notificationId: null,
        dlqId: dlq.id,
        recipientUserId: recipient.userId ?? null,
        recipientEmail: emailFallbackAddr,
        recipientPhone: to,
        error: message,
      };
    }
  }

  private async enqueueDlq(input: {
    orgId: string;
    eventType: string;
    channel: NotificationChannel;
    recipientUserId: string | null;
    templateId: string | null;
    subject: string | null;
    body: string;
    metadata: Record<string, unknown>;
    lastError: string | null;
  }) {
    return withOrg(this.pool, input.orgId, async (client) =>
      notificationDispatchDlqRepo.enqueue(client, input),
    );
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function skipAttempt(
  channel: NotificationChannel,
  recipient: NotificationDispatchRecipient,
  outcome: "SKIPPED_NO_TEMPLATE" | "SKIPPED_NO_ADDRESS",
): NotificationDispatchAttempt {
  return {
    channel,
    outcome,
    notificationId: null,
    dlqId: null,
    recipientUserId: recipient.userId ?? null,
    recipientEmail: recipient.email ?? null,
    recipientPhone: recipient.phone ?? null,
    error: null,
  };
}

function buildMetadata(
  input: NotificationDispatchRequest,
  recipient: NotificationDispatchRecipient,
  email: string | null,
  phone: string | null,
): Record<string, unknown> {
  return {
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    linkUrl: input.linkUrl ?? null,
    recipient: {
      userId: recipient.userId ?? null,
      email,
      phone,
    },
    variables: { ...input.variables, ...(recipient.variables ?? {}) },
  };
}

/**
 * Extract the ordered positional variable list WhatsApp needs for its
 * template send. We scan the body template for `{{name}}` tokens in
 * order and look each one up in the variable bag. Unknown names fall
 * through as empty strings (same lenient policy as renderTemplate so the
 * send doesn't fail on a typo).
 */
function extractWhatsAppVariables(
  tpl: string,
  variables: Record<string, string>,
): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl)) !== null) {
    const key = m[1]!;
    out.push(variables[key] ?? "");
  }
  return out;
}

function describeError(err: unknown): string {
  if (err instanceof DependencyUnavailableError)
    return `breaker_open: ${err.message}`;
  if (err instanceof HttpTimeoutError) return `timeout: ${err.message}`;
  if (err instanceof HttpStatusError)
    return `http_${err.status}: ${err.body.slice(0, 240)}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
