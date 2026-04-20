/**
 * Billing + tenant lifecycle contracts (Sprint 1B / Phase 2.5).
 *
 * Two orthogonal concepts live here:
 *   1. TENANT lifecycle — the `organizations.status` column. Drives the
 *      auth guard. TRIAL with expired `trial_ends_at` is degraded to
 *      "trial_expired" at the service layer (not a separate column).
 *   2. SUBSCRIPTION lifecycle — `subscriptions.status`. Billing-cycle
 *      state ("TRIALING" → "ACTIVE" → "PAST_DUE" → "CANCELED"/"EXPIRED").
 *
 * The two overlap but are NOT the same:
 *   - Tenant can be ACTIVE while subscription is PAST_DUE (grace period).
 *   - Tenant can be SUSPENDED while subscription is still ACTIVE (admin
 *     action, e.g. ToS violation — operator flipped the switch manually).
 *
 * Keep them separate so the vendor can model both axes cleanly.
 */

import { z } from "zod";

// ─── Tenant lifecycle ─────────────────────────────────────────────────────

export const TENANT_STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED", "DELETED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

// ─── Plan codes (vendor catalog) ─────────────────────────────────────────

/**
 * The canonical set of plan codes we ship with. The `plans` table has a
 * UNIQUE on `code`; these literals keep the frontend type-safe when
 * rendering plan-picker UIs.
 *
 * Custom / one-off plans for enterprise deals go under CUSTOM with a
 * per-row `name` override — keeps the type union closed.
 */
export const PLAN_CODES = [
  "FREE",
  "STARTER",
  "PRO",
  "ENTERPRISE",
  "CUSTOM",
] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

// ─── Subscription lifecycle ──────────────────────────────────────────────

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** States in which a tenant still retains read/write access to the app. */
export const LIVE_SUBSCRIPTION_STATES = new Set<SubscriptionStatus>([
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
]);

// ─── Plan features / usage metrics ───────────────────────────────────────

/**
 * Convention for feature_key values:
 *   module.<name>        — boolean module flag (stored as plan_features.is_enabled)
 *   <noun>.<adj>.max     — hard cap (plan_features.limit_value)
 *   <noun>.<adj>.quota   — rolling monthly quota
 *
 * We keep this open-ended (string) rather than a closed union so product
 * can add new gates without a shared-lib release. Known well-formed keys
 * are listed for IDE autocomplete via the `KnownFeatureKey` alias — not
 * enforced at runtime.
 */
export type KnownFeatureKey =
  | "module.crm"
  | "module.inventory"
  | "module.manufacturing"
  | "module.qc"
  | "module.procurement"
  | "module.finance"
  | "module.hr"
  | "users.max"
  | "crm.contacts.max"
  | "crm.deals.max"
  | "inventory.items.max"
  | "api.calls.quota"
  | "storage.gb";

/** Metric keys for usage_records. Same open-string convention. */
export type KnownUsageMetric =
  | "users.count"
  | "crm.contacts.created"
  | "crm.deals.created"
  | "inventory.items.count"
  | "api.calls"
  | "storage.bytes";

// ─── Zod schemas — wire shapes ────────────────────────────────────────────

export const PlanSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  monthlyPriceCents: z.number().int().nonnegative(),
  annualPriceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlanFeatureSchema = z.object({
  planId: z.string().uuid(),
  featureKey: z.string(),
  limitValue: z.number().int().nullable(),
  isEnabled: z.boolean(),
});
export type PlanFeature = z.infer<typeof PlanFeatureSchema>;

export const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  planId: z.string().uuid(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  currentPeriodStart: z.string(), // ISO date string
  currentPeriodEnd: z.string(),
  trialEndsAt: z.string().nullable().optional(),
  canceledAt: z.string().nullable().optional(),
  cancelAtPeriodEnd: z.boolean(),
  externalId: z.string().nullable().optional(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;
