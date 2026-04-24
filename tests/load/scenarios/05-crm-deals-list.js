/**
 * Scenario 5: GET /crm/deals?limit=20.
 *
 * Pipeline dashboard. Similar shape to the leads list but joined to
 * quotations + includes the state-machine snapshot. A healthy system
 * should track /crm/leads closely; if this blows up sooner it's the
 * quotation join that needs an index.
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

export function setup() {
  return { pool: mintTokenPool() };
}

export default function (data) {
  const { token } = pickToken(data.pool, __VU, __ITER);
  const res = http.get(`${API_URL}/crm/deals?limit=20`, {
    headers: authHeaders(token),
    tags: { endpoint: "GET /crm/deals" },
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
  sleep(0.2);
}
