/**
 * Typed client for /admin/audit/* — Phase 4 §4.2.
 *
 * Reads the tenant's audit.log via the real apps/api surface. Uses the
 * shared tenantFetch auth plumbing (bearer + X-Org-Id + refresh-once).
 * Wire shapes come from @instigenie/contracts so the UI never drifts
 * from the Zod schemas the Fastify route parses.
 */

import type {
  AdminAuditListQuery,
  AdminAuditListResponse,
} from "@instigenie/contracts";
import { tenantGet } from "./tenant-fetch";

/**
 * GET /admin/audit/entries — filtered page of audit.log rows.
 *
 * Every filter is optional; omitting all of them returns the
 * most-recent `limit` rows for the tenant. The dashboard UI always
 * sends at least a time window to keep results bounded.
 */
export async function listAdminAuditEntries(
  query: Partial<AdminAuditListQuery> = {},
): Promise<AdminAuditListResponse> {
  const params = new URLSearchParams();
  if (query.tableName) params.set("tableName", query.tableName);
  if (query.action) params.set("action", query.action);
  if (query.userId) params.set("userId", query.userId);
  if (query.rowId) params.set("rowId", query.rowId);
  if (query.fromDate) params.set("fromDate", query.fromDate);
  if (query.toDate) params.set("toDate", query.toDate);
  if (query.q) params.set("q", query.q);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const qs = params.toString();
  return tenantGet<AdminAuditListResponse>(
    `/admin/audit/entries${qs ? `?${qs}` : ""}`,
  );
}
