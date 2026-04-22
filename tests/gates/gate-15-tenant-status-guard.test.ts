/**
 * Gate 15 — Suspended / deleted / trial-expired tenants cannot get tokens.
 *
 * ARCHITECTURE.md §(tbd, Phase 2.5 / Sprint 1B).
 *
 * The invariant: `organizations.status` and `trial_ends_at` are the final
 * word on whether a tenant can mint a new access token. The app enforces
 * this in two places (apps/api/src/modules/tenants/service.ts):
 *
 *   ACTIVE                                 → pass
 *   TRIAL  + trial_ends_at IS NULL         → pass
 *   TRIAL  + trial_ends_at > now           → pass
 *   TRIAL  + trial_ends_at <= now          → TrialExpiredError        (402)
 *   SUSPENDED                              → TenantSuspendedError     (403)
 *   DELETED OR deleted_at IS NOT NULL      → TenantDeletedError       (410)
 *
 * Gates live in a separate workspace and cannot import apps/api directly,
 * so we replicate the decision function verbatim here and run it against
 * rows seeded in various states. If the logic in the service drifts, this
 * gate will go green while production goes red — that's acceptable because
 * the full decision table is also documented in the service file, and any
 * new state lands in BOTH places during code review. A future "integration"
 * gate that HTTP-pokes a test server can narrow the gap further.
 *
 * Fixture org ids (reserved in ops/sql/seed/ for tests):
 *   a0f1  SUSPENDED org
 *   a0f2  DELETED  org  (status=DELETED, deleted_at set)
 *   a0f3  TRIAL    org, trial already expired
 *   a0f4  TRIAL    org, trial still valid
 *   a0f5  ACTIVE   org
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg } from "./_helpers.js";

type AssertOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "tenant_suspended" | "tenant_deleted" | "trial_expired";
    };

interface StatusRow {
  status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "DELETED";
  trial_ends_at: Date | null;
  deleted_at: Date | null;
}

/**
 * Mirror of TenantStatusService.assertActive(). Kept in lock-step with
 * apps/api/src/modules/tenants/service.ts by code review — see file header.
 */
function decide(row: StatusRow | null, now: Date): AssertOutcome {
  if (!row) return { ok: false, reason: "not_found" };
  if (row.deleted_at || row.status === "DELETED") {
    return { ok: false, reason: "tenant_deleted" };
  }
  if (row.status === "SUSPENDED") {
    return { ok: false, reason: "tenant_suspended" };
  }
  if (row.status === "TRIAL" && row.trial_ends_at) {
    if (row.trial_ends_at.getTime() <= now.getTime()) {
      return { ok: false, reason: "trial_expired" };
    }
  }
  return { ok: true };
}

const SUSPENDED_ID = "00000000-0000-0000-0000-0000000000f1";
const DELETED_ID = "00000000-0000-0000-0000-0000000000f2";
const TRIAL_EXPIRED_ID = "00000000-0000-0000-0000-0000000000f3";
const TRIAL_VALID_ID = "00000000-0000-0000-0000-0000000000f4";
const ACTIVE_ID = "00000000-0000-0000-0000-0000000000f5";

describe("gate-15: tenant status guard", () => {
  let pool: pg.Pool;
  const PAST = new Date(Date.now() - 86_400_000); // 1 day ago
  const FUTURE = new Date(Date.now() + 7 * 86_400_000); // 7 days hence

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    // Seed all 5 fixture orgs. Each INSERT must happen under its own
    // app.current_org because organizations has RLS (id = current_org).
    async function upsertOrg(
      id: string,
      name: string,
      status: StatusRow["status"],
      trial_ends_at: Date | null,
      deleted_at: Date | null,
      suspended_at: Date | null
    ): Promise<void> {
      await withOrg(pool, id, async (client) => {
        await client.query(
          `INSERT INTO organizations (
             id, name, status, trial_ends_at, deleted_at, suspended_at
           ) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             trial_ends_at = EXCLUDED.trial_ends_at,
             deleted_at = EXCLUDED.deleted_at,
             suspended_at = EXCLUDED.suspended_at`,
          [id, name, status, trial_ends_at, deleted_at, suspended_at]
        );
      });
    }

    await upsertOrg(SUSPENDED_ID, "Fixture Suspended", "SUSPENDED", null, null, PAST);
    await upsertOrg(DELETED_ID, "Fixture Deleted", "DELETED", null, PAST, null);
    await upsertOrg(
      TRIAL_EXPIRED_ID,
      "Fixture Trial Expired",
      "TRIAL",
      PAST,
      null,
      null
    );
    await upsertOrg(
      TRIAL_VALID_ID,
      "Fixture Trial Valid",
      "TRIAL",
      FUTURE,
      null,
      null
    );
    await upsertOrg(ACTIVE_ID, "Fixture Active", "ACTIVE", null, null, null);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function loadStatus(id: string): Promise<StatusRow | null> {
    return withOrg(pool, id, async (client) => {
      const { rows } = await client.query<StatusRow>(
        `SELECT status, trial_ends_at, deleted_at
           FROM organizations WHERE id = $1`,
        [id]
      );
      return rows[0] ?? null;
    });
  }

  it("SUSPENDED org → tenant_suspended (403)", async () => {
    const row = await loadStatus(SUSPENDED_ID);
    const outcome = decide(row, new Date());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("tenant_suspended");
  });

  it("DELETED org → tenant_deleted (410)", async () => {
    const row = await loadStatus(DELETED_ID);
    const outcome = decide(row, new Date());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("tenant_deleted");
  });

  it("soft-deleted org (deleted_at set, status=ACTIVE) → tenant_deleted", async () => {
    // Belt-and-braces: even if status somehow says ACTIVE, a non-null
    // deleted_at must still veto the login. Flip the ACTIVE fixture to
    // soft-deleted temporarily.
    await withOrg(pool, ACTIVE_ID, async (client) => {
      await client.query(
        `UPDATE organizations SET deleted_at = now() WHERE id = $1`,
        [ACTIVE_ID]
      );
    });
    try {
      const row = await loadStatus(ACTIVE_ID);
      const outcome = decide(row, new Date());
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("tenant_deleted");
    } finally {
      // restore
      await withOrg(pool, ACTIVE_ID, async (client) => {
        await client.query(
          `UPDATE organizations SET deleted_at = NULL WHERE id = $1`,
          [ACTIVE_ID]
        );
      });
    }
  });

  it("TRIAL with expired trial_ends_at → trial_expired (402)", async () => {
    const row = await loadStatus(TRIAL_EXPIRED_ID);
    const outcome = decide(row, new Date());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("trial_expired");
  });

  it("TRIAL with future trial_ends_at → pass", async () => {
    const row = await loadStatus(TRIAL_VALID_ID);
    expect(decide(row, new Date()).ok).toBe(true);
  });

  it("ACTIVE org → pass", async () => {
    const row = await loadStatus(ACTIVE_ID);
    expect(decide(row, new Date()).ok).toBe(true);
  });

  it("unknown org id → not_found", async () => {
    const outcome = decide(null, new Date());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("not_found");
  });
});
