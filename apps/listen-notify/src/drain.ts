/**
 * Outbox drain loop — shared between the live listener and Gate 3 tests.
 *
 * Exposes a pure function `createOutboxDrain(deps)` that returns:
 *   - drain()        : run one batch, mark dispatched_at, enqueue into BullMQ
 *   - getInFlight()  : whether a drain is currently running (for back-pressure)
 *
 * No module-level state. The caller owns the pg Pool, the BullMQ Queue, and
 * the logger; we only invoke them. This makes the function testable without
 * standing up the full apps/listen-notify process.
 */

import type pg from "pg";
import type { Logger } from "@instigenie/observability";
import { outboxDepth } from "@instigenie/observability";
import { retry } from "@instigenie/resilience";

/**
 * Narrow structural type that matches BullMQ's Queue#add. Typing it this way
 * means apps/listen-notify doesn't need a direct bullmq dependency — we only
 * care about the single method the drain uses.
 */
export interface QueueLike {
  add(
    name: string,
    data: { outboxId: string; aggregateType: string },
    opts?: { jobId?: string }
  ): Promise<unknown>;
}

export interface OutboxDrainDeps {
  pool: pg.Pool;
  queue: QueueLike;
  log: Logger;
  /** Max rows per drain pass. Defaults to 100. */
  batchSize?: number;
}

export interface OutboxDrain {
  drain: () => Promise<void>;
  getInFlight: () => boolean;
}

export function createOutboxDrain(deps: OutboxDrainDeps): OutboxDrain {
  let draining = false;
  const batchSize = deps.batchSize ?? 100;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      const { rows } = await deps.pool.query<{
        id: string;
        aggregate_type: string;
        event_type: string;
      }>(
        `SELECT id, aggregate_type, event_type
           FROM outbox.events
          WHERE dispatched_at IS NULL
          ORDER BY created_at
          LIMIT $1`,
        [batchSize]
      );

      if (rows.length === 0) {
        outboxDepth.set(0);
        return;
      }

      await Promise.all(
        rows.map(async (row) => {
          await retry(
            async () => {
              await deps.queue.add(
                row.event_type,
                { outboxId: row.id, aggregateType: row.aggregate_type },
                // Idempotency: if listen-notify restarts mid-drain, BullMQ
                // de-dupes by jobId.
                { jobId: `outbox-${row.id}` }
              );
            },
            {
              maxAttempts: 5,
              baseMs: 100,
              capMs: 5000,
              onAttempt: (err, attempt) => {
                deps.log.warn(
                  { err, attempt, outboxId: row.id },
                  "enqueue retry"
                );
              },
            }
          );

          await deps.pool.query(
            `UPDATE outbox.events
               SET dispatched_at = now(),
                   attempts = attempts + 1
             WHERE id = $1 AND dispatched_at IS NULL`,
            [row.id]
          );
        })
      );

      deps.log.info({ dispatched: rows.length }, "outbox batch dispatched");

      const depthRow = await deps.pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM outbox.events WHERE dispatched_at IS NULL`
      );
      outboxDepth.set(Number(depthRow.rows[0]?.c ?? "0"));

      if (rows.length === batchSize) setImmediate(drain);
    } catch (err) {
      deps.log.error({ err }, "drain failed");
    } finally {
      draining = false;
    }
  }

  return { drain, getInFlight: () => draining };
}
