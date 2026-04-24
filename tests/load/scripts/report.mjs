#!/usr/bin/env node
/**
 * Aggregate every results/*.json file into REPORT.md.
 *
 * k6's --summary-export JSON has this shape (verified against 1.7.1):
 *   { metrics: { http_req_duration: { med, p(90), p(95), p(99), max, avg, min },
 *                http_reqs:          { count, rate },
 *                http_req_failed:    { passes, fails, value }, ... } }
 * Rate metrics store the 0-1 ratio in `value`, not in a `rate` field.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESULTS_DIR = join(ROOT, "results");
const OUT_FILE = join(ROOT, "REPORT.md");

const SCENARIO_LABELS = {
  "01-auth-login": "POST /auth/login",
  "02-auth-me": "GET /auth/me",
  "03-crm-leads-list": "GET /crm/leads",
  "04-crm-leads-create": "POST /crm/leads",
  "05-crm-deals-list": "GET /crm/deals",
};

function fmtMs(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(0)}ms`;
}

function fmtPct(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function fmtRate(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}/s`;
}

function loadSummary(scenario, vus) {
  const path = join(RESULTS_DIR, `${scenario}-${vus}.json`);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    const dur = parsed.metrics?.http_req_duration ?? {};
    const reqs = parsed.metrics?.http_reqs ?? {};
    const failed = parsed.metrics?.http_req_failed ?? {};
    return {
      p50: dur["med"] ?? dur["p(50)"],
      p90: dur["p(90)"],
      p95: dur["p(95)"],
      p99: dur["p(99)"],
      max: dur["max"],
      throughput: reqs["rate"],
      count: reqs["count"],
      errorRate: failed["value"],
      errors: failed["passes"] ?? 0,
    };
  } catch (err) {
    return null;
  }
}

const VU_TARGETS = [10, 100, 500];
const scenarios = Object.keys(SCENARIO_LABELS);

let md = "# Load test report\n\n";
md += "5 endpoints × 3 VU targets (10 / 100 / 500). Each cell = steady-state metrics during the 30s hold phase.\n\n";
md += "Command: `cd tests/load && ./run.sh`\n\n";
md += `Generated: ${new Date().toISOString()}\n\n`;

// Per-endpoint tables.
for (const scenario of scenarios) {
  const label = SCENARIO_LABELS[scenario];
  md += `## ${label}\n\n`;
  md += "| VUs | p50 | p90 | p95 | p99 | max | err rate | throughput | total |\n";
  md += "|----:|----:|----:|----:|----:|----:|---------:|-----------:|------:|\n";
  for (const vus of VU_TARGETS) {
    const s = loadSummary(scenario, vus);
    if (!s) {
      md += `| ${vus} | — | — | — | — | — | — | — | — |\n`;
      continue;
    }
    md += `| ${vus} | ${fmtMs(s.p50)} | ${fmtMs(s.p90)} | ${fmtMs(s.p95)} | ${fmtMs(s.p99)} | ${fmtMs(s.max)} | ${fmtPct(s.errorRate)} | ${fmtRate(s.throughput)} | ${s.count ?? "—"} |\n`;
  }
  md += "\n";
}

// Breakage summary.
md += "## Where things break\n\n";
md += "Threshold: p95 ≤ 1500ms AND error rate < 5%. First VU target where either fails = the limit.\n\n";
md += "| Endpoint | First broken @ | Why |\n|---|---|---|\n";

for (const scenario of scenarios) {
  const label = SCENARIO_LABELS[scenario];
  let firstBroken = null;
  let why = "";
  for (const vus of VU_TARGETS) {
    const s = loadSummary(scenario, vus);
    if (!s) continue;
    const p95Bad = (s.p95 ?? 0) > 1500;
    const errBad = (s.errorRate ?? 0) > 0.05;
    if (p95Bad || errBad) {
      firstBroken = vus;
      const parts = [];
      if (p95Bad) parts.push(`p95=${fmtMs(s.p95)}`);
      if (errBad) parts.push(`err=${fmtPct(s.errorRate)}`);
      why = parts.join(", ");
      break;
    }
  }
  md += `| ${label} | ${firstBroken ?? "held 500 VUs"} | ${why || "—"} |\n`;
}

writeFileSync(OUT_FILE, md);
console.log(`Wrote ${OUT_FILE}`);
