/**
 * Scenario 2: GET /auth/me.
 *
 * Hit on every protected page load — by far the highest-volume read in
 * normal traffic. JWT verify + one row fetch, so a healthy system
 * should hold sub-50ms p95 through 500 VUs.
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
  const res = http.get(`${API_URL}/auth/me`, {
    headers: authHeaders(token),
    tags: { endpoint: "GET /auth/me" },
  });

  check(res, {
    "200 OK": (r) => r.status === 200,
    "has user.id": (r) => {
      try {
        return JSON.parse(r.body).user?.id?.length > 0;
      } catch {
        return false;
      }
    },
  });
  // Ambient per-page-load chatter — 50ms think simulates ~20 page views
  // per second per active user, which is a fair proxy for navigation.
  sleep(0.05);
}
