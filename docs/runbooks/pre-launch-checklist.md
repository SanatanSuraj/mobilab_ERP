# Pre-launch Checklist — Phase 4 §4.4 Go-Live Gates

**Owns**: the master go-live checklist. Every §4.4 correctness gate
that requires action on launch day has a section here. The intent is
that on launch morning the release captain runs one command per gate
and hands the output to the auditor — no improvisation, no
copy-pasting from runbooks.

**Scope**: Gates 17, 18, 20, 21. Gate 19 (audit integrity) is covered
automatically by CI gates `gate-37-phase3-approval-immutability`,
`gate-40-phase4-compliance-hashchain`, and
`gate-41-phase4-audit-hashchain` running green on the release SHA — no
manual action required here.

**Related**:

- ARCHITECTURE.md §4.4 for the gate definitions.
- `docs/runbooks/load-test.md` for Gate 17 topology preconditions.
- `docs/runbooks/backup-dr.md` for Gate 18 DR procedure.
- `docs/runbooks/critical-alerts.md` for Gate 21 alert sources.
- `ops/runbook-drills/gate-21-failure-injection.md` for the Gate 21
  drill matrix.

---

## Gate 17 — Sustained load

### Acceptance criteria (ARCHITECTURE.md §4.4, verbatim)

> 1-hour soak at 500 concurrent; p99 API < 2s; 5xx < 0.1%; zero stock
> drift; zero dead letters.

### Prerequisites

- Staging sized per ARCHITECTURE.md §11.2 (12× api, 16× workers, 2×
  PgBouncer, 3× Redis-BULL/CACHE, 3× MinIO, PG primary + replica).
  Anything single-pod at test time makes this gate uncloseable —
  document the shape in the release PR before starting.
- Prometheus retention ≥ 7d on staging (not the dev 24h default).
- `#oncall-alerts` pre-announced for the 70-minute run window (5m ramp
  + 60m soak + 5m ramp-down).
- `LOADTEST_JWT` service-role token with `crm:read`,
  `inventory:reserve`, `finance:read`, `pdf:trigger`, `audit:read`,
  expiry ≥ 2h.
- Seeded fixtures in the target staging org: `LOADTEST_ITEM_ID`,
  `LOADTEST_ACCOUNT_ID`, `LOADTEST_INVOICE_ID`.

Full preconditions live in `docs/runbooks/load-test.md` — do NOT edit
that runbook; reference it.

### Commands to execute

```bash
# From the loadtest runner host (has k6 installed, has staging net access).
export BASE_URL=https://staging-api.instigenie.internal
export JWT_TOKEN=$(vault kv get -field=value secret/staging/loadtest/jwt)
export ORG_ID=<staging-org-uuid>
export LOADTEST_ITEM_ID=<seeded>
export LOADTEST_ACCOUNT_ID=<seeded>
export LOADTEST_INVOICE_ID=<seeded>
export RUN_ID="gate17-$(date -u +%Y%m%dT%H%M)"

k6 run \
  --out experimental-prometheus-rw=http://prometheus.staging:9090/api/v1/write \
  --tag run_id="${RUN_ID}" \
  --summary-export "/var/log/loadtest/${RUN_ID}-summary.json" \
  ops/k6/gate-17-sustained-load.js \
  | tee /var/log/loadtest/${RUN_ID}.log
```

After k6 exits, run the three post-run checks (the script's header has
the exact commands; they cannot be inline because they would tank the
p99 budget):

1. Stock-drift SELECT across all tenants — must return 0 rows.
2. `redis-cli … XLEN bull:outbox-dispatch:failed` — must print 0.
3. `POST /api/admin/audit/verify-chain` — must return `{ status:
   "COMPLETED", breaks: [] }`.

### Evidence artifact

- Attach `${RUN_ID}-summary.json` (k6 summary export) to the release PR.
- Attach the tee'd log file `${RUN_ID}.log`.
- Attach the three post-run check outputs as a single `gate-17-post.txt`.
- Link the Grafana dashboard URL with `?var-run_id=${RUN_ID}` baked in
  so the auditor sees the live curves.

### Sign-off

```
Executed by: ___   Date: ___   Result: PASS / FAIL
Evidence attached: summary.json / log / post-checks / grafana-url
```

---

## Gate 18 — DR drill

### Acceptance criteria (ARCHITECTURE.md §4.4, verbatim)

> Simulate PG primary loss. Replica promoted; reads+writes resume; no
> lost events (outbox drained after failover).

### Prerequisites

- Current nightly pg_basebackup exists in
  `minio:/instigenie-pg-backup/base/$(date -u +%Y-%m-%d)/` with a
  matching heartbeat object.
- `erp_backup_last_success_hours` metric is < 1 at drill start.
- `CONFIRM_DR=1` and the DR paranoia convention is understood by the
  tester — the drill runs against **staging**, but the script is the
  same one used in a real production DR.
- `mc` is configured with a `MINIO_ALIAS` that has read access to
  `instigenie-pg-backup`.
- A disposable scratch Postgres host is provisioned with docker
  installed and SSH access; its `/var/lib/postgresql/data-restore` is
  safe to wipe.

### Commands to execute

Dry-run first to sanity-check the plan and catch missing env vars:

```bash
./ops/dr/restore-drill.sh \
    --replica-host scratch-pg.staging.internal \
    --primary-host postgres-primary.staging.internal \
    --dry-run
```

Then run for real (both of these; the first validates the restore path,
the second validates the promote path):

```bash
# 1. Restore drill — pulls latest base from MinIO, replays WAL, runs sanity queries, tears down.
export MINIO_BUCKET=instigenie-pg-backup
export MINIO_ALIAS=minio-staging
CONFIRM_DR=1 ./ops/dr/restore-drill.sh \
    --replica-host scratch-pg.staging.internal \
    --primary-host postgres-primary.staging.internal \
    | tee /var/log/dr/gate18-restore-$(date -u +%Y%m%dT%H%M).log

# 2. Promote drill — simulates primary loss by stopping the staging primary,
#    then promotes the staging replica. Do this as a paired exercise.
ssh postgres-primary.staging.internal 'sudo systemctl stop postgresql'
CONFIRM_DR=1 ./ops/dr/promote-replica.sh \
    --replica-host postgres-replica.staging.internal \
    --primary-host postgres-primary.staging.internal \
    | tee /var/log/dr/gate18-promote-$(date -u +%Y%m%dT%H%M).log
```

Immediately after the promotion completes, verify that outbox events
drained by watching `erp_outbox_pending_age_max_seconds` drop back
below 30s within 2 minutes (required by the gate's "no lost events"
clause). The metric staying flat is a FAIL.

### Post-drill teardown

- Rebuild the staging primary as a fresh replica of the promoted node
  (see backup-dr.md §"Provision a replacement replica"). Do NOT let
  the old primary rejoin as primary.
- Record measured RTO (wall-clock between `systemctl stop` and first
  successful staging write against the promoted node).

### Evidence artifact

- `gate18-restore-<ts>.log` and `gate18-promote-<ts>.log` — the JSON
  structured logs from both scripts. Each contains a measured RTO
  line (`measure_rto` step).
- Screenshot of `erp_outbox_pending_age_max_seconds` Grafana panel
  covering the 15 minutes around promotion.
- The filled `ops/runbook-drills/gate-21-failure-injection.md` row
  for "Primary unreachable — full DR drill".

### Sign-off

```
Executed by: ___   Date: ___   Result: PASS / FAIL
Measured RTO: ___ minutes (target < 240 = 4h)
Outbox drain time: ___ minutes (target < 2)
```

### Human-judgment caveats

Two steps in this gate deliberately remain human-gated (they are
listed here so the auditor sees they were intentional, not missed):

- **Rotating `DATABASE_URL` / `DATABASE_DIRECT_URL` in every app
  deployment** is not scripted — the exact rotation path depends on
  the deploy platform in use and is owned by the deploy captain.
  `promote-replica.sh` prints the reminder in its `report_next_steps`
  output.
- **Deciding the old primary is truly unrecoverable** (vs. "flaky,
  will come back in 10 minutes") is a human call. The script refuses
  to run without `CONFIRM_DR=1` specifically so that call is
  deliberate.

---

## Gate 20 — Compliance walk-through

### Acceptance criteria (ARCHITECTURE.md §4.4, verbatim)

> ISO 13485 + Part 11 checklist reviewed by compliance lead;
> signatures, audit, immutability demonstrated.

### External auditor's checklist

The compliance lead walks the auditor through each of the four
demonstrations below. Every demonstration has a linked Gate test
that provides automated evidence — the auditor can verify green CI
status for the release SHA as part of the walk-through.

| Checklist item | Demonstration | Gate test(s) that prove it |
|---|---|---|
| **Hash chain integrity** (Part 11 §11.10(e)) | Compliance lead triggers `POST /api/admin/audit/verify-chain` against the prod org used for the walk-through. Auditor observes the `{status: "COMPLETED", orgs_broken: 0}` response and the resulting row in `qc_cert_chain_audit_runs`. | `tests/gates/gate-40-phase4-compliance-hashchain.test.ts` (chain scheduler + watchdog), `tests/gates/gate-41-phase4-audit-hashchain.test.ts` (per-row forward hash). |
| **Immutability trigger** (ISO 13485 §4.2.5; Part 11 §11.10(c)) | Compliance lead attempts `UPDATE audit.log SET ... WHERE id = ...` and `DELETE FROM audit.log WHERE ...` via psql as a superuser. Both must fail with the Postgres rule error (`cannot update audit.log — table is append-only`). | `tests/gates/gate-37-phase3-approval-immutability.test.ts`. |
| **E-signature flow** (Part 11 §11.200) | Compliance lead executes a CRITICAL action in the app (e.g. approve a QC certificate) and walks through the e-signature challenge — password re-auth, reason text, user name + timestamp captured, resulting `audit.log` row linked to the action. Auditor inspects the `signature_meaning`, `signature_performed_by`, `signature_reason`, and `signed_at` columns. | `tests/gates/gate-42-phase4-esignature.test.ts` (e-sig structural columns), `tests/gates/gate-43-phase4-esig-critical-actions.test.ts` (critical actions require e-sig). |
| **Audit dashboard** (21 CFR Part 11 §11.10(e) — retrievable record) | Compliance lead navigates to `/admin/audit` in the app, searches by actor + date range, exports a CSV, and opens the CSV in Excel. Auditor confirms every row includes `actor_id`, `actor_name`, `object_type`, `object_id`, `action`, `changed_at`, `prev_hash`, `row_hash`, `signature_*` columns. | `tests/gates/gate-18-vendor-audit-log.test.ts` (every vendor-admin mutation writes one row), `tests/gates/gate-19-vendor-bypassrls.test.ts` (the audit dashboard's BYPASSRLS read path is explicitly the only one allowed). |

### Commands to execute

The walk-through is the evidence. The supporting automated evidence
is the CI run on the release SHA. Pull the four gate test results:

```bash
# Assumes the release SHA is in $RELEASE_SHA
gh run list --branch "${RELEASE_SHA}" --workflow ci --json databaseId,conclusion \
  | jq '.[] | select(.conclusion=="success") | .databaseId'

# Then for the most recent green run:
for gate in gate-18-vendor-audit-log gate-19-vendor-bypassrls \
            gate-37-phase3-approval-immutability \
            gate-40-phase4-compliance-hashchain gate-41-phase4-audit-hashchain \
            gate-42-phase4-esignature gate-43-phase4-esig-critical-actions; do
  gh run view "${RUN_ID}" --log | grep -E "(${gate}|PASS|FAIL)" | head -20
done
```

### Evidence artifact

- The auditor's signed checklist PDF (physical or DocuSign).
- `gate-20-ci-evidence.txt` — the concatenated output of the four
  gate test result blocks above.
- Screenshot of `/admin/audit` CSV export opened in Excel.
- Timestamp log of the four demonstrations with the participating
  compliance lead's name.

### Sign-off

```
Executed by: ___   Date: ___   Result: PASS / FAIL
Compliance lead: ___
Auditor: ___
Auditor's checklist PDF attached: Y / N
Demonstrations witnessed:
  [ ] Hash chain integrity
  [ ] Immutability trigger
  [ ] E-signature flow
  [ ] Audit dashboard export
```

### Human-judgment caveats

This gate is fundamentally human-gated by design — the auditor's
sign-off is the deliverable. The automation exists to reduce the
chance the walk-through hits a regression surprise, not to replace
the auditor.

---

## Gate 21 — Runbooks executable

### Acceptance criteria (ARCHITECTURE.md §4.4, verbatim)

> On-call engineer executes every CRITICAL alert runbook against
> staging failure injection.

### Prerequisites

- Drill window announced in `#oncall-alerts`; the on-call engineer
  executing the drills is on the PagerDuty rotation for the window
  (so PagerDuty reaches a real human).
- Staging has capacity for brief degradation — do NOT run this
  during the Gate 17 soak window.
- Every row in `ops/runbook-drills/gate-21-failure-injection.md` has
  a tester assigned in the release PR.

### Commands to execute

The matrix lives in
`ops/runbook-drills/gate-21-failure-injection.md`. Each row is a
single injection command + expected page + linked runbook procedure.
The on-call engineer works the matrix top-to-bottom:

1. Execute the injection command as written.
2. Confirm the PagerDuty page arrives within the stated SLA.
3. Execute the linked runbook's Triage / Rollback / Verification
   sections end-to-end.
4. Fill in the sign-off cell with UTC date + initials.

Gate 21 is CLOSED only when every row has a filled sign-off.

```bash
# Quick visual confirmation that no row was skipped at go-live:
grep -c '`___`' ops/runbook-drills/gate-21-failure-injection.md
# Must print 0 — every sign-off box is filled.
```

### Evidence artifact

- The filled `ops/runbook-drills/gate-21-failure-injection.md` (with
  sign-offs) committed to the release PR.
- Screenshots of every PagerDuty page triggered during the drill
  (one folder per alert).
- A short retro doc (< 1 page) listing any runbooks that were found
  ambiguous and the follow-up ticket filed against each.

### Sign-off

```
Executed by: ___   Date: ___   Result: PASS / FAIL
Number of rows in the matrix: ___
Number with filled sign-offs: ___  (must equal the above)
Follow-up tickets filed: ___
```

### Human-judgment caveats

Two flavors of judgment are explicitly reserved for the human
running this gate, and are NOT automated:

- **Did the runbook procedure genuinely work?** Some runbook steps
  (e.g. "look for a poison job at the front of the queue") require
  inspecting real stack traces and making a replay-vs-quarantine
  decision. The fact that the on-call engineer could complete the
  decision with only the runbook in front of them is the point of
  the gate — if they had to ask Slack for help, the runbook fails
  the gate and needs a follow-up.
- **Did the injection reliably reproduce the alert in staging?**
  Some injections are probabilistic (the `§pg-replica-lag` widen-
  the-gap loop for example). If the alert didn't fire, document it
  and re-inject; do not sign off on an unfired alert.

---

## Consolidated release-PR checklist

Copy-paste the block below into the release PR description and fill
it in as the gates are closed:

```
## §4.4 Go-Live Gates

### Gate 17 — Sustained load
- [ ] k6 soak ran to completion against properly sized staging
- [ ] p99 < 2s, 5xx < 0.1%, zero drift, zero dead letters
- [ ] summary.json + log + post-checks attached
- Executed by ___   Date ___   Result PASS / FAIL

### Gate 18 — DR drill
- [ ] restore-drill.sh passed sanity queries
- [ ] promote-replica.sh completed against staging
- [ ] Outbox drained within 2 minutes
- [ ] Measured RTO < 4h
- Executed by ___   Date ___   Result PASS / FAIL

### Gate 20 — Compliance walk-through
- [ ] Hash chain integrity demonstrated
- [ ] Immutability trigger demonstrated
- [ ] E-signature flow demonstrated
- [ ] Audit dashboard export demonstrated
- [ ] Auditor's checklist PDF attached
- Executed by ___   Date ___   Result PASS / FAIL

### Gate 21 — Runbook failure injection
- [ ] Every row in ops/runbook-drills/gate-21-failure-injection.md signed off
- [ ] PagerDuty screenshots attached
- [ ] Retro doc attached with follow-up tickets
- Executed by ___   Date ___   Result PASS / FAIL
```

## Related

- ARCHITECTURE.md §4.4 — authoritative gate definitions.
- `docs/runbooks/load-test.md` — Gate 17 runbook (do not modify; cross-linked).
- `docs/runbooks/backup-dr.md` — Gate 18 runbook (do not modify; cross-linked).
- `docs/runbooks/critical-alerts.md` — Gate 21 per-alert procedures (do not modify; cross-linked).
- `ops/k6/gate-17-sustained-load.js` — Gate 17 executable.
- `ops/dr/promote-replica.sh` — Gate 18 promote script.
- `ops/dr/restore-drill.sh` — Gate 18 restore drill script.
- `ops/runbook-drills/gate-21-failure-injection.md` — Gate 21 drill matrix.
