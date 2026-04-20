/**
 * Billing tables (Sprint 1B):
 *   plans           global catalog (FREE/STARTER/PRO/ENTERPRISE). No RLS.
 *   plan_features   per-plan feature / limit matrix. No RLS.
 *   subscriptions   one active row per tenant. RLS-enforced.
 *   usage_records   per-tenant counters bucketed by (metric, period). RLS.
 *
 * See ops/sql/init/01-schemas.sql for the authoritative DDL.
 * See ops/sql/rls/01-enable-rls.sql for the RLS policies on the last two.
 *
 * We intentionally keep this in its own Drizzle file so CRM/manufacturing
 * schemas don't transitively import billing types.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./core.js";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    monthlyPriceCents: integer("monthly_price_cents").notNull().default(0),
    annualPriceCents: integer("annual_price_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    activeIdx: index("plans_active_idx").on(t.isActive, t.sortOrder),
  })
);

export const planFeatures = pgTable(
  "plan_features",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    // bigint because usage caps can be very large (e.g. 10_000_000 API calls).
    // Drizzle maps pg bigint to string by default; mode:"number" uses JS number.
    // Caps over 2^53 are unrealistic for our quota surface, so number is safe.
    limitValue: bigint("limit_value", { mode: "number" }),
    isEnabled: boolean("is_enabled").notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planId, t.featureKey] }),
    keyIdx: index("plan_features_key_idx").on(t.featureKey),
  })
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("TRIALING"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("subscriptions_org_idx").on(t.orgId),
    statusIdx: index("subscriptions_status_idx").on(t.status),
    // Partial unique — only one live-state subscription per org. Historical
    // CANCELED/EXPIRED rows don't participate. Mirror the predicate in
    // ops/sql/init/01-schemas.sql exactly.
    orgActiveUnique: uniqueIndex("subscriptions_org_active_unique")
      .on(t.orgId)
      .where(sql`status IN ('TRIALING','ACTIVE','PAST_DUE')`),
  })
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    period: text("period").notNull(), // e.g. '2026-04' or '2026-04-20'
    countValue: bigint("count_value", { mode: "number" }).notNull().default(0),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("usage_records_org_idx").on(t.orgId),
    metricIdx: index("usage_records_metric_idx").on(t.metric),
    periodIdx: index("usage_records_period_idx").on(t.period),
    // Matches the UNIQUE(org_id, metric, period) in the DDL so upserts
    // round-trip without conflict drama.
    orgMetricPeriodUnique: uniqueIndex("usage_records_org_metric_period_unique")
      .on(t.orgId, t.metric, t.period),
  })
);
