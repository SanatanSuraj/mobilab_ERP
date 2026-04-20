/**
 * Metric registry — the static mapping from a USAGE metric name to:
 *   1. The feature_key on the plan that holds its limit.
 *   2. How to bucket usage rows in time (period strategy).
 *
 * Why a static registry rather than a DB table?
 *   - Metrics are code, not config. Adding a new metric means adding a
 *     recordUsage() / assertQuota() call-site, which is a code change.
 *     Making it a runtime table just creates drift.
 *   - The registry is used inside assertQuota() on the hot path; a constant
 *     lookup is free while a pg query would be a second roundtrip.
 *
 * Period strategies:
 *   - "monthly"  — usage resets every calendar month. period = 'YYYY-MM'.
 *                  For quotas like api.calls: "you get 500k calls per month".
 *   - "daily"    — same, but 'YYYY-MM-DD' (currently unused; here for shape).
 *   - "lifetime" — never resets. period = 'lifetime'. For hard caps like
 *                  users.max: "your plan allows up to 50 users ever".
 */

export type PeriodStrategy = "monthly" | "daily" | "lifetime";

export interface MetricDefinition {
  /** Human/wire name used by recordUsage callers. Stable. */
  metric: string;
  /** Feature key holding the limit in plan_features. */
  featureKey: string;
  /** How usage is bucketed. Determines `period` column value. */
  period: PeriodStrategy;
}

/**
 * The canonical set of tracked metrics. Extend this as product adds new
 * billable axes — the compiler will flag missing enforcement sites via
 * KnownMetric references.
 *
 * For now we ship api.calls (monthly, the prototypical quota) and one
 * representative lifetime cap; the other `*.max` keys from the plans
 * catalog can join when their CRM call-sites start emitting recordUsage.
 */
export const METRIC_REGISTRY = {
  "api.calls": {
    metric: "api.calls",
    featureKey: "api.calls.quota",
    period: "monthly",
  },
  "users.count": {
    metric: "users.count",
    featureKey: "users.max",
    period: "lifetime",
  },
  "crm.contacts.created": {
    metric: "crm.contacts.created",
    featureKey: "crm.contacts.max",
    period: "lifetime",
  },
} as const satisfies Record<string, MetricDefinition>;

export type KnownMetric = keyof typeof METRIC_REGISTRY;

/**
 * Resolve the period label for a metric at a given instant. Kept pure /
 * side-effect-free so callers can pass a `now` for deterministic tests.
 *
 * Period formats:
 *   monthly  → "YYYY-MM"     (UTC)
 *   daily    → "YYYY-MM-DD"  (UTC)
 *   lifetime → "lifetime"
 *
 * We use UTC intentionally — a quota window that depends on the server's
 * local time would drift across DST and is hostile to multi-region.
 */
export function periodFor(strategy: PeriodStrategy, now: Date = new Date()): string {
  switch (strategy) {
    case "lifetime":
      return "lifetime";
    case "daily": {
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    case "monthly":
    default: {
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    }
  }
}

/**
 * Look up a metric definition by name. Throws at runtime if missing —
 * this is a programmer bug (unregistered metric), not a user error.
 */
export function getMetricDefinition(name: string): MetricDefinition {
  const def = (METRIC_REGISTRY as Record<string, MetricDefinition | undefined>)[
    name
  ];
  if (!def) {
    throw new Error(`unknown metric: ${name}. Add to METRIC_REGISTRY.`);
  }
  return def;
}
