/**
 * Deterministic-ish scenario generator for the 1M ERP load run.
 *
 * Why "deterministic-ish": we want every VU iteration to pick a
 * scenario shape that exercises a real code path, but we also want
 * runs to be reproducible enough that a flake can be re-investigated.
 * We seed PRNG with (vu, iter) so iteration N on VU M always
 * generates the same shape — without resorting to a global counter
 * that would force VUs to coordinate.
 *
 * NB: k6 has no Math.seedrandom. We use a small mulberry32 PRNG
 * inline; statistically fine for scenario distribution and 100×
 * faster than crypto.randomBytes.
 */

// ─── PRNG (mulberry32) ──────────────────────────────────────────────────────

export function rngFor(vu, iter) {
  let s = (vu * 2654435761 + iter * 40503) >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rndInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function rndPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// ─── Scenario shape ─────────────────────────────────────────────────────────

const INDUSTRIES = ["MANUFACTURING", "TRADING"];
const PAYMENT_TYPES = ["full", "partial"];
const ORDER_SIZE_BUCKETS = [
  { min: 1, max: 10, weight: 60 },     // small orders dominate real traffic
  { min: 10, max: 100, weight: 30 },
  { min: 100, max: 1000, weight: 10 }, // long tail
];

function pickWeighted(rng, buckets) {
  const total = buckets.reduce((s, b) => s + b.weight, 0);
  let n = rng() * total;
  for (const b of buckets) {
    n -= b.weight;
    if (n <= 0) return b;
  }
  return buckets[buckets.length - 1];
}

/**
 * Build a self-contained scenario record. Returned shape is intentionally
 * flat so a flaky scenario can be reproduced verbatim by passing
 * `--env REPLAY_VU=37 --env REPLAY_ITER=812`.
 */
export function generateScenario(vu, iter) {
  const rng = rngFor(vu, iter);
  const sizeBucket = pickWeighted(rng, ORDER_SIZE_BUCKETS);
  return {
    id: `scn-${vu}-${iter}`,
    industry: rndPick(rng, INDUSTRIES),
    orderSize: rndInt(rng, sizeBucket.min, sizeBucket.max),
    approvalRequired: rng() < 0.7, // ~70% need approval; rest are below threshold
    paymentType: rndPick(rng, PAYMENT_TYPES),
    concurrencyLevel: rndInt(rng, 1, 10),
    // Deterministic suffix so two runs at the same scale produce
    // distinguishable rows (different timestamps embedded).
    suffix: `${Date.now().toString(36)}-${vu}-${iter}-${rndInt(rng, 0, 1e8).toString(36)}`,
  };
}
