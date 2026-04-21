/**
 * Typed wrappers for the real /notifications/* surface exposed by apps/api.
 *
 * Pattern-matches lib/api/finance.ts: every function routes through
 * tenantFetch (Bearer + X-Org-Id + silent refresh), uses the real contract
 * types from @mobilab/contracts, and returns the shared PaginatedResponse
 * envelope for list endpoints.
 *
 * Surface (Phase 2 — §13.7):
 *   - Inbox feed (own)      (GET /notifications, /notifications/:id)
 *   - Unread count (bell)   (GET /notifications/unread-count)
 *   - Bulk mark-read        (POST /notifications/mark-read,
 *                            POST /notifications/mark-all-read)
 *   - Soft-delete own       (DELETE /notifications/:id)
 *   - Admin cross-user feed (GET /notifications/all)
 *   - Admin dispatch        (POST /notifications)
 *   - Templates CRUD        (GET/POST/PATCH/DELETE /notifications/templates/…)
 *
 * Phase 3 will wire the event bus to dispatch via templates; the
 * `apiCreateNotification` call here is an ad-hoc dispatcher for ops /
 * internal workflow emitters.
 */

import type {
  CreateNotification,
  CreateNotificationTemplate,
  Notification,
  NotificationChannel,
  NotificationSeverity,
  NotificationTemplate,
  NotificationUnreadCount,
  UpdateNotificationTemplate,
} from "@mobilab/contracts";

import type { PaginatedResponse, PaginationParams } from "./crm";
import {
  tenantDelete,
  tenantGet,
  tenantPatch,
  tenantPost,
} from "./tenant-fetch";

// Re-export shared envelope types so notifications callers don't need to
// import from ./crm directly.
export type { PaginatedResponse, PaginationParams } from "./crm";

function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// ─── Inbox: own feed ─────────────────────────────────────────────────────────

/**
 * Client-side query shape. Mirrors the server's NotificationListQuery but
 * makes every field optional — Zod's `.default()` on page/limit/sortDir
 * inflates those to "required" on the inferred type, which we don't want
 * for callers that only care about a couple of filters.
 */
export interface NotificationListQuery extends PaginationParams {
  isRead?: boolean;
  severity?: NotificationSeverity;
  eventType?: string;
  referenceType?: string;
  referenceId?: string;
  /** ISO-8601 datetime inclusive lower bound. */
  from?: string;
  /** ISO-8601 datetime inclusive upper bound. */
  to?: string;
  search?: string;
}

/** User-scoped inbox. Server always filters to the authenticated user. */
export async function apiListNotifications(
  q: NotificationListQuery = {},
): Promise<PaginatedResponse<Notification>> {
  return tenantGet(`/notifications${qs(q)}`);
}

/**
 * Header-bell aggregate (`total` + `bySeverity`). Cheap — served from a
 * partial index on `(user_id, created_at DESC) WHERE is_read = false`.
 */
export async function apiGetUnreadCount(): Promise<NotificationUnreadCount> {
  return tenantGet(`/notifications/unread-count`);
}

/**
 * Read one notification. Server returns 404 for cross-user reads unless the
 * caller holds `notifications:admin_read`.
 */
export async function apiGetNotification(id: string): Promise<Notification> {
  return tenantGet(`/notifications/${id}`);
}

/**
 * Flip a batch of notifications to read. Ownership-scoped server-side —
 * cross-user IDs silently no-op. Returns the number of rows updated.
 */
export async function apiMarkNotificationsRead(
  ids: string[],
): Promise<{ updated: number }> {
  return tenantPost(`/notifications/mark-read`, { ids });
}

/** Flip every unread inbox row for the current user to read. */
export async function apiMarkAllNotificationsRead(): Promise<{
  updated: number;
}> {
  return tenantPost(`/notifications/mark-all-read`, {});
}

/** Soft-delete one inbox row. Ownership-scoped; 403 on cross-user delete. */
export async function apiDeleteNotification(id: string): Promise<void> {
  return tenantDelete(`/notifications/${id}`);
}

// ─── Admin: cross-user feed + dispatch ───────────────────────────────────────

export interface AdminNotificationListQuery extends PaginationParams {
  userId?: string;
  isRead?: boolean;
  severity?: NotificationSeverity;
  eventType?: string;
  referenceType?: string;
  referenceId?: string;
  /** ISO-8601 datetime inclusive lower bound. */
  from?: string;
  /** ISO-8601 datetime inclusive upper bound. */
  to?: string;
  search?: string;
}

/**
 * Cross-user inbox. Requires `notifications:admin_read`. Accepts an optional
 * `userId` filter to drill into one user's feed.
 */
export async function apiListAllNotifications(
  q: AdminNotificationListQuery = {},
): Promise<PaginatedResponse<Notification>> {
  return tenantGet(`/notifications/all${qs(q)}`);
}

/**
 * Emit a notification to a specific user. Requires `notifications:dispatch`.
 * Phase 3 will wire the event bus as the primary caller.
 */
export async function apiCreateNotification(
  body: CreateNotification,
): Promise<Notification> {
  return tenantPost(`/notifications`, body);
}

// ─── Notification Templates ──────────────────────────────────────────────────

export interface NotificationTemplateListParams extends PaginationParams {
  eventType?: string;
  channel?: NotificationChannel;
  isActive?: boolean;
  search?: string;
}

export async function apiListNotificationTemplates(
  q: NotificationTemplateListParams = {},
): Promise<PaginatedResponse<NotificationTemplate>> {
  return tenantGet(`/notifications/templates${qs(q)}`);
}

export async function apiGetNotificationTemplate(
  id: string,
): Promise<NotificationTemplate> {
  return tenantGet(`/notifications/templates/${id}`);
}

export async function apiCreateNotificationTemplate(
  body: CreateNotificationTemplate,
): Promise<NotificationTemplate> {
  return tenantPost(`/notifications/templates`, body);
}

/**
 * Header update. Pass `expectedVersion` for optimistic concurrency; service
 * 409s on mismatch so the caller can refetch + merge.
 */
export async function apiUpdateNotificationTemplate(
  id: string,
  body: UpdateNotificationTemplate,
): Promise<NotificationTemplate> {
  return tenantPatch(`/notifications/templates/${id}`, body);
}

export async function apiDeleteNotificationTemplate(id: string): Promise<void> {
  return tenantDelete(`/notifications/templates/${id}`);
}

