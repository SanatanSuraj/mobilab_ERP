/**
 * Standard pagination contract. ARCHITECTURE.md §12.2 Deliverables.
 *
 * Every list endpoint accepts `page`, `limit`, `sortBy`, `sortDir` query
 * params and returns `{ data, meta }`. Limit is hard-capped at 100 on both
 * sides so a rogue client can't OOM the API.
 *
 * Gate 10 (tests/gates/gate-10-pagination.test.ts) fuzzes the limits.
 */

import { z } from "zod";

export const PAGE_LIMIT_MAX = 100;
export const PAGE_LIMIT_DEFAULT = 25;

/**
 * Query-string shape for a paginated list. Use `.extend({...})` on a
 * module's route to add filters.
 *
 *   const LeadListQuery = PaginationQuerySchema.extend({
 *     status: LeadStatusSchema.optional(),
 *     search: z.string().trim().min(1).optional(),
 *   });
 *
 * Notes on coercion:
 *   - `page` and `limit` are coerced because they arrive from the query
 *     string as strings. `.coerce.number()` is the Zod idiom for that.
 *   - `limit` is clamped to [1, PAGE_LIMIT_MAX]. A request for limit=9999
 *     does NOT fail — it silently caps. The frontend sees meta.limit=100
 *     and can do the right thing.
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_LIMIT_MAX)
    .catch(PAGE_LIMIT_DEFAULT)
    .default(PAGE_LIMIT_DEFAULT),
  sortBy: z.string().trim().min(1).max(64).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Normalized pagination (post-parse, post-clamp). Services receive this.
 * Keep the shape parallel to PaginationQuerySchema to avoid surprises.
 */
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortDir: "asc" | "desc";
}

/**
 * Clamp-and-bound a parsed PaginationQuery to safe values. Returns a
 * PaginationParams the repository layer can trust.
 */
export function normalizePagination(q: PaginationQuery): PaginationParams {
  const limit = Math.min(Math.max(q.limit, 1), PAGE_LIMIT_MAX);
  const page = Math.max(q.page, 1);
  return {
    page,
    limit,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
  };
}

/** `meta` block returned alongside `data` in every list response. */
export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(PAGE_LIMIT_MAX),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** Build a list response envelope. */
export function paginated<T>(
  data: T[],
  params: Pick<PaginationParams, "page" | "limit">,
  total: number
): { data: T[]; meta: PaginationMeta } {
  return {
    data,
    meta: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  };
}

/** Generic list-response Zod schema factory — useful for client-side decoding. */
export function listResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: PaginationMetaSchema,
  });
}
