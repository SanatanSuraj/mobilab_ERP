/**
 * Gate 61 — Concurrent accept-invite race regression.
 *
 * TESTING_PLAN.md §6 priority gap — regression gate for the bug fixed
 * earlier in this session (acceptInvitationTx missing ON CONFLICT +
 * missing user_roles.org_id). This gate additionally pins the two other
 * race surfaces the /auth/accept-invite endpoint exposes today:
 *
 *   race-A) Two simultaneous accepts for the SAME pending invitation when
 *           the invitee's identity does NOT yet exist. Both execution
 *           paths reach `insertIdentity` (pool-level, no transaction).
 *           Without an ON CONFLICT, the second INSERT trips the
 *           user_identities_email_unique index and the request 500s.
 *
 *   race-B) Two simultaneous accepts for the SAME pending invitation when
 *           the invitee's identity DOES exist. Both paths reach
 *           `acceptInvitationTx` inside withOrg. The fix applied to
 *           repository.ts (ON CONFLICT (identity_id, org_id) DO UPDATE on
 *           users; ON CONFLICT (identity_id, org_id) DO UPDATE on
 *           memberships; ON CONFLICT (user_id, role_id) DO NOTHING on
 *           user_roles) is supposed to make both branches land a single
 *           converged row.
 *
 * This gate fires the two scenarios with tight Promise.all() and asserts
 * the end-state invariants:
 *     exactly 1 user_identities row for the email
 *     exactly 1 users row in the org
 *     exactly 1 memberships row in the org
 *     exactly 1 user_roles row for (user, role)
 *     invitation.accepted_at is set
 * plus: neither promise rejects with a 500-class (e.g. pg 23505) error.
 *
 * We drive the repository layer directly rather than the HTTP surface —
 * the race surface lives in the SQL sequence, not in Fastify, so we
 * can skip the route/TokenFactory wiring and keep this gate fast.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import {
  acceptInvitationTx,
  insertIdentity,
  insertInvitation,
} from "../../apps/api/src/modules/admin-users/repository.js";
import {
  DEV_ORG_ID,
  makeTestPool,
  waitForPg,
} from "./_helpers.js";

/**
 * We use a shared, gate-local email so reruns (or a crash mid-test) can
 * clean up reliably. Two distinct addresses so race-A and race-B don't
 * contaminate each other's user_identities row.
 */
const RACE_A_EMAIL = "gate61-racea@instigenie.test";
const RACE_B_EMAIL = "gate61-raceb@instigenie.test";
// Invited role — MANAGEMENT is internal-invitable per
// admin-users/service.ts (CUSTOMER is rejected there).
const TEST_ROLE_ID = "MANAGEMENT";
// Inviter is the dev seed "Super Admin" user. We only need a valid
// users.id for the invitation row's `invited_by`. See
// ops/sql/seed/03-dev-org-users.sql for the seeded id.
const DEV_INVITER_ID = "00000000-0000-0000-0000-00000000b001";

/** sha256 helper mirroring admin-users/service.ts::sha256(). */
function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Delete every row we touched so a rerun starts clean. Safe to call even
 * if the test blew up mid-insert.
 *
 * The per-tenant tables (users, memberships, user_roles, refresh_tokens,
 * user_invitations) all have FORCE ROW LEVEL SECURITY under the app role,
 * so each DELETE must run inside withOrg() to bind app.current_org —
 * otherwise the DELETE silently affects zero rows and the follow-up
 * DELETE FROM user_identities trips the users.identity_id FK.
 *
 * user_identities is global (no RLS), so it stays on the plain pool.
 */
async function cleanupByEmail(pool: pg.Pool, email: string): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `DELETE FROM user_roles
         WHERE user_id IN (
           SELECT u.id FROM users u
            WHERE u.org_id = $1 AND lower(u.email) = lower($2)
         )`,
      [DEV_ORG_ID, email],
    );
    await client.query(
      `DELETE FROM memberships
         WHERE org_id = $1
           AND identity_id IN (
             SELECT id FROM user_identities WHERE lower(email) = lower($2)
           )`,
      [DEV_ORG_ID, email],
    );
    // refresh_tokens has FKs on both users(id) and user_identities(id); the
    // accept path doesn't hit it (we call repository.ts only), but belt +
    // braces in case a previous gate run had done so.
    await client.query(
      `DELETE FROM refresh_tokens
         WHERE org_id = $1
           AND identity_id IN (
             SELECT id FROM user_identities WHERE lower(email) = lower($2)
           )`,
      [DEV_ORG_ID, email],
    );
    await client.query(
      `DELETE FROM users
         WHERE org_id = $1 AND lower(email) = lower($2)`,
      [DEV_ORG_ID, email],
    );
    await client.query(
      `DELETE FROM user_invitations
         WHERE org_id = $1 AND lower(email) = lower($2)`,
      [DEV_ORG_ID, email],
    );
  });
  // user_identities is a global table (no RLS) so we can DELETE directly
  // under the pool without a tenant GUC.
  await pool.query(
    `DELETE FROM user_identities
       WHERE lower(email) = lower($1)`,
    [email],
  );
}

async function seedInvitation(
  pool: pg.Pool,
  email: string,
): Promise<{ invitationId: string; rawToken: string }> {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = sha256(raw);
  const row = await withOrg(pool, DEV_ORG_ID, async (client) => {
    const ins = await insertInvitation(client, {
      orgId: DEV_ORG_ID,
      email,
      roleId: TEST_ROLE_ID as "MANAGEMENT",
      tokenHash: hash,
      invitedBy: DEV_INVITER_ID,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
      metadata: { name: "Gate 61 Racer" },
    });
    return ins;
  });
  return { invitationId: row.id, rawToken: raw };
}

describe("gate-61: concurrent accept-invite race regression", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await cleanupByEmail(pool, RACE_A_EMAIL).catch(() => {});
    await cleanupByEmail(pool, RACE_B_EMAIL).catch(() => {});
    await pool.end();
  });

  beforeEach(async () => {
    // Rerunnable: nuke anything left behind from a prior failed run
    // before each scenario so the concurrent inserts start cold.
    await cleanupByEmail(pool, RACE_A_EMAIL);
    await cleanupByEmail(pool, RACE_B_EMAIL);
  });

  /**
   * Race A — two concurrent `insertIdentity` calls for the same email.
   *
   * This is the narrowest repro of the production hole: the `accept()`
   * service method does a `findIdentityByEmail` → `insertIdentity` dance
   * at the pool level with NO transaction around it. Two tabs double-
   * clicking the accept link at ~the same time → both see no existing
   * identity → both INSERT → second one hits the unique index.
   *
   * Desired behavior: both promises resolve to the SAME identity id
   * (the write is effectively idempotent). `insertIdentity` should be
   * an UPSERT on lower(email).
   */
  it("race A — concurrent insertIdentity for the same email produces exactly one row", async () => {
    // Cold state verified by beforeEach.
    const hash = "$2b$10$AAAAAAAAAAAAAAAAAAAAAuXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"; // dummy bcrypt form

    const results = await Promise.allSettled([
      insertIdentity(pool, { email: RACE_A_EMAIL, passwordHash: hash }),
      insertIdentity(pool, { email: RACE_A_EMAIL, passwordHash: hash }),
    ]);

    // End-state invariant: exactly ONE user_identities row for this email.
    // This must hold regardless of which call "wins"; the unique index
    // ensures it at the DB level. Both promises must settle WITHOUT a
    // duplicate-key crash — if either one rejects with pg 23505, that is
    // the bug this gate catches.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM user_identities WHERE lower(email) = lower($1)`,
      [RACE_A_EMAIL],
    );
    expect(rows).toHaveLength(1);

    // Neither promise should reject. If both are fulfilled, they MUST
    // agree on the identity id — otherwise we'd have two different
    // authoritative answers for "who is this email".
    for (const r of results) {
      if (r.status === "rejected") {
        const err = r.reason as { code?: string; message?: string };
        throw new Error(
          `Gate 61 FAIL — race A: insertIdentity rejected with ${
            err.code ?? "unknown"
          }: ${err.message ?? String(err)}. ` +
            `The service-layer accept() path has no handler for this — ` +
            `it surfaces as a 500 to the client. Make insertIdentity idempotent ` +
            `via ON CONFLICT (lower(email)).`,
        );
      }
    }
    const ids = (results as PromiseFulfilledResult<{ id: string }>[]).map(
      (r) => r.value.id,
    );
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(rows[0]!.id);
  });

  /**
   * Race B — two concurrent `acceptInvitationTx` calls for the same
   * invitation after the identity already exists.
   *
   * This is the earlier-this-session bug regression. The fix (ON CONFLICT
   * on users / memberships / user_roles) is supposed to make the tx
   * idempotent. We race two concurrent tx calls on the same identity +
   * same invitation and assert final state converges to a single row set.
   */
  it("race B — concurrent acceptInvitationTx converges to one user / membership / role", async () => {
    // Seed: pre-existing identity (the happy-path "link" branch).
    const identity = await insertIdentity(pool, {
      email: RACE_B_EMAIL,
      passwordHash:
        "$2b$10$BBBBBBBBBBBBBBBBBBBBBuYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY", // dummy
    });

    // Seed: pending invitation for this email in DEV_ORG.
    const { invitationId } = await seedInvitation(pool, RACE_B_EMAIL);

    // Race the transactional half of the accept flow. Each call opens
    // its own pool connection, sets the org GUC, and runs the 4-statement
    // tx. Under READ COMMITTED the two txs can interleave freely; the ON
    // CONFLICT clauses are what keep them safe.
    const runOne = async (label: string): Promise<string> => {
      return withOrg(pool, DEV_ORG_ID, async (client) => {
        const { userId } = await acceptInvitationTx(client, {
          invitationId,
          orgId: DEV_ORG_ID,
          identityId: identity.id,
          email: RACE_B_EMAIL,
          name: `Race B ${label}`,
          roleId: TEST_ROLE_ID as "MANAGEMENT",
        });
        return userId;
      });
    };

    const results = await Promise.allSettled([runOne("X"), runOne("Y")]);

    // Both must resolve. A rejection here means a unique-violation
    // slipped past the ON CONFLICT clauses — that is the exact bug
    // fixed at the top of this session's repository patch.
    for (const r of results) {
      if (r.status === "rejected") {
        const err = r.reason as { code?: string; message?: string };
        throw new Error(
          `Gate 61 FAIL — race B: acceptInvitationTx rejected with ${
            err.code ?? "unknown"
          }: ${err.message ?? String(err)}. ` +
            `Check repository.ts: the INSERT INTO users / memberships / ` +
            `user_roles must all carry ON CONFLICT clauses covering the race.`,
        );
      }
    }
    const userIds = (results as PromiseFulfilledResult<string>[]).map(
      (r) => r.value,
    );
    // The two races might agree on the same user id (one INSERT, one
    // UPDATE returning the existing row) or might differ only if the
    // second somehow created a second row — the assertion below rules
    // that out at the table level.
    expect(new Set(userIds).size).toBeGreaterThanOrEqual(1);

    // Table invariants — the real proof. These tables (users, memberships,
    // user_roles, user_invitations) all have FORCE ROW LEVEL SECURITY on
    // ops/sql/rls/*.sql, so we MUST assert through withOrg() to bind the
    // app.current_org GUC — a bare pool.query() would return zero rows and
    // the test would look like it passed for the wrong reason.
    const tableCounts = await withOrg(
      pool,
      DEV_ORG_ID,
      async (client) => {
        const users = await client.query<{ id: string }>(
          `SELECT id FROM users
            WHERE org_id = $1 AND lower(email) = lower($2)`,
          [DEV_ORG_ID, RACE_B_EMAIL],
        );
        const mems = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM memberships
            WHERE org_id = $1 AND identity_id = $2`,
          [DEV_ORG_ID, identity.id],
        );
        const roles = users.rows[0]
          ? await client.query<{ role_id: string }>(
              `SELECT role_id FROM user_roles WHERE user_id = $1`,
              [users.rows[0].id],
            )
          : { rows: [] as Array<{ role_id: string }> };
        const inv = await client.query<{ accepted_at: Date | null }>(
          `SELECT accepted_at FROM user_invitations WHERE id = $1`,
          [invitationId],
        );
        return {
          users: users.rows,
          memberships: mems.rows,
          roles: roles.rows,
          invitation: inv.rows,
        };
      },
    );

    expect(tableCounts.users).toHaveLength(1);
    expect(tableCounts.memberships).toHaveLength(1);
    expect(tableCounts.memberships[0]!.status).toBe("ACTIVE");
    expect(tableCounts.roles).toHaveLength(1);
    expect(tableCounts.roles[0]!.role_id).toBe(TEST_ROLE_ID);

    // The last tx to commit stamps accepted_at — the predicate
    // `accepted_at IS NULL` in the UPDATE inside acceptInvitationTx keeps
    // the second transaction from double-stamping. Either way, it MUST
    // be set by end-of-race.
    expect(tableCounts.invitation).toHaveLength(1);
    expect(tableCounts.invitation[0]!.accepted_at).not.toBeNull();
  });
});
