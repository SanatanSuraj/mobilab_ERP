/**
 * Scenario 1: POST /auth/login.
 *
 * Bcrypt dominates the cost of this endpoint — each login is ~100ms of
 * single-core CPU, so we expect it to be the first endpoint to fall over
 * under sustained concurrency on a laptop.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import {
  API_URL,
  DEV_PASSWORD,
  DEV_USERS,
  JSON_HEADERS,
} from "../lib/env.js";
import { stagesFor, BASE_THRESHOLDS, VU_TARGET } from "../lib/stages.js";

export const options = {
  stages: stagesFor(VU_TARGET),
  thresholds: BASE_THRESHOLDS,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  // Pick a random dev user per iteration so we're not all bcrypting the
  // same row — keeps this a CPU test, not an identity-row-lock test.
  const u = DEV_USERS[Math.floor(Math.random() * DEV_USERS.length)];
  const res = http.post(
    `${API_URL}/auth/login`,
    JSON.stringify({
      email: u.email,
      password: DEV_PASSWORD,
      surface: "internal",
    }),
    { headers: JSON_HEADERS, tags: { endpoint: "POST /auth/login" } },
  );

  check(res, {
    "200 OK": (r) => r.status === 200,
    "has accessToken": (r) => {
      try {
        return JSON.parse(r.body).accessToken?.length > 0;
      } catch {
        return false;
      }
    },
  });
  // Users don't log in 20x/sec. This simulates at most ~2 logins/sec/VU
  // which at 500 VUs = 1000 logins/sec — already absurd for auth.
  sleep(0.5);
}
