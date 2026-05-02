/**
 * TenantStatusService — the single gate between an authenticated user and
 * the rest of the app.
 *
 * Called from TWO places, both on every authenticated interaction:
 *   1. AuthService.login / refresh / selectTenant   (token issuance gate)
 *   2. AuthGuard                                    (per-request gate)
 *
 * Why both? (1) stops bad tokens from being minted; (2) catches already-
 * minted tokens for a tenant that was suspended after login. Without (2)
 * a suspended tenant retains read/write for up to one access-token TTL.
 *
 * Decision table (organizations.status × trial_ends_at):
 *   ACTIVE                                 → pass
 *   TRIAL    + trial_ends_at IS NULL       → pass  (treat as "just signed up")
 *   TRIAL    + trial_ends_at > now         → pass
 *   TRIAL    + trial_ends_at <= now        → TrialExpiredError  (402)
 *   SUSPENDED                              → TenantSuspendedError  (403)
 *   DELETED  OR  deleted_at IS NOT NULL    → TenantDeletedError  (410)
 *
 * Caching: every authenticated request hits this service via AuthGuard, so
 * an unindexed status flip from "ACTIVE" → "SUSPENDED" was previously
 * felt only after the next DB roundtrip (~1-3ms). With the optional
 * `cache` dep below, the status row is memoized in Redis with a 30s TTL,
 * cutting the DB hit out of every request after the first.
 *
 * Eventual consistency window: ≤ TTL_SEC (30s). A vendor-admin suspend
 * takes effect on a logged-in user's next request once the cached row
 * expires. Acceptable because vendor admin operations are rare; if a P0
 * incident demands immediate cutoff, call `cache.invalidateOrg(orgId)`
 * out-of-band. Not adding explicit per-mutation invalidation here to
 * keep the dependency direction clean (vendor-admin package shouldn't
 * import @instigenie/cache; the api layer knows about both).
 */

import type pg from "pg";
import type { Cache } from "@instigenie/cache";
import { withOrg } from "@instigenie/db";
import {
  TenantDeletedError,
  TenantSuspendedError,
  TrialExpiredError,
  NotFoundError,
} from "@instigenie/errors";
import type { TenantStatus } from "@instigenie/contracts";

const CACHE_RESOURCE = "tenant_status";
const CACHE_TTL_SEC = 30;

export interface TenantStatusServiceDeps {
  pool: pg.Pool;
  /**
   * Optional Redis-backed cache. If undefined, every getStatus() call hits
   * the DB. If provided, the row is memoized for 30s. Cache failures are
   * logged-and-swallowed — never fatal to the auth path, since the DB
   * remains the source of truth.
   */
  cache?: Cache;
}

interface TenantStatusRow {
  id: string;
  status: TenantStatus;
  trial_ends_at: Date | null;
  suspended_at: Date | null;
  suspended_reason: string | null;
  deleted_at: Date | null;
}

/** Same shape as TenantStatusRow but with Dates as ISO strings — what
 *  Redis stores after JSON serialization. Re-hydrated to Date on read. */
interface CachedTenantStatusRow {
  id: string;
  status: TenantStatus;
  trial_ends_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  deleted_at: string | null;
}

function rehydrate(row: CachedTenantStatusRow): TenantStatusRow {
  return {
    id: row.id,
    status: row.status,
    trial_ends_at: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
    suspended_at: row.suspended_at ? new Date(row.suspended_at) : null,
    suspended_reason: row.suspended_reason,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export class TenantStatusService {
  constructor(private readonly deps: TenantStatusServiceDeps) {}

  /**
   * Load the current lifecycle snapshot of a tenant. Returns null if the
   * row doesn't exist at all (caller decides whether that's 404 or
   * unauthorized — usually unauthorized, since the orgId came from a JWT
   * claim the user controlled).
   *
   * `organizations` has an RLS policy `id = app.current_org`, so the DB
   * fallback must run under withOrg(orgId). A malicious actor who guesses
   * a foreign orgId still gets zero rows because they can't set
   * app.current_org to that value without passing auth — the JWT claim
   * IS the orgId we're about to look up, which closes the loop.
   *
   * Cache layer (when configured): namespaced as
   * `cache:{orgId}:tenant_status:{orgId}` — the orgId appears twice
   * because the cache lib's key shape is `{prefix}:{orgId}:{resource}:{id}`
   * and there's only one tenant-status row per tenant, so `id == orgId`.
   */
  async getStatus(orgId: string): Promise<TenantStatusRow | null> {
    const cache = this.deps.cache;

    if (cache) {
      try {
        const hit = await cache.get<CachedTenantStatusRow>(
          orgId,
          CACHE_RESOURCE,
          orgId,
        );
        if (hit !== null) return rehydrate(hit);
      } catch {
        // Redis transient failure — fall through to DB. Don't log here;
        // the underlying client already emits its own connection-level
        // events to the pino logger.
      }
    }

    const row = await this.dbLookup(orgId);

    if (cache && row) {
      try {
        await cache.set(orgId, CACHE_RESOURCE, orgId, row, CACHE_TTL_SEC);
      } catch {
        // Cache populate failure is benign — next request will see the
        // same DB row and try again.
      }
    }

    return row;
  }

  /** Direct DB read, no cache. Exposed so callers that explicitly want
   *  fresh state (e.g. a just-flipped status during a vendor-admin op)
   *  can bypass the 30s TTL. */
  async getStatusFresh(orgId: string): Promise<TenantStatusRow | null> {
    return this.dbLookup(orgId);
  }

  private async dbLookup(orgId: string): Promise<TenantStatusRow | null> {
    return withOrg(this.deps.pool, orgId, async (client) => {
      const { rows } = await client.query<TenantStatusRow>(
        `SELECT o.id, o.status, o.trial_ends_at, o.suspended_at,
                o.suspended_reason, o.deleted_at
           FROM organizations o
          WHERE o.id = $1`,
        [orgId]
      );
      return rows[0] ?? null;
    });
  }

  /** Drop the cached row for one tenant. Call after a vendor-admin write
   *  that flips status (suspend/reinstate/delete) to skip the eventual-
   *  consistency window for that orgId. Safe to call without a cache. */
  async invalidate(orgId: string): Promise<void> {
    if (!this.deps.cache) return;
    try {
      await this.deps.cache.del(orgId, CACHE_RESOURCE, orgId);
    } catch {
      // Same swallow rule as the read path.
    }
  }

  /**
   * Throws the appropriate error if the tenant is not in a state that
   * permits access. Returns the row on success so callers can pass along
   * things like `trial_ends_at` to the client without a second query.
   */
  async assertActive(orgId: string): Promise<TenantStatusRow> {
    const row = await this.getStatus(orgId);
    if (!row) {
      // An orgId from a JWT that isn't in the DB at all: treat as 404. We
      // don't leak "tenant existed then was hard-deleted" vs "never existed"
      // because both should force re-auth.
      throw new NotFoundError("tenant not found", { orgId });
    }

    if (row.deleted_at || row.status === "DELETED") {
      throw new TenantDeletedError("tenant has been deleted", { orgId });
    }

    if (row.status === "SUSPENDED") {
      throw new TenantSuspendedError("tenant is suspended", {
        orgId,
        suspendedAt: row.suspended_at,
        reason: row.suspended_reason,
      });
    }

    if (row.status === "TRIAL" && row.trial_ends_at) {
      if (row.trial_ends_at.getTime() <= Date.now()) {
        throw new TrialExpiredError("trial has expired", {
          orgId,
          trialEndedAt: row.trial_ends_at,
        });
      }
    }

    return row;
  }
}
