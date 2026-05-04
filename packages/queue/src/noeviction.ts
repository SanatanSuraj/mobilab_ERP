/**
 * BullMQ "noeviction" guard. Phase 1 Gate 4.
 *
 * BullMQ stores job state in Redis lists, hashes, and streams. If the
 * backing Redis evicts keys under memory pressure (any `allkeys-*` or
 * `volatile-*` policy), jobs can silently disappear — in-flight work
 * is lost, idempotency keys vanish, retried jobs get duplicated.
 *
 * ARCHITECTURE.md §8 makes `noeviction` a hard requirement. The dev
 * docker-compose already sets `--maxmemory-policy noeviction` on the
 * redis-bull container, but an operator could flip it at runtime with
 * `CONFIG SET`. This helper is called at worker boot; it refuses to
 * start on anything other than noeviction.
 *
 * On shared Redis deployments (managed providers, clusters) the
 * CONFIG command may be disabled. In that case the helper surfaces
 * the error rather than silently succeeding, so operators know to
 * either grant CONFIG or verify policy out-of-band.
 */

import { Redis } from "ioredis";

export class BullEvictionPolicyError extends Error {
  readonly code = "bull_redis_not_noeviction";
  readonly actualPolicy: string;
  constructor(actual: string) {
    super(
      `BullMQ redis must be configured with 'noeviction' (got '${actual}'). See ARCHITECTURE.md §8 / Phase 1 Gate 4.`
    );
    this.name = "BullEvictionPolicyError";
    this.actualPolicy = actual;
  }
}

/**
 * Throws if the Redis backing BullMQ is not configured with
 * `maxmemory-policy = noeviction`. No-op on success.
 *
 * The passed connection is used read-only (CONFIG GET) — callers can
 * hand in their long-lived ioredis instance; the helper does not close
 * it. Pass `{ owned: true }` when you create a throwaway connection.
 */
const SKIP_ENV = "BULL_REDIS_SKIP_NOEVICTION_CHECK";

export async function assertBullRedisNoeviction(
  redis: Redis,
  opts: { owned?: boolean } = {}
): Promise<void> {
  // Managed Redis providers (Upstash, AWS Elasticache, Redis Cloud) often
  // disable the CONFIG command for tenant isolation, returning empty or
  // throwing. When the operator has verified noeviction in the provider
  // UI out-of-band, opt in via BULL_REDIS_SKIP_NOEVICTION_CHECK=1.
  const skip = process.env[SKIP_ENV];
  if (skip === "1" || skip === "true") {
    if (opts.owned) await redis.quit().catch(() => undefined);
    // eslint-disable-next-line no-console
    console.warn(
      `[bull] ${SKIP_ENV}=${skip} — skipping maxmemory-policy assertion. ` +
        `Verify the backing Redis is set to 'noeviction' in the provider UI.`
    );
    return;
  }

  let rows: unknown;
  try {
    rows = await redis.config("GET", "maxmemory-policy");
  } catch (err) {
    if (opts.owned) await redis.quit().catch(() => undefined);
    throw new Error(
      `BullMQ redis: unable to read maxmemory-policy (${(err as Error).message}). ` +
        `Grant CONFIG, verify policy is 'noeviction' out-of-band, or set ${SKIP_ENV}=1.`
    );
  }

  // ioredis returns CONFIG GET as ["key", "value"] (node-redis v4 returns
  // a plain object). Support both shapes.
  const policy = readPolicy(rows);

  if (opts.owned) await redis.quit().catch(() => undefined);

  if (policy !== "noeviction") {
    throw new BullEvictionPolicyError(policy);
  }
}

function readPolicy(raw: unknown): string {
  if (Array.isArray(raw)) {
    // ["maxmemory-policy", "noeviction"]
    return String(raw[1] ?? "");
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return String(obj["maxmemory-policy"] ?? "");
  }
  return "";
}
