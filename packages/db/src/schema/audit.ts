/**
 * audit.log — append-only audit trail. ARCHITECTURE.md §11.
 *
 * Written by Postgres triggers, never by application code directly.
 * Schema `audit` is read-only at the application role level — only the
 * superuser / migration role can INSERT (the triggers use SECURITY DEFINER).
 */

import {
  pgSchema,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const audit = pgSchema("audit");

export const auditLog = audit.table(
  "log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id"),
    action: text("action").notNull(), // INSERT | UPDATE | DELETE
    actor: uuid("actor"), // users.id or null for system
    before: jsonb("before"),
    after: jsonb("after"),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgTableIdx: index("audit_log_org_table_idx").on(t.orgId, t.tableName),
    changedAtIdx: index("audit_log_changed_at_idx").on(t.changedAt),
  })
);
