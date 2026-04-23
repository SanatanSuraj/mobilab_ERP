# Audit Archive — cold-storage shipper

**Owns**: the worker that reads `audit.log_archive` +
`stock_ledger_archive` and streams JSONL into MinIO's
`instigenie-audit-archive` bucket. Closes the loop from `pg_cron`
(which moves rows out of the hot tables into the `_archive` cold
tables — see `ops/sql/init/18-phase4-pg-cron.sql`) to durable
off-Postgres storage.

**Why it exists** (Phase 4 §4.2): ARCHITECTURE.md requires audit +
stock ledger rows > 90 days to leave Postgres (hot storage) for
MinIO (cold storage). `pg_cron` cannot speak HTTP, so the
boundary between Postgres and MinIO is a BullMQ worker job.

**Compliance invariants** (21 CFR Part 11):

- **Never UPDATE** an archived row — the hash chain in audit.log
  carries forward into the archive. An UPDATE anywhere in the
  pipeline breaks `erp_audit_chain_break`.
- **Never delete from the archive bucket** — only TRUNCATE the
  `_archive` Postgres table AFTER MinIO has acknowledged the write
  with its ETag.
- Object lock on `instigenie-audit-archive` is **not** enabled (that
  bucket holds the derived JSONL — the source-of-truth immutability
  lives in the BMR bucket). Object-lock is overkill here and blocks
  lifecycle → GLACIER transitions.

## Pipeline

```
  pg_cron (03:00 daily)
     │
     ▼
  phase4_archive_audit_old_rows()
     │  moves rows > 90d into audit.log_archive / stock_ledger_archive
     ▼
  audit-archive-shipper (BullMQ repeatable, 03:30 daily)
     │  reads _archive, streams JSONL to MinIO, TRUNCATEs on ack
     ▼
  minio:/instigenie-audit-archive/
      audit/YYYY/MM/DD/audit-log-<run_id>.jsonl.gz
      ledger/YYYY/MM/DD/stock-ledger-<run_id>.jsonl.gz
```

30-minute gap between `pg_cron` sweep and the shipper is deliberate —
lets the cron transaction fully commit + WAL-ship to the replica
before we start reading.

## Worker — `apps/worker/src/processors/audit-archive.ts`

Registered on `QueueNames.auditArchive` (low-priority queue; not
`critical`). Repeatable job: `every: 24h, startDate: 03:30 UTC`.

Per run:

1. Insert a RUNNING row into `audit.archive_runs` (or reuse the row
   the cron proc already wrote — same UUID carries across both
   phases).
2. Stream rows out of `audit.log_archive` in ORDER BY `changed_at ASC`
   in batches of 1,000 (cursor-based, not LIMIT/OFFSET — the table
   can be millions of rows). Gzip + JSONL encode on the fly.
3. Multipart-upload to
   `minio:/instigenie-audit-archive/audit/YYYY/MM/DD/audit-log-<run_id>.jsonl.gz`.
   The key includes the run_id so a retry doesn't clobber a
   partially-uploaded object — the next run writes a fresh key.
4. On successful `PutObject` ack (ETag captured):

   ```sql
   TRUNCATE audit.log_archive;   -- whole table; everything we read is now in MinIO
   ```

   The TRUNCATE is safe because the sweep moves strictly
   older-than-90d rows and the cron proc holds no concurrency
   contract with the shipper (30 min gap). If a new row lands in
   the cold table between step 2 and step 4 (shouldn't — cron is
   once-daily), it survives to the next sweep.

5. Repeat steps 2–4 for `stock_ledger_archive` → `ledger/YYYY/MM/DD/`.
6. Update `audit.archive_runs` to COMPLETED with the object keys and
   byte counts.

On any error (MinIO 5xx, network, S3 auth failure):

- Roll back to RUNNING → FAILED with `error` populated.
- DO NOT TRUNCATE. The cold table retains the rows; the next
  scheduled run will retry.
- BullMQ retry policy: 3 attempts @ 60s backoff, then dead-letter.
  A DLQ entry on `audit-archive` is CRITICAL — see
  [critical-alerts.md](./critical-alerts.md) §outbox-dead-letter.

### Idempotency guarantee

Because the run_id is embedded in the object key, two concurrent
runs would produce two distinct JSONL objects — neither clobbers
the other. The worker uses BullMQ's `jobId` concurrency=1 so
concurrent runs cannot happen in the first place, but the key
scheme is the defense-in-depth.

## DuckDB query recipe

The archived JSONL.gz is directly queryable from any DuckDB instance
with the `httpfs` + S3 secret set. Compliance reviewers use this to
answer "who touched this PO on 2025-07-14?" without restoring
Postgres.

```sql
INSTALL httpfs;
LOAD httpfs;

SET s3_endpoint='minio.instigenie.internal:9000';
SET s3_url_style='path';
SET s3_use_ssl=true;
SET s3_access_key_id='<from Vault: secret/prod/minio/app_access_key>';
SET s3_secret_access_key='<from Vault: secret/prod/minio/app_secret_key>';

SELECT changed_at, actor_user_id, table_name, row_pk, action
  FROM read_json_auto('s3://instigenie-audit-archive/audit/2025/07/**/*.jsonl.gz')
 WHERE table_name = 'purchase_orders'
   AND row_pk     = '<po uuid>'
   ORDER BY changed_at ASC;
```

The `read_json_auto` call glob-matches across partitioned keys —
push a tighter prefix (`2025/07/14/`) when you know the date, it's
orders of magnitude faster.

## Recovery — restoring a slice into a scratch DB

Rare but necessary for litigation-support queries. Do NOT load back
into the live hot `audit.log` table — the hash chain chains forward
through the archive and a re-inserted row duplicates primary keys.

1. Provision a throwaway Postgres 16 host (standalone; no RLS, no
   app connections).
2. `CREATE TABLE audit_log_restored (LIKE audit.log INCLUDING ALL);`
3. Stream the slice back in via DuckDB → COPY:

   ```sql
   -- From DuckDB, with the S3 secret from the recipe above.
   COPY (
     SELECT * FROM read_json_auto('s3://instigenie-audit-archive/audit/2025/07/**/*.jsonl.gz')
     WHERE org_id = '<target org>'
   ) TO '/tmp/restored.csv' (HEADER, DELIMITER '|');
   ```

   Then on the throwaway Postgres:

   ```sql
   \copy audit_log_restored FROM '/tmp/restored.csv' WITH (FORMAT CSV, HEADER, DELIMITER '|');
   ```

4. Query the scratch DB. When done, drop it — never merge back.

## Monitoring

- `audit.archive_runs` — latest row's `status` is the authoritative
  "did the last run work?" signal. The admin audit dashboard
  surfaces this via `/api/admin/audit/archive-runs`.
- Prometheus gauge `erp_audit_archive_last_success_timestamp` — the
  shipper worker writes this on COMPLETED; the alert
  `erp_audit_archive_last_success_hours > 26` is CRITICAL (the job
  should run daily; 26h is the same 2-hour grace as the hashchain
  watchdog).
- Bucket size: `mc du minio/instigenie-audit-archive` monthly.
  Growth should be linear-ish; a sudden step-up means either a
  burst of legitimate audit activity (check app) or a shipper bug
  writing duplicates.

## Failure modes

### Shipper falls behind (archive_runs.status = FAILED repeatedly)

- Cold tables grow without bound. Postgres disk alert fires before
  correctness suffers. Fix the shipper before the disk fills.
- Don't "manually TRUNCATE the cold table to recover disk" — that
  DESTROYS audit rows that haven't reached MinIO. The correct
  recovery is to fix the shipper and let it drain; if disk is
  about to fill, extend the volume.

### MinIO bucket deleted (someone `mc rb --force` in error)

- Catastrophic. File immediately as a compliance incident.
- The rows that have already been TRUNCATEd from Postgres are gone
  from hot storage. Recovery path: restore `instigenie-audit-archive`
  from MinIO's nightly lifecycle-tier GLACIER copy (lifecycle moves
  to GLACIER after 30 days — see
  [minio-3-node-cluster.md](./minio-3-node-cluster.md)). Anything
  newer than 30 days is unrecoverable.
- Rotate MinIO credentials immediately; whoever had rb permission
  shouldn't have had it.

### Hash chain verify fails on a row in the archive

- The archived JSONL is read-only; if verification fails against it,
  the corruption happened either (a) before the row left Postgres
  (check audit.log's immutability rule — someone UPDATEd or DELETEd
  via a superuser path) or (b) in transit to MinIO (shouldn't
  happen; gzip+JSONL has no intermediate parsing).
- Either way it's CRITICAL. See
  [critical-alerts.md](./critical-alerts.md) §audit-chain-break.

## Rollback

Stopping the shipper is safe — cold tables grow, but correctness is
preserved and the next restart drains them. Run

```bash
kubectl scale deployment/worker-default --replicas=0   # WARNING: stops ALL default-queue work
```

only if the shipper itself is producing bad data; otherwise disable
just the repeatable job:

```bash
# From any host with BullMQ admin access.
bull remove-repeatable audit-archive --every 86400000
```

Removing the repeatable stops scheduling; the worker continues
processing other queues. Re-add after the fix:

```bash
bull add-repeatable audit-archive --every 86400000 --start "2026-04-23T03:30:00Z"
```

## Related

- [minio-3-node-cluster.md](./minio-3-node-cluster.md) — the
  `instigenie-audit-archive` bucket + GLACIER lifecycle.
- `ops/sql/init/18-phase4-pg-cron.sql` — the cron proc that feeds
  this worker.
- [critical-alerts.md](./critical-alerts.md) §audit-chain-break,
  §outbox-dead-letter.
- ARCHITECTURE.md §4.2 "Archive `pg_cron`: `audit_log` and
  `stock_ledger` partitions > 90 days → MinIO JSONL".
- ARCHITECTURE.md Gate 19 (audit integrity) + Gate 20 (compliance
  walk-through).
