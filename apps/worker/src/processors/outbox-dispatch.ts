/**
 * outbox-dispatch processor.
 *
 * For Phase 1 we only log the dispatch and mark the row handled —
 * downstream queues (email, sms, external webhook) land in Phase 2
 * alongside the modules that emit those event types.
 */

import type { Processor } from "bullmq";
import type pg from "pg";
import type { Logger } from "@mobilab/observability";
import { jobsProcessedTotal } from "@mobilab/observability";

export interface OutboxJob {
  outboxId: string;
  aggregateType: string;
}

export function createOutboxDispatchProcessor(
  pool: pg.Pool,
  log: Logger
): Processor<OutboxJob> {
  return async (job) => {
    const { outboxId } = job.data;
    try {
      const { rows } = await pool.query<{
        id: string;
        event_type: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT id, event_type, payload
           FROM outbox.events
          WHERE id = $1`,
        [outboxId]
      );
      const ev = rows[0];
      if (!ev) {
        log.warn({ outboxId }, "outbox row not found, skipping");
        jobsProcessedTotal.inc({ queue: "outbox-dispatch", status: "skipped" });
        return;
      }

      // Phase 1: just log. In Phase 2 we route to email/sms/webhook queues
      // based on ev.event_type.
      log.info(
        { eventType: ev.event_type, outboxId },
        "outbox event dispatched (phase-1 noop)"
      );
      jobsProcessedTotal.inc({ queue: "outbox-dispatch", status: "completed" });
    } catch (err) {
      jobsProcessedTotal.inc({ queue: "outbox-dispatch", status: "failed" });
      throw err; // let BullMQ handle retry/backoff
    }
  };
}
