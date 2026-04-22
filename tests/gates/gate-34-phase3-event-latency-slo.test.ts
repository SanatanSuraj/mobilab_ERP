/**
 * Gate 34 — ARCHITECTURE.md Phase 3 §3.8: "event latency SLO —
 * 50 deal.won events in 60s, p95 < 5s, p99 < 10s".
 *
 * The end-to-end path we're measuring:
 *
 *   business code  ──enqueueOutbox()──▶  outbox.events
 *                                         │
 *                                         │ pg NOTIFY outbox_event
 *                                         ▼
 *                             apps/listen-notify  drain()
 *                                         │
 *                                         │ Queue#add()   (BullMQ in prod)
 *                                         ▼
 *                             worker → DispatcherService.dispatch()
 *                                         │
 *                                         │ INSERT notifications
 *                                         ▼
 *                                  recipient inbox row
 *
 * "Latency" here is the wall-clock gap between the moment a caller
 * commits `enqueueOutbox` and the moment the notification row lands
 * in `notifications`. In production this is the top-of-funnel SLO
 * that drives everything downstream (SSE push, email send, etc).
 *
 * ─── Simplifications for this gate ────────────────────────────────
 *
 * We run the real drain + real dispatcher, but swap BullMQ for an
 * inline stub queue whose `add()` directly invokes the dispatcher.
 * Justification:
 *
 *   1. Gate 21 already proves BullMQ's add → consume latency is in
 *      the single-digit-ms range.
 *   2. We care about the *pipeline's* behaviour under load — the
 *      outbox INSERT → NOTIFY → drain → dispatcher → notifications
 *      INSERT sequence. BullMQ adds Redis RTT noise but doesn't
 *      change the critical-path shape.
 *   3. This keeps the gate runnable in CI without a worker process.
 *
 * Real k6/BullMQ soak-tests belong in ops/k6/ and exercise the full
 * stack; this gate locks in the in-process correctness contract.
 *
 * ─── Arrival pattern ──────────────────────────────────────────────
 *
 * 50 events staggered at ~200ms intervals (10s total arrival window)
 * rather than a 60s trickle. A burst is a stricter test of the SLO
 * than steady-state arrivals, and it keeps the gate under ~15s wall
 * clock. The spec's "50 / 60s" rate is comfortably easier than what
 * we actually fire.
 *
 * ─── Assertions ───────────────────────────────────────────────────
 *
 *   1. All 50 events produce exactly one `notifications` row each
 *      (no drops, no duplicates).
 *   2. No event is seen more than once by the dispatcher (dedupe via
 *      outbox.dispatched_at on UPDATE WHERE dispatched_at IS NULL).
 *   3. p95 latency  < 5000 ms.
 *   4. p99 latency  < 10000 ms.
 *   5. p50 (median) latency is reported but not hard-asserted; it's
 *      a useful regression signal in the test output.
 *
 * Cleanup: every row this gate writes is tagged with
 * event_type='gate34.deal.won' (templates, notifications, outbox).
 * beforeEach wipes them.
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
import { enqueueOutbox, withOrg } from "@instigenie/db";
import {
  DispatcherService,
  notificationTemplatesRepo,
} from "@instigenie/api/notifications";
import { createOutboxDrain, type QueueLike } from "@instigenie/listen-notify/drain";
import { createLogger } from "@instigenie/observability";
import { DATABASE_URL, DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

const DEV_ADMIN_ID = "00000000-0000-0000-0000-00000000b001";

/** Event type under test. */
const EVENT_TYPE = "gate34.deal.won";

/** Aggregate id used by enqueueOutbox (shared across all 50 rows —
 *  outbox doesn't enforce per-aggregate uniqueness, and we want the
 *  dispatch path to fan them out in arrival order). */
const AGG_ID = "00000000-0000-0000-0000-000000003400";

/** SLO numbers from §3.8. */
const P95_BUDGET_MS = 5_000;
const P99_BUDGET_MS = 10_000;

/** How many events the gate fires. */
const EVENT_COUNT = 50;

/** Stagger between enqueueOutbox calls. 200ms * 50 = 10s arrival
 *  window, well inside the 60s spec budget. */
const ARRIVAL_INTERVAL_MS = 200;

/** Hard upper bound on wall-clock test duration — if we blow past
 *  this, something is fundamentally wrong (not a latency issue). */
const TEST_TIMEOUT_MS = 60_000;

// ── helpers ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank, 1-indexed — standard for small sample SLO reports.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)]!;
}

async function wipeGate34(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      [DEV_ADMIN_ID]
    );
    await client.query(
      `DELETE FROM notifications WHERE event_type = $1`,
      [EVENT_TYPE]
    );
    // Hard-delete templates so re-runs don't collide on the
    // (event_type, channel) partial unique index.
    await client.query(
      `DELETE FROM notification_templates WHERE event_type = $1`,
      [EVENT_TYPE]
    );
  });
  // outbox.events is global (no org_id).
  await pool.query(
    `DELETE FROM outbox.events WHERE event_type = $1`,
    [EVENT_TYPE]
  );
}

async function seedTemplate(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      [DEV_ADMIN_ID]
    );
    await notificationTemplatesRepo.create(client, DEV_ORG_ID, DEV_ADMIN_ID, {
      eventType: EVENT_TYPE,
      channel: "IN_APP",
      name: "Gate 34 Deal Won",
      description: "gate-34 deal-won inbox template",
      subjectTemplate: "Deal {{dealId}} won",
      bodyTemplate: "Great news — deal {{dealId}} closed at {{amount}}.",
      defaultSeverity: "SUCCESS",
      isActive: true,
    });
  });
}

// ── describe block ──────────────────────────────────────────────────────────

describe("gate-34 (arch phase 3.8): event latency SLO", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await wipeGate34(pool);
    await pool.end();
  });

  beforeEach(async () => {
    await wipeGate34(pool);
    await seedTemplate(pool);
  });

  it(
    `50 deal.won events: p95 < ${P95_BUDGET_MS}ms, p99 < ${P99_BUDGET_MS}ms`,
    async () => {
      const log = createLogger({ service: "gate-34", level: "fatal" });
      const dispatcher = new DispatcherService(pool, {
        // IN_APP-only scenario; no email/whatsapp transports needed.
      });

      // outboxId → { startMs } — populated at enqueueOutbox time.
      // outboxId → { endMs } — populated when dispatch completes and the
      // notifications row is committed.
      const starts = new Map<string, number>();
      const ends = new Map<string, number>();

      // Deliveries fire-and-forget from the stub queue's add() callback.
      // We Promise.all them at the end so test failure surfaces any
      // rejection instead of hanging on an unhandled error.
      const dispatches: Promise<void>[] = [];

      const stubQueue: QueueLike = {
        async add(eventType, data) {
          // The drain sees every row it polls; we filter to *our* events
          // so any leftover from other test files doesn't clutter the
          // latency sample.
          if (eventType !== EVENT_TYPE) return;
          const p = (async () => {
            // Pull payload from outbox to feed variables — closer to the
            // production worker's behaviour. (In prod the worker reads
            // by outboxId; here we do the same.)
            const { rows } = await pool.query<{
              payload: { dealId: string; amount: string };
            }>(
              `SELECT payload::jsonb AS payload
                 FROM outbox.events WHERE id = $1`,
              [data.outboxId]
            );
            const payload = rows[0]?.payload ?? { dealId: "?", amount: "?" };
            await dispatcher.dispatch(
              DEV_ORG_ID,
              {
                eventType,
                recipients: [{ userId: DEV_ADMIN_ID }],
                variables: {
                  dealId: String(payload.dealId),
                  amount: String(payload.amount),
                },
                referenceType: "deal",
                // reference_id is optional but must be a uuid; the outbox
                // id works well as a stable handle.
                referenceId: data.outboxId,
              },
              { actorId: DEV_ADMIN_ID }
            );
            ends.set(data.outboxId, performance.now());
          })();
          dispatches.push(p);
        },
      };

      const { drain } = createOutboxDrain({ pool, queue: stubQueue, log });

      // Live LISTEN/NOTIFY so the drain is woken immediately on INSERT.
      // This is the production hot path — the 30s poller is the fallback.
      const listener = new pg.Client({ connectionString: DATABASE_URL });
      await listener.connect();
      await listener.query("LISTEN outbox_event");
      listener.on("notification", () => {
        void drain();
      });

      try {
        // 1. Fire 50 enqueueOutbox() calls staggered at ARRIVAL_INTERVAL_MS.
        for (let i = 0; i < EVENT_COUNT; i++) {
          await withOrg(pool, DEV_ORG_ID, async (client) => {
            const ev = await enqueueOutbox(client, {
              aggregateType: "deal",
              aggregateId: AGG_ID,
              eventType: EVENT_TYPE,
              payload: {
                dealId: `deal-${i.toString().padStart(3, "0")}`,
                amount: (100_000 + i * 1000).toString(),
              },
            });
            // Mark start time right after the enqueue commits. Using
            // performance.now() avoids DST / clock-skew issues.
            starts.set(ev.id, performance.now());
          });
          if (i < EVENT_COUNT - 1) {
            await new Promise((r) => setTimeout(r, ARRIVAL_INTERVAL_MS));
          }
        }

        // 2. Wait for every outboxId to either complete dispatch OR
        //    hit the TEST_TIMEOUT_MS ceiling. We poll every 50ms; under
        //    the SLO this loop should exit well before the deadline.
        const deadline = Date.now() + TEST_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (ends.size >= starts.size) break;
          // Give the listener a chance; in the poller-only fallback we'd
          // also tick drain() periodically, but LISTEN is reliable here.
          await new Promise((r) => setTimeout(r, 50));
        }

        // 3. Flush any lingering dispatch() promises to surface errors.
        await Promise.all(dispatches);

        // 4. Compute latency stats.
        const latencies: number[] = [];
        const missing: string[] = [];
        for (const [id, start] of starts) {
          const end = ends.get(id);
          if (end === undefined) {
            missing.push(id);
            continue;
          }
          latencies.push(end - start);
        }

        expect(starts.size).toBe(EVENT_COUNT);
        expect(
          missing.length,
          `${missing.length} events never dispatched`
        ).toBe(0);
        expect(latencies.length).toBe(EVENT_COUNT);

        latencies.sort((a, b) => a - b);
        const p50 = percentile(latencies, 50);
        const p95 = percentile(latencies, 95);
        const p99 = percentile(latencies, 99);
        const min = latencies[0]!;
        const max = latencies[latencies.length - 1]!;
        const mean =
          latencies.reduce((a, b) => a + b, 0) / latencies.length;

        // eslint-disable-next-line no-console
        console.log(
          `[gate-34] ${EVENT_COUNT} events: ` +
            `p50=${p50.toFixed(0)}ms ` +
            `p95=${p95.toFixed(0)}ms ` +
            `p99=${p99.toFixed(0)}ms ` +
            `min=${min.toFixed(0)}ms ` +
            `max=${max.toFixed(0)}ms ` +
            `mean=${mean.toFixed(0)}ms`
        );

        // 5. Verify exactly EVENT_COUNT notification rows — one per
        //    event (no drops, no dupes). Dedupe happens at the outbox
        //    update (WHERE dispatched_at IS NULL); verifying 1:1 here
        //    proves that contract holds under concurrent drain waking.
        const notifs = await withOrg(pool, DEV_ORG_ID, async (client) => {
          const { rows } = await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM notifications
              WHERE event_type = $1 AND user_id = $2`,
            [EVENT_TYPE, DEV_ADMIN_ID]
          );
          return Number(rows[0]!.n);
        });
        expect(notifs).toBe(EVENT_COUNT);

        // 6. Verify every outbox row got `dispatched_at` stamped
        //    exactly once (attempts >= 1, dispatched_at NOT NULL).
        const undispatched = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM outbox.events
             WHERE event_type = $1 AND dispatched_at IS NULL`,
          [EVENT_TYPE]
        );
        expect(Number(undispatched.rows[0]!.n)).toBe(0);

        // 7. The actual SLO assertions.
        expect(
          p95,
          `p95 ${p95.toFixed(0)}ms exceeds budget ${P95_BUDGET_MS}ms`
        ).toBeLessThan(P95_BUDGET_MS);
        expect(
          p99,
          `p99 ${p99.toFixed(0)}ms exceeds budget ${P99_BUDGET_MS}ms`
        ).toBeLessThan(P99_BUDGET_MS);
      } finally {
        await listener.end().catch(() => undefined);
      }
    },
    TEST_TIMEOUT_MS + 10_000
  );
});
