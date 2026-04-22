/**
 * Real-API React Query hooks for the Notifications module.
 *
 * Mirrors useFinanceApi — namespaced query keys (`["notifications-api", …]`),
 * paginated list queries with `placeholderData: (prev) => prev` for stable
 * filter UX, and aggressive cross-cache invalidation so the header bell
 * stays accurate after any write.
 *
 * Cross-cache fan-out rules:
 *   - markRead / markAllRead / delete / receive new notification  →
 *       invalidate BOTH `inbox.all` AND `unreadCount` (the bell).
 *   - admin dispatch (create)                                     →
 *       invalidate `inbox.all` + `unreadCount` + `adminList.all`.
 *   - template CRUD                                               →
 *       invalidate only `templates.all` (does not affect inbox).
 *
 * Money/rendering is not a concern here — these hooks pass DTOs through
 * verbatim.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  // Inbox
  apiListNotifications,
  apiGetNotification,
  apiGetUnreadCount,
  apiMarkNotificationsRead,
  apiMarkAllNotificationsRead,
  apiDeleteNotification,
  // Admin
  apiListAllNotifications,
  apiCreateNotification,
  // Templates
  apiListNotificationTemplates,
  apiGetNotificationTemplate,
  apiCreateNotificationTemplate,
  apiUpdateNotificationTemplate,
  apiDeleteNotificationTemplate,
  type AdminNotificationListQuery,
  type NotificationListQuery,
  type NotificationTemplateListParams,
} from "@/lib/api/notifications";

import type {
  CreateNotification,
  CreateNotificationTemplate,
  Notification,
  NotificationTemplate,
  NotificationUnreadCount,
  UpdateNotificationTemplate,
} from "@instigenie/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────
//
// Namespaced under `["notifications-api", …]`. Every entity exposes at
// minimum `all | list(q) | detail(id)`.  `unreadCount` is a top-level key
// because it has no parameters — every write surface that touches read-state
// invalidates it directly.

export const notificationsApiKeys = {
  all: ["notifications-api"] as const,
  unreadCount: ["notifications-api", "unreadCount"] as const,
  inbox: {
    all: ["notifications-api", "inbox"] as const,
    list: (q: NotificationListQuery) =>
      ["notifications-api", "inbox", "list", q] as const,
    detail: (id: string) =>
      ["notifications-api", "inbox", "detail", id] as const,
  },
  adminList: {
    all: ["notifications-api", "adminList"] as const,
    list: (q: AdminNotificationListQuery) =>
      ["notifications-api", "adminList", "list", q] as const,
  },
  templates: {
    all: ["notifications-api", "templates"] as const,
    list: (q: NotificationTemplateListParams) =>
      ["notifications-api", "templates", "list", q] as const,
    detail: (id: string) =>
      ["notifications-api", "templates", "detail", id] as const,
  },
};

// ─── Inbox: reads ──────────────────────────────────────────────────────────

/**
 * User-scoped inbox feed. Server filters to the authenticated user; the
 * query shape lets you narrow by read-state, severity, event, date range or
 * free-text search.
 */
export function useApiNotifications(query: NotificationListQuery = {}) {
  return useQuery({
    queryKey: notificationsApiKeys.inbox.list(query),
    queryFn: () => apiListNotifications(query),
    // Inbox is relatively write-heavy but we debounce via stale time so
    // rapid filter flicks don't hammer the API.
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

/** Read one notification. Returns 404 for cross-user IDs without admin_read. */
export function useApiNotification(id: string | undefined) {
  return useQuery<Notification>({
    queryKey: id
      ? notificationsApiKeys.inbox.detail(id)
      : ["notifications-api", "inbox", "detail", "__none__"],
    queryFn: () => apiGetNotification(id!),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

/**
 * Header-bell aggregate — `total` plus per-severity split. Cached briefly;
 * every write that could change read-state explicitly invalidates this key.
 */
export function useApiUnreadCount() {
  return useQuery<NotificationUnreadCount>({
    queryKey: notificationsApiKeys.unreadCount,
    queryFn: () => apiGetUnreadCount(),
    staleTime: 15_000,
    // Refetch on focus so the bell re-syncs when the user returns to the
    // tab after acting elsewhere.
    refetchOnWindowFocus: true,
  });
}

// ─── Inbox: writes ─────────────────────────────────────────────────────────

/**
 * Flip a batch to read. Invalidate inbox + bell. The return shape is
 * `{ updated: number }` — useful for toast copy.
 */
export function useApiMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<{ updated: number }, Error, string[]>({
    mutationFn: (ids) => apiMarkNotificationsRead(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsApiKeys.inbox.all });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.unreadCount });
      // Admin view also reflects is_read state, though it's cross-user.
      qc.invalidateQueries({ queryKey: notificationsApiKeys.adminList.all });
    },
  });
}

/** Mark every unread for the current user. Invalidates inbox + bell. */
export function useApiMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<{ updated: number }, Error, void>({
    mutationFn: () => apiMarkAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsApiKeys.inbox.all });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.unreadCount });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.adminList.all });
    },
  });
}

/**
 * Soft-delete one inbox row. Ownership-scoped server-side; 403 on
 * cross-user delete.
 */
export function useApiDeleteNotification() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteNotification(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: notificationsApiKeys.inbox.detail(id) });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.inbox.all });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.unreadCount });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.adminList.all });
    },
  });
}

// ─── Admin: cross-user feed + dispatch ─────────────────────────────────────

export function useApiAllNotifications(
  query: AdminNotificationListQuery = {},
) {
  return useQuery({
    queryKey: notificationsApiKeys.adminList.list(query),
    queryFn: () => apiListAllNotifications(query),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Emit a notification to a given user. If the recipient is the current
 * user, the new row will appear in their inbox + bumps the bell — we
 * always invalidate both to be safe (can't cheaply compare userIds here).
 */
export function useApiCreateNotification() {
  const qc = useQueryClient();
  return useMutation<Notification, Error, CreateNotification>({
    mutationFn: (body) => apiCreateNotification(body),
    onSuccess: (notification) => {
      qc.setQueryData(
        notificationsApiKeys.inbox.detail(notification.id),
        notification,
      );
      qc.invalidateQueries({ queryKey: notificationsApiKeys.inbox.all });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.unreadCount });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.adminList.all });
    },
  });
}

// ─── Templates: reads ──────────────────────────────────────────────────────

export function useApiNotificationTemplates(
  query: NotificationTemplateListParams = {},
) {
  return useQuery({
    queryKey: notificationsApiKeys.templates.list(query),
    queryFn: () => apiListNotificationTemplates(query),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiNotificationTemplate(id: string | undefined) {
  return useQuery<NotificationTemplate>({
    queryKey: id
      ? notificationsApiKeys.templates.detail(id)
      : ["notifications-api", "templates", "detail", "__none__"],
    queryFn: () => apiGetNotificationTemplate(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Templates: writes ─────────────────────────────────────────────────────

export function useApiCreateNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation<NotificationTemplate, Error, CreateNotificationTemplate>({
    mutationFn: (body) => apiCreateNotificationTemplate(body),
    onSuccess: (tpl) => {
      qc.setQueryData(notificationsApiKeys.templates.detail(tpl.id), tpl);
      qc.invalidateQueries({ queryKey: notificationsApiKeys.templates.all });
    },
  });
}

/**
 * PATCH with optimistic-concurrency (caller passes `expectedVersion`). On
 * 409 the returned error bubbles up so the caller can refetch + retry.
 */
export function useApiUpdateNotificationTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation<NotificationTemplate, Error, UpdateNotificationTemplate>({
    mutationFn: (body) => apiUpdateNotificationTemplate(id, body),
    onSuccess: (tpl) => {
      qc.setQueryData(notificationsApiKeys.templates.detail(tpl.id), tpl);
      qc.invalidateQueries({ queryKey: notificationsApiKeys.templates.all });
    },
  });
}

export function useApiDeleteNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteNotificationTemplate(id),
    onSuccess: (_, id) => {
      qc.removeQueries({
        queryKey: notificationsApiKeys.templates.detail(id),
      });
      qc.invalidateQueries({ queryKey: notificationsApiKeys.templates.all });
    },
  });
}
