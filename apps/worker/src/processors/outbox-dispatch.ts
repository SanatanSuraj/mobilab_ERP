/**
 * outbox-dispatch processor.
 *
 * Reads the outbox row behind each job and routes it to the correct
 * destination queue based on event_type:
 *   - quotation.sent  → email queue
 *   - (future)        → sms, webhook, …
 *
 * Events with no registered route are logged and marked complete so they
 * don't retry forever — adding a new route means adding an entry to the
 * map below and an appropriate processor.
 */

import type { Processor, Queue } from "bullmq";
import type pg from "pg";
import type { Logger } from "@instigenie/observability";
import { jobsProcessedTotal } from "@instigenie/observability";

export interface OutboxJob {
  outboxId: string;
  aggregateType: string;
}

export interface EmailQueueJobData {
  outboxId: string;
  aggregateType: string;
}

export interface OutboxDispatchDeps {
  pool: pg.Pool;
  log: Logger;
  emailQueue: Queue<EmailQueueJobData>;
}

const EMAIL_EVENT_TYPES = new Set<string>(["quotation.sent"]);

export function createOutboxDispatchProcessor(
  deps: OutboxDispatchDeps,
): Processor<OutboxJob> {
  return async (job) => {
    const { outboxId, aggregateType } = job.data;
    try {
      const { rows } = await deps.pool.query<{
        id: string;
        event_type: string;
      }>(
        `SELECT id, event_type FROM outbox.events WHERE id = $1`,
        [outboxId],
      );
      const ev = rows[0];
      if (!ev) {
        deps.log.warn({ outboxId }, "outbox row not found, skipping");
        jobsProcessedTotal.inc({
          queue: "outbox-dispatch",
          status: "skipped",
        });
        return;
      }

      if (EMAIL_EVENT_TYPES.has(ev.event_type)) {
        // Forward to the email queue. Using event_type as the BullMQ job
        // name matches the drain convention; jobId dedupe prevents a
        // second enqueue if this processor runs twice for the same row.
        await deps.emailQueue.add(
          ev.event_type,
          { outboxId, aggregateType },
          { jobId: `email-${outboxId}` },
        );
        deps.log.info(
          { outboxId, eventType: ev.event_type },
          "outbox event routed to email queue",
        );
      } else {
        deps.log.info(
          { eventType: ev.event_type, outboxId },
          "outbox event had no registered route — dropping",
        );
      }
      jobsProcessedTotal.inc({
        queue: "outbox-dispatch",
        status: "completed",
      });
    } catch (err) {
      jobsProcessedTotal.inc({
        queue: "outbox-dispatch",
        status: "failed",
      });
      throw err;
    }
  };
}
