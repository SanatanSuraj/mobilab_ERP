/**
 * @instigenie/cache — Redis-CACHE helper. ARCHITECTURE.md §6 / §10.
 *
 * Two Redis instances exist in the dev stack:
 *   - redis-bull   (packages/queue)  → BullMQ only, never used for cache
 *   - redis-cache  (this package)    → read-through cache, rate-limits, idempotency
 *
 * Rules:
 *   - NEVER share a connection between the two. They have different persistence
 *     settings and different eviction policies.
 *   - Keys are NAMESPACED: {orgId}:{resource}:{id} — tenancy lives in the key
 *     so SCAN invalidation can scope to one tenant.
 *   - Use `invalidateByPrefix` for group invalidation — it uses SCAN, not KEYS,
 *     so it's O(N) but non-blocking.
 */

import { Redis, type RedisOptions } from "ioredis";

export interface CacheOptions {
  url: string;
  /** Namespace every key with this prefix. Usually "cache". */
  prefix?: string;
  /** Default TTL in seconds. 0 = no expiry (use sparingly). */
  defaultTtlSec?: number;
}

export class Cache {
  readonly client: Redis;
  private readonly prefix: string;
  private readonly defaultTtlSec: number;

  constructor(opts: CacheOptions) {
    const parsed = this.parseUrl(opts.url);
    this.client = new Redis({
      ...parsed,
      // Lazy-connect so construction doesn't block bootstrap.
      lazyConnect: true,
      // Don't keep retrying forever if Redis is unreachable — caller wraps
      // reads in try/catch and falls back to DB.
      maxRetriesPerRequest: 2,
      enableAutoPipelining: true,
      // Distinguish from BullMQ in `CLIENT LIST` output.
      connectionName: "instigenie-cache",
    });

    this.prefix = opts.prefix ?? "cache";
    this.defaultTtlSec = opts.defaultTtlSec ?? 300;
  }

  private parseUrl(url: string): RedisOptions {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : 0,
    };
  }

  private key(orgId: string, resource: string, id: string): string {
    return `${this.prefix}:${orgId}:${resource}:${id}`;
  }

  async connect(): Promise<void> {
    if (this.client.status === "ready") return;
    await this.client.connect();
  }

  /** Get a JSON-serialized value. Returns null on miss or on parse failure. */
  async get<T>(orgId: string, resource: string, id: string): Promise<T | null> {
    const raw = await this.client.get(this.key(orgId, resource, id));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Set with TTL in seconds. Pass 0 to use the default. */
  async set(
    orgId: string,
    resource: string,
    id: string,
    value: unknown,
    ttlSec = 0
  ): Promise<void> {
    const ttl = ttlSec === 0 ? this.defaultTtlSec : ttlSec;
    const k = this.key(orgId, resource, id);
    await this.client.set(k, JSON.stringify(value), "EX", ttl);
  }

  async del(orgId: string, resource: string, id: string): Promise<void> {
    await this.client.del(this.key(orgId, resource, id));
  }

  /**
   * Invalidate every key matching `{prefix}:{orgId}:{resource}:*`. Uses SCAN
   * (non-blocking) in small batches. Safe to call from request handlers.
   */
  async invalidateResource(orgId: string, resource: string): Promise<number> {
    const pattern = `${this.prefix}:${orgId}:${resource}:*`;
    return this.deleteByPattern(pattern);
  }

  /** Invalidate everything for a single tenant. Usually only admin ops. */
  async invalidateOrg(orgId: string): Promise<number> {
    const pattern = `${this.prefix}:${orgId}:*`;
    return this.deleteByPattern(pattern);
  }

  private async deleteByPattern(pattern: string): Promise<number> {
    let total = 0;
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = next;
      if (keys.length > 0) {
        await this.client.unlink(...keys); // async delete, better for large keyspaces
        total += keys.length;
      }
    } while (cursor !== "0");
    return total;
  }

  async quit(): Promise<void> {
    if (this.client.status === "end") return;
    await this.client.quit();
  }
}
