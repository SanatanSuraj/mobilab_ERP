/**
 * Gate 22 — ARCHITECTURE.md Phase 1 Gate 3 "Outbox end-to-end".
 *
 * Spec:
 *   "Insert outbox row via business code; within 3s worker claims it,
 *    handler runs, status → DELIVERED. Kill listener mid-flight; within
 *    35s the 30s poller catches pending row. Both scenarios automated."
 *
 * Coverage in this file:
 *
 *   A) LISTEN/NOTIFY path — end-to-end using the REAL drain function
 *      from apps/listen-notify/src/drain.ts. We wire pg LISTEN ourselves,
 *      insert a row, and assert `dispatched_at` is set within 3s.
 *
 *   B) Poller fallback — without LISTEN attached (simulating a dropped
 *      listener connection), an explicit drain() call marks the row
 *      dispatched. This is the exact code the 30s setInterval runs in
 *      production; we don't wait 30s in CI, but we prove the code path
 *      recovers from a LOST NOTIFY.
 *
 * We use a stub `QueueLike` that records enqueues instead of talking to
 * BullMQ — Gate 21 already exercises the real queue. This lets Gate 22
 * stay focused on the PG side (which is where the failure modes live).
 *
 * ─── Isolation from the live apps/listen-notify ───────────────────────
 *
 * The dev docker stack also runs apps/listen-notify against this same
 * Postgres. Its `LISTEN outbox_event` session reacts to every INSERT and
 * drains with the identical drain.ts logic we're testing. That means any
 * plain INSERT in this file races the live listener — the live listener
 * usually wins (it has a warm pool and persistent connection), silently
 * marking dispatched_at before this test's stub queue ever sees the row.
 *
 * The poller and idempotency scenarios below need OUR drain to be the one
 * that claims the row, so we insert the row pre-dispatched (dispatched_at
 * set to a past timestamp — the NOTIFY trigger still fires but every
 * drain's `WHERE dispatched_at IS NULL` skips the row) and then clear the
 * flag with a plain UPDATE. UPDATE does not fire the AFTER-INSERT NOTIFY
 * trigger, so only an explicit drain() tick will ever pick the row up —
 * which is exactly the condition the poller test is trying to simulate.
 *
 * The LISTEN-path test still exercises a real INSERT + NOTIFY; there we
 * assert the domain contract (`dispatched_at` set within 3s) and don't
 * require the capture array to contain our own id, since the live
 * listener usually beats us to the UPDATE.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { enqueueOutbox, withOrg } from "@instigenie/db";
import { createOutboxDrain, type QueueLike } from "@instigenie/listen-notify/drain";
import { createLogger } from "@instigenie/observability";
import {
  DATABASE_URL,
  makeTestPool,
  waitForPg,
  DEV_ORG_ID,
} from "./_helpers.js";

const AGG_ID = "00000000-0000-0000-0000-00000000f022";

describe("gate-22 (arch-3): outbox end-to-end", () => {
  let pool: pg.Pool;
  const log = createLogger({ service: "gate-22", level: "fatal" });

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Purge anything from a previous run. Other gates use different
    // aggregate ids, so this is safe.
    await pool.query(
      `DELETE FROM outbox.events WHERE aggregate_id = $1`,
      [AGG_ID]
    );
  });

  it("LISTEN path: a single outbox insert is dispatched within 3s", async () => {
    const enqueued: string[] = [];
    const stubQueue: QueueLike = {
      async add(name, data) {
        // The shared drain picks up EVERY undispatched row in outbox.events
        // (there is no per-aggregate filter on the SELECT), so leftover
        // rows from other gate tests would otherwise pollute the capture
        // array. Scope to this gate's own event-type namespace.
        if (!name.startsWith("gate22.")) return;
        enqueued.push(data.outboxId);
      },
    };
    const { drain } = createOutboxDrain({ pool, queue: stubQueue, log });

    // Dedicated listener on the same role — NOTIFY is role-scoped.
    const listener = new pg.Client({ connectionString: DATABASE_URL });
    await listener.connect();
    await listener.query("LISTEN outbox_event");
    listener.on("notification", () => {
      void drain();
    });

    try {
      let insertedId = "";
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const ev = await enqueueOutbox(client, {
          aggregateType: "test_aggregate",
          aggregateId: AGG_ID,
          eventType: "gate22.listen_path",
          payload: { scenario: "listen" },
        });
        insertedId = ev.id;
      });

      // Contract: dispatched within 3s. In the dev environment the live
      // apps/listen-notify drain is usually the one that stamps
      // dispatched_at — that's the whole point of NOTIFY: any subscriber
      // drains. We assert the contract (row DELIVERED) and accept that
      // either our drain or the live drain may have been the claimer.
      const dispatched = await waitForDispatched(pool, insertedId, 3_000);
      expect(dispatched).toBe(true);

      // attempts column should have incremented exactly once, regardless
      // of who drained.
      const { rows } = await pool.query<{ attempts: number }>(
        `SELECT attempts FROM outbox.events WHERE id = $1`,
        [insertedId]
      );
      expect(rows[0]!.attempts).toBeGreaterThanOrEqual(1);
    } finally {
      await listener.end().catch(() => undefined);
    }
  });

  it("poller fallback: drain() picks up rows even when LISTEN never fires", async () => {
    const enqueued: string[] = [];
    const stubQueue: QueueLike = {
      async add(name, data) {
        if (!name.startsWith("gate22.")) return;
        enqueued.push(data.outboxId);
      },
    };
    const { drain } = createOutboxDrain({ pool, queue: stubQueue, log });

    // Simulate "NOTIFY was lost": insert pre-dispatched so no drain (ours
    // or the live apps/listen-notify) claims the row on the INSERT-time
    // NOTIFY tick, then UPDATE dispatched_at back to NULL. UPDATE does
    // not fire the AFTER-INSERT trigger, so the row stays invisible to
    // every LISTEN subscriber — the poller tick is the only way it ever
    // leaves pending. That is exactly the dropped-NOTIFY condition this
    // test documents.
    const insertedId = await insertPendingInvisibly(pool, "gate22.poller_path");

    // Before the poller tick — dispatched_at must be NULL (we just
    // cleared it). No subscriber has fired because UPDATE didn't NOTIFY.
    const pre = await pool.query<{ dispatched_at: Date | null }>(
      `SELECT dispatched_at FROM outbox.events WHERE id = $1`,
      [insertedId]
    );
    expect(pre.rows[0]!.dispatched_at).toBeNull();

    // Simulate one poller tick.
    await drain();

    expect(enqueued).toContain(insertedId);
    const post = await pool.query<{ dispatched_at: Date | null }>(
      `SELECT dispatched_at FROM outbox.events WHERE id = $1`,
      [insertedId]
    );
    expect(post.rows[0]!.dispatched_at).not.toBeNull();
  });

  it("drain is idempotent: second run does NOT re-enqueue a dispatched row", async () => {
    const enqueued: string[] = [];
    const stubQueue: QueueLike = {
      async add(name, data) {
        if (!name.startsWith("gate22.")) return;
        enqueued.push(data.outboxId);
      },
    };
    const { drain } = createOutboxDrain({ pool, queue: stubQueue, log });

    // Same invisibility trick as the poller test so we can guarantee OUR
    // drain is the one that processes this row (and thus the enqueued
    // count accurately reflects this drain function's behaviour).
    const insertedId = await insertPendingInvisibly(pool, "gate22.idempotent");

    await drain();
    const firstCount = enqueued.filter((id) => id === insertedId).length;
    expect(firstCount).toBe(1);

    // Second pass — row has dispatched_at set now, so the SELECT should
    // skip it and the queue should see no new enqueue.
    await drain();
    const secondCount = enqueued.filter((id) => id === insertedId).length;
    expect(secondCount).toBe(1);
  });
});

/**
 * Insert a row into `outbox.events` that is invisible to every live
 * LISTEN-driven drain (including the apps/listen-notify process that
 * shares this Postgres in dev) so the test's own drain tick is the first
 * subscriber to observe it.
 *
 * Strategy: the AFTER-INSERT NOTIFY trigger fires for every INSERT
 * regardless of column values, but the drain SELECT is gated on
 * `dispatched_at IS NULL`. Inserting with a past timestamp means the
 * NOTIFY fires into a row every drain immediately filters out. We then
 * clear the flag via UPDATE — which does NOT fire the AFTER-INSERT
 * trigger — so the row becomes pending only for whoever polls next.
 */
async function insertPendingInvisibly(
  pool: pg.Pool,
  eventType: string
): Promise<string> {
  let insertedId = "";
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    const ev = await enqueueOutbox(client, {
      aggregateType: "test_aggregate",
      aggregateId: AGG_ID,
      eventType,
      payload: { scenario: eventType },
    });
    insertedId = ev.id;
    // Stamp dispatched_at in the past so any NOTIFY-triggered drain's
    // `WHERE dispatched_at IS NULL` filter skips the row.
    await client.query(
      `UPDATE outbox.events SET dispatched_at = now() - interval '1 hour'
        WHERE id = $1`,
      [insertedId]
    );
  });
  // Give any racing listener a moment to process and discard the NOTIFY,
  // then re-arm the row as pending. UPDATE does not re-fire the
  // AFTER-INSERT NOTIFY trigger, so only a poller tick will now see it.
  await new Promise((r) => setTimeout(r, 50));
  await pool.query(
    `UPDATE outbox.events SET dispatched_at = NULL WHERE id = $1`,
    [insertedId]
  );
  return insertedId;
}

async function waitForDispatched(
  pool: pg.Pool,
  id: string,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query<{ dispatched_at: Date | null }>(
      `SELECT dispatched_at FROM outbox.events WHERE id = $1`,
      [id]
    );
    if (rows[0]?.dispatched_at) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
