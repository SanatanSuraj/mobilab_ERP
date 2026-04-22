/**
 * Gate 13 — WITH CHECK rejects cross-tenant writes.
 *
 * ARCHITECTURE.md §9.2. RLS has two sides:
 *
 *   - USING      → filters rows on READ (SELECT, UPDATE, DELETE visibility)
 *   - WITH CHECK → rejects rows on WRITE (INSERT, UPDATE target rows)
 *
 * Gates 5 and 8 prove the READ side (no cross-tenant leak on SELECT).
 * Gate 13 proves the WRITE side: even if the app code is malicious or
 * buggy, it CANNOT insert a row for another tenant, and CANNOT move an
 * existing row's org_id into another tenant.
 *
 * Why this matters for SaaS: without WITH CHECK, a compromised request
 * handler could attach data to a competitor's tenant. The database kernel
 * must refuse — not the application.
 *
 * Representative table: accounts. The policy is generated in a single
 * DO-block (ops/sql/rls/02-crm-rls.sql), so if it holds for accounts it
 * holds for every other CRM tenant table. Gate 12 proves the policy
 * exists on all of them.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

const OTHER_ORG_ID = "00000000-0000-0000-0000-0000000000d1";
const TEST_ACCOUNT_ID = "00000000-0000-0000-0000-0000000000d2";

describe("gate-13: RLS WITH CHECK rejects cross-tenant writes", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    // Seed the OTHER org so FK constraints on org_id don't mask RLS
    // rejections — we want to see "row-level security policy" errors,
    // not "foreign key violation" errors.
    await withOrg(pool, OTHER_ORG_ID, async (client) => {
      await client.query(
        `INSERT INTO organizations (id, name) VALUES ($1, 'WithCheck Other')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ORG_ID]
      );
    });

    // Seed one account under DEV_ORG that gate-13 will attempt to
    // hijack via UPDATE. Idempotent.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `INSERT INTO accounts (id, org_id, name, country)
         VALUES ($1, $2, 'Gate13 Target', 'IN')
         ON CONFLICT (id) DO NOTHING`,
        [TEST_ACCOUNT_ID, DEV_ORG_ID]
      );
    });
  });

  afterAll(async () => {
    // Clean up the test account under its own org so RLS allows the delete.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(`DELETE FROM accounts WHERE id = $1`, [TEST_ACCOUNT_ID]);
    });
    await pool.end();
  });

  it("INSERT with a foreign org_id is rejected under current tenant", async () => {
    // Tenant GUC = DEV_ORG, but we try to INSERT a row tagged OTHER_ORG.
    // Postgres must raise: "new row violates row-level security policy".
    let caught: unknown = undefined;
    try {
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(
          `INSERT INTO accounts (org_id, name, country)
           VALUES ($1, 'Hijack Attempt', 'IN')`,
          [OTHER_ORG_ID]
        );
      });
    } catch (err) {
      caught = err;
    }
    expect(caught, "cross-tenant INSERT was NOT rejected — WITH CHECK missing").toBeDefined();
    const msg = String((caught as Error).message ?? caught);
    expect(msg).toMatch(/row-level security policy/i);
  });

  it("INSERT with no GUC set is rejected (WITH CHECK fails on NULL)", async () => {
    // No `withOrg` — app.current_org is empty. The WITH CHECK expression
    // becomes (org_id::text = '') which is false for any real UUID, so the
    // row is rejected. Proves a handler that forgets withOrg cannot write.
    const client = await pool.connect();
    let caught: unknown = undefined;
    try {
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO accounts (org_id, name, country)
           VALUES ($1, 'No Context Insert', 'IN')`,
          [DEV_ORG_ID]
        );
      } catch (err) {
        caught = err;
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(caught, "INSERT without app.current_org was NOT rejected").toBeDefined();
    const msg = String((caught as Error).message ?? caught);
    expect(msg).toMatch(/row-level security policy/i);
  });

  it("UPDATE that moves org_id to another tenant is rejected", async () => {
    // Seeded row lives under DEV_ORG. A malicious handler tries to
    // re-tag it to OTHER_ORG while still connected as DEV_ORG.
    // WITH CHECK must reject the NEW row's org_id.
    let caught: unknown = undefined;
    try {
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(
          `UPDATE accounts SET org_id = $1 WHERE id = $2`,
          [OTHER_ORG_ID, TEST_ACCOUNT_ID]
        );
      });
    } catch (err) {
      caught = err;
    }
    expect(
      caught,
      "cross-tenant UPDATE of org_id was NOT rejected — WITH CHECK missing"
    ).toBeDefined();
    const msg = String((caught as Error).message ?? caught);
    expect(msg).toMatch(/row-level security policy/i);

    // Belt-and-braces: confirm the row's org_id was NOT moved.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows } = await client.query<{ org_id: string }>(
        `SELECT org_id FROM accounts WHERE id = $1`,
        [TEST_ACCOUNT_ID]
      );
      expect(rows[0]?.org_id).toBe(DEV_ORG_ID);
    });
  });

  it("UPDATE of non-org_id columns still succeeds under correct tenant", async () => {
    // Sanity: WITH CHECK should only block cross-tenant writes, not
    // normal in-tenant edits. If this fails, the policy is too strict.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        `UPDATE accounts SET name = 'Gate13 Target (touched)'
          WHERE id = $1
         RETURNING id`,
        [TEST_ACCOUNT_ID]
      );
      expect(r.rowCount).toBe(1);
    });
  });
});
