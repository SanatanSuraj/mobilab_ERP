# Gate 21 — Runbook Failure Injection Drill

**Purpose**: execute §4.4 Gate 21 — "On-call engineer executes every
CRITICAL alert runbook against staging failure injection." One row per
CRITICAL alert defined in `docs/runbooks/critical-alerts.md`. Each row
documents the exact injection command that reliably fires the alert in
**staging** (never run any of these in production), the expected page,
the corresponding runbook procedure to execute, and a sign-off box.

**How to use**:

1. Announce the window in `#oncall-alerts` and confirm the tester is on
   PagerDuty rotation so pages reach the intended human.
2. For each row below, execute the injection command against **staging**
   exactly as written. Do NOT alter the target host to production.
3. Confirm the page lands in PagerDuty with the expected alert name and
   severity. Screenshot for the evidence folder.
4. Execute the linked runbook procedure end-to-end — do not skip steps
   even if the cause is obvious from the injection.
5. Fill in the sign-off box with UTC date + initials after the alert
   auto-resolves and Verification passes.
6. A row with an empty sign-off at go-live blocks Gate 21.

All injection commands assume `kubectl` / `psql` / `redis-cli` contexts
already point at the `instigenie-staging` namespace and its sidecars.
Prefix with the appropriate `-n instigenie-staging` where relevant.

---

## Drill matrix

| Alert | Injection command | Expected page | Runbook path | Sign-off (UTC date + initials) |
|---|---|---|---|---|
| `§outbox-dead-letter` (`erp_outbox_dead_letter_count > 0`) | `redis-cli -h redis-bull.staging -p 6379 XADD bull:outbox-dispatch:failed '*' failedReason 'drill-injection' payload '{"jobId":"drill-inject","topic":"noop"}'` — appends a synthetic failed-job entry. Alternative: submit an outbox event whose topic handler throws on purpose in staging only. | PagerDuty CRITICAL `erp_outbox_dead_letter_count > 0` within 2m. | `docs/runbooks/critical-alerts.md#outbox-dead-letter` | `___` |
| `§stock-drift` (`erp_stock_drift_detected > 0`) | `psql -h postgres-primary.staging -U postgres -d instigenie -c "UPDATE stock_summary SET reserved_qty = reserved_qty + 1 WHERE org_id = '<staging-drill-org>' AND item_id = '<staging-drill-item>';"` — bypasses the ledger trigger, forcing drift. Reconcile IMMEDIATELY after the page fires using the §stock-drift reconcile SQL. | PagerDuty CRITICAL `erp_stock_drift_detected` within 5m (rule evaluates hourly; use `--promote-now` on the recording rule if available to speed the drill). | `docs/runbooks/critical-alerts.md#stock-drift` | `___` |
| `§audit-chain-break` (`erp_audit_chain_break > 0`) | `psql -h postgres-primary.staging -U postgres -d instigenie -c "INSERT INTO qc_cert_chain_audit_runs (status, orgs_broken, breaks, started_at, completed_at) VALUES ('FAILED', 1, '[{\"orgId\":\"drill\",\"certId\":\"drill\",\"certNumber\":\"DRILL-001\",\"expected\":\"AA\",\"actual\":\"BB\"}]'::jsonb, now(), now());"` — inserts a synthetic FAILED audit run (the metric scrapes this table). | PagerDuty CRITICAL `erp_audit_chain_break > 0` within 2m of next scrape. | `docs/runbooks/critical-alerts.md#audit-chain-break` | `___` |
| `§bullmq-critical-backlog` (`erp_bullmq_queue_depth{queue="critical"} > 50`) | `kubectl scale deployment/worker-critical -n instigenie-staging --replicas=0` — stops the `critical` worker so queued jobs pile up. Kick a few dozen outbox events to be sure (`for i in $(seq 1 60); do curl -X POST ...staging.../drill/enqueue-noop-critical; done`). | PagerDuty CRITICAL `erp_bullmq_queue_depth{queue="critical"} > 50` within 2m. Remediate by `kubectl scale ... --replicas=2`. | `docs/runbooks/critical-alerts.md#bullmq-critical-backlog` | `___` |
| `§redis-bull-memory` (`erp_bull_redis_memory_used_pct > 80`) | `docker kill $(docker ps -q --filter name=redis-bull-staging)` — simulates node loss so that failover to secondary Redis is exercised. Alternative for memory growth: `redis-cli -h redis-bull.staging -p 6379 DEBUG JMAP` plus a scripted loop inserting large synthetic keys under a `drill:*` prefix you delete afterwards. Use `docker kill` as the default — it is more deterministic. | PagerDuty CRITICAL `erp_bull_redis_memory_used_pct > 80` or `up{job="redis-bull"} == 0` within 3m depending on which metric trips first. | `docs/runbooks/critical-alerts.md#redis-bull-memory` | `___` |
| `§backup-missed` (`erp_backup_last_success_hours > 25`) | On the staging backup host: `sudo systemctl stop pg-basebackup.timer && mc rm --force minio-staging/instigenie-pg-backup/heartbeat/$(date -u +%Y-%m-%d)` — deletes today's heartbeat and prevents tonight's timer from writing a new one. Re-enable the timer within 12h of starting the drill to avoid a real RPO gap. | PagerDuty CRITICAL `erp_backup_last_success_hours > 25` at the next scrape after the 25h threshold crosses. For a same-day drill, temporarily override the rule's for-duration to 5m. | `docs/runbooks/critical-alerts.md#backup-missed` | `___` |
| `§minio-node-down` (`up{job="minio"} == 0` for a node) | `ssh minio-staging-02 'sudo systemctl stop minio'` — simulates a single-node outage. EC:4+2 tolerates 1 node loss so this is safe. Do NOT stop a second node; that takes the cluster read-only. | PagerDuty CRITICAL `up{job="minio",instance="minio-staging-02:9000"} == 0` within 1m. | `docs/runbooks/critical-alerts.md#minio-node-down` plus `docs/runbooks/minio-3-node-cluster.md` §node-failure | `___` |
| `§listen-notify-split-brain` (`sum(erp_listen_notify_leader) != 1`) | To simulate ZERO leaders: `kubectl delete pod -l app=listen-notify -n instigenie-staging --grace-period=0 --force` — delete both pods simultaneously. The redis-bull lock expiry window (~35s) creates the no-leader state. | PagerDuty CRITICAL `sum(erp_listen_notify_leader) != 1` within 90s. | `docs/runbooks/critical-alerts.md#listen-notify-split-brain` plus `docs/runbooks/pgbouncer-replica.md` §failure-modes | `___` |
| `§pg-replica-lag` (escalates to CRITICAL when WAL behind > 10GB) | `psql -h postgres-primary.staging -U postgres -c "SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots WHERE slot_name='erp_replica' AND active_pid IS NOT NULL;"` — kills the replication connection; replica falls behind while the walsender reconnects. Combine with a synthetic write-amplifier loop against a staging-only table to widen the gap into the CRITICAL band. | HIGH `erp_pg_replication_lag_seconds > 10` within 60s; CRITICAL variant (`erp_replication_slot_lag_bytes > 10GB`) after sustained drift. | `docs/runbooks/critical-alerts.md#pg-replica-lag` | `___` |
| Replication-slot abandonment (`erp_replication_slot_lag_bytes > 10GB` cascades from the above) | Keep the replica stopped (`kubectl scale deployment/postgres-replica -n instigenie-staging --replicas=0`) while a staging write loop runs. The slot on the primary retains WAL; the lag metric grows monotonically. | HIGH `erp_replication_slot_lag_bytes > 10GB`; escalates CRITICAL once disk-pressure rules on the primary fire. | `docs/runbooks/backup-dr.md` §logical-replication-slot | `___` |
| Primary unreachable — full DR drill (`Gate 18 rehearsal`) | `iptables -I INPUT -s <api-pod-cidr> -p tcp --dport 5432 -j DROP` on `postgres-primary.staging` — simulates a network partition severing the API from the primary without actually crashing Postgres. Remove the rule after the drill. For the full DR rehearsal, stop the primary container entirely: `ssh postgres-primary.staging 'sudo systemctl stop postgresql'`. | PagerDuty CRITICAL `up{job="postgres",role="primary"} == 0` within 1m. Follow with `ops/dr/promote-replica.sh --replica-host postgres-replica.staging --primary-host postgres-primary.staging --dry-run` first, then re-run with `CONFIRM_DR=1` against staging. | `docs/runbooks/backup-dr.md` §"Production DR (primary crash)" + `ops/dr/promote-replica.sh` | `___` |

---

## Drill completion

Drill is considered complete for go-live purposes when every row in
this matrix has a filled sign-off box. Partial completion (e.g. one
row skipped due to staging infra unavailability) blocks Gate 21;
document the reason in the release PR and reschedule before launch.

After the last sign-off:

- Append a line to `docs/runbooks/pre-launch-checklist.md` Gate 21
  section with the drill window, tester, and any remediations filed.
- File a follow-up ticket for any alert whose runbook turned out to
  be ambiguous or wrong during the drill (common outcome; the whole
  point of Gate 21).
- Confirm every injection has been reverted (workers scaled back up,
  iptables rules removed, heartbeat objects restored) before closing.

## Related

- `docs/runbooks/critical-alerts.md` — per-alert runbook source of truth.
- `docs/runbooks/alertmanager-routing.md` — severity → receiver mapping.
- `docs/runbooks/pre-launch-checklist.md` — master Gate 17/18/20/21 checklist.
- ARCHITECTURE.md §4.4 Gate 21 and §10.3 alert table.
