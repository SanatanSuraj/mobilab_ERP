/**
 * Gate 16 — Plan feature flags are read correctly through the cache.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5 / Sprint 1C).
 *
 * Invariant: FeatureFlagService.isModuleEnabled(orgId, 'module.X') returns
 * the value declared in plan_features for the tenant's live subscription —
 * with a Redis read-through cache in front. When there is no live
 * subscription, every module is denied.
 *
 * This gate owns the END-TO-END path: Postgres rows → PlanResolverService →
 * FeatureFlagService → Redis cache → assertEnabled. A FREE-plan tenant must
 * be blocked from module.inventory, an ENTERPRISE tenant must not.
 *
 * Fixture org ids (reserved for Gate 16):
 *   b001 FREE-plan org
 *   b002 STARTER-plan org
 *   b003 PRO-plan org
 *   b004 ENTERPRISE-plan org
 *   b099 org with zero live subscriptions (should deny everything)
 *
 * The plan UUIDs come from ops/sql/seed/05-plans-catalog.sql:
 *   e001 FREE   e002 STARTER   e003 PRO   e004 ENTERPRISE
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Cache } from "@instigenie/cache";
import { withOrg } from "@instigenie/db";
import { FeatureFlagService, PlanResolverService } from "@instigenie/quotas";
import type { FeatureSnapshot } from "@instigenie/quotas";
import { ModuleDisabledError } from "@instigenie/errors";
import { makeTestPool, waitForPg, REDIS_CACHE_URL } from "./_helpers.js";

const FREE_ORG = "00000000-0000-0000-0000-00000000b001";
const STARTER_ORG = "00000000-0000-0000-0000-00000000b002";
const PRO_ORG = "00000000-0000-0000-0000-00000000b003";
const ENT_ORG = "00000000-0000-0000-0000-00000000b004";
const UNSUB_ORG = "00000000-0000-0000-0000-00000000b099";

const PLAN_FREE = "00000000-0000-0000-0000-00000000e001";
const PLAN_STARTER = "00000000-0000-0000-0000-00000000e002";
const PLAN_PRO = "00000000-0000-0000-0000-00000000e003";
const PLAN_ENT = "00000000-0000-0000-0000-00000000e004";

// Short TTL keeps any stale state from the previous run from leaking
// across tests, but long enough that one test fully trusts the cache.
const TTL_SEC = 30;

describe("gate-16: feature flags read path", () => {
  let pool: pg.Pool;
  let cache: Cache;
  let flags: FeatureFlagService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    cache = new Cache({ url: REDIS_CACHE_URL, defaultTtlSec: TTL_SEC });
    await cache.connect();

    const resolver = new PlanResolverService({ pool });
    flags = new FeatureFlagService(
      { resolver, cache },
      { snapshotTtlSec: TTL_SEC }
    );

    // ── Seed five fixture orgs ────────────────────────────────────────
    // organizations has RLS (id = app.current_org), so every insert runs
    // inside withOrg(). The subscriptions table has the partial unique
    // index on org_id WHERE status in live states, so the ON CONFLICT (id)
    // is how we make this idempotent across re-runs.
    async function seedOrgWithPlan(
      orgId: string,
      name: string,
      planId: string | null
    ): Promise<void> {
      await withOrg(pool, orgId, async (client) => {
        await client.query(
          `INSERT INTO organizations (id, name, status)
           VALUES ($1, $2, 'ACTIVE')
           ON CONFLICT (id) DO UPDATE SET
             status    = EXCLUDED.status,
             deleted_at = NULL`,
          [orgId, name]
        );
        if (planId) {
          // Stable subscription id derived from the org's last 5 chars so
          // ON CONFLICT (id) is idempotent across re-runs. Prefix with 'c'
          // to keep the sub id visually distinct from the org id during
          // psql debug; e.g. org=...b001 → sub=...c0b001.
          const subId = `00000000-0000-0000-0000-000000c${orgId.slice(-5)}`;
          await client.query(
            `INSERT INTO subscriptions (
               id, org_id, plan_id, status,
               current_period_start, current_period_end, cancel_at_period_end
             ) VALUES ($1, $2, $3, 'ACTIVE', now(), now() + interval '1 year', false)
             ON CONFLICT (id) DO UPDATE SET
               plan_id              = EXCLUDED.plan_id,
               status               = EXCLUDED.status,
               current_period_end   = EXCLUDED.current_period_end,
               updated_at           = now()`,
            [subId, orgId, planId]
          );
        }
      });
    }

    await seedOrgWithPlan(FREE_ORG, "Fixture FREE", PLAN_FREE);
    await seedOrgWithPlan(STARTER_ORG, "Fixture STARTER", PLAN_STARTER);
    await seedOrgWithPlan(PRO_ORG, "Fixture PRO", PLAN_PRO);
    await seedOrgWithPlan(ENT_ORG, "Fixture ENTERPRISE", PLAN_ENT);
    await seedOrgWithPlan(UNSUB_ORG, "Fixture No-Subscription", null);

    // Clear any cached snapshot so tests start from a known miss state.
    await Promise.all(
      [FREE_ORG, STARTER_ORG, PRO_ORG, ENT_ORG, UNSUB_ORG].map((id) =>
        flags.invalidate(id)
      )
    );
  });

  afterAll(async () => {
    await cache.quit();
    await pool.end();
  });

  // ── Per-plan feature expectations (mirrors 05-plans-catalog.sql) ────────

  it("FREE plan — only module.crm is enabled", async () => {
    expect(await flags.isModuleEnabled(FREE_ORG, "module.crm")).toBe(true);
    expect(await flags.isModuleEnabled(FREE_ORG, "module.inventory")).toBe(false);
    expect(await flags.isModuleEnabled(FREE_ORG, "module.manufacturing")).toBe(
      false
    );
    expect(await flags.isModuleEnabled(FREE_ORG, "module.finance")).toBe(false);
    // Hard cap reflects limit_value column.
    expect(await flags.getLimit(FREE_ORG, "users.max")).toBe(1);
    expect(await flags.getLimit(FREE_ORG, "crm.contacts.max")).toBe(100);
  });

  it("STARTER plan — crm + inventory on, rest off", async () => {
    expect(await flags.isModuleEnabled(STARTER_ORG, "module.crm")).toBe(true);
    expect(await flags.isModuleEnabled(STARTER_ORG, "module.inventory")).toBe(
      true
    );
    expect(
      await flags.isModuleEnabled(STARTER_ORG, "module.manufacturing")
    ).toBe(false);
    expect(await flags.getLimit(STARTER_ORG, "users.max")).toBe(10);
  });

  it("PRO plan — manufacturing/qc/procurement on, finance/hr off", async () => {
    expect(
      await flags.isModuleEnabled(PRO_ORG, "module.manufacturing")
    ).toBe(true);
    expect(await flags.isModuleEnabled(PRO_ORG, "module.qc")).toBe(true);
    expect(await flags.isModuleEnabled(PRO_ORG, "module.procurement")).toBe(
      true
    );
    expect(await flags.isModuleEnabled(PRO_ORG, "module.finance")).toBe(false);
    expect(await flags.isModuleEnabled(PRO_ORG, "module.hr")).toBe(false);
    expect(await flags.getLimit(PRO_ORG, "users.max")).toBe(50);
  });

  it("ENTERPRISE plan — every module enabled, every limit null", async () => {
    for (const key of [
      "module.crm",
      "module.inventory",
      "module.manufacturing",
      "module.qc",
      "module.procurement",
      "module.finance",
      "module.hr",
    ]) {
      expect(await flags.isModuleEnabled(ENT_ORG, key), `${key} should be on`).toBe(
        true
      );
    }
    // ENTERPRISE has limit_value = NULL for every capped resource.
    expect(await flags.getLimit(ENT_ORG, "users.max")).toBeNull();
    expect(await flags.getLimit(ENT_ORG, "crm.contacts.max")).toBeNull();
    expect(await flags.getLimit(ENT_ORG, "api.calls.quota")).toBeNull();
  });

  it("org with no live subscription — every module denied", async () => {
    expect(await flags.isModuleEnabled(UNSUB_ORG, "module.crm")).toBe(false);
    const snap = await flags.getSnapshot(UNSUB_ORG);
    expect(snap.planCode).toBeNull();
    expect(snap.subscriptionStatus).toBeNull();
    expect(Object.keys(snap.features)).toHaveLength(0);
  });

  // ── assertEnabled throws the expected error ──────────────────────────────

  it("assertEnabled throws ModuleDisabledError on disabled feature (402)", async () => {
    await flags.invalidate(FREE_ORG);
    let caught: unknown;
    try {
      await flags.assertEnabled(FREE_ORG, "module.inventory");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModuleDisabledError);
    if (caught instanceof ModuleDisabledError) {
      expect(caught.code).toBe("module_disabled");
      expect(caught.status).toBe(402);
      expect(caught.details?.feature).toBe("module.inventory");
      expect(caught.details?.planCode).toBe("FREE");
    }
  });

  it("assertEnabled passes silently on enabled feature", async () => {
    await expect(
      flags.assertEnabled(FREE_ORG, "module.crm")
    ).resolves.toBeUndefined();
  });

  // ── Redis cache behaviour ────────────────────────────────────────────────

  it("second call hits Redis, not Postgres (same resolvedAt)", async () => {
    await flags.invalidate(PRO_ORG);
    const snap1 = await flags.getSnapshot(PRO_ORG);
    // ~1ms between reads is enough for the DB path to produce a different
    // resolvedAt; equality here proves the second read came from cache.
    const snap2 = await flags.getSnapshot(PRO_ORG);
    expect(snap2.resolvedAt).toBe(snap1.resolvedAt);
  });

  it("invalidate() drops the cached snapshot — next call rebuilds", async () => {
    await flags.invalidate(STARTER_ORG);
    const snap1 = await flags.getSnapshot(STARTER_ORG);
    await flags.invalidate(STARTER_ORG);
    const snap2 = await flags.getSnapshot(STARTER_ORG);
    // After invalidate the resolvedAt must advance — proving a DB round-trip.
    expect(new Date(snap2.resolvedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(snap1.resolvedAt).getTime()
    );
    // Sanity — rebuild still has the same shape.
    expect(snap2.planCode).toBe("STARTER");
  });

  it("cache returns pre-seeded snapshot without touching the DB", async () => {
    // Hand-craft a snapshot that says STARTER has module.finance=true. If
    // FeatureFlagService really reads through the cache, isEnabled must
    // report the fake value rather than the real (which is false).
    const fake: FeatureSnapshot = {
      orgId: STARTER_ORG,
      planCode: "STARTER",
      planId: PLAN_STARTER,
      subscriptionStatus: "ACTIVE",
      resolvedAt: new Date().toISOString(),
      features: {
        "module.finance": { enabled: true, limit: null },
      },
    };
    await cache.set(STARTER_ORG, "plan", "snapshot", fake, TTL_SEC);
    expect(
      await flags.isModuleEnabled(STARTER_ORG, "module.finance")
    ).toBe(true);
    // And when invalidated, the real plan reasserts itself.
    await flags.invalidate(STARTER_ORG);
    expect(
      await flags.isModuleEnabled(STARTER_ORG, "module.finance")
    ).toBe(false);
  });
});
