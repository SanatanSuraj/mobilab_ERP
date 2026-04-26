/**
 * Token pool minter for the ERP-1M simulation.
 *
 * Differs from the existing lib/auth.js `mintTokenPool()` in two ways:
 *   1. We need quick `byRole` lookup so the approval chain in
 *      normalFlow / concurrencyFlow can fetch the prodmgr token in
 *      O(1) without scanning the array on every iteration.
 *   2. We log in the dev seed users that drive approvals
 *      (prodmgr@instigenie.local, finance@instigenie.local) on top
 *      of the standard 5. Without these, approval-chain steps would
 *      have no actor and have to skip.
 *
 * setup() runs ONCE; the returned `tokens` object is shared across
 * every VU iteration via the `data` argument.
 */

import http from "k6/http";
import { API_URL, DEV_PASSWORD, DEV_USERS, JSON_HEADERS } from "./env.js";

// Approver users on top of DEV_USERS (which doesn't include them).
const APPROVER_USERS = [
  { email: "prodmgr@instigenie.local", role: "PRODUCTION_MANAGER" },
];

function loginOnce(email) {
  const res = http.post(
    `${API_URL}/auth/login`,
    JSON.stringify({ email, password: DEV_PASSWORD, surface: "internal" }),
    { headers: JSON_HEADERS, tags: { endpoint: "POST /auth/login (setup)" } },
  );
  if (res.status !== 200) {
    console.warn(`setup: login(${email}) → ${res.status} (skipping)`);
    return null;
  }
  try {
    const body = JSON.parse(res.body);
    if (body.status !== "authenticated" || !body.accessToken) return null;
    return body.accessToken;
  } catch {
    return null;
  }
}

export function mintErpTokenPool() {
  const list = [];
  const byRole = {};
  for (const u of [...DEV_USERS, ...APPROVER_USERS]) {
    // Skip if a role is already filled — DEV_USERS may carry a
    // SUPER_ADMIN we'd otherwise dilute by re-logging.
    if (byRole[u.role]) continue;
    const token = loginOnce(u.email);
    if (!token) continue;
    list.push({ email: u.email, role: u.role, token });
    byRole[u.role] = token;
  }
  return { list, byRole };
}
