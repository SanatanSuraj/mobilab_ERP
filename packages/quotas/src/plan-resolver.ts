/**
 * PlanResolverService — turns an orgId into a FeatureSnapshot.
 *
 * The query it runs (simplified):
 *
 *   SELECT p.id, p.code, s.status, pf.feature_key, pf.is_enabled, pf.limit_value
 *     FROM subscriptions s
 *     JOIN plans p            ON p.id = s.plan_id
 *     LEFT JOIN plan_features pf ON pf.plan_id = p.id
 *    WHERE s.org_id = $1
 *      AND s.status IN ('TRIALING','ACTIVE','PAST_DUE')
 *    ORDER BY s.current_period_end DESC
 *    LIMIT 1 …  (but the partial unique index guarantees there's at most one)
 *
 * `subscriptions` has RLS on org_id, so the query runs under withOrg(orgId).
 * `plans` + `plan_features` are the vendor's global catalog with no RLS.
 *
 * Why keep this as its own service and not fold it into FeatureFlagService?
 *   - Sprint 2's assertQuota() wants the raw limit_value numbers too, not
 *     just the boolean gate; it shares the same snapshot.
 *   - Tests can stub the resolver independently of Redis.
 */

import type pg from "pg";
import { withOrg } from "@mobilab/db";
import type { PlanCode, SubscriptionStatus } from "@mobilab/contracts";
import type { FeatureEntry, FeatureSnapshot } from "./types.js";

export interface PlanResolverDeps {
  pool: pg.Pool;
}

interface ResolverRow {
  plan_id: string | null;
  plan_code: string | null;
  subscription_status: SubscriptionStatus | null;
  feature_key: string | null;
  is_enabled: boolean | null;
  limit_value: number | null;
}

export class PlanResolverService {
  constructor(private readonly deps: PlanResolverDeps) {}

  /**
   * Resolve the current feature snapshot for a tenant. Always returns a
   * snapshot, never null — a tenant with zero live subscriptions yields
   * {planCode: null, features: {}} so callers can treat "no plan" as
   * "no access" uniformly.
   */
  async resolve(orgId: string): Promise<FeatureSnapshot> {
    const rows = await withOrg<ResolverRow[]>(
      this.deps.pool,
      orgId,
      async (client) => {
        // plan_features.limit_value is bigint — node-postgres returns it as
        // a string by default to preserve 64-bit precision. For plan caps
        // (users, contacts, api calls/month, GB) the values are deep under
        // 2^31, so we cast to int to get a native JS number. Sprint 2's
        // usage_records.count_value will need true bigint handling.
        const result = await client.query<ResolverRow>(
          `SELECT p.id             AS plan_id,
                  p.code           AS plan_code,
                  s.status         AS subscription_status,
                  pf.feature_key,
                  pf.is_enabled,
                  pf.limit_value::integer AS limit_value
             FROM subscriptions s
             JOIN plans p             ON p.id = s.plan_id
             LEFT JOIN plan_features pf ON pf.plan_id = p.id
            WHERE s.org_id = $1
              AND s.status IN ('TRIALING','ACTIVE','PAST_DUE')`,
          [orgId]
        );
        return result.rows;
      }
    );

    const features: Record<string, FeatureEntry> = {};
    let planId: string | null = null;
    let planCode: PlanCode | null = null;
    let subStatus: SubscriptionStatus | null = null;

    for (const r of rows) {
      if (!planId && r.plan_id) planId = r.plan_id;
      if (!planCode && r.plan_code) planCode = r.plan_code as PlanCode;
      if (!subStatus && r.subscription_status) subStatus = r.subscription_status;
      if (r.feature_key && r.is_enabled !== null) {
        features[r.feature_key] = {
          enabled: r.is_enabled,
          limit: r.limit_value,
        };
      }
    }

    return {
      orgId,
      planId,
      planCode,
      subscriptionStatus: subStatus,
      resolvedAt: new Date().toISOString(),
      features,
    };
  }
}
