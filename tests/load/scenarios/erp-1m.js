/**
 * Instigenie ERP — 1,000,000-scenario load + reliability simulation.
 *
 * Six categories run in parallel as separate k6 scenarios with
 * `shared-iterations` executors so each one hits its target count
 * exactly. Each VU iteration generates one randomized scenario shape
 * via lib/scenario-gen.js and dispatches into lib/erp-flows.js.
 *
 * Distribution (matches the spec):
 *   normal_flows       400,000   ~7-8 calls each → ~3M calls
 *   edge_cases         200,000   ~1 call each
 *   concurrency        150,000   5–14 calls each
 *   security           100,000   1 call each
 *   failure_injection  100,000   1 call each
 *   chaos               50,000   ~3-15 calls (random combo)
 *
 * Scale down for local: SCENARIO_SCALE=0.01 (10k smoke) or 0.001
 * (1k canary). Default 1.0 = full 1M.
 *
 * Run:
 *   k6 run tests/load/scenarios/erp-1m.js
 *   k6 run -e SCENARIO_SCALE=0.01 tests/load/scenarios/erp-1m.js
 *   k6 run -e LOAD_API_URL=https://staging.example.com -e SCENARIO_SCALE=0.1 tests/load/scenarios/erp-1m.js
 */

import { fail } from "k6";
import { mintErpTokenPool } from "../lib/auth-erp.js";
import { generateScenario } from "../lib/scenario-gen.js";
import {
  normalFlow, edgeCase, concurrencyFlow, securityFlow,
  failureInjection, chaosFlow,
} from "../lib/erp-flows.js";

// ─── Scale knob ─────────────────────────────────────────────────────────────

const SCALE = parseFloat(__ENV.SCENARIO_SCALE || "1.0");
function n(x) { return Math.max(1, Math.round(x * SCALE)); }

// Per-category VU sizing. Heavier flows get more VUs because each
// iteration takes longer; sizing roughly proportional to expected
// duration × calls per iteration.
const VU_NORMAL = parseInt(__ENV.VU_NORMAL || "50", 10);
const VU_EDGE = parseInt(__ENV.VU_EDGE || "30", 10);
const VU_CONC = parseInt(__ENV.VU_CONC || "60", 10);
const VU_SEC = parseInt(__ENV.VU_SEC || "20", 10);
const VU_FAIL = parseInt(__ENV.VU_FAIL || "20", 10);
const VU_CHAOS = parseInt(__ENV.VU_CHAOS || "10", 10);

const MAX_DURATION = __ENV.MAX_DURATION || "8h";

// ─── k6 options ─────────────────────────────────────────────────────────────

export const options = {
  // Each scenario fires its own `exec` function — k6 doesn't call
  // `default()` when scenarios are explicit. The token pool is loaded
  // ONCE in setup() and shared via the data argument.
  scenarios: {
    normal_flows: {
      executor: "shared-iterations",
      vus: VU_NORMAL,
      iterations: n(400000),
      maxDuration: MAX_DURATION,
      exec: "runNormal",
      tags: { category: "normal" },
    },
    edge_cases: {
      executor: "shared-iterations",
      vus: VU_EDGE,
      iterations: n(200000),
      maxDuration: MAX_DURATION,
      exec: "runEdge",
      tags: { category: "edge" },
    },
    concurrency: {
      executor: "shared-iterations",
      vus: VU_CONC,
      iterations: n(150000),
      maxDuration: MAX_DURATION,
      exec: "runConcurrency",
      tags: { category: "conc" },
    },
    security: {
      executor: "shared-iterations",
      vus: VU_SEC,
      iterations: n(100000),
      maxDuration: MAX_DURATION,
      exec: "runSecurity",
      tags: { category: "sec" },
    },
    failure_injection: {
      executor: "shared-iterations",
      vus: VU_FAIL,
      iterations: n(100000),
      maxDuration: MAX_DURATION,
      exec: "runFailure",
      tags: { category: "fail" },
    },
    chaos: {
      executor: "shared-iterations",
      vus: VU_CHAOS,
      iterations: n(50000),
      maxDuration: MAX_DURATION,
      exec: "runChaos",
      tags: { category: "chaos" },
    },
  },

  // Thresholds match the spec. abortOnFail stops the run early if a
  // hard SLO is broken — saves hours when the API is clearly unhealthy.
  thresholds: {
    // Per-spec global gates.
    "http_req_failed": [
      { threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" },
    ],
    "http_req_duration": [
      "p(95)<500",
      "p(99)<2000",
    ],
    // Per-category — same shape, gives breakdown without re-running.
    "http_req_failed{category:normal}": ["rate<0.01"],
    "http_req_failed{category:edge}": ["rate<0.05"], // edge cases tolerate
    "http_req_failed{category:sec}": ["rate<0.01"],
    "http_req_failed{category:fail}": ["rate<0.05"],
    "http_req_duration{category:normal}": ["p(95)<800"],
    // Custom counters defined in erp-flows.js
    "erp_custom_errors": ["count<10000"],
    "checks": ["rate>0.95"],
  },

  // Trim the noise.
  summaryTrendStats: ["min", "med", "p(95)", "p(99)", "max"],
  noConnectionReuse: false,
  discardResponseBodies: false, // we parse some bodies (PO id, version)
};

// ─── Setup ──────────────────────────────────────────────────────────────────

export function setup() {
  const tokens = mintErpTokenPool();
  if (tokens.list.length === 0) {
    fail("setup: no tokens minted — is the API up?");
  }
  // Sanity-check that the prodmgr is in the pool — without it, the
  // approval-chain steps in normalFlow / concurrencyFlow can't run.
  if (!tokens.byRole.PRODUCTION_MANAGER) {
    console.warn("setup: PRODUCTION_MANAGER not in token pool — approval steps will skip");
  }
  console.log(`setup: ${tokens.list.length} tokens, scale=${SCALE}, total_iters=${
    Math.round((400000 + 200000 + 150000 + 100000 + 100000 + 50000) * SCALE)
  }`);
  return { tokens };
}

// ─── Per-category exec functions ────────────────────────────────────────────

export function runNormal(data) {
  const scn = generateScenario(__VU, __ITER);
  normalFlow(scn, data.tokens);
}

export function runEdge(data) {
  const scn = generateScenario(__VU, __ITER);
  edgeCase(scn, data.tokens);
}

export function runConcurrency(data) {
  const scn = generateScenario(__VU, __ITER);
  concurrencyFlow(scn, data.tokens);
}

export function runSecurity(data) {
  const scn = generateScenario(__VU, __ITER);
  securityFlow(scn, data.tokens);
}

export function runFailure(data) {
  const scn = generateScenario(__VU, __ITER);
  failureInjection(scn, data.tokens);
}

export function runChaos(data) {
  const scn = generateScenario(__VU, __ITER);
  chaosFlow(scn, data.tokens);
}

// ─── Teardown / summary ─────────────────────────────────────────────────────

export function teardown(_data) {
  console.log("teardown: see summary file. Cleanup of LOAD_TEST-tagged rows is manual:");
  console.log("  DELETE FROM leads WHERE source='LOAD_TEST';");
  console.log("  DELETE FROM purchase_orders WHERE created_at > now() - interval '4 hours' AND po_number LIKE 'PO-%';");
}

// ─── handleSummary: write JSON next to the script ───────────────────────────

export function handleSummary(data) {
  const out = {
    "stdout": textSummary(data),
  };
  const path = __ENV.SUMMARY_JSON || "tests/load/results/erp-1m-summary.json";
  out[path] = JSON.stringify(data, null, 2);
  return out;
}

function textSummary(data) {
  const m = data.metrics;
  const get = (k, prop = "value") =>
    m[k] && m[k].values ? m[k].values[prop] : undefined;
  const rows = [
    ["http_reqs total", get("http_reqs", "count") || 0],
    ["http_req_failed rate", `${((get("http_req_failed", "rate") || 0) * 100).toFixed(3)}%`],
    ["http_req_duration p(95)", `${(get("http_req_duration", "p(95)") || 0).toFixed(0)}ms`],
    ["http_req_duration p(99)", `${(get("http_req_duration", "p(99)") || 0).toFixed(0)}ms`],
    ["checks rate", `${((get("checks", "rate") || 0) * 100).toFixed(3)}%`],
    ["erp_custom_errors", get("erp_custom_errors", "count") || 0],
    ["erp_calls_total", get("erp_calls_total", "count") || 0],
    ["iterations", get("iterations", "count") || 0],
  ];
  const lines = [
    "",
    "┌── ERP 1M simulation — summary ────────────────────",
  ];
  for (const [k, v] of rows) {
    lines.push(`│ ${k.padEnd(28)} ${v}`);
  }
  lines.push("└───────────────────────────────────────────────────");
  // Threshold pass/fail
  const failed = [];
  for (const [name, thr] of Object.entries(data.metrics)) {
    if (!thr.thresholds) continue;
    for (const [tname, tdata] of Object.entries(thr.thresholds)) {
      if (tdata.ok === false) failed.push(`${name} :: ${tname}`);
    }
  }
  if (failed.length) {
    lines.push("FAILED THRESHOLDS:");
    for (const f of failed) lines.push("  ✗ " + f);
  } else {
    lines.push("ALL THRESHOLDS PASSED ✓");
  }
  lines.push("");
  return lines.join("\n");
}
