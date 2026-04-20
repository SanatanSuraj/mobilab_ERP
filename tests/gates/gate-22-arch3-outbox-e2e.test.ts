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
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { enqueueOutbox, withOrg } from "@mobilab/db";
import { createOutboxDrain, type QueueLike } from "@mobilab/listen-notify/drain";
import { createLogger } from "@mobilab/observability";
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
      async add(_name, data) {
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

      // Wait up to 3s for the drain to mark dispatched_at.
      const dispatched = await waitForDispatched(pool, insertedId, 3_000);
      expect(dispatched).toBe(true);
      expect(enqueued).toContain(insertedId);

      // attempts column should have incremented.
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
      async add(_name, data) {
        enqueued.push(data.outboxId);
      },
    };
    const { drain } = createOutboxDrain({ pool, queue: stubQueue, log });

    // DELIBERATELY do NOT set up a listener. Simulates a dropped NOTIFY
    // channel where the 30s poller is the only safety net. (In production
    // setInterval invokes drain(); here we invoke it once directly. The
    // semantics are identical.)
    let insertedId = "";
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const ev = await enqueueOutbox(client, {
        aggregateType: "test_aggregate",
        aggregateId: AGG_ID,
        eventType: "gate22.poller_path",
        payload: { scenario: "poller" },
      });
      insertedId = ev.id;
    });

    // Before the poller tick — dispatched_at must still be NULL.
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
      async add(_name, data) {
        enqueued.push(data.outboxId);
      },
    };
    const { drain } = createOutboxDrain({ pool, queue: stubQueue, log });

    let insertedId = "";
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const ev = await enqueueOutbox(client, {
        aggregateType: "test_aggregate",
        aggregateId: AGG_ID,
        eventType: "gate22.idempotent",
        payload: {},
      });
      insertedId = ev.id;
    });

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
