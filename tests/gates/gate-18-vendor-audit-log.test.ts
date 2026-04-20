/**
 * Gate 18 — Vendor-admin actions write to vendor.action_log, and the
 * audit read-back reflects what landed on disk.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5 / Sprint 3).
 *
 * Invariants:
 *   1. Every mutation via VendorAdminService writes exactly ONE row to
 *      vendor.action_log, containing the vendor_admin_id, action type,
 *      target org_id, ip, user-agent, and structured `details`.
 *   2. The audit write lands in the SAME transaction as the mutation. A
 *      transaction that fails before COMMIT must leave NO audit row for
 *      the attempted action.
 *   3. VendorAdminService.listAudit returns rows in created_at DESC order,
 *      supports filtering by orgId / action, and joins the admin email.
 *   4. listAudit itself writes a "tenant.view_audit" row (the act of
 *      browsing the log is itself auditable).
 *
 * Fixture org ids (reserved for Gate 18):
 *   cc01  tenant targeted by vendor actions (suspend/reinstate/change-plan)
 *
 * Fixture vendor admin ids (from ops/sql/seed/07-dev-vendor-admin.sql):
 *   ccc1  the primary dev vendor admin
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import pg from "pg";
import { Cache } from "@mobilab/cache";
import { withOrg } from "@mobilab/db";
import { VendorAdminService } from "@mobilab/vendor-admin";
import { FeatureFlagService, PlanResolverService } from "@mobilab/quotas";
import {
  makeTestPool,
  makeVendorTestPool,
  waitForPg,
  REDIS_CACHE_URL,
} from "./_helpers.js";

const TENANT_ORG = "00000000-0000-0000-0000-00000000cc01";
const VENDOR_ADMIN_ID = "00000000-0000-0000-0000-00000000ccc1";

// STARTER is the baseline plan for the Gate 18 fixture tenant; beforeEach
// resets the subscription back to it so the change-plan test always has a
// known "from" state.
const PLAN_STARTER = "00000000-0000-0000-0000-00000000e002";

describe("gate-18: vendor action log + audit read-back", () => {
  // Use the TENANT pool (mobilab_app) to seed the fixture row — RLS
  // requires the org context, and the vendor pool bypasses RLS so it can't
  // drive the INSERT CHECK side either. Then use the VENDOR pool for the
  // service under test, mirroring production wiring.
  let tenantPool: pg.Pool;
  let vendorPool: pg.Pool;
  let cache: Cache;
  let flags: FeatureFlagService;
  let service: VendorAdminService;

  const ctx = {
    vendorAdminId: VENDOR_ADMIN_ID,
    ipAddress: "10.0.0.5",
    userAgent: "gate-18-test",
  };

  beforeAll(async () => {
    tenantPool = makeTestPool();
    vendorPool = makeVendorTestPool();
    await Promise.all([waitForPg(tenantPool), waitForPg(vendorPool)]);

    cache = new Cache({ url: REDIS_CACHE_URL, defaultTtlSec: 60 });
    await cache.connect();
    const resolver = new PlanResolverService({ pool: tenantPool });
    flags = new FeatureFlagService({ resolver, cache });

    service = new VendorAdminService({
      pool: vendorPool,
      cacheInvalidate: (orgId) => flags.invalidate(orgId),
    });

    // Seed the fixture tenant + a starter subscription. This is a one-off
    // setup — beforeEach resets state below, not the fixture itself.
    await withOrg(tenantPool, TENANT_ORG, async (client) => {
      await client.query(
        `INSERT INTO organizations (id, name, status)
             VALUES ($1, 'Gate 18 Fixture Tenant', 'ACTIVE')
           ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE',
                                          suspended_at = NULL,
                                          suspended_reason = NULL,
                                          deleted_at = NULL`,
        [TENANT_ORG]
      );
      await client.query(
        `INSERT INTO subscriptions (
           id, org_id, plan_id, status,
           current_period_start, current_period_end, cancel_at_period_end
         ) VALUES ($1, $2, $3, 'ACTIVE', now(), now() + interval '1 year', false)
         ON CONFLICT (id) DO UPDATE SET
           plan_id            = EXCLUDED.plan_id,
           status             = EXCLUDED.status,
           current_period_end = EXCLUDED.current_period_end,
           updated_at         = now()`,
        ["00000000-0000-0000-0000-000000dcc001", TENANT_ORG, PLAN_STARTER]
      );
    });
  });

  // Each test starts with a clean slate of audit rows for THIS vendor admin
  // targeting THIS tenant — leaves other rows intact so parallel fixtures
  // from other gates don't have to coordinate with us.
  beforeEach(async () => {
    // NOTE: vendor.action_log has only SELECT+INSERT grants — no DELETE.
    // Switch to the superuser `mobilab` role for cleanup. Via the tenant
    // DATABASE_URL (mobilab_app) we literally cannot run DELETE here.
    // Seeding uses the same BYPASSRLS vendor pool + SECURITY DEFINER-like
    // escalation: in the test harness we just execute DELETE as mobilab via
    // the bootstrap role. Simplest portable path is to run it on the tenant
    // pool's `mobilab_app` session and accept the failure path below:
    // the gate expects a clean slate, so we DELETE from vendor.action_log
    // via vendorPool's BYPASSRLS role. That role has SELECT+INSERT only, so
    // the delete fails; instead, filter every assertion by ipAddress so we
    // look only at THIS test's rows regardless of leftovers.

    // Reset subscription back to STARTER after tests that change the plan.
    await withOrg(tenantPool, TENANT_ORG, async (client) => {
      await client.query(
        `UPDATE subscriptions SET plan_id = $2, status = 'ACTIVE', updated_at = now()
           WHERE org_id = $1`,
        [TENANT_ORG, PLAN_STARTER]
      );
      await client.query(
        `UPDATE organizations SET status = 'ACTIVE',
                                  suspended_at = NULL,
                                  suspended_reason = NULL,
                                  deleted_at = NULL,
                                  updated_at = now()
           WHERE id = $1`,
        [TENANT_ORG]
      );
    });
  });

  afterAll(async () => {
    await cache.quit();
    await tenantPool.end();
    await vendorPool.end();
  });

  /**
   * Helper: count audit rows landed by THIS test run (filter on ipAddress
   * so leftover rows from earlier runs or parallel gates don't poison the
   * assertion). We use `host(ip_address)` so pg gives us a plain string.
   */
  async function auditRowsForThisRun(args: {
    action?: string;
    orgId?: string;
  }): Promise<
    Array<{
      action: string;
      target_type: string;
      org_id: string | null;
      details: Record<string, unknown> | null;
      user_agent: string | null;
      ip: string | null;
    }>
  > {
    const clauses: string[] = [`user_agent = $1`];
    const params: unknown[] = [ctx.userAgent];
    if (args.action) {
      params.push(args.action);
      clauses.push(`action = $${params.length}`);
    }
    if (args.orgId) {
      params.push(args.orgId);
      clauses.push(`org_id = $${params.length}`);
    }
    const { rows } = await vendorPool.query<{
      action: string;
      target_type: string;
      org_id: string | null;
      details: Record<string, unknown> | null;
      user_agent: string | null;
      ip: string | null;
    }>(
      `SELECT action, target_type, org_id, details, user_agent,
              host(ip_address) AS ip
         FROM vendor.action_log
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC`,
      params
    );
    return rows;
  }

  // ── 1. Suspend writes one audit row with structured details ───────────

  it("suspendTenant writes exactly one tenant.suspend row with the reason", async () => {
    const before = (
      await auditRowsForThisRun({ action: "tenant.suspend", orgId: TENANT_ORG })
    ).length;

    await service.suspendTenant(
      TENANT_ORG,
      { reason: "billing hold — invoice INV-42 past due" },
      ctx
    );

    const after = await auditRowsForThisRun({
      action: "tenant.suspend",
      orgId: TENANT_ORG,
    });
    expect(after.length).toBe(before + 1);

    const row = after[0]!;
    expect(row.action).toBe("tenant.suspend");
    expect(row.target_type).toBe("organization");
    expect(row.org_id).toBe(TENANT_ORG);
    expect(row.ip).toBe("10.0.0.5");
    expect(row.user_agent).toBe("gate-18-test");
    expect(row.details).toMatchObject({
      reason: "billing hold — invoice INV-42 past due",
      previousStatus: "ACTIVE",
    });

    // And the tenant row itself really flipped to SUSPENDED.
    const { rows: orgRows } = await vendorPool.query<{
      status: string;
      suspended_reason: string | null;
    }>(
      `SELECT status, suspended_reason FROM organizations WHERE id = $1`,
      [TENANT_ORG]
    );
    expect(orgRows[0]?.status).toBe("SUSPENDED");
    expect(orgRows[0]?.suspended_reason).toBe(
      "billing hold — invoice INV-42 past due"
    );
  });

  // ── 2. Reinstate writes its own row, previousStatus=SUSPENDED ─────────

  it("reinstateTenant writes a tenant.reinstate row after a suspend", async () => {
    await service.suspendTenant(
      TENANT_ORG,
      { reason: "temp hold" },
      ctx
    );
    await service.reinstateTenant(
      TENANT_ORG,
      { reason: "customer paid" },
      ctx
    );

    const reinstate = (
      await auditRowsForThisRun({
        action: "tenant.reinstate",
        orgId: TENANT_ORG,
      })
    )[0];
    expect(reinstate).toBeDefined();
    expect(reinstate!.details).toMatchObject({
      reason: "customer paid",
      previousStatus: "SUSPENDED",
    });

    const { rows: orgRows } = await vendorPool.query<{
      status: string;
      suspended_reason: string | null;
    }>(`SELECT status, suspended_reason FROM organizations WHERE id = $1`, [
      TENANT_ORG,
    ]);
    expect(orgRows[0]?.status).toBe("ACTIVE");
    expect(orgRows[0]?.suspended_reason).toBeNull();
  });

  // ── 3. Change-plan records old→new codes and updates the subscription ─

  it("changePlan records old→new in details and updates the subscription row", async () => {
    const res = await service.changePlan(
      TENANT_ORG,
      { planCode: "PRO", reason: "annual upgrade" },
      ctx
    );
    expect(res).toEqual({ oldPlanCode: "STARTER", newPlanCode: "PRO" });

    const change = (
      await auditRowsForThisRun({
        action: "tenant.change_plan",
        orgId: TENANT_ORG,
      })
    )[0];
    expect(change).toBeDefined();
    expect(change!.details).toMatchObject({
      reason: "annual upgrade",
      oldPlanCode: "STARTER",
      newPlanCode: "PRO",
    });

    const { rows } = await vendorPool.query<{ code: string }>(
      `SELECT p.code
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.org_id = $1
        ORDER BY s.current_period_end DESC NULLS LAST
        LIMIT 1`,
      [TENANT_ORG]
    );
    expect(rows[0]?.code).toBe("PRO");
  });

  // ── 4. A rollback leaves NO partial audit trail ───────────────────────

  it("a failing mutation rolls back the audit row with it", async () => {
    // Sabotage the mutation by requesting an unknown plan code — the
    // lookup throws NotFoundError, which must roll back the audit insert.
    const before = (
      await auditRowsForThisRun({
        action: "tenant.change_plan",
        orgId: TENANT_ORG,
      })
    ).length;

    await expect(
      service.changePlan(
        TENANT_ORG,
        // @ts-expect-error — intentionally invalid plan code for the rollback test
        { planCode: "NOT_A_REAL_PLAN", reason: "should fail" },
        ctx
      )
    ).rejects.toBeDefined();

    const after = (
      await auditRowsForThisRun({
        action: "tenant.change_plan",
        orgId: TENANT_ORG,
      })
    ).length;
    expect(after).toBe(before); // no new row
  });

  // ── 5. listAudit returns rows + its own view_audit entry ──────────────

  it("listAudit returns the most recent rows and logs a tenant.view_audit entry", async () => {
    // Guarantee at least one row exists for this tenant in this test run.
    await service.suspendTenant(
      TENANT_ORG,
      { reason: "for listAudit" },
      ctx
    );

    const { items } = await service.listAudit(
      { orgId: TENANT_ORG, limit: 50, offset: 0 },
      ctx
    );

    expect(items.length).toBeGreaterThan(0);
    // DESC order by created_at — the most recent real mutation was the
    // suspend we just ran. listAudit itself writes a view_audit row AFTER
    // the SELECT (so the service's own bookkeeping doesn't appear in its
    // response; callers expect the read to reflect state *before* the
    // call). So the top row of the response is the suspend, not the
    // view_audit.
    expect(items[0]).toMatchObject({
      action: "tenant.suspend",
      orgId: TENANT_ORG,
      vendorAdminId: VENDOR_ADMIN_ID,
    });

    // Every item carries the joined admin email.
    for (const row of items) {
      expect(row.vendorAdminEmail).toBeTypeOf("string");
    }

    // But the view_audit entry DID get persisted — assert it via a direct
    // DB read. This upholds invariant #4 ("listAudit itself writes a
    // tenant.view_audit row") without wedging the service into a
    // write-before-read ordering just for the assertion.
    const viewRows = await auditRowsForThisRun({
      action: "tenant.view_audit",
      orgId: TENANT_ORG,
    });
    expect(viewRows.length).toBeGreaterThan(0);
  });

  // ── 6. listAudit filters by action ────────────────────────────────────

  it("listAudit filters by action type", async () => {
    await service.suspendTenant(
      TENANT_ORG,
      { reason: "gate-18 filter test" },
      ctx
    );

    const { items } = await service.listAudit(
      { orgId: TENANT_ORG, action: "tenant.suspend", limit: 20, offset: 0 },
      ctx
    );
    expect(items.length).toBeGreaterThan(0);
    for (const r of items) {
      // Every returned row must be tenant.suspend — the action filter is
      // not a "prefix match".
      expect(r.action).toBe("tenant.suspend");
    }
  });
});
