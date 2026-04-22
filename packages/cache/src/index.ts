/**
 * @instigenie/cache — Redis-CACHE helper. ARCHITECTURE.md §6 / §10 / §3.5.
 *
 * Two Redis instances exist in the dev stack:
 *   - redis-bull   (packages/queue)  → BullMQ only, never used for cache
 *   - redis-cache  (this package)    → read-through cache, rate-limits, idempotency
 *
 * Rules:
 *   - NEVER share a connection between the two. They have different persistence
 *     settings and different eviction policies.
 *   - Keys are NAMESPACED: {prefix}:{orgId}:{resource}:{id} — tenancy lives
 *     in the key so SCAN invalidation can scope to one tenant.
 *   - Use `invalidateByPrefix` for group invalidation — it uses SCAN, not KEYS,
 *     so it's O(N) but non-blocking. `KEYS` is banned via gate-29; use
 *     `invalidateResource` / `invalidateOrg` instead.
 *
 * §3.5 resource buckets (TTL per ARCHITECTURE.md):
 *   - BOM             → 3600s (1h)
 *   - item master     → 7200s (2h)
 *   - permissions     → 300s  (5min)
 *   - dashboard KPIs  → 60s
 *   - WIP dashboard   → 30s
 *
 * Each bucket has a helper (`cache.bom()`, `cache.item()`, etc.) that bakes
 * the resource name + TTL in, so callers can't get the TTL wrong.
 */

import { Redis, type RedisOptions } from "ioredis";

export interface CacheOptions {
  url: string;
  /** Namespace every key with this prefix. Usually "cache". */
  prefix?: string;
  /** Default TTL in seconds. 0 = no expiry (use sparingly). */
  defaultTtlSec?: number;
}

/**
 * Canonical resource-name + TTL pairs from ARCHITECTURE.md §3.5.
 * `cache.bom(orgId).get(sku)` etc. route through these.
 */
export const RESOURCE_TTL = Object.freeze({
  bom: { name: "bom", ttlSec: 3600 }, // 1h
  item: { name: "item", ttlSec: 7200 }, // 2h — item master
  permissions: { name: "permissions", ttlSec: 300 }, // 5min
  kpi: { name: "dashboard_kpi", ttlSec: 60 }, // 60s
  wip: { name: "dashboard_wip", ttlSec: 30 }, // 30s
} as const);

export type ResourceKey = keyof typeof RESOURCE_TTL;

/**
 * Scoped accessor returned by `cache.bom(orgId)` et al. — carries the
 * (resource, ttl, orgId) trio so the caller just passes an id.
 */
export interface ResourceCache {
  readonly resource: string;
  readonly ttlSec: number;
  get<T>(id: string): Promise<T | null>;
  set(id: string, value: unknown): Promise<void>;
  del(id: string): Promise<void>;
  /**
   * Read-through: return cached value if present, else call loader(), cache
   * the result (if non-null), return it. Loader exceptions propagate.
   */
  getOrLoad<T>(id: string, loader: () => Promise<T | null>): Promise<T | null>;
  /**
   * Invalidate every id within this (orgId, resource) namespace via SCAN.
   * Returns the count of removed keys.
   */
  invalidate(): Promise<number>;
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
   * Read-through cache: resolve from Redis if present, else call loader,
   * persist (with `ttlSec`), return. `null` loader results are NOT cached
   * so downstream callers still hit the DB for misses.
   */
  async getOrLoad<T>(
    orgId: string,
    resource: string,
    id: string,
    ttlSec: number,
    loader: () => Promise<T | null>,
  ): Promise<T | null> {
    const hit = await this.get<T>(orgId, resource, id);
    if (hit !== null) return hit;
    const fresh = await loader();
    if (fresh !== null && fresh !== undefined) {
      await this.set(orgId, resource, id, fresh, ttlSec);
    }
    return fresh;
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

  // ── §3.5 Resource buckets ───────────────────────────────────────────────

  /**
   * Return a scoped accessor for a known ARCHITECTURE.md §3.5 resource.
   * Callers use it as `cache.scope(orgId, "bom").getOrLoad(sku, loader)`
   * or the shorter `cache.bom(orgId).getOrLoad(sku, loader)`.
   */
  scope(orgId: string, resource: ResourceKey): ResourceCache {
    const spec = RESOURCE_TTL[resource];
    const outer = this;
    return {
      resource: spec.name,
      ttlSec: spec.ttlSec,
      async get<T>(id: string): Promise<T | null> {
        return outer.get<T>(orgId, spec.name, id);
      },
      async set(id: string, value: unknown): Promise<void> {
        return outer.set(orgId, spec.name, id, value, spec.ttlSec);
      },
      async del(id: string): Promise<void> {
        return outer.del(orgId, spec.name, id);
      },
      async getOrLoad<T>(
        id: string,
        loader: () => Promise<T | null>,
      ): Promise<T | null> {
        return outer.getOrLoad<T>(orgId, spec.name, id, spec.ttlSec, loader);
      },
      async invalidate(): Promise<number> {
        return outer.invalidateResource(orgId, spec.name);
      },
    };
  }

  bom(orgId: string): ResourceCache {
    return this.scope(orgId, "bom");
  }
  item(orgId: string): ResourceCache {
    return this.scope(orgId, "item");
  }
  permissions(orgId: string): ResourceCache {
    return this.scope(orgId, "permissions");
  }
  kpi(orgId: string): ResourceCache {
    return this.scope(orgId, "kpi");
  }
  wip(orgId: string): ResourceCache {
    return this.scope(orgId, "wip");
  }
}
