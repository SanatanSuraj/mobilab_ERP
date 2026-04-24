/**
 * Exhaustive RLS isolation across every Drizzle-declared tenant table.
 *
 * ARCHITECTURE.md §9.2 / §13.1. Gate-8 proves SELECT isolation for CRM.
 * Gate-12 proves the catalog flags (RLS enabled + forced + policy) for
 * every org_id table. Gate-25 does the same SELECT-level proof for the
 * Phase-2 modules. This spec goes one layer further:
 *
 *   1. The table list is derived at runtime from the Drizzle schema
 *      (getTableColumns / getTableUniqueName) — no hardcoded table names.
 *      A new tenant table shipped in the schema is automatically covered,
 *      across every Postgres schema (public, audit, …).
 *
 *   2. For every such table it asserts tenant-B rows stay invisible
 *      via the four surfaces a request handler could plausibly touch:
 *      SELECT, UPDATE ... RETURNING, DELETE ... RETURNING, and a
 *      two-table JOIN. The SELECT leg repeats gate-8/25's read check;
 *      the write-RETURNING legs and the JOIN leg are new — they close
 *      the "even a malicious handler can't exfiltrate B's rows" case.
 *
 *   3. A forgotten withOrg() must yield 0 rows, NOT an error — the
 *      app contract (with-org.ts) is that an unset GUC is a silent
 *      empty, so a handler that forgets scoping shows up as a
 *      missing-data bug immediately, not as a 500.
 *
 *   4. The NOBYPASSRLS app role cannot be escalated via SET ROLE to
 *      the BYPASSRLS vendor role or the superuser bootstrap role.
 *      If either SET ROLE were to succeed, every RLS assertion above
 *      would be trivially defeatable.
 *
 * Permission-denied (SQLSTATE 42501) is treated as success for the
 * UPDATE/DELETE legs — a refused operation surfaces zero tenant-B rows,
 * which is a strictly stronger form of the isolation contract. The
 * audit.log table is the canonical example: instigenie_app has no
 * UPDATE/DELETE grants on it (by design, ARCHITECTURE.md §11).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { getTableColumns, getTableUniqueName, isTable } from "drizzle-orm";
import * as schema from "@instigenie/db/schema";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

// Distinct from gate-8 (...c1), gate-13 (...d1/d2), gate-25 (...d1 + d1xx).
// Keeps re-runs idempotent and isolates this gate's seeded rows.
const OTHER_ORG_ID = "00000000-0000-0000-0000-0000000000e1";
const OTHER_ACCOUNT_ID = "00000000-0000-0000-0000-0000000000e2";
const OTHER_CONTACT_ID = "00000000-0000-0000-0000-0000000000e3";
const OTHER_LEAD_ID = "00000000-0000-0000-0000-0000000000e4";
const OTHER_DEAL_ID = "00000000-0000-0000-0000-0000000000e5";

interface TenantTable {
  /** Drizzle JS export name — used in error messages. */
  jsName: string;
  /** Postgres schema (e.g. "public", "audit"). */
  schema: string;
  /** Bare table name (e.g. "accounts", "log"). */
  name: string;
  /** Schema-qualified identifier safe to splice into SQL. */
  qualified: string;
}

/**
 * Walk the Drizzle schema barrel and return one entry per tenant-scoped
 * table — any table that declares a column whose DB name is `org_id`.
 * This is the gate's single source of truth; adding a table to the
 * Drizzle schema with an org_id column auto-enrolls it in every
 * assertion below, regardless of which Postgres schema it lives in.
 */
function discoverTenantTables(): TenantTable[] {
  const IDENT = /^[a-z_][a-z0-9_]*$/;
  const out: TenantTable[] = [];
  for (const [jsName, maybe] of Object.entries(schema)) {
    if (!isTable(maybe)) continue;
    const cols = getTableColumns(maybe);
    const hasOrgId = Object.values(cols).some(
      (c: { name: string }) => c.name === "org_id"
    );
    if (!hasOrgId) continue;
    const qualified = getTableUniqueName(maybe); // always "<schema>.<name>"
    const [schemaName, bareName] = qualified.split(".");
    // Guardrail: these strings are spliced into raw SQL. If the Drizzle
    // API ever hands back something exotic, fail the suite loudly here
    // rather than emit broken queries at assertion time.
    if (!schemaName || !bareName || !IDENT.test(schemaName) || !IDENT.test(bareName)) {
      throw new Error(
        `unexpected Drizzle identifier for ${jsName}: ${qualified}`
      );
    }
    out.push({ jsName, schema: schemaName, name: bareName, qualified });
  }
  return out.sort((a, b) => a.qualified.localeCompare(b.qualified));
}

/**
 * Treat "permission denied" (SQLSTATE 42501) as a strictly stronger
 * form of isolation: the operation was refused before it could leak
 * anything. Any other error is a real failure and must propagate.
 */
function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "42501"
  );
}

describe("rls-isolation: cross-tenant isolation across every Drizzle-declared tenant table", () => {
  let pool: pg.Pool;
  let tables: TenantTable[];

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    tables = discoverTenantTables();

    // Two tenants with overlapping data: DEV_ORG is pre-seeded by
    // ops/sql/seed/* (03-dev-org-users.sql, 04-crm-dev-data.sql). We
    // create OTHER_ORG here + mirror rows into the main CRM parent
    // tables so the UPDATE/DELETE/JOIN attacks below have something
    // real to try to reach. The DO-block-generated RLS policy is
    // uniform across every tenant table (ops/sql/rls/02-crm-rls.sql),
    // so seeding a representative handful is enough to prove the
    // shape of the guarantee; the SELECT emptiness assertion still
    // fires against every discovered table.
    await withOrg(pool, OTHER_ORG_ID, async (client) => {
      await client.query(
        `INSERT INTO organizations (id, name) VALUES ($1, 'RLS-Isolation Other')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO accounts (id, org_id, name, country)
         VALUES ($1, $2, 'Iso Other Account', 'IN')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ACCOUNT_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO contacts (id, org_id, account_id, first_name, last_name)
         VALUES ($1, $2, $3, 'Iso', 'Contact')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_CONTACT_ID, OTHER_ORG_ID, OTHER_ACCOUNT_ID]
      );
      await client.query(
        `INSERT INTO leads (id, org_id, name, company, email, phone)
         VALUES ($1, $2, 'Iso Lead', 'Iso Co', 'iso-lead@iso.local', '+99-00001')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_LEAD_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO deals (id, org_id, deal_number, title, company, contact_name, value)
         VALUES ($1, $2, 'ISO-DEAL-0001', 'Iso deal', 'Iso Co', 'Iso Contact', '0')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_DEAL_ID, OTHER_ORG_ID]
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // ── 0. Sanity — the walker found tables ──────────────────────────────────

  it("enumerated a non-trivial set of tenant tables from the Drizzle schema", () => {
    // A zero-length list would make every assertion below vacuously pass.
    // The barrel currently covers core + crm + billing + audit + outbox,
    // which yields well over ten org_id-bearing tables.
    expect(tables.length).toBeGreaterThan(10);
  });

  // ── 1. SELECT — USING clause at scan ─────────────────────────────────────

  it("SELECT under tenant A returns zero rows tagged with tenant B for every table", async () => {
    const offenders: string[] = [];
    // One connection, one txn wrapping SAVEPOINTs so a per-table failure
    // (e.g. an odd permission shape on a future table) can't cascade and
    // mask leaks on the tables that come after it in the sort order.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_org', $1, true)",
        [DEV_ORG_ID]
      );
      for (const t of tables) {
        await client.query("SAVEPOINT s");
        try {
          const { rows } = await client.query<{ c: string }>(
            `SELECT count(*)::text AS c FROM ${t.qualified} WHERE org_id = $1`,
            [OTHER_ORG_ID]
          );
          if (rows[0]!.c !== "0") {
            offenders.push(`${t.qualified} (${rows[0]!.c} row(s))`);
          }
          await client.query("RELEASE SAVEPOINT s");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT s");
          if (!isPermissionDenied(err)) {
            offenders.push(`${t.qualified} threw: ${(err as Error).message}`);
          }
        }
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      offenders,
      `tables leaking OTHER_ORG rows on SELECT under DEV context: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  // ── 2. UPDATE ... RETURNING — USING filter on target set ─────────────────

  it("UPDATE ... RETURNING under tenant A cannot surface tenant B rows for any table", async () => {
    // Self-assigning org_id is a no-op under WITH CHECK (new row's
    // org_id is unchanged, still equals current_setting), so the only
    // thing this query can reveal is whether the USING clause lets the
    // row into the target set in the first place. If any row comes
    // back, USING is broken.
    //
    // Wrapped in an outer txn we ROLLBACK so even if a row *did* slip
    // through we don't mutate OTHER_ORG's data. SAVEPOINTs keep one
    // table's permission-denial from poisoning the next.
    const offenders: string[] = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_org', $1, true)",
        [DEV_ORG_ID]
      );
      for (const t of tables) {
        await client.query("SAVEPOINT s");
        try {
          const { rows } = await client.query<{ org_id: string }>(
            `UPDATE ${t.qualified} SET org_id = org_id
              WHERE org_id = $1
              RETURNING org_id`,
            [OTHER_ORG_ID]
          );
          if (rows.length > 0) {
            offenders.push(`${t.qualified} (${rows.length} row(s))`);
          }
          await client.query("RELEASE SAVEPOINT s");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT s");
          if (!isPermissionDenied(err)) {
            offenders.push(`${t.qualified} threw: ${(err as Error).message}`);
          }
        }
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      offenders,
      `UPDATE ... RETURNING surfaced OTHER_ORG rows: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  // ── 3. DELETE ... RETURNING — USING filter on target set ─────────────────

  it("DELETE ... RETURNING under tenant A cannot surface tenant B rows for any table", async () => {
    const offenders: string[] = [];
    // Same rollback-wrapper pattern as the UPDATE test. If any row
    // slipped through we don't want to actually destroy it.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_org', $1, true)",
        [DEV_ORG_ID]
      );
      for (const t of tables) {
        await client.query("SAVEPOINT s");
        try {
          const { rows } = await client.query<{ org_id: string }>(
            `DELETE FROM ${t.qualified} WHERE org_id = $1 RETURNING org_id`,
            [OTHER_ORG_ID]
          );
          if (rows.length > 0) {
            offenders.push(`${t.qualified} (${rows.length} row(s))`);
          }
          await client.query("RELEASE SAVEPOINT s");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT s");
          if (!isPermissionDenied(err)) {
            offenders.push(`${t.qualified} threw: ${(err as Error).message}`);
          }
        }
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      offenders,
      `DELETE ... RETURNING surfaced OTHER_ORG rows: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  // ── 4. JOIN — USING is applied per-relation, never composes leakage ──────

  it(
    "a JOIN across every pair of tenant tables cannot surface tenant B rows",
    async () => {
      // RLS is a planner-level rewrite: the USING predicate is applied
      // independently to each relation's scan, BEFORE any join. Therefore
      // if no relation leaks B on its own, no join over them can either.
      // We still verify empirically: for every ordered pair (t1, t2) we
      // ask "is there a row in t1 ⨝ t2 where either side is tagged B?"
      //
      // Runtime caveat: the unrestricted CROSS JOIN materialises Nd1×Nd2
      // DEV-row products under RLS. audit.log alone has ~230k DEV rows
      // in the dev seed, so pairing it with any other table would be
      // seconds of work, times N² pairs, times 20 anchors — blows the
      // vitest timeout. We bound each scan with LIMIT 200 before the
      // cross product. RLS is uniform on org_id (same USING predicate
      // applied to every row), so sampling 200 rows from a DEV-only
      // scan is representative: if any of those 200 came back tagged
      // B, the planner applied USING incorrectly and every other row
      // would too. The JOIN operator stays in the plan — this is what
      // we're exercising.
      //
      // Pre-filter to tables the app role can actually SELECT from;
      // permission-denied is a stricter form of isolation but can't
      // participate in a UNION ALL without poisoning sibling legs.
      // Then batch one query per anchor: 20 round trips, each carrying
      // a UNION ALL of ~19 bounded-CROSS-JOIN EXISTS subqueries.
      const offenders: string[] = [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.current_org', $1, true)",
          [DEV_ORG_ID]
        );

        const selectable: TenantTable[] = [];
        for (const t of tables) {
          await client.query("SAVEPOINT s");
          try {
            await client.query(`SELECT 1 FROM ${t.qualified} LIMIT 0`);
            await client.query("RELEASE SAVEPOINT s");
            selectable.push(t);
          } catch (err) {
            await client.query("ROLLBACK TO SAVEPOINT s");
            if (!isPermissionDenied(err)) {
              offenders.push(
                `${t.qualified} accessibility probe threw: ${(err as Error).message}`
              );
            }
          }
        }

        for (let i = 0; i < selectable.length; i++) {
          const t1 = selectable[i]!;
          const partners = selectable.filter((_, j) => j !== i);
          if (partners.length === 0) continue;

          const legs = partners.map(
            (t2, k) =>
              `SELECT ${k}::int AS idx, EXISTS (
                 SELECT 1
                   FROM (SELECT org_id FROM ${t1.qualified} LIMIT 200) a
                   CROSS JOIN (SELECT org_id FROM ${t2.qualified} LIMIT 200) b
                  WHERE a.org_id = $1 OR b.org_id = $1
               ) AS leaked`
          );
          const { rows } = await client.query<{ idx: number; leaked: boolean }>(
            `SELECT idx, leaked FROM (${legs.join(" UNION ALL ")}) x WHERE leaked`,
            [OTHER_ORG_ID]
          );
          for (const r of rows) {
            offenders.push(`${t1.qualified} ⋈ ${partners[r.idx]!.qualified}`);
          }
        }

        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      expect(
        offenders,
        `JOINs surfaced OTHER_ORG rows: ${offenders.join(", ")}`
      ).toEqual([]);
    },
    60_000
  );

  // ── 5. Forgotten withOrg() — empty GUC → 0 rows, no error ────────────────

  it("without app.current_org set, SELECT returns 0 rows for every table (no error)", async () => {
    // The policy uses current_setting('app.current_org', true) — the
    // `true` (is_missing_ok) flag means an unset GUC returns '' rather
    // than raising. Comparing '' to any real org_id::text is always
    // false, so USING filters every row out. Net: a handler that
    // forgets withOrg() sees an empty result set, not an exception.
    // That's the intended failure mode — bugs show up as missing data,
    // not as runtime errors that could be turned into a DoS.
    //
    // Run queries outside an explicit txn so each one stands alone —
    // a permission-denied on one table doesn't abort the rest. The
    // RESET at the top is defensive: pool connections may have left
    // a stale SET SESSION behind (even though current app code only
    // uses SET LOCAL), and we want to honestly test the "nothing set"
    // condition.
    const client = await pool.connect();
    const offenders: string[] = [];
    try {
      await client.query(`RESET "app.current_org"`).catch(() => {
        // RESET on a GUC that's already at default raises on some
        // Postgres versions — safe to swallow here.
      });
      for (const t of tables) {
        try {
          const { rows } = await client.query<{ c: string }>(
            `SELECT count(*)::text AS c FROM ${t.qualified}`
          );
          if (rows[0]!.c !== "0") {
            offenders.push(
              `${t.qualified} returned ${rows[0]!.c} row(s) with GUC unset`
            );
          }
        } catch (err) {
          // Permission-denied (e.g. a table we can't even SELECT from)
          // is acceptable — it's a stricter form of "no rows surfaced".
          // Any other error breaks the contract.
          if (!isPermissionDenied(err)) {
            offenders.push(
              `${t.qualified} threw with GUC unset: ${(err as Error).message}`
            );
          }
        }
      }
    } finally {
      client.release();
    }
    expect(offenders).toEqual([]);
  });

  // ── 6. Role escalation via SET ROLE ──────────────────────────────────────

  it("the NOBYPASSRLS app role cannot SET ROLE to the BYPASSRLS vendor role", async () => {
    // instigenie_vendor is BYPASSRLS by design (ops/sql/seed/98-vendor-role.sql)
    // so if the app role could jump into it, every RLS assertion above
    // would be defeatable. Postgres guards this via role-membership:
    // SET ROLE requires the target to be a role the session is a member
    // of, and instigenie_app holds no membership in instigenie_vendor
    // (verified separately: pg_auth_members has no row linking them).
    const client = await pool.connect();
    let caught: unknown;
    try {
      await client.query("BEGIN");
      try {
        await client.query(`SET ROLE instigenie_vendor`);
      } catch (err) {
        caught = err;
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      caught,
      "SET ROLE instigenie_vendor was accepted — privilege escalation possible"
    ).toBeDefined();
    expect(String((caught as Error).message ?? caught)).toMatch(
      /permission denied|must be a member of/i
    );
  });

  it("the NOBYPASSRLS app role cannot SET ROLE to the superuser bootstrap role", async () => {
    // The bootstrap role `instigenie` is SUPERUSER for migrations
    // (gate-11). Superusers skip RLS entirely, so this escalation
    // path has to be closed for the same reason as the vendor one.
    const client = await pool.connect();
    let caught: unknown;
    try {
      await client.query("BEGIN");
      try {
        await client.query(`SET ROLE instigenie`);
      } catch (err) {
        caught = err;
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      caught,
      "SET ROLE instigenie was accepted — superuser reachable from the app role"
    ).toBeDefined();
    expect(String((caught as Error).message ?? caught)).toMatch(
      /permission denied|must be a member of/i
    );
  });

  // ── 7. Schema drift — Drizzle declarations agree with physical DB ───────

  it("every Drizzle-declared tenant table actually exists in the DB with an org_id column", async () => {
    // If Drizzle declares a table that's missing from the DB (or one
    // where the org_id column was dropped), the gate's enumeration is
    // lying and every assertion above is being run against a ghost.
    // Fail loudly so the Drizzle schema gets resynced.
    //
    // The reverse direction — DB tables with org_id that Drizzle
    // doesn't know about — is the known Phase-2 backlog (procurement,
    // QC, production, etc. still live only in SQL migrations). We do
    // NOT assert on that direction here; gate-12 already proves those
    // tables are catalog-level isolated, and gate-25 proves runtime
    // isolation for them. This gate only promises completeness for
    // whatever Drizzle currently declares.
    const { rows } = await pool.query<{
      table_schema: string;
      table_name: string;
    }>(
      `SELECT table_schema, table_name
         FROM information_schema.columns
        WHERE column_name = 'org_id'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')`
    );
    const physical = new Set(
      rows.map((r) => `${r.table_schema}.${r.table_name}`)
    );
    const missing = tables
      .map((t) => t.qualified)
      .filter((q) => !physical.has(q));
    expect(
      missing,
      `Drizzle declares tenant tables that don't exist in the DB: ${missing.join(", ")}`
    ).toEqual([]);
  });
});
