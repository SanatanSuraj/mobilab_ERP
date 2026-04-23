# Gate 18 — DR promotion + restore drill evidence

## Status at go-live freeze: DRY-RUN-PASSING / RUNTIME-PENDING

Two shell scripts encode the §4.4 Gate 18 procedure. Both are executable
and both pass their dry-run self-check:

- `promote-replica-dryrun.txt` — `./ops/dr/promote-replica.sh
  --replica-host localhost --primary-host localhost --dry-run`.
  Structured JSON per step. `incident_id` = `dr-20260423T091723Z`.
  Prints the operator follow-up checklist (DB URL rotation, outbox
  drain check, replacement-replica build).

- `restore-drill-dryrun.txt` — `./ops/dr/restore-drill.sh
  --replica-host localhost --primary-host localhost --dry-run`.
  Structured JSON per step. `drill_id` = `restore-drill-20260423T091752Z`.
  Walks through preflight → fetch_base → unpack_and_configure →
  start_container → wait_for_replay → sanity_queries → teardown →
  measure_rto. Sanity queries cover `audit.log`, `cron.job` (the two
  phase-4 schedulers), `outbox_events`, `stock_summary`, `sales_invoices`.
  Elapsed time 0s (dry-run); RTO target 14400s (4h).

## Deferred to staging

The actual drill runs against `postgres-primary.staging` /
`postgres-replica.staging` with `CONFIRM_DR=1`. Follow
`docs/runbooks/backup-dr.md` §"Production DR" and the quarterly restore
section. Steps:

1. `ssh postgres-primary.staging 'sudo systemctl stop postgresql'` —
   simulate primary crash (Gate 21 drill matrix row 11).
2. `CONFIRM_DR=1 ./ops/dr/promote-replica.sh --replica-host postgres-replica.staging --primary-host postgres-primary.staging 2>&1 | tee gate-18-promote.log`.
3. Measure RTO (timestamp between step-1 stop and first successful write
   through rotated DSN). Target: < 60 min.
4. Rebuild a fresh replica from the latest `pg_basebackup`.
5. Restore drill: `CONFIRM_DR=1 MINIO_BUCKET=... MINIO_ALIAS=... ./ops/dr/restore-drill.sh --replica-host scratch-host.staging --primary-host postgres-primary.staging 2>&1 | tee gate-18-restore.log`.
6. Place `gate-18-promote.log` + `gate-18-restore.log` here and flip
   `RELEASE-CHECKLIST.md` Gate 18 row from `DRY-RUN-PASSING` →
   `PASS/<date>/<operator>/RTO=<minutes>m`.

## Tooling preconditions

- `ops/dr/promote-replica.sh` — present, `chmod +x` applied.
- `ops/dr/restore-drill.sh` — present, `chmod +x` applied.
- `docs/runbooks/backup-dr.md` — present.
