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

// ─── Dispatcher (Phase 3 §3.6) ───────────────────────────────────────────────

/**
 * One recipient the dispatcher is responsible for resolving. Either a user
 * inside the org (by id), or an external contact with pre-resolved email /
 * phone — the latter is how the dispatcher reaches customers who don't have
 * an account (e.g. "send WhatsApp invoice to +91…").
 */
export const NotificationDispatchRecipientSchema = z.object({
  userId: uuid.optional(),
  email: z.string().trim().email().max(320).optional(),
  /** E.164 WhatsApp number, e.g. "+919876543210". */
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164 (+…)")
    .optional(),
  /**
   * Optional per-recipient overrides for {{var}} substitution. Merged over
   * the top-level `variables` map; recipient entries win.
   */
  variables: z.record(z.string(), z.string()).optional(),
});
export type NotificationDispatchRecipient = z.infer<
  typeof NotificationDispatchRecipientSchema
>;

export const NotificationDispatchRequestSchema = z.object({
  /** Free text matching a notification_templates.event_type (+channel). */
  eventType: z.string().trim().min(1).max(100),
  /**
   * Restricts the fan-out to a subset of channels. Omit to dispatch to
   * every channel that has an active template for this event.
   */
  channels: z.array(NotificationChannelSchema).nonempty().optional(),
  /** Per-event variable bag substituted into template strings. */
  variables: z.record(z.string(), z.string()).default({}),
  /** Recipients to dispatch to. Min 1. */
  recipients: z.array(NotificationDispatchRecipientSchema).min(1),
  /** Optional severity override. Defaults to the template's default. */
  severity: NotificationSeveritySchema.optional(),
  /** Reference back-link — propagated to the in-app notification row. */
  referenceType: z.string().trim().max(64).optional(),
  referenceId: uuid.optional(),
  /** Optional deep-link for the in-app bell → UI. */
  linkUrl: z.string().trim().max(1000).optional(),
});
export type NotificationDispatchRequest = z.infer<
  typeof NotificationDispatchRequestSchema
>;

/** Per-(recipient,channel) outcome of a dispatch. */
export const NOTIFICATION_DISPATCH_OUTCOMES = [
  "DELIVERED",
  "EMAIL_FALLBACK",
  "DLQ",
  "SKIPPED_NO_TEMPLATE",
  "SKIPPED_NO_ADDRESS",
] as const;
export const NotificationDispatchOutcomeSchema = z.enum(
  NOTIFICATION_DISPATCH_OUTCOMES,
);
export type NotificationDispatchOutcome = z.infer<
  typeof NotificationDispatchOutcomeSchema
>;

export const NotificationDispatchAttemptSchema = z.object({
  channel: NotificationChannelSchema,
  outcome: NotificationDispatchOutcomeSchema,
  /** UUID of the notification row (IN_APP success). */
  notificationId: uuid.nullable(),
  /** UUID of the DLQ row (if outcome=DLQ). */
  dlqId: uuid.nullable(),
  /** Recipient addressing used (for audit) — phone / email / userId. */
  recipientUserId: uuid.nullable(),
  recipientEmail: z.string().nullable(),
  recipientPhone: z.string().nullable(),
  /** Copy of the channel error, if any. */
  error: z.string().nullable(),
});
export type NotificationDispatchAttempt = z.infer<
  typeof NotificationDispatchAttemptSchema
>;

export const NotificationDispatchResultSchema = z.object({
  eventType: z.string(),
  attempts: z.array(NotificationDispatchAttemptSchema),
  /** Summary counters — "dispatched N to IN_APP, M to EMAIL, DLQ K". */
  summary: z.object({
    delivered: z.number().int().nonnegative(),
    emailFallback: z.number().int().nonnegative(),
    dlq: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});
export type NotificationDispatchResult = z.infer<
  typeof NotificationDispatchResultSchema
>;

// ─── Dispatch DLQ row ────────────────────────────────────────────────────────

/**
 * One row in the notification_dispatch_dlq table — created when a channel
 * transport fails or returns a "couldn't deliver" signal. Distinct from
 * manual_entry_queue (that holds raw external-API payloads); this table
 * holds already-rendered channel output, so ops see exactly what the user
 * would have received.
 */
export const NOTIFICATION_DISPATCH_DLQ_STATUSES = [
  "PENDING",
  "RETRIED",
  "ABANDONED",
] as const;
export const NotificationDispatchDlqStatusSchema = z.enum(
  NOTIFICATION_DISPATCH_DLQ_STATUSES,
);
export type NotificationDispatchDlqStatus = z.infer<
  typeof NotificationDispatchDlqStatusSchema
>;

export const NotificationDispatchDlqRowSchema = z.object({
  id: uuid,
  orgId: uuid,
  eventType: z.string(),
  channel: NotificationChannelSchema,
  recipientUserId: uuid.nullable(),
  templateId: uuid.nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  lastError: z.string().nullable(),
  attempts: z.number().int().positive(),
  status: NotificationDispatchDlqStatusSchema,
  resolvedBy: uuid.nullable(),
  resolvedAt: z.string().nullable(),
  resolutionNotes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NotificationDispatchDlqRow = z.infer<
  typeof NotificationDispatchDlqRowSchema
>;
