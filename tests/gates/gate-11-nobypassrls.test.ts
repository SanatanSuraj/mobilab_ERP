/**
 * Gate 11 — App DB role cannot bypass RLS.
 *
 * ARCHITECTURE.md §9.2 / §13.1. The whole multi-tenant isolation contract
 * rests on one assumption: the runtime role is NEITHER a superuser NOR
 * does it carry BYPASSRLS. If that assumption ever breaks, every other
 * tenant-isolation gate becomes a lie (superuser silently sees every
 * tenant, BYPASSRLS ignores policies).
 *
 * This gate locks that assumption down:
 *   1. The role we connect as (current_user) really is `instigenie_app`.
 *   2. That role has rolsuper=false AND rolbypassrls=false.
 *   3. The bootstrap role `instigenie` still has its expected powers
 *      (superuser for migrations), so we notice if someone swaps them.
 *
 * If this gate ever fails, treat it as P0 — the tenant boundary is not
 * enforced and production data is at risk.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { makeTestPool, waitForPg } from "./_helpers.js";

describe("gate-11: app role has NOBYPASSRLS and NOSUPERUSER", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("the connection is running as instigenie_app (not the bootstrap superuser)", async () => {
    // If a future dev points DATABASE_URL at the bootstrap `instigenie` user
    // "just to get tests green", every RLS gate silently passes because
    // superusers bypass all policies. Fail loudly here instead.
    const { rows } = await pool.query<{ cu: string }>(
      `SELECT current_user AS cu`
    );
    expect(
      rows[0]!.cu,
      "gates must run as instigenie_app — superuser bypasses RLS"
    ).toBe("instigenie_app");
  });

  it("instigenie_app has NOSUPERUSER and NOBYPASSRLS", async () => {
    const { rows } = await pool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
         FROM pg_roles
        WHERE rolname = 'instigenie_app'`
    );
    expect(rows.length, "instigenie_app role must exist").toBe(1);
    const r = rows[0]!;
    expect(r.rolcanlogin, "instigenie_app must be able to log in").toBe(true);
    expect(
      r.rolsuper,
      "instigenie_app must NOT be a superuser (superusers bypass RLS)"
    ).toBe(false);
    expect(
      r.rolbypassrls,
      "instigenie_app must NOT have BYPASSRLS — tenant isolation relies on this"
    ).toBe(false);
  });

  it("bootstrap role `instigenie` is still the migration superuser", async () => {
    // We deliberately keep the bootstrap role superuser so migrations can
    // ALTER schema, create extensions, etc. If someone ever demotes it,
    // migrations will fail mysteriously — catch that swap here.
    const { rows } = await pool.query<{
      rolname: string;
      rolsuper: boolean;
    }>(
      `SELECT rolname, rolsuper
         FROM pg_roles
        WHERE rolname = 'instigenie'`
    );
    expect(rows.length, "bootstrap role `instigenie` must exist").toBe(1);
    expect(
      rows[0]!.rolsuper,
      "`instigenie` must stay SUPERUSER — it runs migrations"
    ).toBe(true);
  });

  it("only instigenie_vendor (plus pg_* built-ins) carries BYPASSRLS", async () => {
    // If anyone adds a new role with BYPASSRLS, we want to know. Postgres
    // ships with a few pg_* built-ins that legitimately carry it; the
    // Sprint-3 `instigenie_vendor` role is the one non-built-in that is
    // supposed to have it (see ops/sql/seed/98-vendor-role.sql for why).
    // Anything ELSE is a red flag.
    const EXPECTED_BYPASSRLS_NON_BUILTIN = ["instigenie_vendor"];
    const { rows } = await pool.query<{ rolname: string }>(
      `SELECT rolname
         FROM pg_roles
        WHERE rolbypassrls = true
          AND rolsuper     = false
          AND rolname NOT LIKE 'pg\\_%' ESCAPE '\\'
        ORDER BY rolname`
    );
    expect(
      rows.map((r) => r.rolname),
      "unexpected non-superuser role(s) with BYPASSRLS — audit required"
    ).toEqual(EXPECTED_BYPASSRLS_NON_BUILTIN);
  });
});
