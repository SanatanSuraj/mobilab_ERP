/**
 * Gate 30 — ARCHITECTURE.md Phase 3 §3.4 "External APIs (circuit breakers)".
 *
 * Three outbound integrations sit behind breakers. This gate asserts that:
 *
 *   1. Breaker defaults match the §3.4 table:
 *        NIC EWB      threshold 5   cooldown 300s   (5 min)
 *        GSTN e-inv   threshold 3   cooldown 60s
 *        WhatsApp     threshold 5   cooldown 120s   (2 min)
 *
 *   2. Happy-path: when the underlying transport succeeds, the client
 *      returns a parsed response and does NOT enqueue a fallback.
 *
 *   3. Trip the breaker: after N consecutive failures (= threshold)
 *      the client stops calling the transport and enqueues into
 *      `manual_entry_queue`, recording `breaker_open:` in last_error.
 *      A later attempt while the breaker is OPEN also enqueues but
 *      does NOT make a transport call (proven via call counter on
 *      the injected fake transport).
 *
 *   4. WhatsApp email fallback: when an emailFallback is wired and
 *      the breaker is OPEN, the client re-routes to email and does
 *      NOT touch manual_entry_queue.
 *
 *   5. WhatsApp without emailFallback parks the payload in the queue
 *      (no silent drop even in early bring-up).
 *
 * The tests run against the dev `instigenie-postgres` instance so the queue
 * repo writes are real. Transport is a fake — we never talk to NIC / GSTN
 * / WhatsApp.
 *
 * Cleanup: every gate-30 queue row carries source ∈ {nic_ewb, gstn,
 * whatsapp} and a reference_type prefix of 'gate-30/' so beforeEach can
 * wipe them without touching other tests.
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
  NicEwbClient,
  NIC_EWB_BREAKER_DEFAULTS,
  GstnClient,
  GSTN_BREAKER_DEFAULTS,
  WhatsAppClient,
  WHATSAPP_BREAKER_DEFAULTS,
  type HttpFetch,
  type HttpResponse,
} from "@instigenie/api/external";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// ── Fake transport ──────────────────────────────────────────────────────────
//
// We need a deterministic "next call fails/succeeds" toggle so we can drive
// breakers through their state machine without flakiness.

interface FakeTransport {
  fetch: HttpFetch;
  /** How many times fetch was called since reset(). */
  calls: number;
  /** Queue the next N responses. If shorter than calls, loops on the last one. */
  queue: Array<HttpResponseSpec>;
  reset(): void;
}

type HttpResponseSpec =
  | { kind: "ok"; body: unknown; status?: number }
  | { kind: "status"; status: number; body?: string }
  | { kind: "throw"; error: Error };

function makeFakeTransport(initial: HttpResponseSpec[] = []): FakeTransport {
  const state = {
    calls: 0,
    queue: [...initial],
    reset() {
      state.calls = 0;
      state.queue.length = 0;
    },
  };
  const fetch: HttpFetch = async () => {
    state.calls++;
    const spec =
      state.queue.shift() ??
      // default to a generic 500 so forgotten-to-queue cases still drive
      // breakers into OPEN rather than passing silently.
      ({ kind: "status", status: 500, body: "no-queue" } as HttpResponseSpec);
    if (spec.kind === "throw") {
      throw spec.error;
    }
    if (spec.kind === "status") {
      const body = spec.body ?? "";
      return fakeResponse({ ok: false, status: spec.status, body });
    }
    return fakeResponse({
      ok: true,
      status: spec.status ?? 200,
      body: JSON.stringify(spec.body),
    });
  };
  return {
    fetch,
    get calls() {
      return state.calls;
    },
    get queue() {
      return state.queue;
    },
    reset: state.reset,
  } as FakeTransport;
}

function fakeResponse(args: {
  ok: boolean;
  status: number;
  body: string;
}): HttpResponse {
  return {
    ok: args.ok,
    status: args.status,
    statusText: args.ok ? "OK" : "Error",
    text: async () => args.body,
  };
}

// Helper to wipe rows we've written.
async function wipeGate30Rows(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      ["00000000-0000-0000-0000-00000000b002"], // MANAGEMENT
    );
    await client.query(
      `DELETE FROM manual_entry_queue
         WHERE reference_type LIKE 'gate-30/%'`,
    );
  });
}

async function countQueueRows(
  pool: pg.Pool,
  source: "nic_ewb" | "gstn" | "whatsapp",
): Promise<number> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      ["00000000-0000-0000-0000-00000000b002"],
    );
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::bigint AS n
         FROM manual_entry_queue
        WHERE source = $1
          AND reference_type LIKE 'gate-30/%'`,
      [source],
    );
    return Number(rows[0]!.n);
  });
}

async function latestQueueRow(
  pool: pg.Pool,
  source: "nic_ewb" | "gstn" | "whatsapp",
): Promise<{ last_error: string | null; payload: unknown } | null> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      ["00000000-0000-0000-0000-00000000b002"],
    );
    const { rows } = await client.query<{
      last_error: string | null;
      payload: unknown;
    }>(
      `SELECT last_error, payload
         FROM manual_entry_queue
        WHERE source = $1
          AND reference_type LIKE 'gate-30/%'
        ORDER BY created_at DESC LIMIT 1`,
      [source],
    );
    return rows[0] ?? null;
  });
}

describe("gate-30 (arch phase 3.4): external API circuit breakers", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await wipeGate30Rows(pool);
  });

  // ── 1. Breaker defaults match spec ──────────────────────────────────────

  describe("1. breaker defaults match the §3.4 spec", () => {
    it("NIC EWB uses threshold=5, cooldown=300_000ms", () => {
      expect(NIC_EWB_BREAKER_DEFAULTS.failureThreshold).toBe(5);
      expect(NIC_EWB_BREAKER_DEFAULTS.cooldownMs).toBe(300_000);
    });
    it("GSTN uses threshold=3, cooldown=60_000ms", () => {
      expect(GSTN_BREAKER_DEFAULTS.failureThreshold).toBe(3);
      expect(GSTN_BREAKER_DEFAULTS.cooldownMs).toBe(60_000);
    });
    it("WhatsApp uses threshold=5, cooldown=120_000ms", () => {
      expect(WHATSAPP_BREAKER_DEFAULTS.failureThreshold).toBe(5);
      expect(WHATSAPP_BREAKER_DEFAULTS.cooldownMs).toBe(120_000);
    });
  });

  // ── 2. Happy-path ───────────────────────────────────────────────────────

  describe("2. happy-path: transport success returns GENERATED / SENT", () => {
    it("NIC EWB returns the parsed response and does not enqueue", async () => {
      const tr = makeFakeTransport([
        {
          kind: "ok",
          body: {
            ewbNo: "181003298765",
            ewbDate: "21/04/2026",
            validUpto: "22/04/2026",
          },
        },
      ]);
      const client = new NicEwbClient(pool, {
        baseUrl: "https://fake-nic.local",
        transport: tr.fetch,
      });
      const res = await client.generate(DEV_ORG_ID, {
        gstin: "29ABCDE1234F1Z5",
        docType: "INV",
        docNo: "INV-1",
        docDate: "21/04/2026",
        fromGstin: "29ABCDE1234F1Z5",
        toGstin: "27ABCDE9999F1Z5",
        totalValue: "250000",
        referenceType: "gate-30/happy",
        referenceId: "00000000-0000-0000-0000-000030000001",
      });
      expect(res.status).toBe("GENERATED");
      expect(res.response?.ewbNo).toBe("181003298765");
      expect(await countQueueRows(pool, "nic_ewb")).toBe(0);
    });

    it("GSTN returns the IRN and does not enqueue", async () => {
      const tr = makeFakeTransport([
        {
          kind: "ok",
          body: {
            irn: "a1b2c3d4e5",
            ackNo: "112110020123456",
            ackDate: "21-04-2026",
            signedInvoice: "signed-jwt",
            signedQrCode: "qr",
          },
        },
      ]);
      const client = new GstnClient(pool, {
        baseUrl: "https://fake-gstn.local",
        transport: tr.fetch,
      });
      const res = await client.generateIrn(DEV_ORG_ID, {
        sellerGstin: "29ABCDE1234F1Z5",
        buyerGstin: "27ABCDE9999F1Z5",
        invoiceNo: "INV-1",
        invoiceDate: "21/04/2026",
        totalValue: "250000",
        referenceType: "gate-30/happy",
        referenceId: "00000000-0000-0000-0000-000030000002",
      });
      expect(res.status).toBe("GENERATED");
      expect(res.response?.irn).toBe("a1b2c3d4e5");
      expect(await countQueueRows(pool, "gstn")).toBe(0);
    });

    it("WhatsApp returns the message id and does not enqueue", async () => {
      const tr = makeFakeTransport([
        { kind: "ok", body: { messageId: "wamid.HBgL123", status: "sent" } },
      ]);
      const client = new WhatsAppClient(pool, {
        baseUrl: "https://fake-waba.local",
        transport: tr.fetch,
      });
      const res = await client.send(DEV_ORG_ID, {
        to: "+919876543210",
        template: "otp_login_v1",
        variables: ["123456"],
        referenceType: "gate-30/happy",
      });
      expect(res.status).toBe("SENT");
      expect(res.response?.messageId).toBe("wamid.HBgL123");
      expect(await countQueueRows(pool, "whatsapp")).toBe(0);
    });
  });

  // ── 3. Trip the breaker and confirm fallback ────────────────────────────

  describe("3. repeated failures trip the breaker → manual_entry_queue", () => {
    it("NIC EWB trips after 5 failures and subsequent attempts short-circuit", async () => {
      // 5 failing responses primed, then nothing (the 6th+ calls must be
      // short-circuited by the breaker and NEVER reach the transport).
      const tr = makeFakeTransport(
        Array.from({ length: 5 }, () => ({ kind: "status", status: 503 }) as const),
      );
      const client = new NicEwbClient(pool, {
        baseUrl: "https://fake-nic.local",
        transport: tr.fetch,
        breakerOverrides: { windowMs: 60_000, cooldownMs: 300_000 },
      });
      const makePayload = (n: number) => ({
        gstin: "29ABCDE1234F1Z5",
        docType: "INV" as const,
        docNo: `INV-${n}`,
        docDate: "21/04/2026",
        fromGstin: "29ABCDE1234F1Z5",
        toGstin: "27ABCDE9999F1Z5",
        totalValue: "250000",
        referenceType: "gate-30/trip",
        referenceId: `00000000-0000-0000-0000-0000300301${String(n).padStart(2, "0")}`,
      });
      // First 5 calls hit transport and fail — each enqueues.
      for (let i = 0; i < 5; i++) {
        const res = await client.generate(DEV_ORG_ID, makePayload(i));
        expect(res.status).toBe("QUEUED");
      }
      expect(tr.calls).toBe(5);
      expect(client.breaker.getState()).toBe("OPEN");
      // 6th call: breaker is OPEN — transport MUST NOT be called.
      const res6 = await client.generate(DEV_ORG_ID, makePayload(5));
      expect(res6.status).toBe("QUEUED");
      expect(tr.calls).toBe(5); // unchanged
      expect(res6.queued?.lastError).toMatch(/^breaker_open:/);
      expect(await countQueueRows(pool, "nic_ewb")).toBe(6);
    });

    it("GSTN trips after only 3 failures", async () => {
      const tr = makeFakeTransport(
        Array.from({ length: 3 }, () => ({ kind: "status", status: 502 }) as const),
      );
      const client = new GstnClient(pool, {
        baseUrl: "https://fake-gstn.local",
        transport: tr.fetch,
      });
      const makePayload = (n: number) => ({
        sellerGstin: "29ABCDE1234F1Z5",
        buyerGstin: "27ABCDE9999F1Z5",
        invoiceNo: `INV-${n}`,
        invoiceDate: "21/04/2026",
        totalValue: "250000",
        referenceType: "gate-30/trip",
        referenceId: `00000000-0000-0000-0000-0000300302${String(n).padStart(2, "0")}`,
      });
      for (let i = 0; i < 3; i++) {
        await client.generateIrn(DEV_ORG_ID, makePayload(i));
      }
      expect(tr.calls).toBe(3);
      expect(client.breaker.getState()).toBe("OPEN");
      const res4 = await client.generateIrn(DEV_ORG_ID, makePayload(3));
      expect(tr.calls).toBe(3);
      expect(res4.queued?.lastError).toMatch(/^breaker_open:/);
    });

    it("enqueued row carries the original payload + http_5xx error tag", async () => {
      const tr = makeFakeTransport([
        { kind: "status", status: 504, body: "gateway timeout" },
      ]);
      const client = new NicEwbClient(pool, {
        baseUrl: "https://fake-nic.local",
        transport: tr.fetch,
      });
      const res = await client.generate(DEV_ORG_ID, {
        gstin: "29ABCDE1234F1Z5",
        docType: "INV",
        docNo: "INV-err",
        docDate: "21/04/2026",
        fromGstin: "29ABCDE1234F1Z5",
        toGstin: "27ABCDE9999F1Z5",
        totalValue: "100",
        referenceType: "gate-30/trip",
        referenceId: "00000000-0000-0000-0000-0000300303ff",
      });
      expect(res.status).toBe("QUEUED");
      const row = await latestQueueRow(pool, "nic_ewb");
      expect(row).not.toBeNull();
      expect(row!.last_error).toMatch(/^http_504/);
      expect((row!.payload as { docNo: string }).docNo).toBe("INV-err");
    });
  });

  // ── 4. WhatsApp email fallback ──────────────────────────────────────────

  describe("4. WhatsApp email fallback", () => {
    it("routes to email when breaker is OPEN and does not enqueue", async () => {
      // Prime 5 failing responses to trip the breaker, then one more send
      // while OPEN to prove the email fallback runs.
      const tr = makeFakeTransport(
        Array.from({ length: 5 }, () => ({ kind: "status", status: 502 }) as const),
      );
      const emailed: Array<{ to: string; subject: string }> = [];
      const client = new WhatsAppClient(pool, {
        baseUrl: "https://fake-waba.local",
        transport: tr.fetch,
        emailFallback: async (input) => {
          emailed.push({ to: input.to, subject: input.subject });
        },
      });
      const makePayload = (n: number) => ({
        to: "+919876543210",
        template: "otp_login_v1",
        variables: [`code-${n}`],
        emailFallback: {
          to: "customer@example.com",
          subject: `OTP ${n}`,
          body: `Your code is ${n}`,
        },
        referenceType: "gate-30/whatsapp",
      });
      // Trip the breaker — each failing call uses the email fallback.
      for (let i = 0; i < 5; i++) {
        const res = await client.send(DEV_ORG_ID, makePayload(i));
        expect(res.status).toBe("EMAIL_FALLBACK");
      }
      expect(tr.calls).toBe(5);
      expect(client.breaker.getState()).toBe("OPEN");
      // 6th call: breaker is OPEN, but emailFallback still fires.
      const res6 = await client.send(DEV_ORG_ID, makePayload(5));
      expect(res6.status).toBe("EMAIL_FALLBACK");
      expect(tr.calls).toBe(5); // transport untouched
      expect(emailed).toHaveLength(6);
      expect(emailed[5]?.to).toBe("customer@example.com");
      // Nothing parked in the queue because email fallback is a clean landing.
      expect(await countQueueRows(pool, "whatsapp")).toBe(0);
    });

    it("falls back to the manual queue when no emailFallback is wired", async () => {
      const tr = makeFakeTransport([
        { kind: "status", status: 503, body: "down" },
      ]);
      const client = new WhatsAppClient(pool, {
        baseUrl: "https://fake-waba.local",
        transport: tr.fetch,
        // no emailFallback
      });
      const res = await client.send(DEV_ORG_ID, {
        to: "+919876543210",
        template: "alert_v1",
        variables: ["down"],
        referenceType: "gate-30/whatsapp",
      });
      expect(res.status).toBe("QUEUED");
      expect(await countQueueRows(pool, "whatsapp")).toBe(1);
    });

    it("parks in the queue if BOTH WhatsApp AND email fail", async () => {
      const tr = makeFakeTransport([
        { kind: "status", status: 503, body: "down" },
      ]);
      const client = new WhatsAppClient(pool, {
        baseUrl: "https://fake-waba.local",
        transport: tr.fetch,
        emailFallback: async () => {
          throw new Error("smtp down");
        },
      });
      const res = await client.send(DEV_ORG_ID, {
        to: "+919876543210",
        template: "alert_v1",
        variables: ["down"],
        emailFallback: {
          to: "ops@example.com",
          subject: "fallback",
          body: "alert",
        },
        referenceType: "gate-30/whatsapp",
      });
      expect(res.status).toBe("QUEUED");
      expect(res.queued?.lastError).toMatch(/smtp down/);
      expect(await countQueueRows(pool, "whatsapp")).toBe(1);
    });
  });
});
