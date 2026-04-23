# Instigenie ERP — Production Runbooks

These runbooks back Phase 4 §4.3 (Production Hardening) and Gate 21
("On-call engineer executes every CRITICAL alert runbook against staging
failure injection"). Every CRITICAL alert listed in ARCHITECTURE.md
§10.3 has an entry under [critical-alerts.md](./critical-alerts.md).

## Layout

| Runbook | Owns |
|---------|------|
| [minio-3-node-cluster.md](./minio-3-node-cluster.md) | MinIO erasure-coded cluster, lifecycle policy, bucket replication. |
| [pgbouncer-replica.md](./pgbouncer-replica.md) | Second PgBouncer pooler + leader-elected listener. |
| [alertmanager-routing.md](./alertmanager-routing.md) | Alertmanager config: PagerDuty / Slack / Email routing, escalation. |
| [backup-dr.md](./backup-dr.md) | `pg_basebackup` nightly to MinIO, logical replication slot, quarterly restore drill. |
| [secret-rotation.md](./secret-rotation.md) | Vault / cloud KMS rotation schedule + zero-downtime rollout. |
| [load-test.md](./load-test.md) | 10k users / 500 concurrent / 1h soak recipe with k6. |
| [audit-archive.md](./audit-archive.md) | Ship `audit.log_archive` + `stock_ledger_archive` to MinIO JSONL. |
| [critical-alerts.md](./critical-alerts.md) | One play per CRITICAL Prometheus alert (§10.3). |

## Conventions

- Commands assume `bash`; prefix each destructive step with `# IRREVERSIBLE`.
- Every runbook ends with a **Rollback** section. If rollback is not
  applicable (e.g. a one-way migration), say so explicitly.
- Secrets are referenced by name only (`$PG_SUPERUSER_PASSWORD`), never
  pasted. See [secret-rotation.md](./secret-rotation.md) for retrieval.
- Gate 21 requires every CRITICAL runbook to be executed against
  staging failure injection at least once per quarter. The check-in log
  lives in `ops/gate21-runbook-drills.md` (tracked separately).

## Gates mapping

| Gate | Runbooks exercised |
|------|---------------------|
| Gate 17 (Sustained load) | load-test.md |
| Gate 18 (DR drill) | backup-dr.md |
| Gate 19 (Audit integrity) | critical-alerts.md §audit-chain-break, audit-archive.md |
| Gate 20 (Compliance walk-through) | audit-archive.md, critical-alerts.md §audit-chain-break |
| Gate 21 (Runbooks executable) | **all** |
