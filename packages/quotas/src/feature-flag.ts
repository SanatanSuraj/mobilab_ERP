/**
 * FeatureFlagService — cache-fronted, request-time API for module + feature
 * gates.
 *
 * Two callers:
 *   1. Fastify preHandler requireFeature("module.crm") — fails fast with
 *      ModuleDisabledError (402) before the route handler runs.
 *   2. Sprint 2 quota layer — same snapshot, but also reads limit_value
 *      for api.calls.quota / crm.contacts.max / ...
 *
 * Cache layout (Redis):
 *   key   = cache:{orgId}:plan:snapshot
 *   value = JSON.stringify(FeatureSnapshot)
 *   ttl   = opts.snapshotTtlSec (default 60s)
 *
 * Miss path: call PlanResolverService.resolve() → write snapshot → return.
 * Hit path : parse + return, no DB roundtrip.
 *
 * Invalidation: short TTL for now. Sprint 2 adds explicit invalidate() hooks
 * that fire on subscription.updated / plan_features.updated notifications.
 */

import { ModuleDisabledError } from "@mobilab/errors";
import type { Cache } from "@mobilab/cache";
import type { PlanResolverService } from "./plan-resolver.js";
import type {
  FeatureEntry,
  FeatureFlagServiceOptions,
  FeatureSnapshot,
} from "./types.js";

const DEFAULT_SNAPSHOT_TTL_SEC = 60;
const CACHE_RESOURCE = "plan";
const CACHE_ID = "snapshot";

export interface FeatureFlagDeps {
  resolver: PlanResolverService;
  cache: Cache;
}

export class FeatureFlagService {
  private readonly ttlSec: number;

  constructor(
    private readonly deps: FeatureFlagDeps,
    opts: FeatureFlagServiceOptions = {}
  ) {
    this.ttlSec = opts.snapshotTtlSec ?? DEFAULT_SNAPSHOT_TTL_SEC;
  }

  /**
   * Get (or build) the current feature snapshot for this tenant. If Redis
   * is down the read throws and the caller falls back to DB-only via
   * `getSnapshotUncached()`.
   */
  async getSnapshot(orgId: string): Promise<FeatureSnapshot> {
    try {
      const cached = await this.deps.cache.get<FeatureSnapshot>(
        orgId,
        CACHE_RESOURCE,
        CACHE_ID
      );
      if (cached) return cached;
    } catch {
      // Cache unreachable — fall through to DB path, don't fail the request.
    }

    const snap = await this.deps.resolver.resolve(orgId);

    try {
      await this.deps.cache.set(
        orgId,
        CACHE_RESOURCE,
        CACHE_ID,
        snap,
        this.ttlSec
      );
    } catch {
      // Cache write failures are best-effort.
    }

    return snap;
  }

  /**
   * Explicit DB read, no cache. Used by gate tests and by future
   * admin-force-refresh endpoints.
   */
  async getSnapshotUncached(orgId: string): Promise<FeatureSnapshot> {
    return this.deps.resolver.resolve(orgId);
  }

  /**
   * Drop the cached snapshot for a tenant. Sprint 2 will call this when
   * a vendor admin flips a plan or a subscription status changes.
   */
  async invalidate(orgId: string): Promise<void> {
    try {
      await this.deps.cache.del(orgId, CACHE_RESOURCE, CACHE_ID);
    } catch {
      // best-effort
    }
  }

  /**
   * Resolve a feature entry for this tenant. Returns null if the key isn't
   * on the plan at all. Use `isEnabled` / `getLimit` for the common cases.
   */
  async getFeature(
    orgId: string,
    key: string
  ): Promise<FeatureEntry | null> {
    const snap = await this.getSnapshot(orgId);
    return snap.features[key] ?? null;
  }

  /**
   * True iff the feature is present AND is_enabled. Missing key = false.
   * This is the predicate for every module.<x> gate.
   */
  async isEnabled(orgId: string, key: string): Promise<boolean> {
    const f = await this.getFeature(orgId, key);
    return f !== null && f.enabled;
  }

  /**
   * Convenience — the Sprint 1C contract: "is this module available to
   * this tenant?". Equivalent to isEnabled but reads nicely at call sites.
   */
  async isModuleEnabled(orgId: string, key: string): Promise<boolean> {
    return this.isEnabled(orgId, key);
  }

  /**
   * Hard cap / quota limit for a feature, or null if unlimited (or the
   * feature isn't on the plan at all — caller checks `isEnabled` first).
   */
  async getLimit(orgId: string, key: string): Promise<number | null> {
    const f = await this.getFeature(orgId, key);
    return f?.limit ?? null;
  }

  /**
   * Throws ModuleDisabledError if the feature is missing or disabled.
   * Intended for use inside Fastify preHandlers.
   */
  async assertEnabled(orgId: string, key: string): Promise<void> {
    const snap = await this.getSnapshot(orgId);
    const f = snap.features[key];
    if (!f || !f.enabled) {
      throw new ModuleDisabledError(`feature '${key}' is not on this plan`, {
        orgId,
        feature: key,
        planCode: snap.planCode,
      });
    }
  }
}
