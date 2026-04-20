/**
 * outbox.events — transactional outbox for cross-module side effects.
 * ARCHITECTURE.md §8.
 *
 * Pattern:
 *   BEGIN
 *     INSERT INTO work_orders ...
 *     INSERT INTO outbox.events ...   -- atomically with domain change
 *   COMMIT
 *   -- trigger NOTIFY fires → listen-notify picks up → enqueues BullMQ
 *
 * Notes on indexes: the partial index on undispatched rows (WHERE
 * dispatched_at IS NULL) and the partial unique index on idempotency_key
 * (WHERE idempotency_key IS NOT NULL) are declared in raw SQL in
 * ops/sql/init/02-triggers.sql. Drizzle-kit migrations apply those files
 * after generating this schema, so we only declare the plain indexes here.
 */

import {
  pgSchema,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const outbox = pgSchema("outbox");

export const outboxEvents = outbox.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("outbox_events_created_at_idx").on(t.createdAt),
    aggregateIdx: index("outbox_events_aggregate_idx").on(
      t.aggregateType,
      t.aggregateId
    ),
  })
);
