/**
 * Portal session helper. ARCHITECTURE.md §3.7 / §9.2.
 *
 * Companion to withOrg + withRequest. A portal request binds three GUCs
 * inside a single transaction so that RLS (tenant + portal-customer) and
 * the audit trigger all see a complete picture:
 *
 *   app.current_org              → tenant scope (existing policies)
 *   app.current_user             → audit actor (audit.tg_log reads this)
 *   app.current_portal_customer  → restrictive RLS predicate added in
 *                                  ops/sql/rls/13-portal-rls.sql
 *
 * When the predicate in 13-portal-rls.sql sees a non-empty
 * `app.current_portal_customer`, it requires the row's account_id /
 * customer_id to match. When the GUC is unset (every internal path) the
 * predicate short-circuits to TRUE, so this wrapper is the ONLY place in
 * the codebase that narrows portal visibility — we can audit its call
 * sites to reason about data exposure.
 *
 * Rules:
 *   1. Call inside a handler that has already been through guardPortal —
 *      userId, orgId, customerId must all be validated upstream.
 *   2. Pass the customerId that was recorded on the portal login pivot
 *      row. Never take it from the request body.
 *   3. All three arguments are validated as UUIDs here — mismatch throws
 *      ValidationError before any SQL runs.
 *   4. GUCs are SET LOCAL so a rollback or release drops them cleanly.
 *      A second withPortalUser on the same pool does NOT leak.
 */

import type { Pool, PoolClient } from "pg";
import { ValidationError } from "@instigenie/errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withPortalUser<T>(
  pool: Pool,
  args: { orgId: string; userId: string; customerId: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!args.orgId || !UUID_RE.test(args.orgId)) {
    throw new ValidationError(`withPortalUser: invalid orgId "${args.orgId}"`);
  }
  if (!args.userId || !UUID_RE.test(args.userId)) {
    throw new ValidationError(`withPortalUser: invalid userId "${args.userId}"`);
  }
  if (!args.customerId || !UUID_RE.test(args.customerId)) {
    throw new ValidationError(
      `withPortalUser: invalid customerId "${args.customerId}"`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org', $1, true)", [
      args.orgId,
    ]);
    await client.query("SELECT set_config('app.current_user', $1, true)", [
      args.userId,
    ]);
    await client.query(
      "SELECT set_config('app.current_portal_customer', $1, true)",
      [args.customerId],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // swallow — original error is more important
    }
    throw err;
  } finally {
    client.release();
  }
}
