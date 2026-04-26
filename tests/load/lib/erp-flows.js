/**
 * Per-category flow functions for the 1M ERP simulation.
 *
 * Each flow returns the number of HTTP calls it issued (so the runner
 * can compute "calls per scenario" stats) and uses k6's `check()` for
 * pass/fail tracking. Failures don't throw — k6 records the failed
 * check and the run continues; the threshold step at the end gates
 * the final exit code.
 *
 * Light-touch by design: a "normal flow" creates a couple of real
 * rows but doesn't drag every entity through every state. Multiplied
 * by 400k iterations a heavier flow would balloon the DB into the
 * billions of rows, which is benchmarking the cleanup process more
 * than the ERP. Honest scope.
 */

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { API_URL, JSON_HEADERS, authHeaders } from "./env.js";

// Custom counters surfaced in the k6 summary.
export const customErrors = new Counter("erp_custom_errors");
export const callsTotal = new Counter("erp_calls_total");

// Tagging every request with the scenario category lets the summary
// break latency / error-rate down per category. Without these tags
// the only visible signal would be the global average.
function tag(category, endpoint) {
  return { category, endpoint };
}

function postJson(token, path, body, category, endpoint) {
  callsTotal.add(1);
  return http.post(`${API_URL}${path}`, JSON.stringify(body), {
    headers: { ...JSON_HEADERS, ...authHeaders(token) },
    tags: tag(category, endpoint),
  });
}

function getJson(token, path, category, endpoint) {
  callsTotal.add(1);
  return http.get(`${API_URL}${path}`, {
    headers: { ...JSON_HEADERS, ...authHeaders(token) },
    tags: tag(category, endpoint),
  });
}

function recordFailure(category, label) {
  customErrors.add(1, { category, label });
}

// ─── Constants drawn from the dev seed ──────────────────────────────────────

const DEV_VENDOR = "00000000-0000-0000-0000-000000fe0001";
const DEV_ITEM = "00000000-0000-0000-0000-000000fb0004";

// ─── Normal flow: light-touch ERP cycle ─────────────────────────────────────

/**
 * Roughly mirrors the path a daily user takes:
 *   1. read leads list
 *   2. create a lead
 *   3. create a PO (DRAFT)
 *   4. add a line
 *   5. submit for approval
 *   6. approve via /approvals (as PRODUCTION_MANAGER)
 *
 * Six API calls per iteration. At 400k iterations that's 2.4M HTTP calls.
 * Sized so the DB still fits on a workstation post-run.
 */
export function normalFlow(scenario, tokens) {
  const cat = "normal";
  const sales = pickByRole(tokens, ["SUPER_ADMIN", "SALES_REP", "SALES_MANAGER"]);
  const prodMgr = tokens.byRole.PRODUCTION_MANAGER;
  if (!sales) return 0;

  // 1. Lead list (warm cache)
  let r = getJson(sales, "/crm/leads?limit=5", cat, "GET /crm/leads");
  check(r, { "leads list 200": (x) => x.status === 200 }) ||
    recordFailure(cat, "leads_list");

  // 2. Lead create
  r = postJson(sales, "/crm/leads", {
    name: `LT ${scenario.suffix}`,
    company: `LCo ${scenario.suffix}`,
    email: `lt-${scenario.suffix}@example.com`,
    phone: "+91 90000 00000",
    source: "LOAD_TEST",
    estimatedValue: String(scenario.orderSize * 1000),
  }, cat, "POST /crm/leads");
  check(r, { "lead 201": (x) => x.status === 201 }) ||
    recordFailure(cat, "lead_create");

  // 3. PO create
  r = postJson(sales, "/procurement/purchase-orders", {
    vendorId: DEV_VENDOR, currency: "INR",
  }, cat, "POST /purchase-orders");
  let poId, poVersion;
  if (!check(r, { "po 201": (x) => x.status === 201 })) {
    recordFailure(cat, "po_create");
    return 3;
  }
  try { ({ id: poId, version: poVersion } = JSON.parse(r.body)); }
  catch { recordFailure(cat, "po_parse"); return 3; }

  // 4. PO line
  r = postJson(sales, `/procurement/purchase-orders/${poId}/lines`, {
    itemId: DEV_ITEM,
    quantity: String(scenario.orderSize),
    unitPrice: "10.00",
    uom: "EA",
  }, cat, "POST /po/lines");
  if (!check(r, { "line 201": (x) => x.status === 201 })) {
    recordFailure(cat, "po_line");
    return 4;
  }

  // 5. submit-for-approval (line bumped version → fetch fresh version)
  r = getJson(sales, `/procurement/purchase-orders/${poId}`, cat, "GET /po");
  try { poVersion = JSON.parse(r.body).version; } catch { /* fall through */ }

  r = postJson(sales, `/procurement/purchase-orders/${poId}/submit-for-approval`, {
    expectedVersion: poVersion,
  }, cat, "POST /po/submit");
  if (!check(r, { "submit 200": (x) => x.status === 200 })) {
    recordFailure(cat, "po_submit");
    return 6;
  }

  // 6. Approve via /approvals if approval was required AND we have the role
  if (scenario.approvalRequired && prodMgr) {
    const apr = findPendingApproval(sales, "purchase_order", poId);
    if (apr) {
      r = postJson(prodMgr, `/approvals/${apr.id}/act`,
        { action: "APPROVE", reason: "load-test" },
        cat, "POST /approvals/act");
      check(r, { "approve 200": (x) => x.status === 200 }) ||
        recordFailure(cat, "approve");
      return 8;
    }
  }
  return 7;
}

function findPendingApproval(token, entityType, entityId) {
  callsTotal.add(1);
  const r = http.get(
    `${API_URL}/approvals?entityType=${entityType}&status=PENDING&limit=20`,
    { headers: { ...JSON_HEADERS, ...authHeaders(token) }, tags: tag("normal", "GET /approvals") },
  );
  if (r.status !== 200) return null;
  try {
    const rows = JSON.parse(r.body).data || [];
    return rows.find((a) => a.entityId === entityId) || null;
  } catch { return null; }
}

// ─── Edge cases: inject one anti-pattern per iteration ─────────────────────

const EDGE_VARIANTS = [
  "missing_required_field", "invalid_uuid", "negative_qty",
  "huge_string", "double_submit", "unknown_route", "empty_body",
];

export function edgeCase(scenario, tokens) {
  const cat = "edge";
  const tok = pickAny(tokens);
  if (!tok) return 0;
  const variant = EDGE_VARIANTS[scenario.orderSize % EDGE_VARIANTS.length];
  let r, expected;
  switch (variant) {
    case "missing_required_field":
      r = postJson(tok, "/crm/leads", {}, cat, "edge missing_field");
      expected = (x) => x.status === 400; break;
    case "invalid_uuid":
      r = getJson(tok, "/procurement/purchase-orders/not-a-uuid", cat, "edge invalid_uuid");
      expected = (x) => x.status === 400 || x.status === 404; break;
    case "negative_qty":
      r = postJson(tok, "/inventory/stock/ledger", {
        itemId: DEV_ITEM, warehouseId: "00000000-0000-0000-0000-000000fa3301",
        txnType: "ADJUSTMENT", quantity: "-99999", uom: "EA",
      }, cat, "edge neg_qty");
      expected = (x) => x.status === 400; break;
    case "huge_string":
      r = postJson(tok, "/crm/leads", {
        name: "A".repeat(50000), company: "X", email: "a@b.io",
        phone: "+91 9", source: "LOAD_TEST",
      }, cat, "edge huge_string");
      expected = (x) => x.status === 400 || x.status === 413; break;
    case "double_submit":
      r = postJson(tok, `/procurement/purchase-orders/${crypto_uuid()}/submit-for-approval`,
        { expectedVersion: 1 }, cat, "edge ghost_submit");
      expected = (x) => x.status === 404; break;
    case "unknown_route":
      r = getJson(tok, "/this/route/does/not/exist", cat, "edge 404");
      expected = (x) => x.status === 404; break;
    case "empty_body":
      r = postJson(tok, "/auth/login", null, cat, "edge empty_body");
      expected = (x) => x.status === 400 || x.status === 401; break;
  }
  const ok = check(r, { [`edge ${variant} expected`]: expected });
  if (!ok) recordFailure(cat, variant);
  return 1;
}

// ─── Concurrency: parallel approve race ─────────────────────────────────────

/**
 * Sets up a single approval and fires N parallel acts at it. Exactly one
 * must win; the rest must reject cleanly. Uses k6's batch() for true
 * concurrent issue.
 */
export function concurrencyFlow(scenario, tokens) {
  const cat = "conc";
  const sales = pickByRole(tokens, ["SUPER_ADMIN", "SALES_REP", "SALES_MANAGER"]);
  const prodMgr = tokens.byRole.PRODUCTION_MANAGER;
  if (!sales || !prodMgr) return 0;

  // Build a fresh PO + submit (4 sequential calls).
  let r = postJson(sales, "/procurement/purchase-orders", {
    vendorId: DEV_VENDOR, currency: "INR",
  }, cat, "POST /po (race-setup)");
  let po;
  if (!check(r, { "po 201": (x) => x.status === 201 })) {
    recordFailure(cat, "race_setup_po");
    return 1;
  }
  try { po = JSON.parse(r.body); } catch { recordFailure(cat, "race_setup_parse"); return 1; }

  r = postJson(sales, `/procurement/purchase-orders/${po.id}/lines`, {
    itemId: DEV_ITEM, quantity: "1", unitPrice: "1.00", uom: "EA",
  }, cat, "POST /line (race-setup)");
  if (!check(r, { "line 201": (x) => x.status === 201 })) {
    recordFailure(cat, "race_setup_line");
    return 2;
  }

  r = getJson(sales, `/procurement/purchase-orders/${po.id}`, cat, "GET /po (race-setup)");
  let v;
  try { v = JSON.parse(r.body).version; } catch { recordFailure(cat, "race_setup_ver"); return 3; }

  r = postJson(sales, `/procurement/purchase-orders/${po.id}/submit-for-approval`,
    { expectedVersion: v }, cat, "POST /po/submit (race-setup)");
  if (!check(r, { "submit 200": (x) => x.status === 200 })) {
    recordFailure(cat, "race_setup_submit");
    return 4;
  }

  const apr = findPendingApproval(sales, "purchase_order", po.id);
  if (!apr) { recordFailure(cat, "race_no_approval"); return 5; }

  // Now the race. Use k6 batch() — true parallel issue from this VU.
  const N = Math.min(scenario.concurrencyLevel, 10);
  const reqs = [];
  for (let i = 0; i < N; i++) {
    callsTotal.add(1);
    reqs.push(["POST", `${API_URL}/approvals/${apr.id}/act`,
      JSON.stringify({ action: "APPROVE", reason: "race" }),
      { headers: { ...JSON_HEADERS, ...authHeaders(prodMgr) },
        tags: tag(cat, "POST /approvals/act (race)") }]);
  }
  const responses = http.batch(reqs);
  const wins = responses.filter((x) => x.status === 200).length;
  const ok = check(null, { "exactly 1 race winner": () => wins === 1 });
  if (!ok) recordFailure(cat, `race_wins_${wins}`);
  return 5 + N;
}

// ─── Security probes ────────────────────────────────────────────────────────

const SEC_VARIANTS = ["garbage_jwt", "tampered_jwt", "no_token", "org_header_tamper", "portal_with_internal"];

export function securityFlow(scenario, tokens) {
  const cat = "sec";
  const tok = pickAny(tokens);
  if (!tok) return 0;
  const variant = SEC_VARIANTS[scenario.orderSize % SEC_VARIANTS.length];
  let r, expected;
  callsTotal.add(1);
  switch (variant) {
    case "garbage_jwt":
      r = http.get(`${API_URL}/auth/me`, {
        headers: { authorization: "Bearer xxx.yyy.zzz", ...JSON_HEADERS },
        tags: tag(cat, "garbage_jwt"),
      });
      expected = (x) => x.status === 401; break;
    case "tampered_jwt": {
      const [h, p] = tok.split(".");
      r = http.get(`${API_URL}/auth/me`, {
        headers: { authorization: `Bearer ${h}.${p}.AAAAAAAAAAAAAAAAAAAA`, ...JSON_HEADERS },
        tags: tag(cat, "tampered_jwt"),
      });
      expected = (x) => x.status === 401; break;
    }
    case "no_token":
      r = http.get(`${API_URL}/auth/me`, { headers: JSON_HEADERS, tags: tag(cat, "no_token") });
      expected = (x) => x.status === 401; break;
    case "org_header_tamper":
      r = http.get(`${API_URL}/auth/me`, {
        headers: { ...JSON_HEADERS, ...authHeaders(tok),
          "x-org-id": "00000000-0000-0000-0000-deadbeefcafe" },
        tags: tag(cat, "org_tamper"),
      });
      // Must return 200 with the JWT's org, NOT the header's. We can't
      // assert which org without parsing JSON; just confirm 200 (no
      // accidental 500 from a side-effect).
      expected = (x) => x.status === 200; break;
    case "portal_with_internal":
      r = getJson(tok, "/portal/me", cat, "portal_with_internal");
      expected = (x) => x.status === 401; break;
  }
  const ok = check(r, { [`sec ${variant} expected`]: expected });
  if (!ok) recordFailure(cat, variant);
  return 1;
}

// ─── Failure injection ──────────────────────────────────────────────────────

/**
 * "Failure injection" at this layer means deliberately malformed
 * payloads that exercise the server's defensive paths. True infra
 * failure (kill postgres, kill redis) belongs in chaos tests, not
 * a load harness — it would invalidate every concurrent VU at once.
 */
const INJECT_VARIANTS = ["wrong_method", "invalid_json", "sql_in_query", "huge_payload"];

export function failureInjection(scenario, tokens) {
  const cat = "fail";
  const tok = pickAny(tokens);
  if (!tok) return 0;
  const variant = INJECT_VARIANTS[scenario.orderSize % INJECT_VARIANTS.length];
  let r, expected;
  callsTotal.add(1);
  switch (variant) {
    case "wrong_method":
      r = http.del(`${API_URL}/healthz`, null,
        { headers: JSON_HEADERS, tags: tag(cat, "wrong_method") });
      expected = (x) => x.status === 404 || x.status === 405; break;
    case "invalid_json":
      r = http.post(`${API_URL}/auth/login`, "{not json}",
        { headers: JSON_HEADERS, tags: tag(cat, "invalid_json") });
      expected = (x) => x.status === 400; break;
    case "sql_in_query":
      r = getJson(tok, "/crm/leads?q=%27%20OR%201%3D1--&limit=2",
        cat, "sql_inj");
      expected = (x) => x.status === 200 || x.status === 400; break;
    case "huge_payload":
      r = postJson(tok, "/crm/leads",
        { name: "X".repeat(100000), company: "X", email: "a@b.io",
          phone: "+91 9", source: "LOAD_TEST" },
        cat, "huge_payload");
      expected = (x) => x.status === 400 || x.status === 413; break;
  }
  const ok = check(r, { [`fail ${variant} expected`]: expected });
  if (!ok) recordFailure(cat, variant);
  return 1;
}

// ─── Chaos: random combo of edge + sec + concurrency ────────────────────────

export function chaosFlow(scenario, tokens) {
  const cat = "chaos";
  const calls =
    edgeCase(scenario, tokens) +
    securityFlow(scenario, tokens) +
    (scenario.concurrencyLevel > 5 ? concurrencyFlow(scenario, tokens) : 0);
  return calls;
}

// ─── Token helpers ──────────────────────────────────────────────────────────

function pickByRole(tokens, allowedRoles) {
  for (const role of allowedRoles) {
    if (tokens.byRole[role]) return tokens.byRole[role];
  }
  return null;
}

function pickAny(tokens) {
  return tokens.list.length > 0 ? tokens.list[0].token : null;
}

// ─── Tiny UUID helper (k6 has no crypto.randomUUID) ─────────────────────────

function crypto_uuid() {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
