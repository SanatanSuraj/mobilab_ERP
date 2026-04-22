/**
 * outbox-dispatch processor. ARCHITECTURE.md §3.1 + §8.
 *
 * Reads the outbox row behind each job and:
 *   1. Runs every entry in the §3.1 HANDLER_CATALOGUE whose eventType
 *      matches the row's event_type, via runHandlersForEvent (which
 *      wraps each handler in its own idempotency slot).
 *   2. Fans certain event types out to downstream BullMQ queues
 *      (currently just `quotation.sent` → email).
 *
 * Both fan-outs are independent: a handler failure does not block the
 * queue route, and a queue enqueue failure does not unwind handler
 * effects. Each handler's idempotency slot absorbs retries cleanly.
 *
 * Adding a new event type:
 *   - in-process side effect → add to HANDLER_CATALOGUE (apps/worker/src/handlers)
 *   - downstream-queue fan-out → add to the Set below + a sibling processor
 */

import type { Processor, Queue } from "bullmq";
import type pg from "pg";
import type { Logger } from "@instigenie/observability";
import { jobsProcessedTotal } from "@instigenie/observability";
import {
  HANDLER_CATALOGUE,
  runHandlersForEvent,
  type EwbClientLike,
  type WhatsAppClientLike,
} from "../handlers/index.js";

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
  /**
   * External clients used by §3.4-flavoured handlers (delivery_challan
   * confirmed fans out to both). Optional so dev / test environments
   * without external wiring can still run the rest of the catalogue.
   */
  clients?: {
    ewb?: EwbClientLike;
    whatsapp?: WhatsAppClientLike;
  };
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
        payload: unknown;
      }>(
        `SELECT id, event_type, payload FROM outbox.events WHERE id = $1`,
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

      // ─── §3.1 in-process handler fan-out ─────────────────────────────
      // Only run if the payload carries an orgId (required for withOrg
      // in runner.ts). Events that predate the §3.1 contract simply
      // don't match any catalogue entry, which is a no-op.
      const payload = (ev.payload ?? {}) as Record<string, unknown>;
      if (typeof payload.orgId === "string") {
        const results = await runHandlersForEvent({
          pool: deps.pool,
          entries: HANDLER_CATALOGUE,
          eventType: ev.event_type,
          payload: payload as { orgId: string } & Record<string, unknown>,
          ctx: {
            outboxId,
            log: deps.log,
            ...(deps.clients ? { clients: deps.clients } : {}),
          },
        });
        if (results.length > 0) {
          deps.log.info(
            {
              outboxId,
              eventType: ev.event_type,
              results: results.map((r) => ({
                handler: r.handlerName,
                status: r.status,
              })),
            },
            "outbox event ran §3.1 handlers",
          );
          const failed = results.filter((r) => r.status === "FAILED");
          if (failed.length > 0) {
            // Throw so BullMQ retries the job. The handler_runs ledger
            // ensures already-COMPLETED handlers are skipped on retry.
            throw new Error(
              `handlers failed: ${failed
                .map((f) => `${f.handlerName}(${f.error?.message ?? "err"})`)
                .join(", ")}`,
            );
          }
        }
      }

      // ─── BullMQ queue fan-out (Phase 2 routes kept) ─────────────────
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
