# Gate 17 — Sustained load evidence

## Status at go-live freeze: PENDING-STAGING

The k6 script is committed and statically validated:

- `k6-inspect.txt` — `k6 inspect` output for `ops/k6/gate-17-sustained-load.js`.
  Confirms the parsed option bag — most importantly the per-threshold
  `abortOnFail: true` under `thresholds.*` (NOT the deprecated top-level
  field which k6 1.7+ silently ignores).

The script encodes the Gate 17 PASS criteria verbatim (ARCHITECTURE.md §4.4):

| Criterion                     | Machine-checked threshold           |
|-------------------------------|-------------------------------------|
| p99 API < 2s                  | `http_req_duration: p(99)<2000`     |
| 5xx < 0.1%                    | `http_req_failed: rate<0.001`       |
| Zero dead letters             | `dead_letters_observed: count==0`   |
| Zero stock drift              | `stock_drift_observed: count==0`    |

All four thresholds carry `abortOnFail: true` so the 1-hour soak
terminates immediately on first violation rather than burning staging
hours on a known-bad run.

## Deferred to staging

The actual soak (1h @ 500 VU) runs against `staging-api.instigenie.internal`
and requires a pre-minted 2h JWT + seeded loadtest fixtures. Run command:

```bash
k6 run \
  --out experimental-prometheus-rw=http://prometheus.staging:9090/api/v1/write \
  --tag run_id="gate17-$(date -u +%Y%m%dT%H%M)" \
  ops/k6/gate-17-sustained-load.js \
  | tee /var/log/loadtest/gate17-$(date -u +%Y%m%dT%H%M).log
```

Place the resulting log + Grafana screenshots into this directory and
flip `RELEASE-CHECKLIST.md` Gate 17 row from `PENDING-STAGING` →
`PASS/<date>/<operator>`.

## Post-run SQL verifications

Three post-run queries are documented inline in the script header (lines
42–67). They MUST return the expected values or Gate 17 does not close
even if k6 itself passed:

1. Stock-drift invariant across all tenants — `0 rows`.
2. `XLEN bull:outbox-dispatch:failed` — `0`.
3. `POST /api/admin/audit/verify-chain` — `{ status: "COMPLETED", breaks: [] }`.
