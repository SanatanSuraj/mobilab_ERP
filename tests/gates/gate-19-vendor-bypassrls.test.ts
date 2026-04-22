/**
 * Gate 19 — The vendor DB role reads across tenants; the tenant DB role does NOT.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5 / Sprint 3).
 *
 * This is the contract the whole vendor-admin surface sits on:
 *
 *   instigenie_app     — NOBYPASSRLS. Sees rows only for app.current_org.
 *                     Pointing it at two different orgs shows only their
 *                     own row. Covered by Gate 5 / Gate 8 in detail; we
 *                     re-verify here specifically alongside the vendor
 *                     role so a single test failure is self-describing.
 *
 *   instigenie_vendor  — BYPASSRLS. Sees every organizations row regardless
 *                     of app.current_org. This is how the /vendor-admin
 *                     /tenants list endpoint works without iterating
 *                     every tenant's UUID.
 *
 * Any regression here is a P0: either the vendor pool lost BYPASSRLS
 * (vendor console can't list tenants — broken product), or tenant-side
 * code is running with BYPASSRLS (customer A reads customer B's data —
 * security incident).
 *
 * Fixture orgs (reserved for Gate 19):
 *   dd01  Gate 19 tenant A
 *   dd02  Gate 19 tenant B
 *
 * The vendor admin UUID is ccc1 (ops/sql/seed/07-dev-vendor-admin.sql).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import {
  makeTestPool,
  makeVendorTestPool,
  waitForPg,
} from "./_helpers.js";

const ORG_A = "00000000-0000-0000-0000-00000000dd01";
const ORG_B = "00000000-0000-0000-0000-00000000dd02";

describe("gate-19: vendor BYPASSRLS vs tenant NOBYPASSRLS", () => {
  let tenantPool: pg.Pool;
  let vendorPool: pg.Pool;

  beforeAll(async () => {
    tenantPool = makeTestPool();
    vendorPool = makeVendorTestPool();
    await Promise.all([waitForPg(tenantPool), waitForPg(vendorPool)]);

    // Seed both fixture orgs under their own RLS context. The tenant pool
    // is NOBYPASSRLS so it MUST see set_config('app.current_org', X) to
    // insert into organizations (policy: id = app.current_org::uuid).
    for (const [id, name] of [
      [ORG_A, "Gate 19 Tenant A"],
      [ORG_B, "Gate 19 Tenant B"],
    ] as const) {
      await withOrg(tenantPool, id, async (client) => {
        await client.query(
          `INSERT INTO organizations (id, name, status)
             VALUES ($1, $2, 'ACTIVE')
           ON CONFLICT (id) DO UPDATE SET
             status       = 'ACTIVE',
             deleted_at   = NULL,
             suspended_at = NULL,
             updated_at   = now()`,
          [id, name]
        );
      });
    }
  });

  afterAll(async () => {
    await tenantPool.end();
    await vendorPool.end();
  });

  // ── 1. Role identity — guard against DATABASE_URL drift ──────────────

  it("tenant pool runs as instigenie_app; vendor pool runs as instigenie_vendor", async () => {
    const [{ rows: tRows }, { rows: vRows }] = await Promise.all([
      tenantPool.query<{ cu: string }>(`SELECT current_user AS cu`),
      vendorPool.query<{ cu: string }>(`SELECT current_user AS cu`),
    ]);
    expect(tRows[0]?.cu).toBe("instigenie_app");
    expect(vRows[0]?.cu).toBe("instigenie_vendor");
  });

  // ── 2. Role attributes — pinned at the DB level ──────────────────────

  it("instigenie_vendor is BYPASSRLS + NOSUPERUSER + login-capable", async () => {
    const { rows } = await tenantPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcanlogin
         FROM pg_roles WHERE rolname = 'instigenie_vendor'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(true);
    expect(rows[0]?.rolcanlogin).toBe(true);
  });

  // ── 3. Tenant pool: no cross-tenant visibility even when asked ───────

  it("instigenie_app sees ONLY the current_org even with no GUC set", async () => {
    // With no app.current_org the RLS policy compares `id = ''::uuid` which
    // evaluates to a coercion error in pg. We set it to an obviously
    // unrelated UUID so the policy returns zero rows deterministically.
    const client = await tenantPool.connect();
    try {
      await client.query(
        `SELECT set_config('app.current_org', '00000000-0000-0000-0000-000000000000', true)`
      );
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM organizations
          WHERE id IN ($1, $2)`,
        [ORG_A, ORG_B]
      );
      expect(rows[0]?.count).toBe("0");
    } finally {
      client.release();
    }
  });

  it("instigenie_app sees only orgA when app.current_org = orgA", async () => {
    const seen = await withOrg(tenantPool, ORG_A, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM organizations WHERE id IN ($1, $2) ORDER BY id`,
        [ORG_A, ORG_B]
      );
      return rows.map((r) => r.id);
    });
    expect(seen).toEqual([ORG_A]);
  });

  // ── 4. Vendor pool: cross-tenant visibility, zero GUC dance ──────────

  it("instigenie_vendor sees BOTH orgA and orgB without setting app.current_org", async () => {
    const { rows } = await vendorPool.query<{ id: string }>(
      `SELECT id FROM organizations WHERE id IN ($1, $2) ORDER BY id`,
      [ORG_A, ORG_B]
    );
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([ORG_A, ORG_B].sort());
  });

  it("instigenie_vendor can UPDATE across tenants in one statement", async () => {
    // Suspend-reinstate round trip confirms the vendor role can write too
    // — not just read — regardless of app.current_org.
    await vendorPool.query(
      `UPDATE organizations
          SET status = 'SUSPENDED',
              suspended_at = now(),
              suspended_reason = 'gate-19',
              updated_at = now()
        WHERE id IN ($1, $2)`,
      [ORG_A, ORG_B]
    );
    const { rows: suspended } = await vendorPool.query<{
      id: string;
      status: string;
    }>(
      `SELECT id, status FROM organizations WHERE id IN ($1, $2) ORDER BY id`,
      [ORG_A, ORG_B]
    );
    for (const r of suspended) expect(r.status).toBe("SUSPENDED");

    await vendorPool.query(
      `UPDATE organizations
          SET status = 'ACTIVE',
              suspended_at = NULL,
              suspended_reason = NULL,
              updated_at = now()
        WHERE id IN ($1, $2)`,
      [ORG_A, ORG_B]
    );
    const { rows: active } = await vendorPool.query<{
      id: string;
      status: string;
    }>(
      `SELECT id, status FROM organizations WHERE id IN ($1, $2) ORDER BY id`,
      [ORG_A, ORG_B]
    );
    for (const r of active) expect(r.status).toBe("ACTIVE");
  });

  // ── 5. Vendor schema visibility — tenant role is blocked ─────────────

  it("instigenie_app cannot SELECT from vendor.admins (REVOKEd)", async () => {
    // The vendor schema is the private ops surface. A tenant-side SQL
    // injection should hit an error from the DB, not silently reveal
    // Instigenie's own employee list.
    await expect(
      tenantPool.query(`SELECT count(*) FROM vendor.admins`)
    ).rejects.toMatchObject({
      message: expect.stringMatching(/permission denied|does not exist/i),
    });
  });

  it("instigenie_vendor CAN SELECT from vendor.admins", async () => {
    // Seeded admin lives here; the count is at least 1 in dev.
    const { rows } = await vendorPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vendor.admins`
    );
    expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  // ── 6. Append-only grant: vendor can INSERT the log but not DELETE it ─

  it("instigenie_vendor can INSERT into vendor.action_log but NOT DELETE", async () => {
    const vendorAdminId = "00000000-0000-0000-0000-00000000ccc1";
    // Insert is fine (normal audit path).
    await vendorPool.query(
      `INSERT INTO vendor.action_log (
         vendor_admin_id, action, target_type, target_id, org_id,
         details, ip_address, user_agent
       ) VALUES ($1, 'tenant.view', 'organization', $2, $2,
                 NULL, '127.0.0.1', 'gate-19')`,
      [vendorAdminId, ORG_A]
    );

    // DELETE must fail — append-only is the invariant.
    await expect(
      vendorPool.query(
        `DELETE FROM vendor.action_log WHERE user_agent = 'gate-19'`
      )
    ).rejects.toMatchObject({
      message: expect.stringMatching(/permission denied/i),
    });

    // UPDATE must fail too.
    await expect(
      vendorPool.query(
        `UPDATE vendor.action_log SET action = 'tampered' WHERE user_agent = 'gate-19'`
      )
    ).rejects.toMatchObject({
      message: expect.stringMatching(/permission denied/i),
    });
  });
});
