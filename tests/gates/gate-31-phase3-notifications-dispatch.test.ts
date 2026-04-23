/**
 * Gate 31 — ARCHITECTURE.md Phase 3 §3.6 "Notifications dispatch".
 *
 * Phase 2 shipped the templates library + per-user inbox. Phase 3 ships
 * the dispatcher that takes an event + recipients and fans out across
 * IN_APP, EMAIL, and WHATSAPP channels, DLQ-ing any channel that fails.
 *
 * This gate asserts:
 *
 *   1. Template routing: a single call with three active templates
 *      (IN_APP + EMAIL + WHATSAPP for the same event_type) produces three
 *      delivery attempts, one per channel.
 *
 *   2. {{var}} rendering: the in-app row's title/body and the email
 *      subject/body reflect the substituted variable bag.
 *
 *   3. IN_APP success → a notifications row is created for the recipient.
 *      (LISTEN/NOTIFY → SSE is orthogonal; the dispatcher's contract is
 *      "inbox row exists".)
 *
 *   4. EMAIL success → the injected EmailSender is called with the
 *      rendered subject + body.
 *
 *   5. EMAIL failure → a notification_dispatch_dlq row is inserted with
 *      last_error populated and status='PENDING'.
 *
 *   6. WHATSAPP SENT status → no DLQ row.
 *
 *   7. WHATSAPP QUEUED status (upstream manual_entry_queue already took
 *      the original payload) → a DLQ row lands for audit.
 *
 *   8. No template for a channel → SKIPPED_NO_TEMPLATE (no DLQ, no row).
 *
 *   9. Missing address (no email / no phone) → SKIPPED_NO_ADDRESS and
 *      no DLQ row.
 *
 *  10. channels[] override: passing `channels: ['IN_APP']` skips the
 *      EMAIL + WHATSAPP templates even when they're active.
 *
 *  11. Dispatcher NEVER throws on channel-level failure (partial success
 *      is honored — one channel DLQs while another delivers).
 *
 * The tests run against the dev `instigenie-postgres` instance so all repo
 * writes are real. Email + WhatsApp transports are stubbed — we never
 * hit real infrastructure.
 *
 * Cleanup: every gate-31 row is tagged with reference_type prefix of
 * 'gate-31/' (notifications) or event_type prefix of 'gate31.*'
 * (templates + DLQ rows).  beforeEach wipes rows matching those.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import {
  DispatcherService,
  notificationDispatchDlqRepo,
  notificationTemplatesRepo,
  renderTemplate,
  type EmailSender,
  type WhatsAppSendAdapter,
} from "@instigenie/api/notifications";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// Dev admin from 03-dev-org-users.sql.
const DEV_ADMIN_ID = "00000000-0000-0000-0000-00000000b001";
// Dev finance user — second recipient to prove the dispatcher fans out.
const DEV_FINANCE_ID = "00000000-0000-0000-0000-00000000b005";

const EVENT_TYPE = "gate31.event";
const CHANNELS_EVENT = "gate31.multichannel";
const EVENT_NO_TEMPLATE = "gate31.no_template";

// ─── stub adapters ──────────────────────────────────────────────────────────

interface EmailCall {
  to: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

interface StubEmailSender extends EmailSender {
  calls: EmailCall[];
  /** Next send() throws the supplied error. */
  throwNext?: Error;
  reset(): void;
}

function makeStubEmail(): StubEmailSender {
  const sender: StubEmailSender = {
    calls: [],
    async send(input) {
      if (sender.throwNext) {
        const err = sender.throwNext;
        sender.throwNext = undefined;
        throw err;
      }
      sender.calls.push({
        to: input.to,
        subject: input.subject,
        body: input.body,
        metadata: input.metadata,
      });
    },
    reset() {
      sender.calls.length = 0;
      sender.throwNext = undefined;
    },
  };
  return sender;
}

interface WhatsAppCall {
  to: string;
  template: string;
  variables?: string[];
  emailFallbackTo?: string | null;
}

interface StubWhatsApp extends WhatsAppSendAdapter {
  calls: WhatsAppCall[];
  /** Next send() returns this status instead of SENT. */
  nextOutcome?: "SENT" | "EMAIL_FALLBACK" | "QUEUED";
  reset(): void;
}

function makeStubWhatsApp(): StubWhatsApp {
  const adapter: StubWhatsApp = {
    calls: [],
    async send(_orgId, payload) {
      adapter.calls.push({
        to: payload.to,
        template: payload.template,
        variables: payload.variables,
        emailFallbackTo: payload.emailFallback?.to ?? null,
      });
      const outcome = adapter.nextOutcome ?? "SENT";
      adapter.nextOutcome = undefined;
      if (outcome === "SENT") {
        return {
          status: "SENT",
          response: { messageId: "wamid.stub", status: "sent" },
        };
      }
      if (outcome === "EMAIL_FALLBACK") {
        return {
          status: "EMAIL_FALLBACK",
          emailedTo: payload.emailFallback?.to,
        };
      }
      return {
        status: "QUEUED",
        queued: { id: "meq-stub", lastError: "whatsapp unreachable" },
      };
    },
    reset() {
      adapter.calls.length = 0;
      adapter.nextOutcome = undefined;
    },
  };
  return adapter;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

async function wipeGate31Rows(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      DEV_ADMIN_ID,
    ]);
    await client.query(
      `DELETE FROM notification_dispatch_dlq
         WHERE event_type LIKE 'gate31.%'`,
    );
    await client.query(
      `DELETE FROM notifications
         WHERE event_type LIKE 'gate31.%'
            OR reference_type LIKE 'gate-31/%'`,
    );
    // Hard-delete templates we created for this gate (soft-delete won't
    // release the unique-by-event-channel partial index, so a re-run
    // would fail with 23505).
    await client.query(
      `DELETE FROM notification_templates
         WHERE event_type LIKE 'gate31.%'`,
    );
  });
}

async function seedTemplates(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      DEV_ADMIN_ID,
    ]);
    // Event with all three channels — happy multichannel fan-out.
    await notificationTemplatesRepo.create(client, DEV_ORG_ID, DEV_ADMIN_ID, {
      eventType: CHANNELS_EVENT,
      channel: "IN_APP",
      name: "Multichannel In-App",
      description: "gate-31 in-app",
      subjectTemplate: "Hello {{name}}",
      bodyTemplate: "Order {{orderNo}} is {{status}}.",
      defaultSeverity: "INFO",
      isActive: true,
    });
    await notificationTemplatesRepo.create(client, DEV_ORG_ID, DEV_ADMIN_ID, {
      eventType: CHANNELS_EVENT,
      channel: "EMAIL",
      name: "Multichannel Email",
      description: "gate-31 email",
      subjectTemplate: "[Instigenie] Update {{orderNo}}",
      bodyTemplate: "Hi {{name}},\nOrder {{orderNo}} is now {{status}}.",
      defaultSeverity: "INFO",
      isActive: true,
    });
    await notificationTemplatesRepo.create(client, DEV_ORG_ID, DEV_ADMIN_ID, {
      eventType: CHANNELS_EVENT,
      channel: "WHATSAPP",
      name: "Multichannel WhatsApp",
      description: "gate-31 whatsapp",
      // subjectTemplate omitted — WABA templates don't carry subjects.
      bodyTemplate: "Order {{orderNo}} is {{status}}. Hi {{name}}.",
      defaultSeverity: "INFO",
      isActive: true,
    });
    // Event with ONLY IN_APP — drives the SKIPPED_NO_TEMPLATE assertion
    // for the other channels.
    await notificationTemplatesRepo.create(client, DEV_ORG_ID, DEV_ADMIN_ID, {
      eventType: EVENT_TYPE,
      channel: "IN_APP",
      name: "Single Channel In-App",
      description: "gate-31 single",
      subjectTemplate: "Hi {{name}}",
      bodyTemplate: "Your {{what}} is ready.",
      defaultSeverity: "INFO",
      isActive: true,
    });
  });
}

async function countDlqRows(
  pool: pg.Pool,
  filter: { eventType?: string; channel?: string } = {},
): Promise<number> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      DEV_ADMIN_ID,
    ]);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.eventType) {
      params.push(filter.eventType);
      where.push(`event_type = $${params.length}`);
    } else {
      where.push(`event_type LIKE 'gate31.%'`);
    }
    if (filter.channel) {
      params.push(filter.channel);
      where.push(`channel = $${params.length}`);
    }
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::bigint AS n
         FROM notification_dispatch_dlq
        WHERE ${where.join(" AND ")}`,
      params,
    );
    return Number(rows[0]!.n);
  });
}

async function countInboxRows(
  pool: pg.Pool,
  filter: { eventType?: string; userId?: string } = {},
): Promise<number> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      DEV_ADMIN_ID,
    ]);
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (filter.eventType) {
      params.push(filter.eventType);
      where.push(`event_type = $${params.length}`);
    } else {
      where.push(`event_type LIKE 'gate31.%'`);
    }
    if (filter.userId) {
      params.push(filter.userId);
      where.push(`user_id = $${params.length}`);
    }
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM notifications
        WHERE ${where.join(" AND ")}`,
      params,
    );
    return Number(rows[0]!.n);
  });
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("gate-31 (arch phase 3.6): notification dispatch", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    await wipeGate31Rows(pool);
    await seedTemplates(pool);
  });

  afterAll(async () => {
    await wipeGate31Rows(pool);
    await pool.end();
  });

  beforeEach(async () => {
    // Only wipe rows the DispatcherService produces — keep the templates
    // seeded in beforeAll so every test starts from a known library state.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [
        DEV_ADMIN_ID,
      ]);
      await client.query(
        `DELETE FROM notification_dispatch_dlq
           WHERE event_type LIKE 'gate31.%'`,
      );
      await client.query(
        `DELETE FROM notifications
           WHERE event_type LIKE 'gate31.%'`,
      );
    });
  });

  // ── 0. renderTemplate helper ────────────────────────────────────────────

  describe("0. renderTemplate helper", () => {
    it("substitutes {{var}} tokens and tolerates missing keys", () => {
      expect(
        renderTemplate("Hi {{name}}, order {{orderNo}} ({{status}})", {
          name: "Ada",
          orderNo: "SO-100",
          status: "shipped",
        }),
      ).toBe("Hi Ada, order SO-100 (shipped)");
      // Missing key → empty string, not literal "{{x}}"
      expect(renderTemplate("Hi {{unknown}} done", {})).toBe("Hi  done");
      // Whitespace inside the braces should be tolerated.
      expect(renderTemplate("{{  name  }}", { name: "ok" })).toBe("ok");
    });
  });

  // ── 1. Template fan-out ────────────────────────────────────────────────

  describe("1. template routing fans out across channels", () => {
    it("dispatches one attempt per (recipient, channel-with-template)", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [
          { userId: DEV_ADMIN_ID, phone: "+919876543210" },
        ],
      });
      expect(result.attempts).toHaveLength(3);
      const byChannel = Object.fromEntries(
        result.attempts.map((a) => [a.channel, a.outcome]),
      );
      expect(byChannel.IN_APP).toBe("DELIVERED");
      expect(byChannel.EMAIL).toBe("DELIVERED");
      expect(byChannel.WHATSAPP).toBe("DELIVERED");
      expect(result.summary.delivered).toBe(3);
      expect(result.summary.dlq).toBe(0);
      expect(result.summary.skipped).toBe(0);
    });

    it("skips channels that have no matching template", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: EVENT_TYPE, // IN_APP only
        variables: { name: "Ada", what: "report" },
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      expect(result.attempts).toHaveLength(3);
      const byChannel = Object.fromEntries(
        result.attempts.map((a) => [a.channel, a.outcome]),
      );
      expect(byChannel.IN_APP).toBe("DELIVERED");
      expect(byChannel.EMAIL).toBe("SKIPPED_NO_TEMPLATE");
      expect(byChannel.WHATSAPP).toBe("SKIPPED_NO_TEMPLATE");
      expect(email.calls).toHaveLength(0);
      expect(whatsapp.calls).toHaveLength(0);
    });

    it("skips an unseen event entirely", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: EVENT_NO_TEMPLATE,
        variables: {},
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      expect(result.summary.skipped).toBe(3);
      expect(result.summary.delivered).toBe(0);
      expect(await countDlqRows(pool)).toBe(0);
    });

    it("channels[] override limits fan-out to the requested subset", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["IN_APP"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]!.channel).toBe("IN_APP");
      expect(result.attempts[0]!.outcome).toBe("DELIVERED");
      expect(email.calls).toHaveLength(0);
      expect(whatsapp.calls).toHaveLength(0);
    });
  });

  // ── 2. {{var}} rendering end-to-end ────────────────────────────────────

  describe("2. {{var}} rendering reaches the channel outputs", () => {
    it("in-app row body + email body reflect the variable bag", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        variables: { name: "Ada", orderNo: "SO-99", status: "packed" },
        referenceType: "gate-31/render",
        recipients: [{ userId: DEV_ADMIN_ID, phone: "+919876543210" }],
      });
      // In-app row check.
      const inbox = await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        const { rows } = await client.query<{ title: string; body: string }>(
          `SELECT title, body FROM notifications
            WHERE event_type = $1 AND user_id = $2
            ORDER BY created_at DESC LIMIT 1`,
          [CHANNELS_EVENT, DEV_ADMIN_ID],
        );
        return rows[0];
      });
      expect(inbox).toBeDefined();
      expect(inbox!.title).toBe("Hello Ada");
      expect(inbox!.body).toBe("Order SO-99 is packed.");
      // Email check.
      expect(email.calls).toHaveLength(1);
      expect(email.calls[0]!.subject).toBe("[Instigenie] Update SO-99");
      expect(email.calls[0]!.body).toContain("Order SO-99 is now packed.");
      // WhatsApp variables (positional, in template-order).
      expect(whatsapp.calls).toHaveLength(1);
      expect(whatsapp.calls[0]!.variables).toEqual(["SO-99", "packed", "Ada"]);
    });

    it("per-recipient variables override event-level variables", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        variables: { name: "GLOBAL", orderNo: "SO-42", status: "shipped" },
        recipients: [
          {
            userId: DEV_ADMIN_ID,
            phone: "+919876543210",
            variables: { name: "LOCAL" },
          },
        ],
      });
      expect(email.calls[0]!.body).toContain("Hi LOCAL,");
    });
  });

  // ── 3. IN_APP success writes to notifications ──────────────────────────

  describe("3. IN_APP delivery writes to the notifications table", () => {
    it("creates one notifications row per recipient and carries template_id", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["IN_APP"],
        variables: { name: "Ada", orderNo: "SO-50", status: "paid" },
        referenceType: "gate-31/inbox",
        recipients: [
          { userId: DEV_ADMIN_ID },
          { userId: DEV_FINANCE_ID },
        ],
      });
      expect(result.summary.delivered).toBe(2);
      expect(await countInboxRows(pool, { eventType: CHANNELS_EVENT })).toBe(2);
      // Row for dev admin has the right template_id + reference_type.
      const row = await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        const { rows } = await client.query<{
          template_id: string | null;
          reference_type: string | null;
        }>(
          `SELECT template_id, reference_type FROM notifications
            WHERE event_type = $1 AND user_id = $2
            ORDER BY created_at DESC LIMIT 1`,
          [CHANNELS_EVENT, DEV_ADMIN_ID],
        );
        return rows[0];
      });
      expect(row?.template_id).not.toBeNull();
      expect(row?.reference_type).toBe("gate-31/inbox");
    });

    it("DLQs IN_APP when the recipient has no userId", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["IN_APP"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ email: "ada@example.com" }], // no userId
      });
      expect(result.summary.delivered).toBe(0);
      expect(result.summary.dlq).toBe(1);
      expect(await countDlqRows(pool, { channel: "IN_APP" })).toBe(1);
    });
  });

  // ── 4. EMAIL: success calls sender; failure DLQs ───────────────────────

  describe("4. EMAIL channel", () => {
    it("calls the injected EmailSender with rendered subject + body", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["EMAIL"],
        variables: { name: "Ada", orderNo: "SO-50", status: "paid" },
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      expect(email.calls).toHaveLength(1);
      expect(email.calls[0]!.to).toBe("admin@instigenie.local");
      expect(email.calls[0]!.subject).toBe("[Instigenie] Update SO-50");
    });

    it("DLQs an EMAIL when EmailSender throws", async () => {
      const email = makeStubEmail();
      email.throwNext = new Error("smtp down");
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["EMAIL"],
        variables: { name: "Ada", orderNo: "SO-50", status: "paid" },
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      expect(result.summary.delivered).toBe(0);
      expect(result.summary.dlq).toBe(1);
      expect(await countDlqRows(pool, { channel: "EMAIL" })).toBe(1);
      // Inspect the row — it must carry rendered body + the error.
      const dlqRow = await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        const rows = await notificationDispatchDlqRepo.list(client, {
          channel: "EMAIL",
          eventType: CHANNELS_EVENT,
        });
        return rows[0]!;
      });
      expect(dlqRow.status).toBe("PENDING");
      expect(dlqRow.lastError).toMatch(/smtp down/);
      expect(dlqRow.body).toContain("Order SO-50");
    });

    it("SKIPPED_NO_ADDRESS when the recipient has no resolvable email", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["EMAIL"],
        variables: { name: "Ada", orderNo: "SO-50", status: "paid" },
        // No userId lookup seed + no email supplied = no address resolvable.
        recipients: [{ phone: "+919876543210" }],
      });
      expect(result.attempts[0]!.outcome).toBe("SKIPPED_NO_ADDRESS");
      expect(email.calls).toHaveLength(0);
      expect(await countDlqRows(pool, { channel: "EMAIL" })).toBe(0);
    });

    it("DLQs when no EmailSender is configured at all", async () => {
      const svc = new DispatcherService(pool, {
        // no emailSender
        whatsappClient: makeStubWhatsApp(),
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["EMAIL"],
        variables: { name: "Ada", orderNo: "SO-50", status: "paid" },
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      expect(result.summary.dlq).toBe(1);
      expect(await countDlqRows(pool, { channel: "EMAIL" })).toBe(1);
    });
  });

  // ── 5. WHATSAPP: SENT vs QUEUED vs EMAIL_FALLBACK ──────────────────────

  describe("5. WHATSAPP channel", () => {
    it("forwards positional variables in template order and reports DELIVERED", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["WHATSAPP"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID, phone: "+919876543210" }],
      });
      expect(result.summary.delivered).toBe(1);
      expect(whatsapp.calls).toHaveLength(1);
      // Template body: "Order {{orderNo}} is {{status}}. Hi {{name}}."
      // → positional: [orderNo, status, name]
      expect(whatsapp.calls[0]!.variables).toEqual(["SO-42", "shipped", "Ada"]);
      // Email fallback is wired because the resolved user has an email on file.
      expect(whatsapp.calls[0]!.emailFallbackTo).toBe("admin@instigenie.local");
    });

    it("EMAIL_FALLBACK outcome from WhatsAppClient is NOT a DLQ", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      whatsapp.nextOutcome = "EMAIL_FALLBACK";
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["WHATSAPP"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID, phone: "+919876543210" }],
      });
      expect(result.attempts[0]!.outcome).toBe("EMAIL_FALLBACK");
      expect(result.summary.emailFallback).toBe(1);
      expect(result.summary.dlq).toBe(0);
      expect(await countDlqRows(pool, { channel: "WHATSAPP" })).toBe(0);
    });

    it("QUEUED outcome DLQs (both WhatsApp + email failed upstream)", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      whatsapp.nextOutcome = "QUEUED";
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["WHATSAPP"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID, phone: "+919876543210" }],
      });
      expect(result.summary.dlq).toBe(1);
      expect(await countDlqRows(pool, { channel: "WHATSAPP" })).toBe(1);
      const dlqRow = await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        const rows = await notificationDispatchDlqRepo.list(client, {
          channel: "WHATSAPP",
          eventType: CHANNELS_EVENT,
        });
        return rows[0]!;
      });
      expect(dlqRow.lastError).toMatch(/whatsapp unreachable/);
      // metadata.manualEntryQueueId must point at the meq row so ops can
      // correlate the rendered DLQ entry to the raw payload queue.
      expect(dlqRow.metadata?.manualEntryQueueId).toBe("meq-stub");
    });

    it("SKIPPED_NO_ADDRESS when no phone supplied and no phone on file", async () => {
      const email = makeStubEmail();
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["WHATSAPP"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID }], // no phone
      });
      expect(result.attempts[0]!.outcome).toBe("SKIPPED_NO_ADDRESS");
      expect(whatsapp.calls).toHaveLength(0);
    });
  });

  // ── 6. Partial-success / never-throws ──────────────────────────────────

  describe("6. partial success", () => {
    it("one channel DLQs while the other two deliver — dispatcher never throws", async () => {
      const email = makeStubEmail();
      email.throwNext = new Error("esp timeout");
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      const result = await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID, phone: "+919876543210" }],
      });
      // IN_APP + WHATSAPP delivered, EMAIL DLQ'd.
      expect(result.summary.delivered).toBe(2);
      expect(result.summary.dlq).toBe(1);
      const byCh = Object.fromEntries(
        result.attempts.map((a) => [a.channel, a.outcome]),
      );
      expect(byCh.IN_APP).toBe("DELIVERED");
      expect(byCh.EMAIL).toBe("DLQ");
      expect(byCh.WHATSAPP).toBe("DELIVERED");
      // Exactly one DLQ row landed, scoped to EMAIL.
      expect(await countDlqRows(pool, { channel: "EMAIL" })).toBe(1);
      expect(await countDlqRows(pool, { channel: "IN_APP" })).toBe(0);
      expect(await countDlqRows(pool, { channel: "WHATSAPP" })).toBe(0);
    });
  });

  // ── 7. DLQ repository basics ───────────────────────────────────────────

  describe("7. DLQ repository lifecycle", () => {
    it("markRetried flips status from PENDING → RETRIED and stamps resolver", async () => {
      const email = makeStubEmail();
      email.throwNext = new Error("transient");
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["EMAIL"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      const updated = await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        const pending = await notificationDispatchDlqRepo.listPending(client, {
          channel: "EMAIL",
          eventType: CHANNELS_EVENT,
        });
        expect(pending).toHaveLength(1);
        return notificationDispatchDlqRepo.markRetried(client, pending[0]!.id, {
          resolvedBy: DEV_ADMIN_ID,
          notes: "resent after esp healed",
        });
      });
      expect(updated?.status).toBe("RETRIED");
      expect(updated?.resolvedBy).toBe(DEV_ADMIN_ID);
      // A second markRetried on the same row should no-op (status guard).
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        const again = await notificationDispatchDlqRepo.markRetried(
          client,
          updated!.id,
          { resolvedBy: DEV_ADMIN_ID },
        );
        expect(again).toBeNull();
      });
    });

    it("markAbandoned sets ABANDONED and records the reason", async () => {
      const email = makeStubEmail();
      email.throwNext = new Error("permanent");
      const whatsapp = makeStubWhatsApp();
      const svc = new DispatcherService(pool, {
        emailSender: email,
        whatsappClient: whatsapp,
      });
      await svc.dispatch(DEV_ORG_ID, {
        eventType: CHANNELS_EVENT,
        channels: ["EMAIL"],
        variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
        recipients: [{ userId: DEV_ADMIN_ID }],
      });
      const row = await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        const pending = await notificationDispatchDlqRepo.listPending(client, {
          channel: "EMAIL",
          eventType: CHANNELS_EVENT,
        });
        return notificationDispatchDlqRepo.markAbandoned(
          client,
          pending[0]!.id,
          "recipient opted out",
          { resolvedBy: DEV_ADMIN_ID },
        );
      });
      expect(row?.status).toBe("ABANDONED");
      expect(row?.resolutionNotes).toBe("recipient opted out");
    });
  });

  // ── 8. Inactive templates are skipped ──────────────────────────────────

  describe("8. inactive templates", () => {
    it("is_active=false template is treated as SKIPPED_NO_TEMPLATE", async () => {
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`SELECT set_config('app.current_user', $1, true)`, [
          DEV_ADMIN_ID,
        ]);
        // Deactivate the IN_APP template for the multichannel event.
        const tpl = await notificationTemplatesRepo.findByEventChannel(
          client,
          CHANNELS_EVENT,
          "IN_APP",
        );
        expect(tpl).not.toBeNull();
        await client.query(
          `UPDATE notification_templates SET is_active = false WHERE id = $1`,
          [tpl!.id],
        );
      });
      try {
        const email = makeStubEmail();
        const whatsapp = makeStubWhatsApp();
        const svc = new DispatcherService(pool, {
          emailSender: email,
          whatsappClient: whatsapp,
        });
        const result = await svc.dispatch(DEV_ORG_ID, {
          eventType: CHANNELS_EVENT,
          channels: ["IN_APP"],
          variables: { name: "Ada", orderNo: "SO-42", status: "shipped" },
          recipients: [{ userId: DEV_ADMIN_ID }],
        });
        expect(result.attempts[0]!.outcome).toBe("SKIPPED_NO_TEMPLATE");
        // No inbox row, no DLQ.
        expect(await countInboxRows(pool, { eventType: CHANNELS_EVENT })).toBe(
          0,
        );
        expect(await countDlqRows(pool, { channel: "IN_APP" })).toBe(0);
      } finally {
        // Re-activate so later tests aren't poisoned.
        await withOrg(pool, DEV_ORG_ID, async (client) => {
          await client.query(`SELECT set_config('app.current_user', $1, true)`, [
            DEV_ADMIN_ID,
          ]);
          await client.query(
            `UPDATE notification_templates
                SET is_active = true
              WHERE event_type = $1 AND channel = 'IN_APP'`,
            [CHANNELS_EVENT],
          );
        });
      }
    });
  });
});
