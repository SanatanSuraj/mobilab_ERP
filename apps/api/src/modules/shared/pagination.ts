/**
 * Request → SQL glue for pagination. ARCHITECTURE.md §12.2 Deliverables.
 *
 * The zod schema in @mobilab/contracts parses the query string; this file
 * adapts the normalized PaginationParams to `ORDER BY ... LIMIT ... OFFSET`
 * and whitelists the sort column to prevent SQL injection.
 *
 * Repository code should call `applyPagination(base, params, allowedSorts)`
 * with a parameterized text-SQL fragment and get back `{sql, params}` to
 * splice in.
 *
 * Gate 10 verifies that limit=9999 returns at most 100 rows.
 */

import { normalizePagination, type PaginationQuery } from "@mobilab/contracts";

export interface SortSpec {
  /** Column name as emitted in SQL. Must match the ORDER BY whitelist. */
  column: string;
  /** Default direction if the query didn't specify one. */
  defaultDir?: "asc" | "desc";
}

export interface PaginationPlan {
  page: number;
  limit: number;
  offset: number;
  orderBy: string; // pre-formatted `col asc|desc`
}

/**
 * Turn a parsed PaginationQuery + allowlist into an offset/limit plan.
 *
 * `allowed` maps a public-facing sort key (e.g. "createdAt") to a SQL column
 * name (e.g. "created_at"). A request with sortBy not in the map falls back
 * to the first entry — we don't 400 on it, because that's more annoying
 * than useful in practice.
 */
export function planPagination(
  query: PaginationQuery,
  allowed: Record<string, string>,
  fallbackKey: keyof typeof allowed & string
): PaginationPlan {
  const params = normalizePagination(query);
  const sortKey =
    params.sortBy && allowed[params.sortBy] ? params.sortBy : fallbackKey;
  const sortCol = allowed[sortKey];
  const dir = params.sortDir === "asc" ? "asc" : "desc";
  return {
    page: params.page,
    limit: params.limit,
    offset: (params.page - 1) * params.limit,
    orderBy: `${sortCol} ${dir}`,
  };
}
