/**
 * Admin audit repository — ARCHITECTURE.md §4.2.
 *
 * Reads tenant-scoped rows from `audit.log` for the admin dashboard.
 * Joins to `users` to materialise actor email/name so the UI doesn't
 * have to fan out with a second round-trip. Every query path here runs
 * inside `withRequest()`, so RLS is enforced by the tenant_isolation
 * policy in ops/sql/rls/15-audit-log-rls.sql.
 *
 * The before/after jsonb payload is returned verbatim: it frequently
 * contains nested structures the UI renders with a JSON tree widget.
 * We DO cap the response at `limit` rows (default 50, max 500) to keep
 * serialisation costs bounded even for high-volume tenants.
 */

import type { PoolClient } from "pg";
import type {
  AdminAuditEntry,
  AdminAuditListQuery,
} from "@instigenie/contracts";

interface AuditLogRow {
  id: string;
  org_id: string;
  table_name: string;
  row_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor: string | null;
  actor_email: string | null;
  actor_first_name: string | null;
  actor_last_name: string | null;
  trace_id: string | null;
  before: unknown;
  after: unknown;
  changed_at: Date;
}

export interface AdminAuditListResult {
  items: AdminAuditEntry[];
  total: number;
}

/**
 * Build a WHERE fragment + param list from the dashboard filter. Each
 * predicate is AND-joined; omitted filters contribute nothing.
 */
function buildPredicates(
  query: AdminAuditListQuery,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const push = (clause: (idx: number) => string, value: unknown): void => {
    params.push(value);
    clauses.push(clause(params.length));
  };
  if (query.tableName) push((i) => `al.table_name = $${i}`, query.tableName);
  if (query.action) push((i) => `al.action = $${i}`, query.action);
  if (query.userId) push((i) => `al.actor = $${i}`, query.userId);
  if (query.rowId) push((i) => `al.row_id = $${i}`, query.rowId);
  if (query.fromDate) push((i) => `al.changed_at >= $${i}`, query.fromDate);
  if (query.toDate) push((i) => `al.changed_at < $${i}`, query.toDate);
  if (query.q) {
    // jsonb text-match fallback. before/after can be NULL on INSERT /
    // DELETE respectively, so COALESCE to an empty jsonb object keeps
    // the ILIKE target well-defined.
    push(
      (i) =>
        `(COALESCE(al.before::text, '') ILIKE $${i}
          OR COALESCE(al.after::text, '') ILIKE $${i})`,
      `%${query.q}%`,
    );
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function listAuditEntries(
  client: PoolClient,
  query: AdminAuditListQuery,
): Promise<AdminAuditListResult> {
  const { sql: where, params } = buildPredicates(query);

  // We issue two queries in parallel — count + page — to preserve
  // classical pagination semantics without the dubious window-function
  // tricks. The dashboard never leaves the limit/offset default unless
  // a user explicitly requests it.
  const countParamCount = params.length;
  const pageParams = [...params, query.limit, query.offset];

  const [countRes, rowsRes] = await Promise.all([
    client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM audit.log al ${where}`,
      params,
    ),
    client.query<AuditLogRow>(
      `SELECT al.id, al.org_id, al.table_name, al.row_id, al.action,
              al.actor, al.trace_id, al.before, al.after, al.changed_at,
              u.email AS actor_email,
              u.first_name AS actor_first_name,
              u.last_name AS actor_last_name
         FROM audit.log al
         LEFT JOIN users u ON u.id = al.actor
         ${where}
         ORDER BY al.changed_at DESC, al.id DESC
         LIMIT $${countParamCount + 1} OFFSET $${countParamCount + 2}`,
      pageParams,
    ),
  ]);

  return {
    total: Number(countRes.rows[0]?.total ?? "0"),
    items: rowsRes.rows.map<AdminAuditEntry>((r) => ({
      id: r.id,
      orgId: r.org_id,
      tableName: r.table_name,
      rowId: r.row_id,
      action: r.action,
      actorId: r.actor,
      actorEmail: r.actor_email,
      actorName:
        r.actor_first_name || r.actor_last_name
          ? `${r.actor_first_name ?? ""} ${r.actor_last_name ?? ""}`.trim()
          : null,
      traceId: r.trace_id,
      before: r.before ?? null,
      after: r.after ?? null,
      changedAt: r.changed_at.toISOString(),
    })),
  };
}
