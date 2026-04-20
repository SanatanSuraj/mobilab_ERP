/**
 * Single source of truth for queue names. Importing a queue by string literal
 * anywhere in the codebase is a lint error — use QueueNames instead.
 *
 * ARCHITECTURE.md §8. Four queues for Phase 1:
 *   - outbox-dispatch    — sends rows from outbox.events to the appropriate
 *                          destination queue or external hook.
 *   - email              — transactional email via SMTP / provider.
 *   - sms                — OTP + notifications via SMS provider.
 *   - scheduled-tasks    — cron / interval jobs (stats, reports).
 */

export const QueueNames = {
  outboxDispatch: "outbox-dispatch",
  email: "email",
  sms: "sms",
  scheduledTasks: "scheduled-tasks",
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];
