/**
 * QuotaService — enforces per-plan usage caps.
 *
 * Two public verbs:
 *   assertQuota(orgId, metric, amount=1)  — throws QuotaExceededError on
 *                                            overflow.
 *   recordUsage(orgId, metric, amount=1)  — atomic increment of the
 *                                            (org, metric, period) row.
 *
 * Workflow for a counted operation (e.g. API call, contact create):
 *
 *     await quotas.assertQuota(org, "api.calls");   // throws 429 if full
 *     const result = await doTheThing(...);
 *     await quotas.recordUsage(org, "api.calls");   // fire-and-forget ok
 *
 * assertQuota and recordUsage are NOT a transaction. Two parallel requests
 * can both observe count_value = limit-1, both pass the check, both
 * increment → count = limit+1. For a request-rate quota this slop is fine
 * (eventual consistency with billing); for a hard-count cap like
 * `users.max` we should follow up with a reserving assertQuotaAtomic() that
 * combines the check and the increment in one round-trip under advisory
 * lock. Sprint 2+ will add it when we have a concrete need.
 *
 * Unlimited (limit = null) → assertQuota is a no-op. ENTERPRISE tenants
 * therefore have no DB hop at all on the check path once the snapshot is
 * cached — free to burn API calls without a round-trip.
 *
 * Usage reads still need a DB hit because usage_records is write-heavy
 * and caching it would be a lie on concurrent writes. We keep the query
 * tiny (PK lookup on the partial UNIQUE index org_id, metric, period).
 *
 * RLS: usage_records has `org_id = app.current_org`. All reads and writes
 * go through withOrg(pool, orgId, ...).
 */

import type pg from "pg";
import { withOrg } from "@instigenie/db";
import { QuotaExceededError } from "@instigenie/errors";
import type { FeatureFlagService } from "./feature-flag.js";
import {
  getMetricDefinition,
  periodFor,
  type PeriodStrategy,
} from "./metrics.js";

export interface QuotaServiceDeps {
  pool: pg.Pool;
  flags: FeatureFlagService;
}

export interface UsageSnapshot {
  metric: string;
  period: string;
  count: number;
  /** Limit from plan_features for the backing feature key. NULL = unlimited. */
  limit: number | null;
}

/**
 * Injectable clock so tests can pin time at a period boundary without
 * mocking globals. Default is a real Date.
 */
export interface ClockLike {
  now(): Date;
}

const defaultClock: ClockLike = { now: () => new Date() };

interface UsageRow {
  count_value: number;
}

export class QuotaService {
  constructor(
    private readonly deps: QuotaServiceDeps,
    private readonly clock: ClockLike = defaultClock
  ) {}

  /**
   * Throws QuotaExceededError if `amount` more units would push
   * count_value past the plan limit. amount defaults to 1.
   *
   * Fast path: if the feature isn't on the plan or limit is null
   * (unlimited), return without touching usage_records.
   */
  async assertQuota(
    orgId: string,
    metric: string,
    amount = 1
  ): Promise<void> {
    const def = getMetricDefinition(metric);
    const limit = await this.deps.flags.getLimit(orgId, def.featureKey);

    // Unlimited plan caps are the common ENTERPRISE case; return early with
    // no DB hit. Missing feature (limit === null because the key isn't on
    // the plan at all) is also treated as unlimited here — the UPSTREAM
    // gate is isModuleEnabled for boolean module access; assertQuota only
    // owns numeric-cap enforcement.
    if (limit === null) return;

    const period = periodFor(def.period, this.clock.now());
    const used = await this.readUsage(orgId, metric, period);

    if (used + amount > limit) {
      throw new QuotaExceededError("plan quota exceeded", {
        metric,
        limit,
        used,
        requested: amount,
        period,
        orgId,
      });
    }
  }

  /**
   * Idempotent increment. The (org_id, metric, period) UNIQUE index +
   * ON CONFLICT DO UPDATE adds atomicity — two concurrent calls both
   * increment exactly once, no lost updates.
   *
   * Amount is capped at >=1 so accidental zero/negative calls don't
   * silently succeed without touching the row.
   */
  async recordUsage(
    orgId: string,
    metric: string,
    amount = 1
  ): Promise<UsageSnapshot> {
    if (amount <= 0) {
      throw new Error(
        `recordUsage requires a positive amount, got ${amount}`
      );
    }
    const def = getMetricDefinition(metric);
    const period = periodFor(def.period, this.clock.now());

    const row = await withOrg<UsageRow | null>(
      this.deps.pool,
      orgId,
      async (client) => {
        // Bigint cast so node-postgres returns count_value as a JS number
        // instead of a string (same reason plan_features.limit_value is
        // cast in plan-resolver). These counters stay under 2^31 for any
        // realistic customer on a month-scale; if a customer blows past
        // that we'll migrate to true bigint pipes.
        const { rows } = await client.query<UsageRow>(
          `INSERT INTO usage_records (org_id, metric, period, count_value)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (org_id, metric, period) DO UPDATE SET
             count_value = usage_records.count_value + EXCLUDED.count_value,
             recorded_at = now()
           RETURNING count_value::integer AS count_value`,
          [orgId, metric, period, amount]
        );
        return rows[0] ?? null;
      }
    );

    const limit = await this.deps.flags.getLimit(orgId, def.featureKey);
    return {
      metric,
      period,
      count: row?.count_value ?? 0,
      limit,
    };
  }

  /**
   * Look up the current usage snapshot for a metric without mutating
   * anything. Returns {count: 0} if no row exists — the quota layer
   * treats missing rows as "used zero", consistent with INSERT-or-UPDATE.
   */
  async getUsage(orgId: string, metric: string): Promise<UsageSnapshot> {
    const def = getMetricDefinition(metric);
    const period = periodFor(def.period, this.clock.now());
    const [count, limit] = await Promise.all([
      this.readUsage(orgId, metric, period),
      this.deps.flags.getLimit(orgId, def.featureKey),
    ]);
    return { metric, period, count, limit };
  }

  /**
   * Small internal helper: read count_value for (org, metric, period) or
   * 0 if no row. Used by both assertQuota and getUsage.
   */
  private async readUsage(
    orgId: string,
    metric: string,
    period: string
  ): Promise<number> {
    return withOrg<number>(this.deps.pool, orgId, async (client) => {
      const { rows } = await client.query<UsageRow>(
        `SELECT count_value::integer AS count_value
           FROM usage_records
          WHERE org_id = $1 AND metric = $2 AND period = $3`,
        [orgId, metric, period]
      );
      return rows[0]?.count_value ?? 0;
    });
  }
}

// Re-export the PeriodStrategy type for convenience on import sites that
// also want to construct Metric definitions.
export type { PeriodStrategy };
