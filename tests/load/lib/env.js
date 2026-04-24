/**
 * Shared env + dev-seed config for k6 scenarios.
 *
 * Mirrors the values the gate harness (_env-setup.ts) and the E2E suite
 * use so one local dev stack serves all three.
 */

// k6's __ENV object pulls from `-e KEY=val` or the shell.
export const API_URL = __ENV.LOAD_API_URL || "http://localhost:4000";

/** Dev-seeded org — ops/sql/seed/03-dev-org-users.sql. */
export const DEV_ORG_ID = "00000000-0000-0000-0000-00000000a001";
export const DEV_PASSWORD = "instigenie_dev_2026";

/**
 * Canonical dev users per role. Load tests hit POST /auth/login with a
 * pool of these so we're not hammering a single identity row (which
 * would artificially serialise the invitation/last-login updates).
 */
export const DEV_USERS = [
  { email: "admin@instigenie.local", role: "SUPER_ADMIN" },
  { email: "mgmt@instigenie.local", role: "MANAGEMENT" },
  { email: "sales@instigenie.local", role: "SALES_REP" },
  { email: "salesmgr@instigenie.local", role: "SALES_MANAGER" },
  { email: "finance@instigenie.local", role: "FINANCE" },
];

/**
 * The API rate-limits 300 req/min per IP. Every k6 VU shares
 * 127.0.0.1, so even modest loads would 429-storm. The dev-only
 * allowList in apps/api/src/index.ts honours this header and is
 * gated on NODE_ENV !== "production" so it's a no-op in real deploys.
 */
const BYPASS_HEADERS = {
  "x-load-test-bypass": "instigenie-dev-loadtest",
};

export const JSON_HEADERS = {
  "content-type": "application/json",
  ...BYPASS_HEADERS,
};

/**
 * Build an auth-header object given a bearer token.
 */
export function authHeaders(token) {
  return { authorization: `Bearer ${token}`, ...BYPASS_HEADERS };
}
