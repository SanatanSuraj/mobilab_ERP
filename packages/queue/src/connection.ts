/**
 * Shared ioredis connection factory for BullMQ. The `redis-bull` instance is
 * SEPARATE from `redis-cache` (ARCHITECTURE.md §6) — different persistence,
 * different eviction. Never point both at the same URL.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the connection (it manages
 * retries itself via stalled-job recovery). If you set it, bullmq throws at
 * Worker init time.
 */

import { Redis, type RedisOptions } from "ioredis";

export function createBullConnection(url: string): Redis {
  const parsed = parseUrl(url);
  return new Redis({
    ...parsed,
    // BullMQ requirement — it does its own retry management.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Blocking commands (BRPOPLPUSH) need no timeout so the worker can wait.
    connectionName: "instigenie-bull",
    // Keep the process alive as long as a connection is open.
    keepAlive: 30_000,
  });
}

function parseUrl(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    password: u.password || undefined,
    username: u.username || undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : 0,
  };
}
