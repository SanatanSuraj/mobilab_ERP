/**
 * @mobilab/quotas — plan-features + quota enforcement.
 *
 * Sprint 1C: READ path
 *   - FeatureFlagService: isModuleEnabled / isEnabled / getLimit / assertEnabled
 *   - PlanResolverService: low-level SQL → FeatureSnapshot
 *
 * Sprint 2: ENFORCEMENT
 *   - QuotaService: assertQuota / recordUsage / getUsage
 *   - METRIC_REGISTRY: metric → feature-key + period strategy
 */

export { FeatureFlagService } from "./feature-flag.js";
export type { FeatureFlagDeps } from "./feature-flag.js";
export { PlanResolverService } from "./plan-resolver.js";
export type { PlanResolverDeps } from "./plan-resolver.js";
export { QuotaService } from "./quota-service.js";
export type {
  QuotaServiceDeps,
  UsageSnapshot,
  ClockLike,
} from "./quota-service.js";
export {
  METRIC_REGISTRY,
  periodFor,
  getMetricDefinition,
} from "./metrics.js";
export type {
  MetricDefinition,
  PeriodStrategy,
  KnownMetric,
} from "./metrics.js";
export type {
  FeatureEntry,
  FeatureSnapshot,
  FeatureFlagServiceOptions,
} from "./types.js";
