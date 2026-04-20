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
import { createLogger, registry } from "@mobilab/observability";
import {
  QueueNames,
  makeQueue,
  assertBullRedisNoeviction,
  createBullConnection,
} from "@mobilab/queue";
import { assertDirectPgUrl } from "@mobilab/db";
import { createOutboxDrain } from "./drain.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const log = createLogger({ service: "listen-notify", level: env.logLevel });

// Phase 1 Gate 5 — the listener MUST talk to Postgres directly. LISTEN
// does not survive PgBouncer's transaction mode because the subscription
// is dropped between the pooled client's queries. Fail fast with a clear
// message if someone points this process at pgbouncer by mistake.
assertDirectPgUrl(env.databaseUrl);

// Phase 1 Gate 4 — BullMQ requires maxmemory-policy=noeviction, else
// queued jobs can silently disappear under memory pressure. Verify with
// a throwaway connection before we subscribe anything.
{
  const probe = createBullConnection(env.bullRedisUrl);
  await assertBullRedisNoeviction(probe).finally(() =>
    probe.quit().catch(() => undefined)
  );
}

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

const { drain: drainOutbox } = createOutboxDrain({
  pool,
  queue: outboxQueue,
  log,
});

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
