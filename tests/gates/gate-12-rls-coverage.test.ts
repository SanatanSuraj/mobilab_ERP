/**
 * Gate 12 — Every tenant-scoped table has RLS enforced.
 *
 * ARCHITECTURE.md §9.2. The contract is simple:
 *
 *   "If a public.<table> has an org_id column, it is tenant-scoped, and
 *    therefore MUST have RLS enabled, FORCED, and at least one policy."
 *
 * Gate 8 hand-lists the CRM tables. This one is the *discovery* gate —
 * it asks the catalog directly, so a table added in Phase 2.5+ without a
 * policy fails here before it can ship. Every future SaaS vertical
 * (inventory, procurement, production, QC, finance, notifications)
 * inherits this guarantee for free.
 *
 * Allowlist: the handful of tables we know are NOT tenant-scoped even
 * though they carry org_id (currently: none). If one ever appears, add
 * it explicitly with a comment explaining why — don't weaken the rule.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { makeTestPool, waitForPg } from "./_helpers.js";

/**
 * Tables that carry an `org_id` column BUT should NOT be RLS-scoped.
 * Must be empty by default. Every entry needs a comment justifying why
 * it's safe to exclude from tenant isolation.
 */
const RLS_EXEMPT_TABLES = new Set<string>([
  // (empty) — add entries with justification if ever needed.
]);

interface TableRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
}

describe("gate-12: RLS coverage across every org_id table", () => {
  let pool: pg.Pool;
  let orgIdTables: string[];
  let tableMeta: Map<string, TableRow>;
  let policyCounts: Map<string, number>;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    // 1. Every public table that has an org_id column.
    const cols = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name  = 'org_id'
        ORDER BY table_name`
    );
    orgIdTables = cols.rows.map((r) => r.table_name);

    // 2. RLS flags for those tables from pg_class.
    const meta = await pool.query<TableRow>(
      `SELECT c.relname,
              c.relrowsecurity,
              c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])`,
      [orgIdTables]
    );
    tableMeta = new Map(meta.rows.map((r) => [r.relname, r]));

    // 3. Policy count per table.
    const pols = await pool.query<{ tablename: string; n: string }>(
      `SELECT tablename, count(*)::text AS n
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = ANY($1::text[])
        GROUP BY tablename`,
      [orgIdTables]
    );
    policyCounts = new Map(pols.rows.map((r) => [r.tablename, Number(r.n)]));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("the discovery query found at least one tenant table (sanity)", () => {
    // If this is zero, either the DB wasn't seeded or the information_schema
    // query is broken — every downstream assertion would vacuously pass.
    expect(orgIdTables.length).toBeGreaterThan(0);
  });

  it("every org_id-bearing table has RLS ENABLED", () => {
    const offenders: string[] = [];
    for (const t of orgIdTables) {
      if (RLS_EXEMPT_TABLES.has(t)) continue;
      const m = tableMeta.get(t);
      if (!m || !m.relrowsecurity) offenders.push(t);
    }
    expect(
      offenders,
      `these tables carry org_id but RLS is not ENABLED: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("every org_id-bearing table has RLS FORCED (owners cannot bypass)", () => {
    const offenders: string[] = [];
    for (const t of orgIdTables) {
      if (RLS_EXEMPT_TABLES.has(t)) continue;
      const m = tableMeta.get(t);
      if (!m || !m.relforcerowsecurity) offenders.push(t);
    }
    expect(
      offenders,
      `these tables carry org_id but RLS is not FORCED — owner role can silently see every tenant: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("every org_id-bearing table has at least one policy", () => {
    // Without a policy, RLS enabled = "deny all" which looks safe, but is
    // also a sign that tenant isolation was never actually wired. Fail
    // loudly so the developer knows to add the policy instead of silently
    // shipping a table that returns zero rows to every request.
    const offenders: string[] = [];
    for (const t of orgIdTables) {
      if (RLS_EXEMPT_TABLES.has(t)) continue;
      const n = policyCounts.get(t) ?? 0;
      if (n === 0) offenders.push(t);
    }
    expect(
      offenders,
      `these tables have RLS enabled but no policy defined: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("every PERMISSIVE policy references app.current_org (no rogue USING clauses)", async () => {
    // Guard against a future policy that accidentally filters on
    // something other than the tenant GUC (e.g. someone types
    // `current_user` thinking it's the tenant).
    //
    // PERMISSIVE vs RESTRICTIVE:
    //   - PERMISSIVE policies are OR'd; they establish the base
    //     tenant-isolation gate and MUST bind to app.current_org.
    //   - RESTRICTIVE policies are AND'd onto permissive ones
    //     (§3.7 portal customer overlay, e.g. tickets_portal_customer in
    //     ops/sql/rls/13-portal-rls.sql) and deliberately do NOT
    //     reference app.current_org — the tenant gate is already
    //     enforced by the permissive policy. Enforcing the check on them
    //     would outlaw a legitimate RLS pattern. Phase 4 §4.1 RESTRICTIVE
    //     policies (pdf_render_* — none yet) would behave the same way.
    //
    // We therefore assert: every *permissive* policy references
    // app.current_org. The RESTRICTIVE overlays get to define whatever
    // orthogonal predicate they need.
    const { rows } = await pool.query<{
      tablename: string;
      policyname: string;
      permissive: string;
      qual: string | null;
    }>(
      `SELECT tablename, policyname, permissive, qual
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = ANY($1::text[])`,
      [orgIdTables]
    );
    const bad = rows.filter(
      (r) =>
        r.permissive === "PERMISSIVE" &&
        (!r.qual || !r.qual.includes("app.current_org"))
    );
    expect(
      bad.map((r) => `${r.tablename}.${r.policyname}`),
      `permissive policies not bound to app.current_org: ${bad.map((r) => `${r.tablename}.${r.policyname}`).join(", ")}`
    ).toEqual([]);
  });
});
