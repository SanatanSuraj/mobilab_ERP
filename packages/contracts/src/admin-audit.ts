/**
 * Admin audit dashboard contracts — ARCHITECTURE.md §4.2.
 *
 * The tenant-facing admin audit dashboard at /admin/audit reads rows
 * from `audit.log` (RLS-scoped via the existing tenant_isolation
 * policy). Filters are narrow and sharp on purpose — audit data grows
 * fast, and a query without a time window + at least one facet tends
 * to return 100k+ rows and lock the browser.
 *
 * The listQuery shape mirrors the /vendor-admin/audit pattern (see
 * vendor-admin.ts) but reads the *tenant's* audit.log, not the
 * `vendor_admin_actions` table. Different data, different permission
 * gate (`admin:audit:read`), different route surface.
 *
 * Observability: each response row carries an optional trace_id so the
 * UI can deep-link into Loki / Tempo for the full request waterfall —
 * satisfies the spec line "Admin audit dashboard: search by
 * user/entity/date-range, with trace_id deep-link to Loki/Tempo".
 */

import { z } from "zod";

/** Filter shape accepted by GET /admin/audit/entries. */
export const AdminAuditListQuerySchema = z
  .object({
    /** Table name, schema-qualified (e.g. "public.sales_invoices"). */
    tableName: z.string().trim().min(1).max(128).optional(),
    /** Audit action type. */
    action: z.enum(["INSERT", "UPDATE", "DELETE"]).optional(),
    /** UUID of the actor — matches audit.log.actor. */
    userId: z.string().uuid().optional(),
    /** Row-id of the audited entity. */
    rowId: z.string().uuid().optional(),
    /** Inclusive lower bound (ISO). Server coerces to timestamptz. */
    fromDate: z.string().datetime().optional(),
    /** Exclusive upper bound (ISO). */
    toDate: z.string().datetime().optional(),
    /** Full-text search across before/after jsonb. */
    q: z.string().trim().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type AdminAuditListQuery = z.infer<typeof AdminAuditListQuerySchema>;

/** One row returned to the dashboard. */
export const AdminAuditEntrySchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  tableName: z.string(),
  rowId: z.string().uuid().nullable(),
  action: z.enum(["INSERT", "UPDATE", "DELETE"]),
  actorId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable(),
  actorName: z.string().nullable(),
  /** W3C trace-parent id if the request carried one; null on pre-§4.2 rows. */
  traceId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  changedAt: z.string(),
});

export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

export const AdminAuditListResponseSchema = z.object({
  items: z.array(AdminAuditEntrySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type AdminAuditListResponse = z.infer<
  typeof AdminAuditListResponseSchema
>;
