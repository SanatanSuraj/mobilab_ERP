/**
 * TenantStatusService — the single gate between an authenticated user and
 * the rest of the app.
 *
 * Called from TWO places, both on every authenticated interaction:
 *   1. AuthService.login / refresh / selectTenant   (token issuance gate)
 *   2. AuthGuard                                    (per-request gate)
 *
 * Why both? (1) stops bad tokens from being minted; (2) catches already-
 * minted tokens for a tenant that was suspended after login. Without (2)
 * a suspended tenant retains read/write for up to one access-token TTL.
 *
 * Decision table (organizations.status × trial_ends_at):
 *   ACTIVE                                 → pass
 *   TRIAL    + trial_ends_at IS NULL       → pass  (treat as "just signed up")
 *   TRIAL    + trial_ends_at > now         → pass
 *   TRIAL    + trial_ends_at <= now        → TrialExpiredError  (402)
 *   SUSPENDED                              → TenantSuspendedError  (403)
 *   DELETED  OR  deleted_at IS NOT NULL    → TenantDeletedError  (410)
 *
 * One indexed PK lookup per call. No cache yet — add a 10s LRU in front
 * when real load demands it. The query itself is <1ms on pg with a PK
 * equality predicate.
 */

import type pg from "pg";
import { withOrg } from "@instigenie/db";
import {
  TenantDeletedError,
  TenantSuspendedError,
  TrialExpiredError,
  NotFoundError,
} from "@instigenie/errors";
import type { TenantStatus } from "@instigenie/contracts";

export interface TenantStatusServiceDeps {
  pool: pg.Pool;
}

interface TenantStatusRow {
  id: string;
  status: TenantStatus;
  trial_ends_at: Date | null;
  suspended_at: Date | null;
  suspended_reason: string | null;
  deleted_at: Date | null;
}

export class TenantStatusService {
  constructor(private readonly deps: TenantStatusServiceDeps) {}

  /**
   * Load the current lifecycle snapshot of a tenant. Returns null if the
   * row doesn't exist at all (caller decides whether that's 404 or
   * unauthorized — usually unauthorized, since the orgId came from a JWT
   * claim the user controlled).
   *
   * `organizations` has an RLS policy `id = app.current_org`, so we must
   * run under withOrg(orgId). A malicious actor who guesses a foreign
   * orgId still gets zero rows because they can't set app.current_org to
   * that value without passing auth — the JWT claim IS the orgId we're
   * about to look up, which closes the loop.
   */
  async getStatus(orgId: string): Promise<TenantStatusRow | null> {
    return withOrg(this.deps.pool, orgId, async (client) => {
      const { rows } = await client.query<TenantStatusRow>(
        `SELECT o.id, o.status, o.trial_ends_at, o.suspended_at,
                o.suspended_reason, o.deleted_at
           FROM organizations o
          WHERE o.id = $1`,
        [orgId]
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Throws the appropriate error if the tenant is not in a state that
   * permits access. Returns the row on success so callers can pass along
   * things like `trial_ends_at` to the client without a second query.
   */
  async assertActive(orgId: string): Promise<TenantStatusRow> {
    const row = await this.getStatus(orgId);
    if (!row) {
      // An orgId from a JWT that isn't in the DB at all: treat as 404. We
      // don't leak "tenant existed then was hard-deleted" vs "never existed"
      // because both should force re-auth.
      throw new NotFoundError("tenant not found", { orgId });
    }

    if (row.deleted_at || row.status === "DELETED") {
      throw new TenantDeletedError("tenant has been deleted", { orgId });
    }

    if (row.status === "SUSPENDED") {
      throw new TenantSuspendedError("tenant is suspended", {
        orgId,
        suspendedAt: row.suspended_at,
        reason: row.suspended_reason,
      });
    }

    if (row.status === "TRIAL" && row.trial_ends_at) {
      if (row.trial_ends_at.getTime() <= Date.now()) {
        throw new TrialExpiredError("trial has expired", {
          orgId,
          trialEndedAt: row.trial_ends_at,
        });
      }
    }

    return row;
  }
}
