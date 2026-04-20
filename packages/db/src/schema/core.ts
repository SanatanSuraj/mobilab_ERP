/**
 * Core tables: organizations, user_identities, users, roles, user_roles,
 * memberships, permissions, role_permissions, refresh_tokens.
 *
 * ARCHITECTURE.md §4, §9. Identity model follows the Slack/Linear pattern:
 *   - user_identities  — global (no org_id): email + password + MFA
 *   - users            — per-tenant profile (org_id, identity_id FK)
 *   - memberships      — identity ↔ org links, drives tenant picker
 *
 * Every tenant-scoped table (org_id column) is RLS-enforced in
 * ops/sql/rls/01-enable-rls.sql.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// We keep RLS-targeted tables in the default `public` schema so Drizzle
// migrations work cleanly. Outbox and audit get their own schemas.

// Tenant lifecycle columns (Sprint 1B). The `status` enum drives guard
// rejection: SUSPENDED/DELETED never issue tokens; TRIAL passes only if
// trial_ends_at is in the future. `owner_identity_id` will be populated by
// Sprint 4's provisioning flow — kept nullable until then.
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Points to user_identities.id. Declared inline as plain uuid because
    // defining a Drizzle FK here would create a circular reference
    // (user_identities hasn't been declared yet in this file). The real
    // FK is enforced in the DDL via `organizations_owner_identity_fk`.
    ownerIdentityId: uuid("owner_identity_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("organizations_status_idx").on(t.status),
    ownerIdentityIdx: index("organizations_owner_identity_idx").on(
      t.ownerIdentityId
    ),
  })
);

// ─── Identity (global — no org_id, no RLS) ───────────────────────────────────

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"), // nullable: SSO-only identities
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    emailUnique: uniqueIndex("user_identities_email_unique").on(t.email),
  })
);

// ─── Per-tenant profile ──────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => userIdentities.id, { onDelete: "restrict" }),
    email: text("email").notNull(), // denormalized from user_identities.email
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
    identityOrgUnique: uniqueIndex("users_identity_org_unique").on(
      t.identityId,
      t.orgId
    ),
    orgIdx: index("users_org_idx").on(t.orgId),
    identityIdx: index("users_identity_idx").on(t.identityId),
  })
);

// ─── RBAC ────────────────────────────────────────────────────────────────────

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

// ─── Memberships (identity ↔ org) ────────────────────────────────────────────

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => userIdentities.id, { onDelete: "restrict" }),
    // NULLABLE during INVITED status — the per-tenant user profile is
    // created only when the invite is accepted.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ACTIVE"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    identityOrgUnique: uniqueIndex("memberships_identity_org_unique").on(
      t.identityId,
      t.orgId
    ),
    orgIdx: index("memberships_org_idx").on(t.orgId),
    identityIdx: index("memberships_identity_idx").on(t.identityId),
    statusIdx: index("memberships_status_idx").on(t.status),
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
    identityId: uuid("identity_id")
      .notNull()
      .references(() => userIdentities.id, { onDelete: "cascade" }),
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
    identityIdx: index("refresh_tokens_identity_idx").on(t.identityId),
    tokenHashUnique: uniqueIndex("refresh_tokens_hash_unique").on(t.tokenHash),
  })
);
