/**
 * Shared stage profiles — one per VU target.
 *
 * Every scenario uses the same 3-phase ramp: 10s warm-up ramp, 30s hold
 * at target, 5s ramp-down. Short enough that the full matrix (5 endpoints
 * × 3 targets) runs in well under 15 minutes; long enough for the p99
 * bucket to be statistically meaningful at each hold.
 */

const HOLD = "30s";
const WARMUP = "10s";
const RAMPDOWN = "5s";

export function stagesFor(target) {
  return [
    { duration: WARMUP, target },
    { duration: HOLD, target },
    { duration: RAMPDOWN, target: 0 },
  ];
}

/**
 * Threshold defaults. These do NOT fail the run — they just print in
 * the k6 summary so the report runner can flag breaches. We want every
 * target level to run to completion so the report captures the
 * breakage point, not cut out at the first threshold miss.
 */
export const BASE_THRESHOLDS = {
  // Delegate pass/fail to the aggregator. `abortOnFail=false` keeps the
  // run going even when a threshold fires.
  http_req_failed: [{ threshold: "rate<0.05", abortOnFail: false }],
  http_req_duration: [{ threshold: "p(95)<1500", abortOnFail: false }],
};

export const VU_TARGET =
  Number.parseInt(__ENV.LOAD_VUS || "10", 10);
