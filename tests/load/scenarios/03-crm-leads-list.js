/**
 * Scenario 3: GET /crm/leads?limit=20.
 *
 * Main list page for the sales org. Paginated SELECT + tenant filter +
 * the usual status/source joins. Read-only but shaped by indexes —
 * should stay under 200ms p95 through 500 VUs if the list query is
 * indexed properly.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { API_URL, authHeaders } from "../lib/env.js";
import { mintTokenPool, pickToken } from "../lib/auth.js";
import { stagesFor, BASE_THRESHOLDS, VU_TARGET } from "../lib/stages.js";

export const options = {
  stages: stagesFor(VU_TARGET),
  thresholds: BASE_THRESHOLDS,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// FINANCE doesn't have `leads:read`, so excluding it keeps the run
// measuring the list query, not the permission-denial path.
const ALLOWED_ROLES = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "SALES_REP",
  "SALES_MANAGER",
];

export function setup() {
  return { pool: mintTokenPool(ALLOWED_ROLES) };
}

export default function (data) {
  const { token } = pickToken(data.pool, __VU, __ITER);
  const res = http.get(`${API_URL}/crm/leads?limit=20`, {
    headers: authHeaders(token),
    tags: { endpoint: "GET /crm/leads" },
  });

  check(res, {
    "200 OK": (r) => r.status === 200,
    "has data array": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).data);
      } catch {
        return false;
      }
    },
  });
  // 200ms think — a sales rep scrolling / filtering / re-opening the
  // list page. At 500 VUs that's 2.5k rps on the list query.
  sleep(0.2);
}
