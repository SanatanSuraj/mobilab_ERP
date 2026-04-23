/**
 * Factory helpers for producing BullMQ Queue and Worker instances backed by
 * the redis-bull connection. Consumers must declare their queue name via
 * QueueNames — passing a raw string is a lint violation.
 *
 * ARCHITECTURE.md §8:
 *   - Retention:     remove completed after 1h or 1000, keep failed 14d.
 *   - Backoff:       exponential, starting at 2s, capped at 5m, 5 attempts.
 *   - Concurrency:   set per-worker via options, default 4.
 *   - Graceful drain on SIGTERM is the worker's responsibility.
 */

import { Queue, Worker, QueueEvents, type Processor, type WorkerOptions, type JobsOptions } from "bullmq";
import { createBullConnection } from "./connection.js";
import type { QueueName } from "./queue-names.js";

export interface MakeQueueOptions {
  redisUrl: string;
  /**
   * Per-queue job option overrides. Deep-merged onto DEFAULT_JOB_OPTS so
   * callers only need to specify the fields that diverge — e.g. the
   * `pdf-render` queue (ARCHITECTURE.md §4.1) overrides `attempts: 3`
   * and `backoff: { type: 'fixed', delay: 60_000 }` while inheriting the
   * 1h/1000 retain-complete and 14d retain-failed retention defaults.
   */
  defaultJobOptions?: JobsOptions;
}

const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 2_000,
  },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

export function makeQueue<T = unknown>(
  name: QueueName,
  opts: MakeQueueOptions
): Queue<T> {
  const connection = createBullConnection(opts.redisUrl);
  return new Queue<T>(name, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTS,
      ...(opts.defaultJobOptions ?? {}),
    },
  });
}

export interface MakeWorkerOptions<T> {
  redisUrl: string;
  processor: Processor<T>;
  concurrency?: number;
  /** Pass-through for any other BullMQ WorkerOptions. */
  workerOptions?: Partial<Omit<WorkerOptions, "connection" | "concurrency">>;
}

export function makeWorker<T = unknown>(
  name: QueueName,
  opts: MakeWorkerOptions<T>
): Worker<T> {
  const connection = createBullConnection(opts.redisUrl);
  return new Worker<T>(name, opts.processor, {
    connection,
    concurrency: opts.concurrency ?? 4,
    ...opts.workerOptions,
  });
}

export function makeQueueEvents(
  name: QueueName,
  opts: MakeQueueOptions
): QueueEvents {
  const connection = createBullConnection(opts.redisUrl);
  return new QueueEvents(name, { connection });
}
