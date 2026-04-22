/**
 * Gate 5 — RLS silently filters cross-tenant access.
 *
 * ARCHITECTURE.md §9.2. Setting app.current_org to org A means SELECTs
 * from users/refresh_tokens return ONLY org A rows. Trying without a
 * setting returns zero rows (doesn't error).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

const OTHER_ORG_ID = "00000000-0000-0000-0000-0000000000b1";
// Matches Option 2 identity model — one global identity, one membership,
// one tenant-scoped users row. The identity sits above RLS (no org_id);
// users + memberships are tenant-scoped and must flow through withOrg().
const OTHER_IDENTITY_ID = "00000000-0000-0000-0000-0000000000b2";
const OTHER_USER_ID = "00000000-0000-0000-0000-00000000e001";

describe("gate-5: row-level security", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    // user_identities is GLOBAL (no RLS), so we can insert without withOrg.
    // Upsert shape keeps the test idempotent across runs.
    const bootstrap = await pool.connect();
    try {
      // user_identities holds auth (email/password/MFA); `name` lives on
      // the per-tenant users row, not here.
      await bootstrap.query(
        `INSERT INTO user_identities (id, email, password_hash)
         VALUES ($1, 'other@other.local', '$2b$10$stub')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_IDENTITY_ID]
      );
    } finally {
      bootstrap.release();
    }

    // The org + its users row + the membership all live under RLS —
    // inserts without app.current_org match zero rows and are silently
    // dropped. Wrap in withOrg(OTHER_ORG_ID).
    await withOrg(pool, OTHER_ORG_ID, async (client) => {
      await client.query(
        `INSERT INTO organizations (id, name) VALUES ($1, 'Other Tenant')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO users (id, org_id, identity_id, email, name)
         VALUES ($1, $2, $3, 'other@other.local', 'Other User')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_USER_ID, OTHER_ORG_ID, OTHER_IDENTITY_ID]
      );
    });
  });

  afterAll(async () => {
    // Leave the other org in place — cheap and stable between runs.
    await pool.end();
  });

  it("SELECT under DEV_ORG_ID sees only dev-org users", async () => {
    const rows = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const r = await client.query<{ org_id: string; email: string }>(
        `SELECT org_id, email FROM users`
      );
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.org_id).toBe(DEV_ORG_ID);
    }
    // The other-org user must NOT show up.
    expect(
      rows.find((r) => r.email === "other@other.local")
    ).toBeUndefined();
  });

  it("SELECT under OTHER_ORG_ID sees only the other-org user", async () => {
    const rows = await withOrg(pool, OTHER_ORG_ID, async (client) => {
      const r = await client.query<{ email: string }>(`SELECT email FROM users`);
      return r.rows;
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.email).toBe("other@other.local");
  });

  it("SELECT with no GUC set returns zero rows (not an error)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // No set_config call — app.current_org is empty string.
      const r = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM users`
      );
      await client.query("ROLLBACK");
      expect(r.rows[0]!.c).toBe("0");
    } finally {
      client.release();
    }
  });
});
