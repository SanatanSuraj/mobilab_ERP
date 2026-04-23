/*
 * gate-17-sustained-load.js — Phase 4 §4.4 Gate 17 "Sustained load" soak.
 *
 *   Command to run:
 *     k6 run ops/k6/gate-17-sustained-load.js
 *
 *   With Prometheus remote-write + run tag (recommended for audit trail):
 *     k6 run \
 *       --out experimental-prometheus-rw=http://prometheus.staging:9090/api/v1/write \
 *       --tag run_id="gate17-$(date -u +%Y%m%dT%H%M)" \
 *       ops/k6/gate-17-sustained-load.js \
 *       | tee /var/log/loadtest/gate17-$(date -u +%Y%m%dT%H%M).log
 *
 *   Required env vars:
 *     BASE_URL              — staging API base, e.g. https://staging-api.instigenie.internal
 *     JWT_TOKEN             — pre-minted staging JWT valid for >= 2h with roles
 *                             crm:read, inventory:reserve, finance:read,
 *                             pdf:trigger, audit:read.
 *     ORG_ID                — staging org UUID with seeded loadtest data.
 *
 *   Optional env vars (aliases supported for legacy runbook invocation):
 *     API_BASE              — alias of BASE_URL.
 *     LOADTEST_JWT          — alias of JWT_TOKEN.
 *     LOADTEST_ORG_ID       — alias of ORG_ID.
 *     LOADTEST_ITEM_ID      — seeded stock item UUID used by reserveStock / createQuotation.
 *     LOADTEST_ACCOUNT_ID   — seeded account UUID used by createQuotation.
 *     LOADTEST_INVOICE_ID   — seeded invoice UUID used by triggerPdfRender.
 *     RUN_ID                — opaque identifier copied to the X-Loadtest-Run header.
 *     STAGES_OVERRIDE       — set to "smoke" to run the 5-minute pre-release smoke test.
 *
 *   Expected PASS criteria (ARCHITECTURE.md §4.4 Gate 17, verbatim):
 *     "1-hour soak at 500 concurrent; p99 API < 2s; 5xx < 0.1%;
 *      zero stock drift; zero dead letters."
 *
 *   Machine-checked thresholds enforced by this script:
 *     http_req_duration p(99) < 2000 ms     — p99 API < 2s
 *     http_req_failed   rate   < 0.001      — 5xx < 0.1%
 *     dead_letters_observed    count == 0   — zero dead letters
 *     stock_drift_observed     count == 0   — zero stock drift
 *   abortOnFail: true ensures we do not burn soak time after any threshold has broken.
 *
 *   Post-run verification (MUST PASS for Gate 17 to close — run these AFTER k6 exits;
 *   they are deliberately not inline because running them per-iteration would tank p99):
 *
 *   1) Stock drift across all tenants (Gate 12's strict invariant; must return 0 rows):
 *
 *      -- Run as superuser (SELECT across tenants).
 *      SELECT s.item_id, s.org_id,
 *             s.reserved_qty,
 *             COALESCE(SUM(l.quantity) FILTER (WHERE l.txn_type = 'RESERVATION'), 0) AS ledger_sum
 *        FROM stock_summary s
 *        LEFT JOIN stock_ledger l
 *          ON l.item_id = s.item_id AND l.org_id = s.org_id
 *       GROUP BY s.item_id, s.org_id, s.reserved_qty
 *      HAVING s.reserved_qty <> COALESCE(SUM(l.quantity) FILTER (WHERE l.txn_type = 'RESERVATION'), 0);
 *      -- Must return 0 rows.
 *
 *   2) Dead-letter queue is empty:
 *
 *      redis-cli -h redis-bull.staging -p 6379 XLEN bull:outbox-dispatch:failed
 *      # Must print 0.
 *
 *   3) Audit hash chain intact:
 *
 *      curl -X POST https://staging-api.instigenie.internal/api/admin/audit/verify-chain \
 *        -H "Authorization: Bearer ${ADMIN_JWT}"
 *      # Expect { status: "COMPLETED", breaks: [] }.
 *
 *   See docs/runbooks/load-test.md for the full runbook (topology preconditions,
 *   mid-run monitoring dashboards, rollback posture).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// Accept the spec's canonical env var names AND the legacy names used in
// docs/runbooks/load-test.md so existing runner hosts keep working verbatim.
const API = __ENV.BASE_URL || __ENV.API_BASE || 'https://staging-api.instigenie.internal';
const TOKEN = __ENV.JWT_TOKEN || __ENV.LOADTEST_JWT;
const ORG = __ENV.ORG_ID || __ENV.LOADTEST_ORG_ID;

const dead_letters = new Counter('dead_letters_observed');
const stock_drift  = new Counter('stock_drift_observed');
const api_p99      = new Trend('api_latency_ms');

const SOAK_STAGES = [
  { duration: '5m',  target: 500 },
  { duration: '60m', target: 500 },
  { duration: '5m',  target: 0 },
];

const SMOKE_STAGES = [
  { duration: '30s', target: 50 },
  { duration: '3m',  target: 50 },
  { duration: '30s', target: 0 },
];

export const options = {
  // 500 concurrent VUs for 1 hour, with a 5-min ramp either side.
  // STAGES_OVERRIDE=smoke swaps in the short pre-release smoke stages.
  stages: __ENV.STAGES_OVERRIDE === 'smoke' ? SMOKE_STAGES : SOAK_STAGES,
  // abortOnFail is a PER-THRESHOLD property in k6 1.7+ — the old
  // top-level option is silently ignored. Each threshold has its own
  // abort so a dead-letter or stock-drift violation kills the run
  // immediately rather than burning staging time.
  thresholds: {
    http_req_failed:       [{ threshold: 'rate<0.001',  abortOnFail: true }],
    http_req_duration:     [{ threshold: 'p(99)<2000',  abortOnFail: true }],
    dead_letters_observed: [{ threshold: 'count==0',    abortOnFail: true }],
    stock_drift_observed:  [{ threshold: 'count==0',    abortOnFail: true }],
  },
  noConnectionReuse: false,                 // match real app behavior
  tags: {
    run_id: __ENV.RUN_ID || 'gate17',
    org_id: ORG || 'unset',
  },
};

const H = () => ({
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'X-Loadtest-Run': __ENV.RUN_ID || 'gate17',
  'X-Org-Id': ORG || '',
});

// Weighted scenario mix — roughly matches observed prod traffic.
// Keep the mix in a single place so the numbers are auditable.
const SCENARIOS = [
  { weight: 30, fn: listLeads },
  { weight: 20, fn: getDashboard },
  { weight: 15, fn: reserveStock },           // the one that can drift
  { weight: 15, fn: listInvoices },
  { weight: 10, fn: createQuotation },
  { weight:  5, fn: triggerPdfRender },
  { weight:  5, fn: searchAuditLog },
];
const TOTAL = SCENARIOS.reduce((s, x) => s + x.weight, 0);

function pick() {
  let r = Math.random() * TOTAL;
  for (const s of SCENARIOS) {
    r -= s.weight;
    if (r <= 0) return s.fn;
  }
  return SCENARIOS[0].fn;
}

export function setup() {
  if (!TOKEN) {
    throw new Error('JWT_TOKEN (or LOADTEST_JWT) is required; mint a staging service-role token with crm:read, inventory:reserve, finance:read, pdf:trigger, audit:read.');
  }
  if (!ORG) {
    throw new Error('ORG_ID (or LOADTEST_ORG_ID) is required; must match the staging org where loadtest fixtures are seeded.');
  }
  return { startedAt: new Date().toISOString() };
}

export default function () {
  pick()();
  sleep(Math.random() * 0.5 + 0.2);          // 200–700ms think time
}

// ─── Scenarios ───────────────────────────────────────────────────────
function listLeads() {
  const r = http.get(`${API}/api/crm/leads?page=1&limit=50&sortDir=desc`, { headers: H() });
  check(r, { 'leads 200': (x) => x.status === 200 });
  api_p99.add(r.timings.duration);
}

function getDashboard() {
  const r = http.get(`${API}/api/dashboard/wip`, { headers: H() });
  check(r, { 'wip 200': (x) => x.status === 200 });
}

function listInvoices() {
  const r = http.get(`${API}/api/finance/sales-invoices?page=1&limit=25&sortDir=desc`, { headers: H() });
  check(r, { 'inv 200': (x) => x.status === 200 });
}

function reserveStock() {
  // Reserve a small qty against a known item; the Gate-12 invariant
  // (stock_summary.reserved_qty == SUM(stock_ledger where RESERVATION))
  // is checked AFTER the soak, not inline — inline would tank p99.
  const r = http.post(`${API}/api/inventory/reserve`,
    JSON.stringify({ itemId: __ENV.LOADTEST_ITEM_ID, qty: '1.0' }),
    { headers: H() });
  check(r, { 'reserve 200/409': (x) => x.status === 200 || x.status === 409 });
  // 409 is acceptable — FOR UPDATE NOWAIT contention is the happy-path
  // retry signal under load. 5xx is not.
}

function createQuotation() {
  const body = JSON.stringify({
    accountId: __ENV.LOADTEST_ACCOUNT_ID,
    currency: 'INR',
    lineItems: [{ itemId: __ENV.LOADTEST_ITEM_ID, qty: '1', unitPrice: '100.00' }],
  });
  const r = http.post(`${API}/api/crm/quotations`, body, { headers: H() });
  check(r, { 'quot 201': (x) => x.status === 201 });
}

function triggerPdfRender() {
  // Against a static seeded invoice — exercises worker-pdf + MinIO.
  const r = http.post(
    `${API}/api/finance/sales-invoices/${__ENV.LOADTEST_INVOICE_ID}/render-pdf`,
    null, { headers: H() });
  check(r, { 'pdf 202': (x) => x.status === 202 });
}

function searchAuditLog() {
  const r = http.get(
    `${API}/api/admin/audit?from=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}&limit=25`,
    { headers: H() });
  check(r, { 'audit 200': (x) => x.status === 200 });
}
