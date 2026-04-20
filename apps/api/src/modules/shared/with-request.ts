/**
 * Per-request DB wrapper: set both `app.current_org` (used by RLS) and
 * `app.current_user` (used by the audit trigger in ops/sql/triggers/03-audit.sql).
 *
 * Every mutating route handler inside a module should run inside this
 * wrapper. Read-only handlers can skip setting app.current_user but still
 * need the org GUC — withOrg() from @mobilab/db covers that case.
 *
 * ARCHITECTURE.md §9.2 (RLS) + §11 (audit actor).
 */

import type { FastifyRequest } from "fastify";
import type { PoolClient, Pool } from "pg";
import { withOrg } from "@mobilab/db";
import { requireUser } from "../../context/request-context.js";

export async function withRequest<T>(
  req: FastifyRequest,
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const user = requireUser(req);
  return withOrg(pool, user.orgId, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      user.id,
    ]);
    return fn(client);
  });
}
