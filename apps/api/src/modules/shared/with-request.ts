/**
 * Per-request DB wrapper: set three request-scoped GUCs so the
 * transaction picks them up in RLS policies, triggers, and any SELECT
 * that reads current_setting().
 *
 *   app.current_org        → RLS tenant binding (ops/sql/rls/*.sql)
 *   app.current_user       → audit actor (ops/sql/triggers/03-audit.sql)
 *   app.current_trace_id   → admin-audit dashboard trace deep-link
 *                            (ops/sql/init/19-phase4-audit-trace-id.sql)
 *
 * Every mutating route handler inside a module should run inside this
 * wrapper. Read-only handlers can skip setting app.current_user but still
 * need the org GUC — withOrg() from @instigenie/db covers that case.
 *
 * ARCHITECTURE.md §9.2 (RLS) + §11 (audit actor) + §4.2 (trace_id).
 */

import type { FastifyRequest } from "fastify";
import type { PoolClient, Pool } from "pg";
import { withOrg } from "@instigenie/db";
import { requireUser } from "../../context/request-context.js";

/**
 * Pick the best trace-id we can hand to Postgres:
 *   1. Incoming W3C traceparent header (first hex segment after the
 *      "version-").
 *   2. x-request-id / x-correlation-id set by an upstream proxy.
 *   3. Fastify's auto-generated req.id (fallback).
 *
 * The Postgres column is `text`, so we don't enforce a strict format —
 * whatever we pass here is what the admin audit dashboard deep-links
 * into Loki/Tempo. When real OTel instrumentation arrives, this
 * function swaps to `trace.getActiveSpan()?.spanContext().traceId`
 * with no schema churn.
 */
function resolveTraceId(req: FastifyRequest): string | null {
  // Gate tests (gate-26, gate-43) construct a minimal request stub with
  // only `{ user }` so headers / req.id may be absent. Guard every access
  // — the GUC is optional and a null trace_id is a valid state.
  const headers = req.headers ?? {};
  const tp = headers["traceparent"];
  if (typeof tp === "string") {
    // traceparent format: "<version>-<trace-id>-<parent-id>-<flags>".
    const parts = tp.split("-");
    if (parts.length >= 2 && parts[1] && /^[0-9a-f]{32}$/i.test(parts[1])) {
      return parts[1];
    }
  }
  const xReq = headers["x-request-id"] ?? headers["x-correlation-id"];
  if (typeof xReq === "string" && xReq.length > 0 && xReq.length <= 128) {
    return xReq;
  }
  return req.id ?? null;
}

export async function withRequest<T>(
  req: FastifyRequest,
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const user = requireUser(req);
  const traceId = resolveTraceId(req);
  return withOrg(pool, user.orgId, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      user.id,
    ]);
    if (traceId) {
      await client.query(
        `SELECT set_config('app.current_trace_id', $1, true)`,
        [traceId],
      );
    }
    return fn(client);
  });
}
