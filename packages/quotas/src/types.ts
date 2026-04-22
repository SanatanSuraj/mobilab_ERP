/**
 * Shared types for the plan-features read path.
 *
 * A FeatureSnapshot is the denormalized {orgId → (planCode, features)}
 * projection that drives every module/quota gate. We cache the whole blob
 * in Redis keyed by orgId, so a single MGET'able JSON payload answers
 * every gate check for a request's lifetime.
 *
 * The shape is deliberately plain JSON (no class, no date objects) because
 * it's round-tripped through Redis SET / GET.
 */

import type { PlanCode, SubscriptionStatus } from "@instigenie/contracts";

export interface FeatureEntry {
  /** module flag or capped resource — is it even available at all? */
  enabled: boolean;
  /**
   * Hard cap or quota, or null for "unlimited". For module.<x> this is
   * ignored (boolean-only); for users.max / api.calls.quota / ... this
   * is the numeric limit used by Sprint 2 quota checks.
   */
  limit: number | null;
}

export interface FeatureSnapshot {
  orgId: string;
  /**
   * The plan the tenant is currently resolved to. Null only in the
   * degenerate case where a tenant has no live subscription at all
   * (e.g. freshly provisioned before billing setup) — in that case we
   * fall back to an empty feature map so everything is denied, and the
   * caller decides whether to bootstrap a FREE plan.
   */
  planCode: PlanCode | null;
  planId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  /** ISO-8601 timestamp the snapshot was built. For observability / debug. */
  resolvedAt: string;
  /** feature_key → {enabled, limit}. Missing key = feature not on plan. */
  features: Record<string, FeatureEntry>;
}

export interface FeatureFlagServiceOptions {
  /**
   * TTL for the cached snapshot in Redis, in seconds. Short TTL is fine
   * because plan/subscription changes are rare; we don't implement pub/sub
   * invalidation until Sprint 2+.
   */
  snapshotTtlSec?: number;
}
