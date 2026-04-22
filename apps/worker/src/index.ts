/**
 * apps/worker — BullMQ worker host.
 *
 * Phase 1 workers:
 *   - outbox-dispatch   (stub that logs + metrics; real routing in Phase 2)
 *
 * Runs the bootstrap policy guard (Gate 7) at start.
 */

import { initTracing } from "@instigenie/observability/tracing";
initTracing({ serviceName: "worker" });

import http from "node:http";
import pg from "pg";
import { createLogger, registry } from "@instigenie/observability";
import { installNumericTypeParser } from "@instigenie/db";
import {
  QueueNames,
  makeWorker,
  assertBullRedisNoeviction,
  createBullConnection,
} from "@instigenie/queue";
import type { Worker } from "bullmq";
import { loadEnv } from "./env.js";
import { runBootstrapPolicy } from "./bootstrap-policy.js";
import {
  createOutboxDispatchProcessor,
  type OutboxJob,
} from "./processors/outbox-dispatch.js";

const env = loadEnv();
const log = createLogger({ service: "worker", level: env.logLevel });

async function main(): Promise<void> {
  installNumericTypeParser();

  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
    max: 5,
    application_name: "instigenie-worker",
  });

  await runBootstrapPolicy(pool, log);

  // Phase 1 Gate 4 — BullMQ requires maxmemory-policy=noeviction, else
  // queued jobs can silently disappear under memory pressure. Check once
  // at boot with a throwaway connection.
  {
    const probe = createBullConnection(env.bullRedisUrl);
    try {
      await assertBullRedisNoeviction(probe);
    } finally {
      await probe.quit().catch(() => undefined);
    }
  }

  const workers: Worker[] = [];
  workers.push(
    makeWorker<OutboxJob>(QueueNames.outboxDispatch, {
      redisUrl: env.bullRedisUrl,
      processor: createOutboxDispatchProcessor(pool, log),
      concurrency: env.concurrency,
    })
  );

  for (const w of workers) {
    w.on("failed", (job, err) => {
      log.error(
        { queue: w.name, jobId: job?.id, err },
        "job failed"
      );
    });
    w.on("error", (err) => {
      log.error({ queue: w.name, err }, "worker error");
    });
  }

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

  log.info({ queues: workers.map((w) => w.name) }, "worker started");

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await Promise.all(workers.map((w) => w.close()));
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "fatal");
  process.exit(1);
});
