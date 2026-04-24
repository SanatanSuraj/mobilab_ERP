/**
 * Token minting for auth'd scenarios.
 *
 * k6 VUs share module state via import — a `setup()` that logs in all
 * five dev users and returns the access tokens is the cheapest way to
 * get an auth'd VU pool without every virtual user hammering
 * /auth/login during the read/write benchmarks.
 *
 * setup() runs ONCE before the ramp starts; the returned value is passed
 * to every VU iteration.
 */

import http from "k6/http";
import { API_URL, DEV_PASSWORD, DEV_USERS, JSON_HEADERS } from "./env.js";

/**
 * Log every dev user in and return a round-robin-able array of tokens.
 * Any login failure throws — we'd rather fail-fast than run a benchmark
 * with tokens that'll all 401.
 *
 * `allowedRoles` — if given, only users whose canonical role is in the
 * set are included. Scenarios that hit permission-gated endpoints
 * (e.g. POST /crm/leads requires leads:create → SUPER_ADMIN, SALES_REP,
 * SALES_MANAGER only) pass this so FINANCE / MANAGEMENT aren't diluting
 * the sample with deterministic 403s.
 */
export function mintTokenPool(allowedRoles) {
  const allow = allowedRoles ? new Set(allowedRoles) : null;
  const tokens = [];
  for (const u of DEV_USERS) {
    if (allow && !allow.has(u.role)) continue;
    const res = http.post(
      `${API_URL}/auth/login`,
      JSON.stringify({
        email: u.email,
        password: DEV_PASSWORD,
        surface: "internal",
      }),
      { headers: JSON_HEADERS },
    );
    if (res.status !== 200) {
      throw new Error(
        `setup: login(${u.email}) returned ${res.status}: ${res.body}`,
      );
    }
    const body = JSON.parse(res.body);
    if (body.status !== "authenticated" || !body.accessToken) {
      throw new Error(
        `setup: login(${u.email}) did not authenticate: ${res.body}`,
      );
    }
    tokens.push({ email: u.email, role: u.role, token: body.accessToken });
  }
  return tokens;
}

/**
 * Pick a token for this VU iteration. Spreading writes across the 5 dev
 * users reduces artificial row-level contention on identity/users rows.
 */
export function pickToken(pool, vu, iter) {
  return pool[(vu + iter) % pool.length];
}
