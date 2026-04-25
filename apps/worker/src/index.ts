/**
 * apps/worker — BullMQ worker host.
 *
 * Phase 1 workers:
 *   - outbox-dispatch   (stub that logs + metrics; real routing in Phase 2)
 *
 * Phase 4 workers:
 *   - pdf-render        (renders QC certs / POs / invoices / DCs / GRNs;
 *                        3 × 60s retry; permanent failure → pdf_render_dlq)
 *
 * Runs the bootstrap policy guard (Gate 7) at start.
 */

import { initTracing } from "@instigenie/observability/tracing";
initTracing({ serviceName: "worker" });

import http from "node:http";
import pg from "pg";
import {
  createLogger,
  dlqWritesTotal,
  registry,
} from "@instigenie/observability";
import { installNumericTypeParser } from "@instigenie/db";
import {
  QueueNames,
  makeQueue,
  makeWorker,
  assertBullRedisNoeviction,
  createBullConnection,
} from "@instigenie/queue";
import type { Queue, Worker } from "bullmq";
import { S3ObjectStorage } from "@instigenie/storage";
import { loadEnv } from "./env.js";
import { runBootstrapPolicy } from "./bootstrap-policy.js";
import {
  createOutboxDispatchProcessor,
  type EmailQueueJobData,
  type OutboxJob,
} from "./processors/outbox-dispatch.js";
import {
  createEmailProcessor,
  type EmailJob,
} from "./processors/email.js";
import {
  createPdfRenderProcessor,
  writePdfRenderDlq,
  type PdfRenderJob,
} from "./processors/pdf-render.js";
import {
  createAuditHashchainProcessor,
  type AuditHashchainJob,
} from "./processors/audit-hashchain.js";
import { createMailer } from "./email/mailer.js";

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

  // The email queue is written to by the outbox-dispatch processor and read
  // by the email worker registered below. One Queue handle is enough — it's
  // a thin wrapper around the Redis connection.
  const emailQueue = makeQueue<EmailQueueJobData>(QueueNames.email, {
    redisUrl: env.bullRedisUrl,
  });

  // pdf-render queue: enqueued by §3.1 compliance handler on qc_cert.issued;
  // consumed by the pdf-render worker below. Spec §4.1 retry policy:
  //   attempts: 3, backoff: fixed 60s.
  // Permanent failure lands in pdf_render_dlq via the .on("failed") hook.
  const pdfRenderQueue = makeQueue<PdfRenderJob>(QueueNames.pdfRender, {
    redisUrl: env.bullRedisUrl,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "fixed", delay: 60_000 },
    },
  });

  // audit-hashchain queue: scheduled daily at 02:00 via
  // upsertJobScheduler (§6.5 — no OS cron, no setInterval). Used to
  // sweep every org's qc_certs signature-hash chain, record findings
  // in qc_cert_chain_audit_runs, and bump the §10.3
  // erp_audit_chain_break alert counter on any detected tampering.
  const auditHashchainQueue = makeQueue<AuditHashchainJob>(
    QueueNames.auditHashchain,
    { redisUrl: env.bullRedisUrl },
  );

  // Object storage adapter — used by the pdf-render processor to stream
  // the rendered bytes into MinIO. Constructed once and shared across all
  // pdf-render jobs for the life of the worker process.
  const storage = new S3ObjectStorage({
    endpoint: env.minioEndpoint,
    accessKeyId: env.minioAccessKey,
    secretAccessKey: env.minioSecretKey,
  });

  const mailer = createMailer({
    resendApiKey: env.resendApiKey,
    emailDisabled: env.emailDisabled,
  });
  if (env.emailDisabled) {
    log.warn(
      {},
      "email sending is DISABLED (set RESEND_API_KEY + EMAIL_DISABLED=false to enable)",
    );
  }

  const workers: Worker[] = [];
  const outboxWorker = makeWorker<OutboxJob>(QueueNames.outboxDispatch, {
    redisUrl: env.bullRedisUrl,
    processor: createOutboxDispatchProcessor({
      pool,
      log,
      emailQueue,
      // Inject the pdf-render queue so the compliance.enqueuePdfRender
      // handler (§3.1) can fan out without importing BullMQ directly.
      clients: {
        enqueuePdfRender: makePdfRenderEnqueue(pdfRenderQueue),
      },
    }),
    concurrency: env.concurrency,
  });
  const emailWorker = makeWorker<EmailJob>(QueueNames.email, {
    redisUrl: env.bullRedisUrl,
    processor: createEmailProcessor({
      pool,
      log,
      mailer,
      mailFrom: env.mailFrom,
      mailReplyTo: env.mailReplyTo,
      brandName: "InstiGenie",
    }),
    concurrency: env.concurrency,
  });
  const pdfRenderWorker = makeWorker<PdfRenderJob>(QueueNames.pdfRender, {
    redisUrl: env.bullRedisUrl,
    processor: createPdfRenderProcessor({
      pool,
      log,
      storage,
      bucket: env.pdfBucket,
      brandName: env.brandName,
    }),
    // PDF rendering is CPU-heavy — cap concurrency lower than the default
    // transactional queues so one pod doesn't starve the event loop.
    concurrency: Math.max(1, Math.floor(env.concurrency / 2)),
  });
  // audit-hashchain worker: consumes the daily repeatable job emitted by
  // upsertJobScheduler below. Concurrency is pinned to 1 — two parallel
  // sweeps would race to INSERT into qc_cert_chain_audit_runs and could
  // both observe mid-insert chain state, yielding phantom breaks.
  const auditHashchainWorker = makeWorker<AuditHashchainJob>(
    QueueNames.auditHashchain,
    {
      redisUrl: env.bullRedisUrl,
      processor: createAuditHashchainProcessor({ pool, log }),
      concurrency: 1,
    },
  );
  workers.push(outboxWorker, emailWorker, pdfRenderWorker, auditHashchainWorker);

  // Register (or refresh) the daily 02:00 sweep. upsertJobScheduler is
  // idempotent keyed by the scheduler id — multiple worker pods booting
  // simultaneously converge on a single scheduled entry via Redis atomic
  // ops (ARCHITECTURE.md §6.5). If the pattern ever changes, the next
  // boot replaces the previous schedule cleanly.
  await auditHashchainQueue.upsertJobScheduler(
    "audit-hashchain-daily",
    { pattern: "0 2 * * *" },
    {
      name: "audit-hashchain",
      data: { trigger: "SCHEDULED" } satisfies AuditHashchainJob,
    },
  );

  // ─── Dead-letter hook for pdf-render (§4.1) ────────────────────────────
  // BullMQ emits "failed" on every failed attempt; when attemptsMade
  // reaches the configured `attempts`, the job is terminal and ops needs
  // to know. Park the payload + last error in pdf_render_dlq so the
  // admin UI can surface it for manual triage / re-drive.
  pdfRenderWorker.on("failed", (job, err) => {
    const attemptsMade = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 3;
    if (!job || attemptsMade < maxAttempts) {
      // Still has retries left — a subsequent attempt will run. We only
      // DLQ on terminal exhaustion.
      return;
    }
    void (async () => {
      try {
        await writePdfRenderDlq(pool, {
          orgId: job.data.orgId,
          docType: job.data.docType,
          docId: job.data.docId,
          payload: job.data,
          attempts: attemptsMade,
          lastError: err.message,
        });
        // Bump the DLQ counter BEFORE the structured log line so a scrape
        // racing against the log shipper still sees the metric. The
        // alertmanager rule paired with this metric (see
        // packages/observability/src/metrics.ts:dlqWritesTotal) is the
        // primary signal — log.error is the secondary one for humans.
        dlqWritesTotal.inc({
          queue: QueueNames.pdfRender,
          reason: "attempts_exhausted",
        });
        log.error(
          {
            event: "dlq.write",
            queue: QueueNames.pdfRender,
            docType: job.data.docType,
            docId: job.data.docId,
            orgId: job.data.orgId,
            attempts: attemptsMade,
            err,
          },
          "pdf-render: attempts exhausted → pdf_render_dlq",
        );
      } catch (dlqErr) {
        // If we can't even write the DLQ row we've no safety net left.
        // Bump the metric with reason=dlq_write_failed so the alert still
        // fires even when Postgres is the broken dependency.
        dlqWritesTotal.inc({
          queue: QueueNames.pdfRender,
          reason: "dlq_write_failed",
        });
        log.error(
          {
            event: "dlq.write_failed",
            queue: QueueNames.pdfRender,
            err: dlqErr,
            originalErr: err,
            jobData: job.data,
          },
          "pdf-render: FAILED to write pdf_render_dlq",
        );
      }
    })();
  });

  for (const w of workers) {
    if (w.name === QueueNames.pdfRender) continue; // custom DLQ hook above
    w.on("failed", (job, err) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 1;
      const exhausted = !!job && attemptsMade >= maxAttempts;
      // For queues without a dedicated DLQ table (outbox-dispatch,
      // email, audit-hashchain), terminal failure means the job is gone
      // for good unless we surface it. Bump the DLQ counter so
      // Alertmanager pages on-call — log.error alone is too easy to miss
      // in a noisy stream.
      if (exhausted) {
        dlqWritesTotal.inc({
          queue: w.name,
          reason: "attempts_exhausted_no_dlq_table",
        });
      }
      log.error(
        {
          event: exhausted ? "dlq.write" : "job.failed",
          queue: w.name,
          jobId: job?.id,
          attempts: attemptsMade,
          maxAttempts,
          terminal: exhausted,
          err,
        },
        exhausted
          ? `${w.name}: attempts exhausted (no DLQ table — alert via metric)`
          : "job failed",
      );
    });
    w.on("error", (err) => {
      log.error({ event: "worker.error", queue: w.name, err }, "worker error");
    });
  }
  pdfRenderWorker.on("error", (err) => {
    log.error({ queue: pdfRenderWorker.name, err }, "worker error");
  });

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
    await emailQueue.close().catch(() => undefined);
    await pdfRenderQueue.close().catch(() => undefined);
    await auditHashchainQueue.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * Adapt the raw BullMQ Queue into the narrow {@link EnqueuePdfRender}
 * shape that the §3.1 compliance handler accepts, so the handler
 * package has no direct BullMQ import. The `jobId` is stamped from
 * (docType, docId) to ensure that multiple outbox re-deliveries of the
 * same qc_cert.issued event resolve to a single queue slot — idempotent
 * enqueue at the queue layer complementing the idempotency ledger at
 * the processor layer.
 */
function makePdfRenderEnqueue(
  queue: Queue<PdfRenderJob>,
): (job: PdfRenderJob) => Promise<void> {
  return async (job) => {
    await queue.add(`pdf-render:${job.docType}`, job, {
      jobId: `${job.docType}:${job.docId}`,
    });
  };
}

main().catch((err) => {
  log.error({ err }, "fatal");
  process.exit(1);
});
