# Critical Alerts — On-call playbooks

**Owns**: one procedure per CRITICAL alert from ARCHITECTURE.md
§10.3. Gate 21 ("On-call engineer executes every CRITICAL alert
runbook against staging failure injection") tracks quarterly drills
against these sections in `ops/gate21-runbook-drills.md`.

**How to use this page**: when paged, find the `§<alertname>`
section, execute `Triage` in order, and escalate if Triage step 3
hasn't narrowed the cause within 15 minutes.

**Shared conventions**:

- "Primary on-call" means the person PagerDuty paged. "Secondary"
  is the escalation in the PagerDuty policy.
- Commands assume `kubectl` context is already set to the prod
  cluster. If you're operating against staging, prefix every command
  with `-n instigenie-staging`.
- Every §section ends with a `Verification` subsection — the alert
  MUST resolve on its own within 5 minutes of the fix; if it
  doesn't, the fix isn't done.

---

## §outbox-dead-letter — `erp_outbox_dead_letter_count > 0`

**Severity**: CRITICAL. A permanent event failure. Every DLQ entry
means at least one downstream side-effect (notification, stock
reserve, GRN-derived invoice) never happened.

### Triage

1. Pull the dead-lettered job payload:

   ```bash
   redis-cli -h redis-bull -p 6379 XRANGE bull:outbox-dispatch:failed - + COUNT 10
   ```

   Look for the `failedReason` field — BullMQ captures the last
   error message. Common cases:

   - `404 /api/notifications/send` — a downstream service is down.
   - `violates foreign key constraint` — the event was enqueued
     referencing a row that got soft-deleted. Rare.
   - `timeout` — the handler exceeded its 30s budget. Often Redis or
     Postgres pressure; check §redis-bull-memory + §api-p99.

2. Check the outbox row state in Postgres:

   ```sql
   SELECT id, topic, dispatched_at, last_error, attempt_count
     FROM outbox_events
    WHERE id IN ('<ids from BullMQ>');
   ```

   `dispatched_at IS NOT NULL` means the listener DID successfully
   enqueue; the failure is purely downstream. `dispatched_at IS NULL
   AND attempt_count >= 3` means the LISTEN path failed repeatedly.

3. Decide: **replay** or **quarantine**?

   - Replay when the failure was transient (downstream came back,
     timeout under load): `bull retry-failed outbox-dispatch <jobId>`.
   - Quarantine when the payload is structurally broken (missing
     required field, invalid FK): move to the manual-review queue,
     file an incident ticket, fix the emitter, then replay against
     a fresh outbox row.

### Rollback

Not applicable — this alert's resolution IS the action. Never "just
clear" DLQ entries without replaying or documenting the
quarantine — a silently dropped event is a compliance gap.

### Verification

- `redis-cli … XLEN bull:outbox-dispatch:failed` returns 0.
- `outbox_events WHERE dispatched_at IS NULL AND attempt_count >= 3`
  returns 0 rows.

---

## §stock-drift — `erp_stock_drift_detected > 0`

**Severity**: CRITICAL. **STOP TRADING**. Per ARCHITECTURE.md §10.3
this is the tripwire: if `stock_summary.reserved_qty` diverges from
`SUM(stock_ledger WHERE txn_type='RESERVATION')` you cannot trust
ANY inventory-dependent decision until reconciled.

### Triage

1. **Freeze writes** on the affected tenant(s):

   ```bash
   # IRREVERSIBLE in the sense that inflight orders will fail loudly
   # for the duration. That is correct; do it first.
   curl -X POST https://api.instigenie.internal/admin/tenants/<orgId>/freeze \
     -H "Authorization: Bearer ${ADMIN_JWT}"
   ```

   If drift is global (all tenants), `POST /admin/global-freeze`.
   This is a vendor-admin action; RBAC requires the `platform:ops`
   role.

2. Identify the drifted item(s):

   ```sql
   SELECT s.org_id, s.item_id, s.reserved_qty,
          COALESCE(SUM(l.quantity) FILTER (WHERE l.txn_type='RESERVATION'), 0) AS ledger_sum
     FROM stock_summary s
     LEFT JOIN stock_ledger l
       ON l.item_id = s.item_id AND l.org_id = s.org_id
    GROUP BY s.org_id, s.item_id, s.reserved_qty
   HAVING s.reserved_qty <> COALESCE(SUM(l.quantity) FILTER (WHERE l.txn_type='RESERVATION'), 0);
   ```

3. Root-cause. The stock trigger that maintains the summary is in
   `ops/sql/triggers/`. Common causes:

   - A new mutation path bypassed the trigger (check for direct
     INSERTs into `stock_summary` in recent code — the trigger
     fires from `stock_ledger`).
   - A long-running transaction held a lock and the summary update
     failed silently. Rare; look for `canceling statement due to
     lock timeout` in Postgres logs for the timestamp range.
   - Deadlock retry didn't re-apply. See ARCHITECTURE.md §3.2.

4. **Reconcile**. The ledger is source-of-truth; rebuild the summary
   from it:

   ```sql
   -- Per affected (org_id, item_id). Do NOT batch-update across
   -- tenants without a line item ownership review — RLS is bypassed
   -- here (SECURITY DEFINER path).
   UPDATE stock_summary s
      SET reserved_qty = COALESCE((
            SELECT SUM(l.quantity)
              FROM stock_ledger l
             WHERE l.item_id = s.item_id AND l.org_id = s.org_id
               AND l.txn_type = 'RESERVATION'), 0),
          updated_at = now()
    WHERE s.org_id = '<orgId>' AND s.item_id = '<itemId>';
   ```

### Rollback

Once the freeze is lifted, reservations flow again. The freeze
itself has no persistent side-effect — lifting is just `POST
/admin/tenants/<orgId>/unfreeze`.

### Verification

- The Gate-12 invariant query returns 0 rows.
- Unfreeze; tail `erp_stock_drift_detected` for 15 minutes. Must
  stay at 0.

### Postmortem

Always. Stock drift is either a bug in the ledger/summary
invariant or a direct-SQL incident — both are review-worthy.

---

## §audit-chain-break — `erp_audit_chain_break > 0`

**Severity**: CRITICAL. A 21 CFR Part 11 incident. This means the
SHA-256 forward chain in `audit.log` fails verification somewhere —
either a row was mutated or the chain has a gap.

### Triage

1. Identify the break location:

   ```sql
   SELECT orgs_broken, breaks
     FROM qc_cert_chain_audit_runs
    WHERE status = 'FAILED'
    ORDER BY completed_at DESC
    LIMIT 1;
   ```

   `breaks` is JSONB: `[{orgId, certId, certNumber, expected,
   actual}, ...]`. `actual: null` means the row is missing; a
   mismatched hash means the row was mutated.

2. **DO NOT** attempt to "fix" the chain by recomputing. The chain
   is the evidence — recomputing destroys it. Record the state.

3. Check `audit.log`'s immutability rules are intact:

   ```sql
   SELECT c.conname, c.contype, pg_get_constraintdef(c.oid)
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'log' AND t.relnamespace = 'audit'::regnamespace;

   -- And the PG rules that block UPDATE/DELETE:
   SELECT rulename, pg_get_ruledef(r.oid)
     FROM pg_rewrite r
     JOIN pg_class t ON t.oid = r.ev_class
    WHERE t.relname = 'log' AND t.relnamespace = 'audit'::regnamespace;
   ```

   If the UPDATE/DELETE rules are missing, someone dropped them.
   That's a secondary incident — file separately.

4. Who had superuser access during the break window?

   ```sql
   -- The Postgres audit extension (pgaudit) logs DDL and role
   -- changes into pg_log. Grep the timestamp range.
   ```

### Watchdog variant

`erp_audit_chain_break_watchdog` fires when `phase4_watchdog_hashchain`
(pg_cron, hourly) has inserted a synthetic FAILED row because the
BullMQ audit-hashchain scheduler missed its 02:00 slot for > 26h.
That is NOT a chain break — it's a scheduler break.

Triage the watchdog variant:

1. Check BullMQ audit-hashchain worker is alive:

   ```bash
   kubectl logs -l app=worker-scheduler --tail=100 | grep audit-hashchain
   ```

2. If the worker is down, restart. The next scheduled run picks
   up and the watchdog's FAILED row is NOT retroactively converted
   — it stays in the run history as evidence of the gap (which is
   correct; auditors want to see the gap).

### Rollback

None for a genuine break. The audit row's state at the moment of
detection is the evidence; preserve it.

### Verification

- The next scheduled `qc_cert_chain_audit_runs` COMPLETED row has
  `orgs_broken = 0`.
- The admin audit dashboard's "last run" card is green.
- File a compliance-impact memo within 24h regardless of whether
  root-cause is found in that window.

---

## §bullmq-critical-backlog — `erp_bullmq_queue_depth{queue="critical"} > 50`

**Severity**: CRITICAL. `critical` is the queue for outbox dispatch
and approval-workflow events. Depth > 50 for any meaningful window
means workers are not keeping up, which means downstream events are
delayed and stock/finance decisions are being made against stale
data.

### Triage

1. Are workers alive?

   ```bash
   kubectl get pods -l app=worker-critical
   # Expect 2/2 running at steady state.
   ```

2. Are workers CPU- or memory-bound?

   ```bash
   kubectl top pods -l app=worker-critical
   ```

   If CPU-bound: scale up (`kubectl scale deployment/worker-critical
   --replicas=4`). The noeviction property of Redis-BULL means
   scale-up is always safe — BullMQ's pessimistic locking prevents
   double-processing.

3. Is there a poison job at the front?

   ```bash
   bull logs critical --job-id $(bull list critical --state active | head -1)
   ```

   A single handler stuck in a retry loop stalls the queue. Move it
   to DLQ manually:

   ```bash
   bull move-to-failed critical <jobId> --reason "manual intervention $(date -I)"
   ```

   Then follow §outbox-dead-letter for that jobId.

### Rollback

Scale-up is safe to leave in place — the only downside is cost. Write
the new replica count into the next release's values.yaml.

### Verification

- Queue depth < 10 within 5 minutes.
- `erp_outbox_pending_age_max_seconds` drops below 30s.

---

## §redis-bull-memory — `erp_bull_redis_memory_used_pct > 80`

**Severity**: CRITICAL. Redis-BULL uses `noeviction`, so hitting
`maxmemory` causes writes to fail with OOM — which means new jobs
can't be enqueued, which means every downstream event stalls. At
80% you have minutes.

### Triage

1. Pre-flight check — which key family is growing?

   ```bash
   redis-cli -h redis-bull -p 6379 --bigkeys
   # Look for large bull:<queue>:{wait|active|delayed|failed} sets.
   ```

2. Most common culprit: a DLQ growing without bound because no one
   drained it. Check `bull:*:failed` sizes:

   ```bash
   for q in outbox-dispatch critical high default pdf; do
     echo "$q: $(redis-cli -h redis-bull -p 6379 XLEN bull:${q}:failed)"
   done
   ```

3. **Do NOT** `FLUSHDB` or delete job keys. BullMQ's invariants
   depend on those keys — you'd erase completed-job history that
   downstream idempotency checks rely on.

4. Resolve the failed jobs (follow §outbox-dead-letter for each
   offender). Completed-job retention is configured on the queue
   (`removeOnComplete: { count: 1000, age: 86400 }`) so once failed
   jobs are cleared, memory naturally trends down.

5. If memory keeps climbing with no obvious DLQ: scale Redis-BULL
   memory — DO NOT enable eviction as the "easy fix". Eviction
   violates Gate 4 (the bootstrap assertion will refuse to start
   workers).

### Rollback

Increasing `maxmemory` is forward-only (scaling down later requires
a maintenance window). Do it.

### Verification

- Memory usage drops below 70% within 10 minutes of clearing DLQ
  backlog.
- Workers continue processing; `erp_bullmq_queue_depth` stays in
  healthy range.

---

## §backup-missed — `erp_backup_last_success_hours > 25`

**Severity**: CRITICAL. RPO breach. Either the nightly
`pg_basebackup` didn't run or it ran and failed silently.

### Triage

1. Check the heartbeat:

   ```bash
   mc stat "minio/instigenie-pg-backup/heartbeat/$(date -u +%Y-%m-%d)"
   # If this 404s, the backup script never reached the "upload
   # heartbeat" step.
   ```

2. Check the systemd timer on the backup host:

   ```bash
   ssh backup-host 'systemctl status pg-basebackup.timer pg-basebackup.service'
   journalctl -u pg-basebackup.service --since "36 hours ago"
   ```

3. Run the backup manually:

   ```bash
   ssh backup-host 'sudo -u postgres /usr/local/bin/erp-pg-basebackup'
   ```

   If it fails, read stderr. Common causes:

   - MinIO auth failure — check Vault for the access key; see
     [secret-rotation.md](./secret-rotation.md).
   - Disk full on backup host — `df -h /var/lib/backup`.
   - Postgres replication slot issue — the replica might be holding
     WAL that's needed for the base. See
     [backup-dr.md](./backup-dr.md) §logical-replication-slot.

### Rollback

Not applicable. A missed backup cannot be backdated.

### Verification

- Today's base object exists at
  `minio/instigenie-pg-backup/base/YYYY-MM-DD/`.
- `erp_backup_last_success_hours` resets to 0 within 30 minutes.
- If the backup-host was the root cause, schedule a replacement
  and rotate — single-host backup is fragile.

---

## §pg-replica-lag — `erp_pg_replication_lag_seconds > 10`

**Severity**: HIGH (not CRITICAL — still requires attention). Reports
automatically route to primary during lag spikes, so application
correctness is preserved; but sustained lag means the replica is
not a viable DR target.

### Triage

1. Is the replica alive?

   ```bash
   psql -h postgres-replica -c 'SELECT pg_is_in_recovery(), now() - pg_last_xact_replay_timestamp()'
   ```

2. Is replication slot still advancing?

   ```bash
   psql -h postgres-primary -c "SELECT slot_name, active, pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS bytes_behind FROM pg_replication_slots"
   ```

3. If the replica is alive but lagging, the usual cause is an
   expensive query holding recovery conflicts. `SELECT * FROM
   pg_stat_activity WHERE datname = 'instigenie' AND state != 'idle'`
   on the replica — kill the long one with `pg_cancel_backend(pid)`.

### Rollback

N/A. Routing back to replica happens automatically once lag drops
below 10s for 60 seconds (handled in the app's `dbRO` router).

### Verification

`erp_pg_replication_lag_seconds` holds below 2s for 10 minutes.

---

## §bullmq-stalled — `erp_bullmq_stalled_count_total > 5 in 10min`

**Severity**: HIGH. A stalled job is one whose `lockDuration` expired
while the worker was still holding it — usually because the handler
has blocking code (a sync CPU loop, a synchronous fs call). Stalled
jobs are auto-redelivered by BullMQ; the alert is telling you that
*something* is wedging the worker.

### Triage

1. Which queue is stalling?

   ```bash
   # Prometheus query: sum by (queue) (rate(erp_bullmq_stalled_count_total[5m]))
   ```

2. Inspect worker flame graphs if available (pyroscope in the
   observability stack). Blocking loops are the signature pattern.

3. If the `pdf` queue is the offender: @react-pdf/renderer is
   notorious for synchronous font-loading on first render. Check
   for recent template changes — any new font file added without
   pre-loading could be the cause.

### Rollback

`kubectl rollout undo deployment/worker-<queue>` if a recent deploy
introduced the regression. Otherwise the fix is forward-only — find
the blocking code and `await` it.

### Verification

`rate(erp_bullmq_stalled_count_total[5m])` → 0 over a 30-minute
window.

---

## §api-p99 — `erp_api_p99_latency_ms > 2000`

**Severity**: HIGH. Gate 17's SLO — p99 < 2s. A breach at 3am might
be a backup job or a cron — don't page too aggressively, but don't
ignore it either.

### Triage

1. Which route?

   ```
   topk(5, histogram_quantile(0.99,
     sum by (route, le) (rate(http_request_duration_seconds_bucket[5m]))
   ))
   ```

2. Is Postgres the bottleneck?

   - `erp_pg_pool_wait_time_ms` > 100ms → pool saturated; scale api
     replicas OR investigate a slow query holding connections.
   - `pg_stat_statements` top-by-total_time → usual suspect is a
     missing index on a new feature's filter column.

3. Is a downstream circuit breaker flapping?

   - `erp_circuit_state{target="ewb_api"}` = half-open oscillation
     triggers retries that pile up p99.

### Rollback

Revert the change that introduced the regression (e.g. new slow
query, new external call). `kubectl rollout undo deployment/api`.

### Verification

p99 holds below 1500ms (not 2000 — don't ride the edge) for 30
minutes.

---

## §api-5xx — `erp_api_error_rate_5xx > 1%`

**Severity**: HIGH.

### Triage

1. Which route + status?

   ```
   topk(10, sum by (route, status) (rate(http_requests_total{status=~"5.."}[5m])))
   ```

2. 500s cluster around a route → likely a code bug. `kubectl logs -l
   app=api --tail=500 | grep -A20 'status: 500'` for a sample
   stack.

3. 503s → downstream dep (PG, Redis, MinIO) is the likely cause.
   Cross-reference §pg-replica-lag / §redis-bull-memory.

4. 502s at the LB → API pod is crashing faster than the readiness
   probe. Check `kubectl get pods -l app=api -o wide` for CrashLoop.

### Rollback

`kubectl rollout undo deployment/api` if a recent deploy is implicated.

### Verification

5xx rate below 0.1% for 15 minutes.

---

## §outbox-pending-age — `erp_outbox_pending_age_max_seconds > 120`

**Severity**: HIGH. Listener-or-worker stuck. Distinct from
§outbox-dead-letter, which is terminal; this one is "pending but
not moving".

### Triage

1. Is the leader listener alive?

   ```bash
   kubectl logs -l app=listen-notify --tail=100 | grep -i drain
   ```

   If no drain activity in > 60s, the listener is wedged. Kill the
   pod — the standby takes over within ~35s (see
   [pgbouncer-replica.md](./pgbouncer-replica.md) §take-over-drill).

   ```bash
   kubectl delete pod $(kubectl get pods -l app=listen-notify -o jsonpath='{.items[?(@.metadata.labels.role=="leader")].metadata.name}')
   ```

2. If the listener is draining but rows still accumulate, workers
   are the bottleneck. See §bullmq-critical-backlog.

3. If Postgres is under heavy WAL pressure, LISTEN notifications can
   be delayed. Check `pg_stat_wal` — write rate spike + disk busy.

### Rollback

N/A. Resolution is the action.

### Verification

`erp_outbox_pending_age_max_seconds` drops below 30s within 5
minutes.

---

## §minio-node-down — `up{job="minio"} == 0` for a node

**Severity**: CRITICAL. EC:4+2 tolerates 1 node loss; a second loss
takes the cluster read-only. Paging is correct.

Full procedure lives in
[minio-3-node-cluster.md](./minio-3-node-cluster.md) §node-failure.
The short version:

1. Confirm the node is actually down (one 5xx isn't definitive).
2. Reboot attempt first.
3. Reimage + rejoin as same hostname if reboot fails.
4. Watch `mc admin heal`; full heal ~6 hours on a 4 TB node.

---

## §listen-notify-split-brain — `sum(erp_listen_notify_leader) != 1`

**Severity**: CRITICAL. Either zero leaders (no one is draining —
equivalent to a listener outage) or two leaders (Redis lock failed
to serialize them).

Full procedure: [pgbouncer-replica.md](./pgbouncer-replica.md)
§failure-modes.

### Triage

1. If `sum == 0`: both listeners crashed or are failing the lock
   refresh. Check Redis-BULL (§redis-bull-memory may be cascading).
2. If `sum > 1`: kill the pod with the older `startedAt`. BullMQ's
   jobId dedup prevents double-delivery during the window.

---

## Related

- [alertmanager-routing.md](./alertmanager-routing.md) — severity
  label → receiver mapping.
- ARCHITECTURE.md §10.3 — authoritative alert table.
- Gate 21 drill log: `ops/gate21-runbook-drills.md` (tracked
  separately).
