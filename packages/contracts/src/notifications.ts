/**
 * Notifications contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §13.7. Matches ops/sql/init/08-notifications.sql.
 *
 * Scope (Phase 2): "templates + log (record-only; dispatch is Phase 3)".
 *   - notification_templates (library keyed by event + channel)
 *   - notifications (per-user record-only feed)
 *
 * Explicitly OUT of scope (Phase 3+):
 *   - Real-time delivery (SSE, email dispatch, WhatsApp)
 *   - Template rendering engine (Phase 2 callers materialise title/body)
 *   - Preferences / subscriptions (per-user per-event muting)
 *
 * Conventions match finance.ts / qc.ts:
 *   - Enums UPPER_SNAKE to match DB CHECK constraints
 *   - Reads return full shape; list endpoints paginated
 *   - Header `notification_templates` has optimistic concurrency via version
 *   - No version/concurrency on notifications (append-only except is_read flip)
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

const uuid = z.string().uuid();

// ─── Enums ───────────────────────────────────────────────────────────────────

export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL", "WHATSAPP"] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NOTIFICATION_SEVERITIES = [
  "INFO",
  "SUCCESS",
  "WARNING",
  "ERROR",
  "CRITICAL",
] as const;
export const NotificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

// ─── Notification Templates ──────────────────────────────────────────────────

export const NotificationTemplateSchema = z.object({
  id: uuid,
  orgId: uuid,
  eventType: z.string(),
  channel: NotificationChannelSchema,
  name: z.string(),
  description: z.string().nullable(),
  subjectTemplate: z.string().nullable(),
  bodyTemplate: z.string(),
  defaultSeverity: NotificationSeveritySchema,
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdBy: uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type NotificationTemplate = z.infer<typeof NotificationTemplateSchema>;

export const CreateNotificationTemplateSchema = z.object({
  eventType: z.string().trim().min(1).max(100),
  channel: NotificationChannelSchema.default("IN_APP"),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  // Subject is NULL-able because IN_APP notifications have only a title.
  subjectTemplate: z.string().trim().max(200).optional(),
  bodyTemplate: z.string().trim().min(1).max(4000),
  defaultSeverity: NotificationSeveritySchema.default("INFO"),
  isActive: z.boolean().default(true),
});
export type CreateNotificationTemplate = z.infer<
  typeof CreateNotificationTemplateSchema
>;

export const UpdateNotificationTemplateSchema =
  CreateNotificationTemplateSchema.partial().extend({
    /** Optimistic concurrency — service 409s on mismatch. */
    expectedVersion: z.number().int().positive().optional(),
  });
export type UpdateNotificationTemplate = z.infer<
  typeof UpdateNotificationTemplateSchema
>;

export const NotificationTemplateListQuerySchema =
  PaginationQuerySchema.extend({
    eventType: z.string().trim().min(1).max(100).optional(),
    channel: NotificationChannelSchema.optional(),
    isActive: z.coerce.boolean().optional(),
    search: z.string().trim().min(1).max(200).optional(),
  });
export type NotificationTemplateListQuery = z.infer<
  typeof NotificationTemplateListQuerySchema
>;

// ─── Notifications (per-user feed) ───────────────────────────────────────────

export const NotificationSchema = z.object({
  id: uuid,
  orgId: uuid,
  userId: uuid,
  eventType: z.string(),
  severity: NotificationSeveritySchema,
  title: z.string(),
  body: z.string(),
  linkUrl: z.string().nullable(),
  referenceType: z.string().nullable(),
  referenceId: uuid.nullable(),
  templateId: uuid.nullable(),
  isRead: z.boolean(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/**
 * Admin/service-level payload for emitting a notification to a specific
 * user. Phase 2 has no subscription matrix, so the caller picks the target
 * directly. Phase 3 will introduce template-routed emit that resolves the
 * recipient set from subscriptions.
 */
export const CreateNotificationSchema = z.object({
  userId: uuid,
  eventType: z.string().trim().min(1).max(100),
  severity: NotificationSeveritySchema.default("INFO"),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  linkUrl: z.string().trim().max(1000).url().optional().or(
    z.string().trim().max(1000).startsWith("/").optional(),
  ),
  referenceType: z.string().trim().max(64).optional(),
  referenceId: uuid.optional(),
  /** Lineage only — not rendered. Phase 3 will resolve via eventType lookup. */
  templateId: uuid.optional(),
});
export type CreateNotification = z.infer<typeof CreateNotificationSchema>;

export const NotificationListQuerySchema = PaginationQuerySchema.extend({
  /** Filter to read / unread. Omit for both. */
  isRead: z.coerce.boolean().optional(),
  severity: NotificationSeveritySchema.optional(),
  eventType: z.string().trim().min(1).max(100).optional(),
  referenceType: z.string().trim().max(64).optional(),
  referenceId: uuid.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

/**
 * Batch mark-as-read payload. Empty `ids` = "mark ALL current-user unread as
 * read" (the inbox "mark all read" button).
 */
export const MarkNotificationsReadSchema = z.object({
  ids: z.array(uuid).max(100).default([]),
});
export type MarkNotificationsRead = z.infer<typeof MarkNotificationsReadSchema>;

// ─── Dashboard aggregates ────────────────────────────────────────────────────

/**
 * Cheap header bell count — called on every page load. Service reads from
 * the partial index on (user_id, created_at DESC) WHERE is_read = false.
 */
export const NotificationUnreadCountSchema = z.object({
  total: z.number().int().nonnegative(),
  bySeverity: z.object({
    INFO: z.number().int().nonnegative(),
    SUCCESS: z.number().int().nonnegative(),
    WARNING: z.number().int().nonnegative(),
    ERROR: z.number().int().nonnegative(),
    CRITICAL: z.number().int().nonnegative(),
  }),
});
export type NotificationUnreadCount = z.infer<
  typeof NotificationUnreadCountSchema
>;
