/**
 * Scenario 4: POST /crm/leads.
 *
 * Main write path. Each call INSERTs into `leads` + enqueues an outbox
 * event. Under 500 VUs this should tax pg's row-lock + outbox polling
 * more than CPU. Every lead tagged with `source: "LOAD_TEST"` so the
 * cleanup script can purge them afterwards.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { API_URL, authHeaders, JSON_HEADERS } from "../lib/env.js";
import { mintTokenPool, pickToken } from "../lib/auth.js";
import { stagesFor, BASE_THRESHOLDS, VU_TARGET } from "../lib/stages.js";

export const options = {
  stages: stagesFor(VU_TARGET),
  thresholds: BASE_THRESHOLDS,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// leads:create is held by SUPER_ADMIN, SALES_REP, SALES_MANAGER only —
// MANAGEMENT + FINANCE would 403 and pollute the error rate.
const ALLOWED_ROLES = ["SUPER_ADMIN", "SALES_REP", "SALES_MANAGER"];

export function setup() {
  return { pool: mintTokenPool(ALLOWED_ROLES) };
}

// Unique-ish identifier for each lead — stamp (VU, ITER) + random. We
// want no collisions because Instigenie flags near-duplicates in the
// response body, which could colour the latency trend.
function body(vu, iter) {
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e8).toString(36);
  const tag = `${stamp}-${vu}-${iter}-${rand}`;
  return JSON.stringify({
    name: `LoadTest ${tag}`,
    company: `LoadCo ${tag}`,
    email: `load-${tag}@example.com`,
    phone: "+91 90000 00000",
    // Marker we grep for in cleanup — keep it out of the enum list so
    // we don't pollute the legitimate source stats.
    source: "LOAD_TEST",
    estimatedValue: "0",
  });
}

export default function (data) {
  const { token } = pickToken(data.pool, __VU, __ITER);
  const res = http.post(`${API_URL}/crm/leads`, body(__VU, __ITER), {
    headers: { ...JSON_HEADERS, ...authHeaders(token) },
    tags: { endpoint: "POST /crm/leads" },
  });

  check(res, {
    "201 Created": (r) => r.status === 201,
    "has lead.id": (r) => {
      try {
        return JSON.parse(r.body).id?.length > 0;
      } catch {
        return false;
      }
    },
  });
  // 500ms think — a sales rep making 2 leads/sec is already aggressive.
  // At 500 VUs = 1k rps of writes, a realistic stress for this endpoint.
  sleep(0.5);
}
