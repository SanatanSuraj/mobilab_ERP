/**
 * Chaos spec — Outbox exactly-once guarantee under 5 failure modes × 1000 iters.
 *
 * Every committed domain change must produce **exactly one** delivered event
 * regardless of where the infrastructure fails between commit and handler
 * completion. This spec injects each of five failure modes at the critical
 * boundary and then asserts the invariant holds after recovery.
 *
 * Failure modes simulated:
 *   1. skip-notify                     — listen-notify crashed before the
 *                                        AFTER-INSERT NOTIFY reached any
 *                                        subscriber. Recovery = next drain.
 *   2. duplicate-notify                — two drain instances (e.g. live
 *                                        listener + 30s poller) pick up the
 *                                        same row concurrently. jobId dedup
 *                                        must collapse the double-dispatch.
 *   3. crash-after-enqueue-before-ack  — queue.add() succeeded but the API
 *                                        process died before the
 *                                        `UPDATE dispatched_at` committed.
 *                                        Next drain re-runs the SELECT and
 *                                        re-enqueues; BullMQ jobId dedup
 *                                        prevents a second handler run.
 *   4. handler-mid-body-crash          — runner.ts opens a txn, claims the
 *                                        (outbox_id, handler_name) slot, the
 *                                        handler body throws, everything
 *                                        rolls back (slot included). Retry
 *                                        re-acquires the slot and succeeds.
 *   5. worker-restart-after-commit     — handler finished, but the BullMQ
 *                                        worker was SIGKILLed before acking
 *                                        the job. The job is re-delivered;
 *                                        runner.ts sees the existing
 *                                        handler_runs row and returns
 *                                        SKIPPED — no duplicate side effect.
 *
 * Invariant asserted after each iteration's recovery:
 *   (a) exactly 1 original-domain-write in lead_activities (the `chaos-original:${i}` row)
 *   (b) exactly 1 handler-side-effect in lead_activities   (the `chaos-handler:${i}` row)
 *   (c) exactly 1 row in outbox.handler_runs for the iteration's outbox id, status=COMPLETED
 *
 * A global sweep at the end verifies no outbox row was left pending without
 * a matching handler_runs entry (no orphans).
 *
 * ─── What this spec does NOT do ────────────────────────────────────────────
 *
 * We do not kill processes or simulate Redis Sentinel failover. Both require
 * docker-level orchestration that does not belong in a vitest file. What we
 * test here is the *recovery code path* each crash would trigger in
 * production — the DB-side exactly-once fence (dispatched_at guard +
 * handler_runs PK). If the recovery path holds under the five DB-observable
 * chaos shapes above, process-kill scenarios degenerate to the same shapes
 * on reboot: a pending outbox row, an un-acked BullMQ job, or a previously
 * completed handler_runs row.
 *
 * ─── Why a test-local drain re-impl instead of createOutboxDrain ──────────
 *
 * The dev docker stack runs apps/listen-notify against this same Postgres.
 * Its 30s poller issues `SELECT ... WHERE dispatched_at IS NULL` with NO
 * aggregate_type filter, so over a ~60-second 1000-iter run that poller
 * would race our re-armed rows and claim them from under us. We re-implement
 * the drain's three core operations — (SELECT pending ∧ aggregate_type),
 * (queue.add with jobId), (UPDATE dispatched_at guarded on IS NULL) —
 * scoped to our chaos aggregate_type. The drain-level *behavior* (retry
 * wrapper, metrics, setImmediate chain) is already covered end-to-end by
 * Gate 22 (gate-22-arch3-outbox-e2e.test.ts) against the real
 * createOutboxDrain; this spec targets exactly-once *semantics* under
 * chaos, which only depend on those three operations.
 *
 * Live-listener isolation on INSERT is still required — we use the Gate-22
 * invisibility trick (insert with past dispatched_at, then UPDATE to NULL)
 * so the live listener's INSERT-triggered drain does not race us on the
 * very first tick.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { enqueueOutbox, withOrg } from "@instigenie/db";
import {
  runHandler,
  type HandlerEntry,
} from "@instigenie/worker/handlers";
import type { QueueLike } from "@instigenie/listen-notify/drain";
import {
  makeTestPool,
  makeVendorTestPool,
  waitForPg,
  DEV_ORG_ID,
} from "./_helpers.js";
import { silentLog } from "./_phase3-helpers.js";

// ─── Config ───────────────────────────────────────────────────────────────

const ITERATIONS = Number(process.env.CHAOS_ITERATIONS ?? 1000);
const SETTLE_MS = Number(process.env.CHAOS_SETTLE_MS ?? 20);
const TIMEOUT_MS = Number(process.env.CHAOS_TIMEOUT_MS ?? 10 * 60_000);

const SEED_LEAD_ID = "00000000-0000-0000-0000-0000cc0ac001";
const AGG_TYPE = "chaos_aggregate";
const EVENT_TYPE = "gate_chaos.triggered";
const HANDLER_NAME = "gate_chaos.write_side_effect";
const ORIGINAL_PREFIX = "chaos-original:";
const HANDLER_PREFIX = "chaos-handler:";

const MODES = [
  "skip-notify",
  "duplicate-notify",
  "crash-after-enqueue-before-ack",
  "handler-mid-body-crash",
  "worker-restart-after-commit",
] as const;
type Mode = (typeof MODES)[number];

interface StubQueueEntry {
  jobId: string;
  outboxId: string;
  eventType: string;
}

describe("chaos-outbox-exactly-once", () => {
  let pool: pg.Pool;
  // Cross-tenant read pool (BYPASSRLS) for assertions and cleanup — the
  // main pool's instigenie_app role has RLS enforced, so naked SELECTs
  // outside a withOrg txn return zero rows. `instigenie_vendor` bypasses
  // RLS for the read-only / destructive paths that don't model a tenant
  // action.
  let vendorPool: pg.Pool;

  // Per-iteration mutable state, reset at the top of each iteration.
  const captured: StubQueueEntry[] = [];
  const seenJobIds = new Set<string>();

  // Handler one-shot throw flag for mode 4. Keyed by outboxId; handler
  // removes itself on first fire so the retry succeeds.
  const throwOnceSet = new Set<string>();

  // BullMQ-like stub — dedupes by jobId exactly like Queue#add(..., { jobId }).
  const stubQueue: QueueLike = {
    async add(name, data, opts) {
      const jobId = opts?.jobId ?? `${name}:${data.outboxId}`;
      if (seenJobIds.has(jobId)) return;
      seenJobIds.add(jobId);
      captured.push({ jobId, outboxId: data.outboxId, eventType: name });
    },
  };

  const chaosEntry: HandlerEntry = {
    eventType: EVENT_TYPE,
    handlerName: HANDLER_NAME,
    handler: async (client, payload, ctx) => {
      if (throwOnceSet.has(ctx.outboxId)) {
        throwOnceSet.delete(ctx.outboxId);
        throw new Error("chaos: handler mid-body crash");
      }
      const p = payload as {
        orgId: string;
        leadId: string;
        iteration: number;
      };
      await client.query(
        `INSERT INTO lead_activities (org_id, lead_id, type, content)
         VALUES ($1, $2, 'NOTE', $3)`,
        [p.orgId, p.leadId, `${HANDLER_PREFIX}${p.iteration}`]
      );
    },
  };

  beforeAll(async () => {
    pool = makeTestPool();
    vendorPool = makeVendorTestPool();
    await waitForPg(pool);
    await waitForPg(vendorPool);
    // Seed the shared anchor lead — lead_activities FK-requires a real
    // lead row, and we want every iteration's side-effect writes to hang
    // off the same lead so the surgical cleanup stays trivial.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `INSERT INTO leads (id, org_id, name, company, email, phone)
         VALUES ($1, $2, 'Chaos Anchor', 'Chaos Co', 'chaos@invalid.local', '+99-0-chaos')
         ON CONFLICT (id) DO NOTHING`,
        [SEED_LEAD_ID, DEV_ORG_ID]
      );
    });
    await cleanupAll();
  });

  afterAll(async () => {
    if (pool) {
      await cleanupAll();
      await pool.end();
      await vendorPool.end();
    }
  });

  async function cleanupAll(): Promise<void> {
    // outbox.* is not RLS-enabled and instigenie_vendor has no grants on
    // schema outbox, so outbox cleanup runs through the main app pool.
    await pool.query(
      `DELETE FROM outbox.handler_runs
        WHERE outbox_id IN (SELECT id FROM outbox.events WHERE aggregate_type = $1)`,
      [AGG_TYPE]
    );
    await pool.query(
      `DELETE FROM outbox.events WHERE aggregate_type = $1`,
      [AGG_TYPE]
    );
    // lead_activities is RLS-enabled; vendorPool (BYPASSRLS) clears it
    // cross-tenant without needing a withOrg wrapper per iteration.
    await vendorPool.query(
      `DELETE FROM lead_activities
        WHERE lead_id = $1
          AND (content LIKE $2 OR content LIKE $3)`,
      [SEED_LEAD_ID, `${ORIGINAL_PREFIX}%`, `${HANDLER_PREFIX}%`]
    );
  }

  // ─── Negative control ─────────────────────────────────────────────────
  //
  // The main chaos test asserts exactly-once *after* recovery drains the
  // outbox row. On its own, that's consistent with a trivial bug: what if
  // the handler side effect lands spontaneously without anyone draining?
  // Then "exactly one" would still pass by accident.
  //
  // This test makes the recovery path causally necessary. We do the domain
  // commit + outbox enqueue exactly like the main flow, then deliberately
  // DO NOT drain and DO NOT run the handler. We prove the side effect
  // *does not* land, the outbox row stays pending, handler_runs stays
  // empty. Then we drain + run and assert the side effect lands exactly
  // once — proving drain is both necessary and sufficient.
  //
  // If a future change makes outbox rows auto-trigger handlers on INSERT
  // (e.g. a DB trigger, or a queue.add() inside enqueueOutbox itself),
  // this test fails loudly. Without it, such a change would silently
  // satisfy the main invariant and the spec would stop distinguishing
  // "recovery worked" from "there was nothing to recover from."
  it(
    "negative control: without recovery drain, handler_runs stays empty and side effect never lands",
    async () => {
      resetIterationState();
      const iter = -1; // sentinel, still matches cleanup LIKE prefixes
      const outboxId = await commitWithInvisibility(iter);

      // Give any live listener one more settle window to do something we
      // don't want it to do. If the SETTLE_MS re-arm didn't hold, or if
      // some other process claims un-dispatched rows by aggregate_type,
      // this is where it would show up.
      await new Promise((r) => setTimeout(r, SETTLE_MS));

      // Domain write landed (proves the business txn commits).
      expect(
        await countActivities(`${ORIGINAL_PREFIX}${iter}`),
        "domain write lands regardless of drain"
      ).toBe(1);
      // Handler side effect did NOT land — nobody drained, nobody ran.
      expect(
        await countActivities(`${HANDLER_PREFIX}${iter}`),
        "handler side effect must NOT land without drain+handler"
      ).toBe(0);
      // Nothing was enqueued — we bypassed the live NOTIFY path and we
      // haven't polled. Queue is empty.
      expect(
        captured,
        "no queue delivery without drain"
      ).toEqual([]);
      // Outbox row is pending.
      const { rows: ob } = await pool.query<{ dispatched_at: Date | null }>(
        `SELECT dispatched_at FROM outbox.events WHERE id = $1`,
        [outboxId]
      );
      expect(ob.length, "outbox row exists").toBe(1);
      expect(
        ob[0]?.dispatched_at,
        "outbox row is still pending"
      ).toBeNull();
      // No handler_runs row.
      const { rows: hr } = await pool.query(
        `SELECT 1 FROM outbox.handler_runs WHERE outbox_id = $1`,
        [outboxId]
      );
      expect(
        hr.length,
        "no handler_runs row without drain+handler"
      ).toBe(0);

      // Drain is both necessary AND sufficient: run it, watch the side
      // effect land exactly once.
      await testDrain();
      const r = await runHandlerOnce(outboxId, iter);
      expect(r.status, "drain then run COMPLETED").toBe("COMPLETED");
      expect(
        await countActivities(`${HANDLER_PREFIX}${iter}`),
        "side effect lands exactly once after drain+run"
      ).toBe(1);

      // Leave a clean slate for the main chaos test — cleanupAll was
      // already called in beforeAll; this wipes the negative-control's
      // iteration so the main test's count assertions aren't off-by-one.
      await cleanupAll();
    }
  );

  it(
    `${ITERATIONS} iterations across ${MODES.length} failure modes: exactly-once invariant holds`,
    async () => {
      const outboxByIter = new Map<number, string>();

      for (let iter = 0; iter < ITERATIONS; iter++) {
        const mode = MODES[iter % MODES.length]!;
        resetIterationState();

        // ── Phase 1: business txn ─ domain write + outbox enqueue (one txn)
        const outboxId = await commitWithInvisibility(iter);
        outboxByIter.set(iter, outboxId);

        // ── Phase 2/3: inject chaos + recover
        await runMode(mode, outboxId, iter);

        // ── Phase 4: per-iteration invariant check
        await assertInvariants(mode, iter, outboxId);
      }

      // ── Global sweep ─ every outbox row has a handler_runs entry.
      const orphan = await pool.query<{ id: string }>(
        `SELECT e.id
           FROM outbox.events e
           LEFT JOIN outbox.handler_runs r
             ON r.outbox_id = e.id AND r.handler_name = $2
          WHERE e.aggregate_type = $1
            AND r.outbox_id IS NULL`,
        [AGG_TYPE, HANDLER_NAME]
      );
      expect(orphan.rows, "outbox rows without handler_runs (orphans)").toEqual([]);

      // Total handler_runs should equal ITERATIONS (exactly-once globally).
      const { rows: total } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c
           FROM outbox.handler_runs r
           JOIN outbox.events e ON e.id = r.outbox_id
          WHERE e.aggregate_type = $1 AND r.handler_name = $2`,
        [AGG_TYPE, HANDLER_NAME]
      );
      expect(Number(total[0]!.c)).toBe(ITERATIONS);
    },
    TIMEOUT_MS
  );

  // ─── Helpers ────────────────────────────────────────────────────────────

  function resetIterationState(): void {
    captured.length = 0;
    seenJobIds.clear();
    // throwOnceSet is one-shot per-outbox; do not clear — the handler
    // removes itself on first fire, and modes that don't populate it are
    // unaffected.
  }

  /**
   * Insert the domain write + outbox row in a single txn, then use the
   * Gate-22 invisibility trick to keep the row from being claimed by the
   * live apps/listen-notify INSERT-triggered drain. On exit, the row is
   * pending (dispatched_at IS NULL) and visible only to our
   * aggregate_type-scoped test drain.
   */
  async function commitWithInvisibility(iter: number): Promise<string> {
    let outboxId = "";
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `INSERT INTO lead_activities (org_id, lead_id, type, content)
         VALUES ($1, $2, 'NOTE', $3)`,
        [DEV_ORG_ID, SEED_LEAD_ID, `${ORIGINAL_PREFIX}${iter}`]
      );
      const ev = await enqueueOutbox(client, {
        aggregateType: AGG_TYPE,
        aggregateId: SEED_LEAD_ID,
        eventType: EVENT_TYPE,
        payload: { orgId: DEV_ORG_ID, leadId: SEED_LEAD_ID, iteration: iter },
      });
      outboxId = ev.id;
      // Stamp dispatched_at in the past so the AFTER-INSERT NOTIFY fires
      // into a row every live drain's `WHERE dispatched_at IS NULL` filter
      // skips. The NOTIFY queue is flushed at COMMIT, so this must happen
      // in the same txn.
      await client.query(
        `UPDATE outbox.events SET dispatched_at = now() - interval '1 hour'
          WHERE id = $1`,
        [outboxId]
      );
    });
    // Let any listener process + discard the NOTIFY.
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    // Re-arm as pending. UPDATE does not fire AFTER-INSERT, so this is
    // invisible to every LISTEN subscriber. Our test drain will see it.
    await pool.query(
      `UPDATE outbox.events SET dispatched_at = NULL WHERE id = $1`,
      [outboxId]
    );
    return outboxId;
  }

  /**
   * Faithful re-implementation of the three drain operations, scoped to
   * our aggregate_type. See file docblock for why. Uses the main app
   * pool — outbox.* has no RLS and instigenie_app has full DML on the
   * schema.
   */
  async function testDrain(): Promise<void> {
    const { rows } = await pool.query<{
      id: string;
      aggregate_type: string;
      event_type: string;
    }>(
      `SELECT id, aggregate_type, event_type
         FROM outbox.events
        WHERE dispatched_at IS NULL AND aggregate_type = $1
        ORDER BY created_at
        LIMIT 100`,
      [AGG_TYPE]
    );
    await Promise.all(
      rows.map(async (row) => {
        await stubQueue.add(
          row.event_type,
          { outboxId: row.id, aggregateType: row.aggregate_type },
          { jobId: `outbox-${row.id}` }
        );
        await pool.query(
          `UPDATE outbox.events
              SET dispatched_at = now(), attempts = attempts + 1
            WHERE id = $1 AND dispatched_at IS NULL`,
          [row.id]
        );
      })
    );
  }

  async function runMode(
    mode: Mode,
    outboxId: string,
    iter: number
  ): Promise<void> {
    switch (mode) {
      case "skip-notify": {
        // NOTIFY never reached any subscriber. Before we invoke the poller
        // tick, pin the "nothing has happened yet" starting state — this
        // is the negative-control baked into the mode itself. If some other
        // drain (live listener, cron, concurrent test) had picked up the
        // row despite commitWithInvisibility()'s masking, one of these
        // three assertions fails and the test tells us *how* the
        // isolation broke, not just that exactly-once was violated.
        expect(
          captured,
          `[${mode}, iter=${iter}] pre-drain: queue must be empty (no one delivered the row)`
        ).toEqual([]);
        const preOb = await pool.query<{ dispatched_at: Date | null }>(
          `SELECT dispatched_at FROM outbox.events WHERE id = $1`,
          [outboxId]
        );
        expect(
          preOb.rows[0]?.dispatched_at,
          `[${mode}, iter=${iter}] pre-drain: row must still be pending`
        ).toBeNull();
        const preHr = await pool.query(
          `SELECT 1 FROM outbox.handler_runs WHERE outbox_id = $1`,
          [outboxId]
        );
        expect(
          preHr.rowCount,
          `[${mode}, iter=${iter}] pre-drain: no handler_runs row yet`
        ).toBe(0);
        // Poller tick drains; handler completes.
        await testDrain();
        await runHandlerOnce(outboxId, iter);
        break;
      }
      case "duplicate-notify": {
        // Listener + poller hit the same row at once. jobId dedup collapses.
        await Promise.all([testDrain(), testDrain()]);
        await runHandlerOnce(outboxId, iter);
        break;
      }
      case "crash-after-enqueue-before-ack": {
        // drain succeeded (queue accepted + row marked dispatched), but
        // simulate the API process crashing before the mark committed by
        // rolling back dispatched_at. Next drain re-enqueues; jobId dedup
        // suppresses the duplicate handler run.
        await testDrain();
        await pool.query(
          `UPDATE outbox.events SET dispatched_at = NULL, attempts = 0 WHERE id = $1`,
          [outboxId]
        );
        await testDrain();
        await runHandlerOnce(outboxId, iter);
        break;
      }
      case "handler-mid-body-crash": {
        // Handler throws mid-body. runner.ts rolls back the txn including
        // the handler_runs claim. Retry re-acquires and succeeds.
        await testDrain();
        throwOnceSet.add(outboxId);
        const r1 = await runHandlerOnce(outboxId, iter);
        expect(r1.status, `iter=${iter} first-run`).toBe("FAILED");
        const r2 = await runHandlerOnce(outboxId, iter);
        expect(r2.status, `iter=${iter} retry`).toBe("COMPLETED");
        break;
      }
      case "worker-restart-after-commit": {
        // Handler ran to completion; worker restarts and re-delivers the job.
        // ON CONFLICT DO NOTHING on handler_runs yields SKIPPED — no second
        // side effect.
        await testDrain();
        const r1 = await runHandlerOnce(outboxId, iter);
        expect(r1.status, `iter=${iter} first-run`).toBe("COMPLETED");
        const r2 = await runHandlerOnce(outboxId, iter);
        expect(r2.status, `iter=${iter} redelivery`).toBe("SKIPPED");
        break;
      }
    }
  }

  function runHandlerOnce(outboxId: string, iter: number) {
    return runHandler({
      pool,
      entry: chaosEntry,
      payload: { orgId: DEV_ORG_ID, leadId: SEED_LEAD_ID, iteration: iter },
      ctx: { outboxId, log: silentLog },
    });
  }

  async function assertInvariants(
    mode: Mode,
    iter: number,
    outboxId: string
  ): Promise<void> {
    const tag = `[${mode}, iter=${iter}, outbox=${outboxId}]`;

    const origCount = await countActivities(`${ORIGINAL_PREFIX}${iter}`);
    expect(origCount, `${tag} original-domain-write count`).toBe(1);

    const handlerCount = await countActivities(`${HANDLER_PREFIX}${iter}`);
    expect(handlerCount, `${tag} handler-side-effect count`).toBe(1);

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM outbox.handler_runs
        WHERE outbox_id = $1 AND handler_name = $2`,
      [outboxId, HANDLER_NAME]
    );
    expect(rows.length, `${tag} handler_runs row count`).toBe(1);
    expect(rows[0]!.status, `${tag} handler_runs status`).toBe("COMPLETED");

    // Queue-level exactly-once: jobId dedup + drain guard must collapse
    // the 5 chaos shapes to exactly ONE enqueue per iteration. This is the
    // invariant that proves the *queue side* of exactly-once, complementing
    // the lead_activities row count which proves the *handler side*.
    // The per-iteration state is reset in resetIterationState(), so this
    // is scoped to this iteration only.
    expect(captured.length, `${tag} exactly one queue delivery`).toBe(1);
    expect(
      captured[0]?.outboxId,
      `${tag} the delivered jobId must match this iteration's outbox row`
    ).toBe(outboxId);

    // Outbox row must end up marked delivered. The crash-after-enqueue
    // mode deliberately NULLs dispatched_at mid-sequence; if a regression
    // left the row pending at end-of-iteration, the live listener would
    // eventually pick it up in production and fire the handler a *second*
    // time — jobId dedup is per-process, so that re-run would be a real
    // duplicate. Pinning dispatched_at NOT NULL per iteration closes that.
    const { rows: ob } = await pool.query<{ dispatched_at: Date | null }>(
      `SELECT dispatched_at FROM outbox.events WHERE id = $1`,
      [outboxId]
    );
    expect(
      ob[0]?.dispatched_at,
      `${tag} outbox row must be marked dispatched`
    ).not.toBeNull();
  }

  async function countActivities(content: string): Promise<number> {
    const { rows } = await vendorPool.query<{ c: string }>(
      `SELECT count(*)::text AS c
         FROM lead_activities
        WHERE content = $1 AND lead_id = $2`,
      [content, SEED_LEAD_ID]
    );
    return Number(rows[0]!.c);
  }
});
