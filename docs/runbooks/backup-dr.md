# Backup & Disaster Recovery

**Owns**: the `pg_basebackup → MinIO` nightly pipeline, WAL archiving,
and the quarterly restore drill that closes Gate 18. If this runbook
is silently broken, the business has no RPO/RTO worth naming.

**SLOs** (ARCHITECTURE.md §4.3, §10.3):

- **RPO** ≤ 15 minutes — WAL archiving continuous; last successful
  archived WAL is at most 15 min old at any time.
- **RTO** ≤ 4 hours — primary crash to reads+writes restored.
- `erp_backup_last_success_hours > 25` is **CRITICAL** — a missed
  nightly paging on-call.

## Topology

```
  postgres-primary ─┬─ WAL stream → archive_command → minio:/instigenie-pg-backup/wal/
                    │
                    └─ pg_basebackup (03:00 daily) → minio:/instigenie-pg-backup/base/YYYY-MM-DD/
  postgres-replica ─── replication slot `erp_replica` (DO NOT DROP)
```

Retention in `instigenie-pg-backup`:

- `base/YYYY-MM-DD/`: keep 14 days of base backups.
- `wal/`: keep 14 days of WAL. (Every base is replayable against any
  WAL timestamp within the retention window.)
- Lifecycle: MinIO policy tiers to GLACIER after 30 days (before
  deletion at 14 days, the cheap tier holds a compliance copy).

## Nightly backup

### `pg_basebackup` wrapper

Runs from a dedicated backup host (not the primary), scheduled via
systemd timer at 03:00. Source at `ops/backup/pg-basebackup.sh`:

```bash
#!/usr/bin/env bash
# Invoked from pg-basebackup.service via pg-basebackup.timer (03:00 daily).
# Publishes to minio:/instigenie-pg-backup/base/<UTC date>/.

set -euo pipefail
umask 077

DATE=$(date -u +%Y-%m-%d)
WORK=/var/lib/backup/work/${DATE}
TARGET=minio/instigenie-pg-backup/base/${DATE}

mkdir -p "${WORK}"
trap 'rm -rf "${WORK}"' EXIT

# Stream compressed + checksummed. --wal-method=stream lets us finish
# WAL replay up to the end of the basebackup without touching the
# archive path.
pg_basebackup \
  --host=postgres-primary \
  --port=5432 \
  --username=repl \
  --pgdata="${WORK}" \
  --format=tar \
  --gzip \
  --progress \
  --wal-method=stream \
  --checkpoint=fast \
  --label="erp-${DATE}"

# Upload. mc cp is idempotent per-file (it uses part-by-part ETag
# compare), so a re-run after a transient failure will skip completed
# parts.
mc cp --recursive "${WORK}/" "${TARGET}/"

# Post a healthcheck ping so Prometheus sees a fresh
# `erp_backup_last_success_timestamp`.
mc cp - "minio/instigenie-pg-backup/heartbeat/${DATE}" <<< "ok" >/dev/null

echo "backup ${DATE} uploaded"
```

### WAL archiving

`postgresql.conf` on the primary:

```
archive_mode = on
archive_command = '/usr/local/bin/erp-wal-archive %p %f'
archive_timeout = 900              # force-switch WAL every 15 min for RPO
wal_level = logical                # also required for the LR slot
max_wal_senders = 10
```

`/usr/local/bin/erp-wal-archive` (ships the file and returns 0 ONLY on
success — a non-zero exit stops Postgres from recycling the WAL
segment):

```bash
#!/usr/bin/env bash
# %p = source file path, %f = filename
set -euo pipefail
SRC=$1
NAME=$2
mc cp "${SRC}" "minio/instigenie-pg-backup/wal/${NAME}" >/dev/null
# mc cp exit code is the script's exit code.
```

### Verification after nightly run

```bash
# Latest base shows up with the expected tarball set.
mc ls minio/instigenie-pg-backup/base/ | tail -5

# Heartbeat object for today exists.
mc stat "minio/instigenie-pg-backup/heartbeat/$(date -u +%Y-%m-%d)"

# WAL segments in the last hour.
mc find minio/instigenie-pg-backup/wal/ --newer-than 1h | wc -l
# > 4 is healthy (one every 15 min max).
```

## Logical replication slot (DR fallback)

ARCHITECTURE.md §4.3: "logical replication slot for DR". The slot
`erp_dr_slot` on the primary feeds an optional off-site replica.

```sql
-- Create once, never drop without a change ticket. Slots retain WAL
-- on the primary until consumed — an abandoned slot fills the disk.
SELECT pg_create_logical_replication_slot('erp_dr_slot', 'pgoutput');
```

If you drop the slot, the DR replica cannot catch up without a fresh
base backup. The `ops/prometheus/rules/backup.yml` rule
`erp_replication_slot_lag_bytes > 10GB` fires HIGH when the slot
falls behind — that means either the consumer is down, or the slot
was abandoned. Check before deleting anything.

## Quarterly restore drill (Gate 18)

**Cadence**: once per quarter, against staging infra. Close the Gate
21 drill log in `ops/gate21-runbook-drills.md` with the timestamp and
the measured RTO.

### Procedure

1. Spin up an empty Postgres 16 host — same minor version as prod,
   same `shared_preload_libraries` list (pg_cron).

2. Restore the latest base:

   ```bash
   LATEST=$(mc ls minio/instigenie-pg-backup/base/ | tail -1 | awk '{print $NF}')
   mc cp --recursive "minio/instigenie-pg-backup/base/${LATEST}" /var/lib/postgresql/data-restore/
   cd /var/lib/postgresql/data-restore/
   tar -xzf base.tar.gz
   tar -xzf pg_wal.tar.gz -C pg_wal/
   ```

3. Drop `recovery.signal` + `postgresql.auto.conf` with a
   `restore_command` that pulls WAL from MinIO:

   ```bash
   touch /var/lib/postgresql/data-restore/recovery.signal
   cat > /var/lib/postgresql/data-restore/postgresql.auto.conf <<'EOF'
   restore_command = 'mc cp minio/instigenie-pg-backup/wal/%f %p'
   recovery_target_action = 'promote'
   EOF
   ```

4. Start Postgres pointing at the restored data dir. It will replay
   WAL up to the last archived segment and promote.

5. Verify:

   ```sql
   -- Chain integrity.
   SELECT COUNT(*) FROM audit.log;
   SELECT MAX(changed_at) FROM audit.log;
   -- Should be within minutes of when you froze the base.

   -- pg_cron rehydrated.
   SELECT jobname, schedule FROM cron.job;
   -- Must show phase4_archive_audit_old_rows + phase4_watchdog_hashchain.

   -- Outbox not stuck.
   SELECT COUNT(*) FROM outbox_events WHERE dispatched_at IS NULL;
   ```

6. Run a point-in-time sanity INSERT against the restored primary
   (any tenant, any table under RLS) and confirm it succeeds. You
   are now a functional primary.

7. Capture the measured RTO (clock-time from step 1 to step 6) into
   `ops/gate21-runbook-drills.md`. The target is < 4h; if you blow
   past it, file a postmortem.

### Rollback the drill

Tear down the staging host — no production impact possible from the
drill because it ran against a throwaway instance.

## Production DR (primary crash)

This is the real thing, not the drill. Follow it only if
`postgres-primary` is confirmed unrecoverable (node gone, disk
failed, corrupted WAL).

1. Declare an incident; page Finance / Ops leads. Stop trading in
   the app (set `tenant_status.global_freeze=true` via the
   vendor-admin route — that kills new writes while preserving
   reads).
2. Promote the replica:

   ```bash
   # On postgres-replica — this is IRREVERSIBLE; once promoted it
   # cannot return to being a replica of the old primary.
   ssh postgres-replica 'sudo -u postgres pg_ctl promote'
   ```

3. Update `DATABASE_URL` / `DATABASE_DIRECT_URL` in the app deployment
   to point at the promoted node (or update the LB's upstream). The
   app will 5xx for ~30 seconds during the connection-pool rotation,
   then recover.
4. Restore the outbox drain invariant: the promoted node inherits
   every undispatched row, so `listen-notify` just has to reconnect.
   Watch `erp_outbox_pending_age_max_seconds` — it should drain
   within 2 minutes.
5. Provision a replacement replica from the latest base (follow the
   drill procedure, then start it as a streaming replica instead of
   promoting). Until the replica is rebuilt, you are running without
   HA — schedule this as the next priority task.

### Rollback

Not applicable — promotion is one-way. If the old primary comes back,
DO NOT let it rejoin as primary. Rebuild it from the new primary's
base or wipe and re-provision.

## Related

- [minio-3-node-cluster.md](./minio-3-node-cluster.md) —
  `instigenie-pg-backup` bucket lifecycle.
- [critical-alerts.md](./critical-alerts.md) §backup-missed.
- ARCHITECTURE.md §4.3 Production Hardening, §11.4 Failure & Resilience.
