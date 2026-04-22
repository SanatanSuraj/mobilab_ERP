/**
 * Handler runner — the atomic (claim idempotency slot + run handler)
 * wrapper. ARCHITECTURE.md §3.1.
 *
 * Contract:
 *   1. Open one transaction via withOrg(pool, payload.orgId).
 *   2. INSERT a row into outbox.handler_runs for (outbox_id, handler_name).
 *      If a row already exists (ON CONFLICT DO NOTHING returns 0 rows),
 *      this handler already ran — return { status: "SKIPPED" }.
 *   3. Otherwise run the handler body on the same client.
 *   4. COMMIT. Both the handler's domain writes AND the handler_runs row
 *      land atomically.
 *
 * If the handler throws:
 *   - The whole transaction rolls back including the handler_runs claim.
 *   - The next delivery attempt re-acquires the slot and retries.
 *
 * Guarantees:
 *   - AT-MOST-ONCE observable effects. At-least-once delivery is fine.
 *   - The handler never sees a partially-applied state from a prior
 *     failed attempt — everything is in one txn.
 */

import type pg from "pg";
import { withOrg } from "@instigenie/db";
import type { HandlerContext, HandlerEntry } from "./types.js";

export interface RunHandlerResult {
  handlerName: string;
  status: "COMPLETED" | "SKIPPED" | "FAILED";
  error?: Error;
}

export interface RunHandlerOptions {
  pool: pg.Pool;
  entry: HandlerEntry;
  payload: { orgId: string } & Record<string, unknown>;
  ctx: HandlerContext;
}

export async function runHandler(
  opts: RunHandlerOptions,
): Promise<RunHandlerResult> {
  const { pool, entry, payload, ctx } = opts;
  try {
    const status = await withOrg(pool, payload.orgId, async (client) => {
      const { rowCount } = await client.query(
        `INSERT INTO outbox.handler_runs (outbox_id, handler_name, status)
         VALUES ($1, $2, 'COMPLETED')
         ON CONFLICT (outbox_id, handler_name) DO NOTHING`,
        [ctx.outboxId, entry.handlerName],
      );
      if (rowCount === 0) {
        return "SKIPPED" as const;
      }
      await entry.handler(client, payload, ctx);
      return "COMPLETED" as const;
    });
    return { handlerName: entry.handlerName, status };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    ctx.log.error(
      { err: error, outboxId: ctx.outboxId, handler: entry.handlerName },
      "event handler failed",
    );
    return { handlerName: entry.handlerName, status: "FAILED", error };
  }
}

/**
 * Run every handler registered for a given event type in catalogue order.
 * Failures do not stop other handlers — each has its own idempotency
 * slot so they can heal independently on retry.
 */
export async function runHandlersForEvent(opts: {
  pool: pg.Pool;
  entries: HandlerEntry[];
  eventType: string;
  payload: { orgId: string } & Record<string, unknown>;
  ctx: HandlerContext;
}): Promise<RunHandlerResult[]> {
  const matching = opts.entries.filter((e) => e.eventType === opts.eventType);
  const results: RunHandlerResult[] = [];
  for (const entry of matching) {
    results.push(
      await runHandler({
        pool: opts.pool,
        entry,
        payload: opts.payload,
        ctx: opts.ctx,
      }),
    );
  }
  return results;
}
