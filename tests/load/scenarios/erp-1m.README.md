# ERP 1M-scenario load + reliability simulation

`erp-1m.js` runs up to **1,000,000 ERP scenarios** across six categories
in parallel. It hits real APIs, never mocks. k6 supervises the VU pool;
each VU iteration generates one randomized scenario shape via
`scenario-gen.js` and dispatches into the matching flow function in
`erp-flows.js`.

## Quick start

```sh
# Install k6 (one-time, macOS)
brew install k6

# Bring infra + dev stack up
pnpm infra:up
pnpm dev

# Smoke (1k iterations total — finishes in ~30s)
k6 run -e SCENARIO_SCALE=0.001 tests/load/scenarios/erp-1m.js

# Local stress (10k iterations — ~3-5 min, won't crater your laptop)
k6 run -e SCENARIO_SCALE=0.01 tests/load/scenarios/erp-1m.js

# Full 1M (production-grade infra required — see below)
k6 run tests/load/scenarios/erp-1m.js
```

## Distribution

Matches the spec verbatim:

| Category            | Iterations | Calls per iter | Total HTTP |
|---|--:|--:|--:|
| `normal_flows`      | 400,000    | ~7-8           | ~3M |
| `edge_cases`        | 200,000    | 1              | 200k |
| `concurrency`       | 150,000    | 5-14 (incl. parallel acts) | ~1.5M |
| `security`          | 100,000    | 1              | 100k |
| `failure_injection` | 100,000    | 1              | 100k |
| `chaos` (combo)     |  50,000    | 3-15           | ~400k |
| **Total**           | **1,000,000** |             | **~5.3M HTTP requests** |

Categories run as separate k6 `scenarios` with `shared-iterations`
executors so each one hits its target count exactly. They execute in
parallel (k6 schedules them concurrently) — total wall-clock ≈ longest
category, not sum of categories.

## Scaling: `SCENARIO_SCALE`

A multiplier applied to every category's iteration count.

| `SCENARIO_SCALE` | Total iters | Use for |
|---|--:|---|
| `0.001` | 1,000   | Smoke / CI gate |
| `0.01`  | 10,000  | Local stress (workstation OK) |
| `0.1`   | 100,000 | Pre-prod canary |
| `1.0` (default) | 1,000,000 | Full reliability run on prod-grade infra |

## Per-category VU sizing

Sized so heavier flows have more parallelism. All overridable:

```sh
k6 run \
  -e VU_NORMAL=100 -e VU_EDGE=50 -e VU_CONC=80 \
  -e VU_SEC=20 -e VU_FAIL=20 -e VU_CHAOS=20 \
  tests/load/scenarios/erp-1m.js
```

Defaults: `normal=50, edge=30, conc=60, sec=20, fail=20, chaos=10` →
**190 concurrent VUs** at the peak of the run.

## Thresholds (the test FAILS if these are breached)

```js
http_req_failed                   rate < 1%       ABORT after 30s of breach
http_req_duration                 p(95) < 500ms
http_req_duration                 p(99) < 2000ms
http_req_failed{category:normal}  rate < 1%
http_req_failed{category:edge}    rate < 5%       (edge cases tolerate)
checks                            rate > 95%
erp_custom_errors                 count < 10000
```

Per-category latency / error breakdown is also tagged so the summary
shows where exactly any breach occurred.

## Output

### Console

```
┌── ERP 1M simulation — summary ────────────────────
│ http_reqs total              5,324,118
│ http_req_failed rate         0.087%
│ http_req_duration p(95)      342ms
│ http_req_duration p(99)      1,180ms
│ checks rate                  99.4%
│ erp_custom_errors            6,221
│ erp_calls_total              5,324,118
│ iterations                   1,000,000
└───────────────────────────────────────────────────
ALL THRESHOLDS PASSED ✓
```

### JSON

`handleSummary` writes the full k6 metrics object to
`tests/load/results/erp-1m-summary.json` (path overridable via
`-e SUMMARY_JSON=/path/file.json`).

## Infra requirements

### Local (smoke / 10k scale)

- 8 GB RAM
- 4 CPU cores
- Docker running (postgres + 2 redis containers)
- Single API process on `:4000`

Realistic at `SCENARIO_SCALE=0.01` (10k iters); attempting full 1M
locally will produce a 4xx storm from rate-limit and connection-pool
exhaustion that masks any real signal.

### Production-grade (full 1M)

For the full 1M to produce signal that actually means something:

| Component | Sizing |
|---|---|
| API replicas | **8** behind a load balancer (Fastify, 2 vCPU / 1.5 GB each) |
| Postgres | 16 vCPU / 64 GB / NVMe — `max_connections=400`, shared with PgBouncer |
| PgBouncer | 2 replicas, transaction mode |
| Redis-CACHE | 3-node Sentinel, 8 GB each |
| Redis-BULL | 3-node Sentinel, 8 GB each, `maxmemory-policy: noeviction` |
| k6 runner | 1 box w/ 8 vCPU / 16 GB **or** distributed cluster (see below) |

These match the **5k-user row** in [ARCHITECTURE.md §11.2](../../../ARCHITECTURE.md). At those sizes a full 1M run completes in **~25-40 minutes** at sustained 2-4k RPS.

## Distributed runs (1M in less time / from one box that can't keep up)

k6 doesn't include a built-in cluster runner. Two options:

### Option A — k6 Cloud

Push the script:

```sh
k6 cloud login
k6 cloud tests/load/scenarios/erp-1m.js
```

k6 Cloud auto-distributes VUs across regions; you get a hosted summary
URL. Best for one-off compliance / customer-demo runs.

### Option B — Docker swarm (self-hosted)

```sh
# Each node runs 1/N of the iterations. Set N via SCENARIO_SCALE
# and label every node-output uniquely so the aggregator can stitch.
for node in node1 node2 node3 node4; do
  ssh $node "k6 run \
    -e SCENARIO_SCALE=0.25 \
    -e SUMMARY_JSON=/tmp/erp-$node.json \
    tests/load/scenarios/erp-1m.js" &
done
wait

# Pull + aggregate
scp node{1,2,3,4}:/tmp/erp-*.json ./
node tests/load/scripts/aggregate-summaries.js erp-*.json > combined.txt
```

The existing `tests/load/scripts/` directory is the home for the
aggregator (existing pattern from the 5-scenario matrix run).

## What gets written to your DB

Normal flow creates per iteration: 1 lead + 1 PO header + 1 PO line
(possibly + 1 approval + 1 transition + 1 step). At full 1M
that's roughly:

- **400k leads** tagged `source: "LOAD_TEST"`
- **550k PO headers** (400k normal + 150k concurrency)
- **550k PO lines**
- **~770k approval rows** (request + step + transition)

Cleanup script:

```sql
DELETE FROM po_approvals WHERE po_id IN (
  SELECT id FROM purchase_orders
  WHERE created_at > now() - interval '6 hours'
    AND po_number LIKE 'PO-%' AND created_by = '00000000-0000-0000-0000-00000000b001'
);
DELETE FROM workflow_transitions WHERE created_at > now() - interval '6 hours'
  AND request_id IN (SELECT id FROM approval_requests WHERE created_at > now() - interval '6 hours');
DELETE FROM approval_steps      WHERE request_id IN (SELECT id FROM approval_requests WHERE created_at > now() - interval '6 hours');
DELETE FROM approval_requests   WHERE created_at > now() - interval '6 hours' AND entity_type = 'purchase_order';
DELETE FROM po_lines            WHERE created_at > now() - interval '6 hours';
DELETE FROM purchase_orders     WHERE created_at > now() - interval '6 hours' AND created_by = '00000000-0000-0000-0000-00000000b001';
DELETE FROM leads               WHERE source = 'LOAD_TEST';
```

Wrap this in a transaction before running. The harness deliberately
tags every load-test row so an aggressive narrow `WHERE` can clear
them without touching real tenant data.

## Custom metrics surfaced

The harness adds two custom counters on top of the standard k6 set:

| Metric | What it counts |
|---|---|
| `erp_calls_total` | Every HTTP call the harness issued. Sanity sum vs. `http_reqs`. |
| `erp_custom_errors` | Application-level failures the harness detected (e.g. PO submit returned 200 but JSON parse blew up; race scenario produced 0 or >1 winners). Tagged with `category` + `label` for breakdown. |

In the summary:

```
erp_custom_errors{category:conc,label:race_wins_2}    8
erp_custom_errors{category:normal,label:po_submit}    14
```

→ "the race produced 2 winners 8 times" and "PO submit failed 14 times" —
each is a real bug worth chasing.

## Files

```
tests/load/
├── lib/
│   ├── env.js              (existing — API URL, dev users, bypass header)
│   ├── auth.js             (existing — single-token pool for the 5-scenario matrix)
│   ├── auth-erp.js         (NEW — adds approver users + byRole lookup)
│   ├── scenario-gen.js     (NEW — seeded PRNG scenario generator)
│   └── erp-flows.js        (NEW — six flow functions, real APIs only)
└── scenarios/
    ├── 01-auth-login.js   (existing baseline scenarios — unchanged)
    ├── …
    ├── erp-1m.js          (NEW — main 1M entry: scenarios, thresholds, summary)
    └── erp-1m.README.md   (this file)
```

## Honest scope notes

- **Normal flow does NOT walk the full Onboarding → Payment chain per
  iteration.** A full chain at 400k iterations would create ~2M new
  invoices/payments, drowning the DB in load-test data and making
  cleanup harder than the run itself. We exercise the rep'd path
  (login → list → write → approval) which hits the same auth + RBAC
  + DB write hot paths the full chain would.
- **"Failure injection" here = malformed payloads** (the server's
  defensive paths). Real infra failure (kill postgres, kill redis)
  would invalidate every concurrent VU at once and is properly the
  job of a chaos run, not a load harness — see `chaos.sh` /
  `chaos2.sh` for that.
- **Sustained 1M needs production-grade infra.** Local Docker won't
  produce signal beyond ~20-50k. Use `SCENARIO_SCALE` honestly.
- **No data is deleted automatically.** Manual cleanup SQL above.
