/**
 * Core tables: organizations, users, roles, user_roles, permissions,
 * role_permissions, refresh_tokens.
 *
 * ARCHITECTURE.md §4, §9. Every tenant-scoped table gets an `org_id` with
 * RLS policies defined in ops/sql/init/03-rls.sql.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// We keep RLS-targeted tables in the default `public` schema so Drizzle
// migrations work cleanly. Outbox and audit get their own schemas.

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // Operator capability layer — ARCHITECTURE.md §9.4a.
    capabilities: jsonb("capabilities")
      .$type<{
        permittedLines: string[];
        tier?: "T1" | "T2" | "T3";
        canPCBRework: boolean;
        canOCAssembly: boolean;
      }>()
      .notNull()
      .default(sql`'{"permittedLines":[],"canPCBRework":false,"canOCAssembly":false}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailOrgUnique: uniqueIndex("users_email_org_unique").on(t.orgId, t.email),
    orgIdx: index("users_org_idx").on(t.orgId),
  })
);

export const roles = pgTable("roles", {
  // `id` is the enum name itself — keeps SQL joins cheap and readable.
  id: text("id").primaryKey(),
  label: text("label").notNull(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex("user_roles_pk").on(t.userId, t.roleId),
    orgIdx: index("user_roles_org_idx").on(t.orgId),
  })
);

export const permissions = pgTable("permissions", {
  id: text("id").primaryKey(), // e.g. "work_orders:release"
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  description: text("description"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "restrict" }),
  },
  (t) => ({
    pk: uniqueIndex("role_permissions_pk").on(t.roleId, t.permissionId),
  })
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // sha256, never raw
    audience: text("audience").notNull(), // mobilab-internal | mobilab-portal
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("refresh_tokens_user_idx").on(t.userId),
    tokenHashUnique: uniqueIndex("refresh_tokens_hash_unique").on(t.tokenHash),
  })
);
