# Load Test — Gate 17 Sustained Soak

**Owns**: the k6 recipe that closes Gate 17 ("1-hour soak at 500
concurrent; p99 API < 2s; 5xx < 0.1%; zero stock drift; zero dead
letters"). Also the day-to-day shorter smoke-test recipe used before
every prod release.

**SLOs** (ARCHITECTURE.md §4.4 Gate 17):

| Metric | Target |
|--------|--------|
| p99 API latency | < 2000 ms |
| 5xx rate | < 0.1% |
| Stock drift count (Gate 12 invariant) | **0** |
| BullMQ dead letter count | **0** |
| `erp_outbox_pending_age_max_seconds` | < 60s throughout |
| `erp_pg_replication_lag_seconds` | < 10s throughout |

Any breach of the zero-tolerance metrics (stock drift, dead letter)
is a test FAILURE regardless of the latency picture.

## Target topology for the soak

The test runs against the **staging** environment sized to the 10k-
users target column (ARCHITECTURE.md §11.2), not dev. Running a
1-hour soak at 500 concurrent against dev-compose is meaningless —
the failure modes the test is designed to catch (connection-pool
saturation, replica lag, Redis-BULL memory) only appear under real
sizing.

Required infra before pressing start:

- 12× api pods (2 vCPU / 1.5 GB)
- 16× worker pods across the queue mix (per §11.2)
- 2× PgBouncer poolers (see [pgbouncer-replica.md](./pgbouncer-replica.md))
- 2× listen-notify (leader + standby)
- Postgres primary 32 vCPU / 128 GB NVMe + replica
- 3× Redis-BULL (4 vCPU / 12 GB, noeviction)
- 3× Redis-CACHE
- MinIO 3-node (see [minio-3-node-cluster.md](./minio-3-node-cluster.md))

If ANY of the above is single-pod at test time, Gate 17 cannot be
closed against it — document the staging shape in the drill ticket
before running.

## k6 recipe

Source file: `ops/loadtest/gate17-soak.js` — full script below so this
runbook stands alone when the repo isn't in front of you.

```js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.API_BASE || 'https://staging-api.instigenie.internal';
const TOKEN = __ENV.LOADTEST_JWT;           // pre-minted staging token
const ORG = __ENV.LOADTEST_ORG_ID;          // staging org with seeded data

const dead_letters = new Counter('dead_letters_observed');
const stock_drift  = new Counter('stock_drift_observed');
const api_p99      = new Trend('api_latency_ms');

export const options = {
  // 500 concurrent VUs for 1 hour, with a 5-min ramp either side.
  stages: [
    { duration: '5m',  target: 500 },
    { duration: '60m', target: 500 },
    { duration: '5m',  target: 0 },
  ],
  thresholds: {
    http_req_failed:  ['rate<0.001'],       // 0.1% 5xx budget
    http_req_duration: ['p(99)<2000'],      // p99 < 2s
    dead_letters_observed: ['count==0'],
    stock_drift_observed:  ['count==0'],
  },
  // Abort immediately on any threshold breach — don't waste soak time
  // after the gate is already failed.
  abortOnFail: true,
  noConnectionReuse: false,                 // match real app behavior
};

const H = () => ({
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'X-Loadtest-Run': __ENV.RUN_ID || 'gate17',
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
```

## Running the soak

### Preconditions

- Staging sized as above; confirm via `kubectl get deploy -n
  instigenie-staging`.
- Staging is seeded: `LOADTEST_ITEM_ID`, `LOADTEST_ACCOUNT_ID`,
  `LOADTEST_INVOICE_ID` all exist in the org identified by
  `LOADTEST_ORG_ID`.
- `LOADTEST_JWT` valid for the entire 70-minute run (5m ramp + 60m
  soak + 5m ramp-down). Mint it against the staging auth with a
  service role that has the permissions every scenario needs
  (`crm:read`, `inventory:reserve`, `finance:read`, `pdf:trigger`,
  `audit:read`). Expiry ≥ 2 hours.
- Prometheus retention is 7d — you'll want 48h post-run to dig
  through metrics. Confirm retention is 7d, not the dev 24h.
- `#oncall-alerts` pre-announced the window. PagerDuty will still
  page on CRITICAL (rightly — a real break during a soak IS a real
  break).

### Kick off

```bash
# From the loadtest runner host (has k6 installed, has staging net access).
export API_BASE=https://staging-api.instigenie.internal
export LOADTEST_JWT=$(vault kv get -field=value secret/staging/loadtest/jwt)
export LOADTEST_ORG_ID=<staging-org-uuid>
export LOADTEST_ITEM_ID=<seeded>
export LOADTEST_ACCOUNT_ID=<seeded>
export LOADTEST_INVOICE_ID=<seeded>
export RUN_ID="gate17-$(date -u +%Y%m%dT%H%M)"

k6 run --out experimental-prometheus-rw=http://prometheus.staging:9090/api/v1/write \
       --tag run_id=${RUN_ID} \
       ops/loadtest/gate17-soak.js | tee /var/log/loadtest/${RUN_ID}.log
```

The k6 output is mirrored into Prometheus so the Grafana dashboard
`Load Test — Gate 17` shows the live curves.

### Mid-run monitoring

Have these three dashboards open in parallel:

- Grafana → `System Health` → the staging folder. Watch: PG
  connection pool utilization, replica lag, Redis-BULL memory.
- Grafana → `Business Ops` → stock drift counter. Must stay at 0.
- Grafana → `Event System` → outbox pending age, dead-letter count.

If any of the zero-tolerance invariants flicker, k6's
`abortOnFail: true` stops the test. Capture the timestamp — the
postmortem wants the exact break.

### Post-run verification

Three checks that can't be done inline (they'd tank the p99 budget)
but must pass for Gate 17 to close:

1. **Stock drift across the universe** (Gate 12's strict invariant):

   ```sql
   -- Run under the superuser (SELECT across tenants).
   SELECT s.item_id, s.org_id,
          s.reserved_qty,
          COALESCE(SUM(l.quantity) FILTER (WHERE l.txn_type = 'RESERVATION'), 0) AS ledger_sum
     FROM stock_summary s
     LEFT JOIN stock_ledger l
       ON l.item_id = s.item_id AND l.org_id = s.org_id
    GROUP BY s.item_id, s.org_id, s.reserved_qty
   HAVING s.reserved_qty <> COALESCE(SUM(l.quantity) FILTER (WHERE l.txn_type = 'RESERVATION'), 0);
   -- Must return 0 rows.
   ```

2. **Dead-letter queue is empty**:

   ```bash
   redis-cli -h redis-bull.staging -p 6379 XLEN bull:outbox-dispatch:failed
   # Must print 0.
   ```

3. **Audit chain intact**:

   ```bash
   # Trigger the hashchain worker manually against the staging org.
   curl -X POST https://staging-api.instigenie.internal/api/admin/audit/verify-chain \
     -H "Authorization: Bearer ${ADMIN_JWT}"
   # Expect { status: "COMPLETED", breaks: [] }.
   ```

Record all three outputs in the Gate 17 drill entry in
`ops/gate21-runbook-drills.md`.

## Smoke test (pre-release, 5 minutes)

A trimmed variant that every release runs as a gate before
promoting staging → prod. Same script, different stages:

```bash
k6 run --env STAGES_OVERRIDE=smoke ops/loadtest/gate17-soak.js
# stages: 30s ramp to 50 VUs, 3m at 50, 30s ramp down
```

No zero-tolerance changes — dead letters and stock drift are still
hard failures.

## Rollback

Not applicable — the load test is non-destructive by construction
(no DELETE scenarios, every write is against a tagged loadtest
lane that's periodically TRUNCATEd offline). If the soak genuinely
took staging down, that's the gate doing its job; restore staging
from its nightly base + WAL (same pattern as
[backup-dr.md](./backup-dr.md), just against staging).

## Related

- ARCHITECTURE.md §4.4 Gate 17.
- ARCHITECTURE.md §11.2 hardware sizing.
- [critical-alerts.md](./critical-alerts.md) §bullmq-critical-backlog,
  §stock-drift, §outbox-dead-letter — all can fire during a soak
  and each has a specific procedure for whether to abort.
