/**
 * Gate 14 — Tenant-lifecycle + plans schema is sound.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5 / Sprint 1B).
 *
 * The tenant lifecycle (organizations.status + trial_ends_at + suspended_at
 * + deleted_at) and the plans catalog (plans, plan_features, subscriptions,
 * usage_records) are the structural substrate that Sprint 2 (quotas) and
 * Sprint 3 (vendor admin) build on. This gate asserts the shape is
 * exactly what those sprints expect, so schema drift fails CI first.
 *
 * Checks:
 *   1. organizations has the Sprint 1B columns with expected types.
 *   2. organizations.status CHECK rejects invalid values.
 *   3. plans / plan_features / subscriptions / usage_records exist.
 *   4. plans has UNIQUE(code); plan_features PK is (plan_id, feature_key).
 *   5. subscriptions has a partial unique index enforcing one live row per org.
 *   6. usage_records has UNIQUE(org_id, metric, period).
 *   7. subscriptions + usage_records: RLS enabled + forced + policy references
 *      app.current_org; plans + plan_features: no RLS (global catalog).
 *   8. The dev seed populated plans (≥4) and one ACTIVE dev subscription.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

describe("gate-14: tenant lifecycle + plans schema", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ── 1. organizations lifecycle columns ────────────────────────────────────
  it("organizations has the Sprint 1B lifecycle columns", async () => {
    const { rows } = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organizations'
        ORDER BY column_name`
    );
    const byName = new Map(rows.map((r) => [r.column_name, r]));

    // Every column listed here must exist with the expected shape.
    const expected: Array<[string, string, "YES" | "NO"]> = [
      ["status", "text", "NO"],
      ["trial_ends_at", "timestamp with time zone", "YES"],
      ["suspended_at", "timestamp with time zone", "YES"],
      ["suspended_reason", "text", "YES"],
      ["deleted_at", "timestamp with time zone", "YES"],
      ["owner_identity_id", "uuid", "YES"],
    ];
    for (const [name, type, nullable] of expected) {
      const col = byName.get(name);
      expect(col, `organizations.${name} missing`).toBeDefined();
      expect(col!.data_type).toBe(type);
      expect(col!.is_nullable).toBe(nullable);
    }
    // status defaults to 'ACTIVE' — important so legacy rows and unit tests
    // without explicit status land in a reachable state.
    expect(byName.get("status")!.column_default).toContain("ACTIVE");
  });

  // ── 2. status CHECK constraint ─────────────────────────────────────────────
  it("organizations.status CHECK rejects invalid values", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.current_org', $1, true)`,
        [DEV_ORG_ID]
      );
      let threw = false;
      try {
        await c.query(
          `INSERT INTO organizations (id, name, status)
           VALUES (gen_random_uuid(), 'Bogus', 'NOT_A_STATUS')`
        );
      } catch (err) {
        threw = true;
        expect((err as Error).message).toMatch(/check constraint|violates/i);
      }
      expect(threw, "expected CHECK violation on bad status").toBe(true);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  // ── 3. billing tables exist ────────────────────────────────────────────────
  it("plans / plan_features / subscriptions / usage_records tables exist", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN
              ('plans','plan_features','subscriptions','usage_records')`
    );
    expect(new Set(rows.map((r) => r.table_name))).toEqual(
      new Set(["plans", "plan_features", "subscriptions", "usage_records"])
    );
  });

  // ── 4. Key constraints on plans / plan_features ────────────────────────────
  it("plans has UNIQUE(code) and plan_features PK is (plan_id, feature_key)", async () => {
    // UNIQUE on plans.code
    const { rows: uniq } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='plans' AND indexdef ILIKE '%UNIQUE%code%'`
    );
    expect(uniq.length).toBeGreaterThan(0);

    // PK on plan_features = (plan_id, feature_key).
    // Cast attname (pg `name` type) to text so node-postgres parses it as
    // text[] rather than returning the literal '{plan_id,feature_key}' string.
    const { rows: pk } = await pool.query<{ attnames: string[] }>(
      `SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum)) AS attnames
         FROM pg_index i
         JOIN pg_class c  ON c.oid = i.indrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE c.relname = 'plan_features' AND i.indisprimary
        GROUP BY i.indexrelid`
    );
    expect(pk[0]?.attnames).toEqual(["plan_id", "feature_key"]);
  });

  // ── 5. subscriptions partial unique index ─────────────────────────────────
  it("subscriptions has partial unique index on org_id for live states", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='subscriptions'
          AND indexname='subscriptions_org_active_unique'`
    );
    expect(rows.length).toBe(1);
    const def = rows[0]!.indexdef;
    expect(def).toMatch(/UNIQUE/);
    // Must restrict to live states — the exact predicate text is brittle so
    // we assert it mentions each live state.
    expect(def).toMatch(/TRIALING/);
    expect(def).toMatch(/ACTIVE/);
    expect(def).toMatch(/PAST_DUE/);
  });

  // ── 6. usage_records uniqueness for idempotent upsert ─────────────────────
  it("usage_records enforces UNIQUE(org_id, metric, period)", async () => {
    // Cast attname to text so pg returns text[] (parsed) not name[] (raw).
    const { rows } = await pool.query<{ attnames: string[] }>(
      `SELECT array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum)) AS attnames
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE c.relname = 'usage_records' AND i.indisunique AND NOT i.indisprimary
        GROUP BY i.indexrelid`
    );
    const combos = rows.map((r) => r.attnames.join(","));
    expect(combos).toContain("org_id,metric,period");
  });

  // ── 7. RLS matrix ─────────────────────────────────────────────────────────
  it("subscriptions + usage_records are RLS-enforced; plans/plan_features are not", async () => {
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('plans','plan_features','subscriptions','usage_records')`
    );
    const by = new Map(rows.map((r) => [r.relname, r]));

    for (const name of ["subscriptions", "usage_records"]) {
      const r = by.get(name);
      expect(r, `${name} missing from pg_class`).toBeDefined();
      expect(r!.relrowsecurity, `${name} should have RLS enabled`).toBe(true);
      expect(r!.relforcerowsecurity, `${name} should force RLS`).toBe(true);
    }
    for (const name of ["plans", "plan_features"]) {
      const r = by.get(name);
      expect(r, `${name} missing from pg_class`).toBeDefined();
      expect(r!.relrowsecurity, `${name} should NOT have RLS`).toBe(false);
    }

    // And both RLS'd tables must have a policy that references app.current_org.
    const { rows: policies } = await pool.query<{
      tablename: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT tablename, qual, with_check
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('subscriptions','usage_records')`
    );
    const polByTable = new Map(policies.map((p) => [p.tablename, p]));
    for (const name of ["subscriptions", "usage_records"]) {
      const p = polByTable.get(name);
      expect(p, `${name} has no RLS policy`).toBeDefined();
      expect(p!.qual ?? "").toMatch(/app\.current_org/);
      expect(p!.with_check ?? "").toMatch(/app\.current_org/);
    }
  });

  // ── 8. Dev seed is sane ───────────────────────────────────────────────────
  it("dev seed has ≥4 plans and one ACTIVE dev subscription", async () => {
    const { rows: plans } = await pool.query<{ code: string }>(
      `SELECT code FROM plans WHERE is_active = true ORDER BY sort_order`
    );
    // We ship FREE/STARTER/PRO/ENTERPRISE as the canonical set.
    expect(plans.length).toBeGreaterThanOrEqual(4);
    for (const want of ["FREE", "STARTER", "PRO", "ENTERPRISE"]) {
      expect(
        plans.find((p) => p.code === want),
        `missing plan ${want}`
      ).toBeDefined();
    }

    // Dev subscription must exist, be ACTIVE, and be in-window.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `SELECT set_config('app.current_org', $1, true)`,
        [DEV_ORG_ID]
      );
      const { rows: subs } = await c.query<{
        status: string;
        current_period_end: Date;
      }>(
        `SELECT status, current_period_end
           FROM subscriptions WHERE org_id = $1`,
        [DEV_ORG_ID]
      );
      await c.query("ROLLBACK");
      expect(subs.length).toBe(1);
      expect(subs[0]!.status).toBe("ACTIVE");
      expect(subs[0]!.current_period_end.getTime()).toBeGreaterThan(Date.now());
    } finally {
      c.release();
    }
  });
});
