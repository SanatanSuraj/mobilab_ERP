/**
 * Gate 17 — QuotaService enforces plan quotas correctly.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5 / Sprint 2).
 *
 * Invariants:
 *   1. assertQuota passes at (limit - k), fails at (limit + 1).
 *   2. recordUsage is additive and idempotent-per-period. Two parallel
 *      calls with amount=n converge on count = 2n, not n or 3n.
 *   3. Unlimited (limit = null) → assertQuota never throws, regardless of
 *      how much has been recorded. No DB hit on the limit branch.
 *   4. Period scoping: bumping usage in month A does not pollute month B.
 *   5. When overflowing, QuotaExceededError carries enough detail for the
 *      client to render a useful upgrade CTA: metric / limit / used / period.
 *
 * Fixture orgs (reserved for Gate 17):
 *   bb01 FREE-plan org        (api.calls.quota = 1000)
 *   bb02 STARTER-plan org     (api.calls.quota = 50000)
 *   bb03 ENTERPRISE-plan org  (api.calls.quota = NULL, unlimited)
 *
 * We use an injected clock so the "period scoping" test can pin two
 * different months without sleeping for a month between steps.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { Cache } from "@mobilab/cache";
import { withOrg } from "@mobilab/db";
import {
  FeatureFlagService,
  PlanResolverService,
  QuotaService,
  periodFor,
  type ClockLike,
} from "@mobilab/quotas";
import { QuotaExceededError } from "@mobilab/errors";
import { makeTestPool, waitForPg, REDIS_CACHE_URL } from "./_helpers.js";

const FREE_ORG = "00000000-0000-0000-0000-00000000bb01";
const STARTER_ORG = "00000000-0000-0000-0000-00000000bb02";
const ENT_ORG = "00000000-0000-0000-0000-00000000bb03";

const PLAN_FREE = "00000000-0000-0000-0000-00000000e001";
const PLAN_STARTER = "00000000-0000-0000-0000-00000000e002";
const PLAN_ENT = "00000000-0000-0000-0000-00000000e004";

describe("gate-17: quota enforcement", () => {
  let pool: pg.Pool;
  let cache: Cache;
  let flags: FeatureFlagService;
  let quotas: QuotaService;

  // Fixed clock — tests control the period so assertions don't race the
  // wall clock at a month boundary. Default sits in April 2026.
  const mutableClock: ClockLike & { set(d: Date): void } = (() => {
    let current = new Date("2026-04-15T12:00:00Z");
    return {
      now: () => current,
      set(d: Date) {
        current = d;
      },
    };
  })();

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    cache = new Cache({ url: REDIS_CACHE_URL, defaultTtlSec: 60 });
    await cache.connect();

    const resolver = new PlanResolverService({ pool });
    flags = new FeatureFlagService({ resolver, cache }, { snapshotTtlSec: 60 });
    quotas = new QuotaService({ pool, flags }, mutableClock);

    // Seed three fixture orgs, each on a different plan.
    async function seedOrgWithPlan(
      orgId: string,
      name: string,
      planId: string
    ): Promise<void> {
      await withOrg(pool, orgId, async (client) => {
        await client.query(
          `INSERT INTO organizations (id, name, status)
             VALUES ($1, $2, 'ACTIVE')
           ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', deleted_at = NULL`,
          [orgId, name]
        );
        const subId = `00000000-0000-0000-0000-000000d${orgId.slice(-5)}`;
        await client.query(
          `INSERT INTO subscriptions (
             id, org_id, plan_id, status,
             current_period_start, current_period_end, cancel_at_period_end
           ) VALUES ($1, $2, $3, 'ACTIVE', now(), now() + interval '1 year', false)
           ON CONFLICT (id) DO UPDATE SET
             plan_id             = EXCLUDED.plan_id,
             status              = EXCLUDED.status,
             current_period_end  = EXCLUDED.current_period_end,
             updated_at          = now()`,
          [subId, orgId, planId]
        );
      });
    }

    await seedOrgWithPlan(FREE_ORG, "Fixture Quota FREE", PLAN_FREE);
    await seedOrgWithPlan(STARTER_ORG, "Fixture Quota STARTER", PLAN_STARTER);
    await seedOrgWithPlan(ENT_ORG, "Fixture Quota ENT", PLAN_ENT);

    // Ensure the snapshot cache is cold so beforeEach starts clean.
    await Promise.all(
      [FREE_ORG, STARTER_ORG, ENT_ORG].map((id) => flags.invalidate(id))
    );
  });

  // Every test starts from zero usage for all three fixture orgs AND for
  // the metric's actual period string (not just the default "2026-04"),
  // so a previous iteration's overflow row doesn't bleed in.
  beforeEach(async () => {
    mutableClock.set(new Date("2026-04-15T12:00:00Z"));
    const period = periodFor("monthly", mutableClock.now());
    for (const orgId of [FREE_ORG, STARTER_ORG, ENT_ORG]) {
      await withOrg(pool, orgId, async (client) => {
        await client.query(
          `DELETE FROM usage_records
            WHERE org_id = $1 AND metric = 'api.calls' AND period = $2`,
          [orgId, period]
        );
      });
    }
  });

  afterAll(async () => {
    // Leave organizations + subscriptions around for re-runs; nuke usage.
    for (const orgId of [FREE_ORG, STARTER_ORG, ENT_ORG]) {
      await withOrg(pool, orgId, async (client) => {
        await client.query(
          `DELETE FROM usage_records WHERE org_id = $1 AND metric = 'api.calls'`,
          [orgId]
        );
      });
    }
    await cache.quit();
    await pool.end();
  });

  // ── 1. Basic overflow ───────────────────────────────────────────────────

  it("FREE org: assertQuota passes at limit - 1, fails at limit + 1 (429)", async () => {
    // FREE's api.calls.quota is 1000. Record 999, then:
    //   - assertQuota(1) should succeed (999 + 1 = 1000, exactly at limit)
    //   - record 1 more → count = 1000
    //   - assertQuota(1) should throw (1000 + 1 = 1001 > limit)
    await quotas.recordUsage(FREE_ORG, "api.calls", 999);
    await expect(
      quotas.assertQuota(FREE_ORG, "api.calls", 1)
    ).resolves.toBeUndefined();

    await quotas.recordUsage(FREE_ORG, "api.calls", 1);
    await expect(
      quotas.assertQuota(FREE_ORG, "api.calls", 1)
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("overflow error carries metric/limit/used/period details (429)", async () => {
    await quotas.recordUsage(FREE_ORG, "api.calls", 1000);
    let caught: unknown;
    try {
      await quotas.assertQuota(FREE_ORG, "api.calls", 1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QuotaExceededError);
    if (caught instanceof QuotaExceededError) {
      expect(caught.status).toBe(429);
      expect(caught.code).toBe("quota_exceeded");
      expect(caught.details?.metric).toBe("api.calls");
      expect(caught.details?.limit).toBe(1000);
      expect(caught.details?.used).toBe(1000);
      expect(caught.details?.period).toBe("2026-04");
      expect(caught.details?.requested).toBe(1);
    }
  });

  it("assertQuota with amount = k blocks if used + k > limit", async () => {
    await quotas.recordUsage(FREE_ORG, "api.calls", 900);
    // 900 + 50 = 950 ≤ 1000 → pass
    await expect(
      quotas.assertQuota(FREE_ORG, "api.calls", 50)
    ).resolves.toBeUndefined();
    // 900 + 101 = 1001 > 1000 → fail
    await expect(
      quotas.assertQuota(FREE_ORG, "api.calls", 101)
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  // ── 2. Idempotency + additivity ────────────────────────────────────────

  it("recordUsage is additive — two calls sum into one counter row", async () => {
    const a = await quotas.recordUsage(FREE_ORG, "api.calls", 3);
    expect(a.count).toBe(3);
    const b = await quotas.recordUsage(FREE_ORG, "api.calls", 5);
    expect(b.count).toBe(8);
    const now = await quotas.getUsage(FREE_ORG, "api.calls");
    expect(now.count).toBe(8);
    expect(now.limit).toBe(1000);
    expect(now.period).toBe("2026-04");
  });

  it("parallel recordUsage converges — no lost updates under concurrency", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        quotas.recordUsage(FREE_ORG, "api.calls", 1)
      )
    );
    const snap = await quotas.getUsage(FREE_ORG, "api.calls");
    expect(snap.count).toBe(10);
  });

  // ── 3. Unlimited plans (limit = NULL) ──────────────────────────────────

  it("ENTERPRISE org: assertQuota never throws (limit = null)", async () => {
    // Record an absurd amount — should not blow past any cap since ENTERPRISE
    // has limit_value = NULL for api.calls.quota.
    await quotas.recordUsage(ENT_ORG, "api.calls", 10_000_000);
    await expect(
      quotas.assertQuota(ENT_ORG, "api.calls", 1_000_000)
    ).resolves.toBeUndefined();
    const snap = await quotas.getUsage(ENT_ORG, "api.calls");
    expect(snap.limit).toBeNull();
    expect(snap.count).toBe(10_000_000);
  });

  // ── 4. Period scoping ───────────────────────────────────────────────────

  it("bumping month A does not affect assertQuota in month B", async () => {
    // Fill April to the brim.
    await quotas.recordUsage(FREE_ORG, "api.calls", 1000);
    await expect(
      quotas.assertQuota(FREE_ORG, "api.calls", 1)
    ).rejects.toBeInstanceOf(QuotaExceededError);

    // Now fast-forward the clock to May. The (org,metric,period="2026-05")
    // row doesn't exist yet so count = 0, assertQuota(1) passes.
    mutableClock.set(new Date("2026-05-02T00:00:00Z"));
    await expect(
      quotas.assertQuota(FREE_ORG, "api.calls", 1)
    ).resolves.toBeUndefined();

    const mayUsage = await quotas.getUsage(FREE_ORG, "api.calls");
    expect(mayUsage.period).toBe("2026-05");
    expect(mayUsage.count).toBe(0);

    // And April's row is still there with its 1000.
    mutableClock.set(new Date("2026-04-20T00:00:00Z"));
    const aprilUsage = await quotas.getUsage(FREE_ORG, "api.calls");
    expect(aprilUsage.period).toBe("2026-04");
    expect(aprilUsage.count).toBe(1000);
  });

  // ── 5. Sanity — recordUsage rejects amount <= 0 ────────────────────────

  it("recordUsage throws on non-positive amount (programmer bug)", async () => {
    await expect(
      quotas.recordUsage(FREE_ORG, "api.calls", 0)
    ).rejects.toThrow(/positive amount/);
    await expect(
      quotas.recordUsage(FREE_ORG, "api.calls", -3)
    ).rejects.toThrow(/positive amount/);
  });

  // ── 6. getUsage on zero-usage metric returns {count: 0, limit: <plan>} ──

  it("getUsage returns {count: 0} when no row exists yet", async () => {
    const snap = await quotas.getUsage(STARTER_ORG, "api.calls");
    expect(snap.count).toBe(0);
    expect(snap.limit).toBe(50_000); // STARTER api.calls.quota
    expect(snap.period).toBe("2026-04");
  });
});
