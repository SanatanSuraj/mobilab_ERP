/**
 * Tenant-scoping helper. ARCHITECTURE.md §4 / §9.2.
 *
 * Postgres RLS policies consult `current_setting('app.current_org', true)`
 * to filter rows to a single tenant. `withOrg(pool, orgId, fn)` wraps a
 * callback in a transaction and sets that GUC for its lifetime.
 *
 * Rules (enforced in tests, Gate 5):
 *   1. Every request handler that touches a tenant-scoped table MUST use
 *      withOrg — never a bare pool.query.
 *   2. The GUC is set LOCAL so it auto-clears at transaction end, even
 *      on error.
 *   3. If orgId is empty/invalid, throw — never run the callback with
 *      no org set (that would return nothing under RLS, not error, and
 *      would mask bugs).
 */

import type { PoolClient, Pool } from "pg";
import { ValidationError } from "@instigenie/errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withOrg<T>(
  pool: Pool,
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!orgId || !UUID_RE.test(orgId)) {
    throw new ValidationError(`withOrg: invalid orgId "${orgId}"`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config(name, value, is_local) — is_local=true scopes to txn.
    await client.query("SELECT set_config('app.current_org', $1, true)", [
      orgId,
    ]);
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
