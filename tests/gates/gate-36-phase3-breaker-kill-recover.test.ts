/**
 * Gate 36 — ARCHITECTURE.md Phase 3 §3.8: "circuit breaker
 * kill-and-recover — kill EWB mock; breaker opens after 5 failures;
 * fallback queue engaged; breaker recovers (OPEN → HALF_OPEN →
 * CLOSED) after cooldown".
 *
 * Gate 30 proved the breaker defaults and happy-path behaviour.
 * Gate 36 proves the *full state-machine lifecycle* under an
 * injected outage — the piece Gate 30 didn't exercise because it
 * would require time travel.
 *
 * ─── Test strategy ───────────────────────────────────────────────
 *
 * The NIC EWB client accepts `breakerOverrides` so tests can shrink
 * the 5-minute production cooldown down to something a CI box can
 * wait for without flake. We override:
 *
 *   failureThreshold: 5     (matches spec — do NOT change)
 *   cooldownMs:       500   (compressed for CI; prod is 300_000)
 *   windowMs:         10_000 (compressed from 60_000)
 *
 * The failureThreshold stays at the spec value so the "after 5
 * failures" assertion still holds honestly. Only the *timer* shrinks.
 *
 * Transport is a fake fetch: we push "throw" responses to simulate
 * the NIC mock being killed, then switch to "ok" responses to
 * simulate recovery. Call counts on the fake prove whether the
 * breaker is short-circuiting (no transport call) or letting
 * traffic through.
 *
 * ─── Lifecycle asserted ──────────────────────────────────────────
 *
 *   Phase A  (CLOSED, healthy)
 *     1 successful call → state stays CLOSED, queue empty.
 *
 *   Phase B  (kill the mock, drive failures)
 *     5 calls with transport throwing →
 *       • every call reaches transport (calls += 5)
 *       • every call's fallback lands a manual_entry_queue row
 *         with last_error != 'breaker_open:'
 *       • after the 5th failure: breaker state = OPEN
 *
 *   Phase C  (OPEN, short-circuit)
 *     3 further calls while OPEN →
 *       • NONE of them reach transport (calls unchanged)
 *       • all 3 land queue rows with last_error starting
 *         'breaker_open:' — the fallback is engaged
 *
 *   Phase D  (cooldown elapses, probe)
 *     Sleep cooldownMs + buffer, then 1 call with transport ok →
 *       • call reaches transport (calls += 1)
 *       • returned status = GENERATED
 *       • no queue row added
 *       • breaker state = CLOSED (HALF_OPEN probe promoted)
 *
 *   Phase E  (CLOSED again, fully healed)
 *     2 more successful calls → state stays CLOSED, queue stable.
 *
 * ─── Ancillary assertions ───────────────────────────────────────
 *
 *   • Breaker onStateChange hook fires with the right transitions:
 *       CLOSED → OPEN        (phase B, after 5th failure)
 *       OPEN → HALF_OPEN     (phase D, probe)
 *       HALF_OPEN → CLOSED   (phase D, probe success)
 *     No spurious transitions.
 *
 *   • `generate()` NEVER throws — all paths either return GENERATED
 *     or QUEUED. (Documented contract; kill-and-recover must not
 *     break the business transaction.)
 *
 * Cleanup: every queue row this gate writes carries reference_type
 * of 'gate-36/*' so we can wipe it without touching other tests.
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
  type HttpFetch,
  type HttpResponse,
} from "@instigenie/api/external";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

const DEV_ADMIN_ID = "00000000-0000-0000-0000-00000000b001";

/** Shortened cooldown so the test can actually wait it out. Prod is
 *  300_000 ms; we confirm the prod default separately in Gate 30. */
const TEST_COOLDOWN_MS = 500;
/** Small additional slack so the probe kicks in reliably. */
const COOLDOWN_SLACK_MS = 150;
/** Failure threshold — MATCHES spec, never shrunk. */
const FAILURE_THRESHOLD = 5;

/** Reference prefix for manual_entry_queue rows. */
const REF_PREFIX = "gate-36/kill-recover";

// ── fake transport ─────────────────────────────────────────────────────────

interface FakeTransport {
  fetch: HttpFetch;
  calls: number;
  /** Queue of "next call outcome" — consumed in order. */
  queue: Array<{ kind: "throw"; error: Error } | { kind: "ok"; body: unknown }>;
  reset(): void;
}

function makeFakeTransport(): FakeTransport {
  const state = {
    calls: 0,
    queue: [] as FakeTransport["queue"],
    reset() {
      state.calls = 0;
      state.queue.length = 0;
    },
  };
  const fetch: HttpFetch = async () => {
    state.calls++;
    const spec = state.queue.shift();
    if (!spec) {
      // Safety: an unqueued call is a test-setup bug.
      throw new Error("gate-36 transport: no queued response");
    }
    if (spec.kind === "throw") throw spec.error;
    return fakeOkResponse(spec.body);
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

function fakeOkResponse(body: unknown): HttpResponse {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => text,
  };
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function wipeGate36(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      DEV_ADMIN_ID,
    ]);
    await client.query(
      `DELETE FROM manual_entry_queue WHERE reference_type LIKE 'gate-36/%'`
    );
  });
}

async function queueRowsByRef(
  pool: pg.Pool,
  referenceId: string
): Promise<Array<{ lastError: string | null }>> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      DEV_ADMIN_ID,
    ]);
    const { rows } = await client.query<{ last_error: string | null }>(
      `SELECT last_error FROM manual_entry_queue
        WHERE reference_id = $1 ORDER BY created_at ASC`,
      [referenceId]
    );
    return rows.map((r) => ({ lastError: r.last_error }));
  });
}

// ── test ───────────────────────────────────────────────────────────────────

describe("gate-36 (arch phase 3.8): circuit breaker kill-and-recover", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await wipeGate36(pool);
    await pool.end();
  });

  beforeEach(async () => {
    await wipeGate36(pool);
  });

  it("full lifecycle: CLOSED → OPEN → HALF_OPEN → CLOSED", async () => {
    const tr = makeFakeTransport();
    const transitions: Array<{ prev: string; next: string }> = [];

    const client = new NicEwbClient(pool, {
      baseUrl: "https://fake-nic.local",
      transport: tr.fetch,
      breakerOverrides: {
        failureThreshold: FAILURE_THRESHOLD,
        cooldownMs: TEST_COOLDOWN_MS,
        windowMs: 10_000,
      },
      // Observe every transition — HALF_OPEN is atomic inside
      // breaker.execute(), so a getState() sample around each call
      // would miss it. Hooks are the only reliable surface.
      onBreakerStateChange: (prev, next) => {
        transitions.push({ prev, next });
      },
    });
    const snapshot = () => client.breaker.getState();

    const payload = (tag: string) => ({
      gstin: "29ABCDE1234F1Z5",
      docType: "INV" as const,
      docNo: `GATE36-${tag}`,
      docDate: "22/04/2026",
      fromGstin: "29ABCDE1234F1Z5",
      toGstin: "27ABCDE9999F1Z5",
      totalValue: "100000",
      referenceType: REF_PREFIX,
      referenceId: "00000000-0000-0000-0000-000036000001",
    });

    async function call(tag: string): Promise<
      Awaited<ReturnType<typeof client.generate>>
    > {
      return client.generate(DEV_ORG_ID, payload(tag), { actorId: DEV_ADMIN_ID });
    }

    // ─── Phase A: baseline CLOSED, one successful call ───────────────────
    expect(snapshot()).toBe("CLOSED");
    tr.queue.push({
      kind: "ok",
      body: { ewbNo: "eA", ewbDate: "22/04/2026", validUpto: "23/04/2026" },
    });
    const a1 = await call("A1");
    expect(a1.status).toBe("GENERATED");
    expect(snapshot()).toBe("CLOSED");
    expect(tr.calls).toBe(1);
    expect(transitions).toEqual([]);
    {
      const rows = await queueRowsByRef(
        pool,
        "00000000-0000-0000-0000-000036000001"
      );
      expect(rows.length).toBe(0);
    }

    // ─── Phase B: kill the mock, drive 5 failures → OPEN ─────────────────
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      tr.queue.push({ kind: "throw", error: new Error(`B${i + 1} ewb down`) });
    }
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      const res = await call(`B${i + 1}`);
      expect(res.status).toBe("QUEUED");
      // In phase B the transport IS called — the breaker is still
      // CLOSED up until the 5th failure. So last_error must NOT be a
      // breaker_open message; it's the raw transport error.
      expect(res.queued?.lastError ?? "").not.toMatch(/^breaker_open:/);
    }
    expect(tr.calls).toBe(1 + FAILURE_THRESHOLD);
    expect(snapshot()).toBe("OPEN");
    expect(transitions).toEqual([{ prev: "CLOSED", next: "OPEN" }]);

    // ─── Phase C: 3 calls while OPEN → short-circuit, fallback engaged ──
    const whileOpenCount = 3;
    for (let i = 0; i < whileOpenCount; i++) {
      // Push a spec we never expect to be consumed — any transport
      // call while OPEN is a bug. If one does slip through, the fake
      // will throw "no queued response" and fail the test loudly.
      const res = await call(`C${i + 1}`);
      expect(res.status).toBe("QUEUED");
      expect(res.queued?.lastError ?? "").toMatch(/^breaker_open:/);
    }
    // Transport call count unchanged — short-circuit proved.
    expect(tr.calls).toBe(1 + FAILURE_THRESHOLD);
    expect(snapshot()).toBe("OPEN");
    expect(transitions).toEqual([{ prev: "CLOSED", next: "OPEN" }]);

    // ─── Phase D: wait out cooldown, probe with a successful call ───────
    await new Promise((r) => setTimeout(r, TEST_COOLDOWN_MS + COOLDOWN_SLACK_MS));
    tr.queue.push({
      kind: "ok",
      body: { ewbNo: "eD", ewbDate: "22/04/2026", validUpto: "23/04/2026" },
    });
    const d1 = await call("D1");
    expect(d1.status).toBe("GENERATED");
    expect(d1.response?.ewbNo).toBe("eD");
    expect(tr.calls).toBe(1 + FAILURE_THRESHOLD + 1); // phase-D call reached transport
    expect(snapshot()).toBe("CLOSED");
    // Transitions now: CLOSED→OPEN, then OPEN→HALF_OPEN (probe
    // permitted), then HALF_OPEN→CLOSED (probe success).
    expect(transitions).toEqual([
      { prev: "CLOSED", next: "OPEN" },
      { prev: "OPEN", next: "HALF_OPEN" },
      { prev: "HALF_OPEN", next: "CLOSED" },
    ]);

    // ─── Phase E: fully healed, subsequent calls go through ─────────────
    tr.queue.push({
      kind: "ok",
      body: { ewbNo: "eE1", ewbDate: "22/04/2026", validUpto: "23/04/2026" },
    });
    tr.queue.push({
      kind: "ok",
      body: { ewbNo: "eE2", ewbDate: "22/04/2026", validUpto: "23/04/2026" },
    });
    const e1 = await call("E1");
    const e2 = await call("E2");
    expect(e1.status).toBe("GENERATED");
    expect(e2.status).toBe("GENERATED");
    expect(snapshot()).toBe("CLOSED");
    expect(tr.calls).toBe(1 + FAILURE_THRESHOLD + 1 + 2);
    // No further transitions past the probe recovery.
    expect(transitions).toEqual([
      { prev: "CLOSED", next: "OPEN" },
      { prev: "OPEN", next: "HALF_OPEN" },
      { prev: "HALF_OPEN", next: "CLOSED" },
    ]);

    // Final fallback-queue audit: exactly 5 phase-B rows + 3 phase-C
    // rows = 8 rows for our single referenceId. Phase-A / D / E
    // succeeded and never enqueued.
    const allRows = await queueRowsByRef(
      pool,
      "00000000-0000-0000-0000-000036000001"
    );
    expect(allRows.length).toBe(FAILURE_THRESHOLD + whileOpenCount);
    const openRows = allRows.filter((r) =>
      (r.lastError ?? "").startsWith("breaker_open:")
    );
    const passthroughRows = allRows.filter(
      (r) => !(r.lastError ?? "").startsWith("breaker_open:")
    );
    expect(passthroughRows.length).toBe(FAILURE_THRESHOLD);
    expect(openRows.length).toBe(whileOpenCount);
  });

  it("breaker re-opens if the HALF_OPEN probe fails", async () => {
    // Cheaper "flaky recovery" test — prove that a failing probe sends
    // us back to OPEN and re-arms the cooldown, rather than dropping
    // us into a partially-closed zombie state.
    const tr = makeFakeTransport();
    const client = new NicEwbClient(pool, {
      baseUrl: "https://fake-nic.local",
      transport: tr.fetch,
      breakerOverrides: {
        failureThreshold: FAILURE_THRESHOLD,
        cooldownMs: TEST_COOLDOWN_MS,
        windowMs: 10_000,
      },
    });
    const snap = () => client.breaker.getState();

    // Drive to OPEN.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      tr.queue.push({ kind: "throw", error: new Error("kill") });
    }
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await client.generate(
        DEV_ORG_ID,
        {
          gstin: "29ABCDE1234F1Z5",
          docType: "INV",
          docNo: `FLAKY-${i}`,
          docDate: "22/04/2026",
          fromGstin: "29ABCDE1234F1Z5",
          toGstin: "27ABCDE9999F1Z5",
          totalValue: "1",
          referenceType: REF_PREFIX + "-flaky",
          referenceId: "00000000-0000-0000-0000-000036000002",
        },
        { actorId: DEV_ADMIN_ID }
      );
    }
    expect(snap()).toBe("OPEN");

    // Wait, then fire a PROBE that also fails — breaker should
    // flip HALF_OPEN → OPEN (via the onFailure path) and reset
    // openedAt so further calls short-circuit again.
    await new Promise((r) => setTimeout(r, TEST_COOLDOWN_MS + COOLDOWN_SLACK_MS));
    tr.queue.push({ kind: "throw", error: new Error("probe still broken") });
    const probe = await client.generate(
      DEV_ORG_ID,
      {
        gstin: "29ABCDE1234F1Z5",
        docType: "INV",
        docNo: "FLAKY-PROBE",
        docDate: "22/04/2026",
        fromGstin: "29ABCDE1234F1Z5",
        toGstin: "27ABCDE9999F1Z5",
        totalValue: "1",
        referenceType: REF_PREFIX + "-flaky",
        referenceId: "00000000-0000-0000-0000-000036000002",
      },
      { actorId: DEV_ADMIN_ID }
    );
    expect(probe.status).toBe("QUEUED");
    // The probe DID reach transport (= FAILURE_THRESHOLD + 1 calls
    // total) and then failed, flipping back to OPEN.
    expect(tr.calls).toBe(FAILURE_THRESHOLD + 1);
    expect(snap()).toBe("OPEN");

    // An immediate follow-up call must again short-circuit — the
    // cooldown window re-armed.
    const followup = await client.generate(
      DEV_ORG_ID,
      {
        gstin: "29ABCDE1234F1Z5",
        docType: "INV",
        docNo: "FLAKY-FOLLOWUP",
        docDate: "22/04/2026",
        fromGstin: "29ABCDE1234F1Z5",
        toGstin: "27ABCDE9999F1Z5",
        totalValue: "1",
        referenceType: REF_PREFIX + "-flaky",
        referenceId: "00000000-0000-0000-0000-000036000002",
      },
      { actorId: DEV_ADMIN_ID }
    );
    expect(followup.status).toBe("QUEUED");
    expect(followup.queued?.lastError ?? "").toMatch(/^breaker_open:/);
    // Transport NOT called again.
    expect(tr.calls).toBe(FAILURE_THRESHOLD + 1);
  });
});
