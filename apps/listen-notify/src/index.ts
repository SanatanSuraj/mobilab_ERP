/**
 * apps/listen-notify — bridges outbox.events → BullMQ.
 *
 * Flow:
 *   1. One dedicated pg connection sits on LISTEN outbox_event.
 *   2. On each notify, we SELECT undispatched rows (using the partial
 *      index) and enqueue into BullMQ outbox-dispatch queue.
 *   3. The worker in apps/worker picks them up and routes to the right
 *      destination queue (email, sms, external webhook) or calls the
 *      handler inline.
 *   4. After successful enqueue, we mark dispatched_at so the row
 *      never fires again.
 *
 * ARCHITECTURE.md §8 — this is the ONLY process that should hold a
 * LISTEN connection in production (otherwise we'd dispatch each row
 * N times).
 */

// Tracing must be initialized first so auto-instrumentation captures pg + http.
import { initTracing } from "@mobilab/observability/tracing";
initTracing({ serviceName: "listen-notify" });

import pg from "pg";
import http from "node:http";
import { createLogger, outboxDepth, registry } from "@mobilab/observability";
import { QueueNames, makeQueue } from "@mobilab/queue";
import { retry } from "@mobilab/resilience";
import { loadEnv } from "./env.js";

const env = loadEnv();
const log = createLogger({ service: "listen-notify", level: env.logLevel });

const outboxQueue = makeQueue(QueueNames.outboxDispatch, {
  redisUrl: env.bullRedisUrl,
});

// Dedicated listener connection — NOT from a pool, because LISTEN must sit
// on a stable connection.
const listener = new pg.Client({ connectionString: env.databaseUrl });

// Separate pool for the read/update side.
const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 5,
  application_name: "mobilab-listen-notify",
});

// ─── Drain loop ───────────────────────────────────────────────────────────────

let draining = false;

async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    // Batch: up to 100 rows at a time. Tweakable.
    const { rows } = await pool.query<{
      id: string;
      aggregate_type: string;
      event_type: string;
    }>(`
      SELECT id, aggregate_type, event_type
      FROM outbox.events
      WHERE dispatched_at IS NULL
      ORDER BY created_at
      LIMIT 100
    `);

    if (rows.length === 0) {
      outboxDepth.set(0);
      return;
    }

    // Enqueue with retry; mark rows dispatched only after successful enqueue.
    await Promise.all(
      rows.map(async (row) => {
        await retry(
          async () => {
            await outboxQueue.add(
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
              log.warn({ err, attempt, outboxId: row.id }, "enqueue retry");
            },
          }
        );

        await pool.query(
          `UPDATE outbox.events
             SET dispatched_at = now(),
                 attempts = attempts + 1
           WHERE id = $1 AND dispatched_at IS NULL`,
          [row.id]
        );
      })
    );

    log.info({ dispatched: rows.length }, "outbox batch dispatched");

    // Measure remaining depth.
    const depthRow = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM outbox.events WHERE dispatched_at IS NULL`
    );
    outboxDepth.set(Number(depthRow.rows[0]?.c ?? "0"));

    // If we got a full batch, there may be more — drain again.
    if (rows.length === 100) setImmediate(drainOutbox);
  } catch (err) {
    log.error({ err }, "drain failed");
  } finally {
    draining = false;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await listener.connect();
  await listener.query("LISTEN outbox_event");
  listener.on("notification", () => {
    void drainOutbox();
  });
  listener.on("error", (err) => {
    log.error({ err }, "listener connection error");
    // pg will attempt auto-reconnect via the event loop; if it doesn't,
    // exit so the supervisor restarts us.
    process.exitCode = 1;
  });

  // Prime: drain anything pending from before we started listening.
  await drainOutbox();

  // Safety net: poll every 30s in case a NOTIFY is lost (shouldn't happen
  // under healthy pg, but fills the gap across disconnects).
  const poller = setInterval(() => void drainOutbox(), 30_000);

  // ─── Metrics endpoint ───────────────────────────────────────────────────────
  if (env.metricsPort > 0) {
    const server = http.createServer(async (req, res) => {
      if (req.url === "/metrics") {
        res.setHeader("Content-Type", registry.contentType);
        res.end(await registry.metrics());
        return;
      }
      if (req.url === "/healthz") {
        res.statusCode = 200;
        res.end("ok");
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(env.metricsPort, () =>
      log.info({ port: env.metricsPort }, "metrics listening")
    );
  }

  log.info("listen-notify started");

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    clearInterval(poller);
    try {
      await listener.end();
    } catch {
      /* swallow */
    }
    try {
      await pool.end();
    } catch {
      /* swallow */
    }
    try {
      await outboxQueue.close();
    } catch {
      /* swallow */
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "fatal");
  process.exit(1);
});
