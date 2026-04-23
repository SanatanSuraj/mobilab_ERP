-- Phase 4 §4.2 — pg_cron compliance & archive scheduling.
--
-- The bookworm postgres image (ops/postgres/Dockerfile) installs the
-- `postgresql-16-cron` package; compose passes
--   shared_preload_libraries=pg_cron
--   cron.database_name=instigenie
-- on the `command:` line so the extension loads at postmaster start.
--
-- This file:
--   1. CREATEs the extension + ancillary tables (archive cold-storage).
--   2. Declares two deterministic stored procs consumed by the scheduler
--      (`phase4_archive_audit_old_rows`, `phase4_watchdog_hashchain`).
--   3. Schedules both via cron.schedule().
--
-- Two deliberate scope notes:
--
-- * Hash-chain verification itself stays in the BullMQ audit-hashchain
--   worker (apps/worker/src/processors/audit-hashchain.ts) because the
--   hash algorithm lives in @instigenie/api/qc/cert-hash and porting
--   SHA-256 forward-chain computation to PL/pgSQL would create two
--   independent implementations whose drift would silently break
--   verification. What pg_cron adds here is a *watchdog*: if the
--   BullMQ scheduler fails to fire for > 26 hours, the watchdog
--   writes a FAILED row into qc_cert_chain_audit_runs. Prometheus
--   alerting and the admin audit dashboard both already react to that
--   table.
--
-- * The archive proc moves rows to cold tables within Postgres. Shipping
--   to MinIO JSONL (spec line 1567) is a second-phase job owned by the
--   worker — pg_cron cannot speak HTTP. A follow-up worker reads
--   audit_log_archive / stock_ledger_archive, streams to MinIO, and
--   TRUNCATEs on ack. Runbook in docs/runbooks/audit-archive.md.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── Cold-storage archive tables ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit.log_archive (
  LIKE audit.log INCLUDING ALL
);
COMMENT ON TABLE audit.log_archive IS
  'Phase 4 §4.2 cold-storage for audit.log rows older than 90 days. A worker ships these to MinIO JSONL and TRUNCATEs on ack (runbook: audit-archive.md).';

CREATE TABLE IF NOT EXISTS stock_ledger_archive (
  LIKE stock_ledger INCLUDING ALL
);
COMMENT ON TABLE stock_ledger_archive IS
  'Phase 4 §4.2 cold-storage for stock_ledger rows older than 90 days. Same ship-to-MinIO lifecycle as audit.log_archive.';

-- `LIKE ... INCLUDING ALL` copies indexes, constraints, and defaults but
-- NOT row-level security state. Without the three statements below,
-- Gate 12 ("every public.<table> with an org_id column is RLS-enabled
-- + FORCED + has a policy") fails — and more importantly, the cold
-- table would be visible cross-tenant to any app query that reached
-- it. Mirror the exact policy shape stock_ledger uses.
ALTER TABLE stock_ledger_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_ledger_archive FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'stock_ledger_archive'
       AND policyname = 'stock_ledger_archive_tenant_isolation'
  ) THEN
    CREATE POLICY stock_ledger_archive_tenant_isolation
      ON stock_ledger_archive
      FOR ALL
      USING (org_id::text = current_setting('app.current_org', true));
  END IF;
END
$$;

-- Summary ledger of archive runs. One row per successful sweep so ops
-- can answer "when did we last archive?" without grepping Postgres logs.
CREATE TABLE IF NOT EXISTS audit.archive_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  audit_rows_moved   bigint NOT NULL DEFAULT 0,
  ledger_rows_moved  bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'RUNNING'
                       CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  error              text
);
CREATE INDEX IF NOT EXISTS audit_archive_runs_started_idx
  ON audit.archive_runs (started_at DESC);

-- ─── phase4_archive_audit_old_rows ────────────────────────────────────
--
-- Moves audit.log and stock_ledger rows older than 90 days into the
-- _archive cold tables. Uses CTEs so the insert/delete happens in one
-- atomic transaction per table — a crash mid-sweep leaves the hot
-- table intact and the archive table either fully updated or not at
-- all (per-CTE atomicity; the outer proc is NOT a transaction boundary).

-- SECURITY DEFINER: runs as the migration owner (superuser), so it
-- bypasses the RLS on audit.log and the DELETE-privilege gap on
-- instigenie_app. That matches the intent — this is a maintenance
-- sweep that deliberately works across every tenant. `search_path=''`
-- is the standard safety harness for SECURITY DEFINER: forces every
-- table reference to be fully qualified, preventing a caller from
-- planting a shadow table to hijack the rewrite.
CREATE OR REPLACE FUNCTION public.phase4_archive_audit_old_rows()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run_id           uuid;
  v_audit_moved      bigint := 0;
  v_ledger_moved     bigint := 0;
  v_cutoff           timestamptz := now() - interval '90 days';
BEGIN
  INSERT INTO audit.archive_runs (status)
       VALUES ('RUNNING')
    RETURNING id INTO v_run_id;

  BEGIN
    -- audit.log → audit.log_archive
    WITH moved AS (
      DELETE FROM audit.log
       WHERE changed_at < v_cutoff
       RETURNING *
    )
    INSERT INTO audit.log_archive
         SELECT * FROM moved;
    GET DIAGNOSTICS v_audit_moved = ROW_COUNT;

    -- stock_ledger → stock_ledger_archive
    WITH moved AS (
      DELETE FROM public.stock_ledger
       WHERE posted_at < v_cutoff
       RETURNING *
    )
    INSERT INTO public.stock_ledger_archive
         SELECT * FROM moved;
    GET DIAGNOSTICS v_ledger_moved = ROW_COUNT;

    UPDATE audit.archive_runs
       SET status            = 'COMPLETED',
           completed_at      = now(),
           audit_rows_moved  = v_audit_moved,
           ledger_rows_moved = v_ledger_moved
     WHERE id = v_run_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE audit.archive_runs
       SET status       = 'FAILED',
           completed_at = now(),
           error        = SQLERRM
     WHERE id = v_run_id;
    RAISE;
  END;
END;
$$;

COMMENT ON FUNCTION public.phase4_archive_audit_old_rows() IS
  'Phase 4 §4.2 scheduled archive sweep — moves audit.log + stock_ledger rows older than 90 days into _archive cold tables. Scheduled daily at 03:00 via pg_cron.';

-- ─── phase4_watchdog_hashchain ────────────────────────────────────────
--
-- The BullMQ audit-hashchain scheduler should produce one
-- qc_cert_chain_audit_runs row per day. If more than 26 hours have
-- elapsed since the last COMPLETED row, the scheduler has failed
-- (worker down, Redis down, code bug). This watchdog inserts a
-- synthetic FAILED row so:
--   * the admin audit dashboard surfaces the gap,
--   * the Prometheus rule erp_audit_chain_break_watchdog fires off the
--     watchdog-inserted row's presence (via the audit dashboard API).
--
-- 26h (not 24h) gives the real scheduler a 2-hour grace window — we
-- don't want a single slow run to page ops.

-- Same SECURITY DEFINER treatment as the archive proc — this watchdog
-- is a cross-tenant sweep that reads MAX(completed_at) across every
-- qc_cert_chain_audit_runs row regardless of org, so it must run above
-- RLS. `search_path=''` for the same shadow-table safety.
CREATE OR REPLACE FUNCTION public.phase4_watchdog_hashchain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last_completed_at timestamptz;
  v_breaks_payload    jsonb;
BEGIN
  SELECT MAX(completed_at)
    INTO v_last_completed_at
    FROM public.qc_cert_chain_audit_runs
   WHERE status = 'COMPLETED';

  IF v_last_completed_at IS NOT NULL
     AND v_last_completed_at > (now() - interval '26 hours')
  THEN
    -- Scheduler is healthy — no watchdog row needed.
    RETURN;
  END IF;

  v_breaks_payload := jsonb_build_array(
    jsonb_build_object(
      'orgId',         '00000000-0000-0000-0000-000000000000',
      'certId',        '00000000-0000-0000-0000-000000000000',
      'certNumber',    '<watchdog: no COMPLETED run in 26h>',
      'expected',      '',
      'actual',        NULL,
      'verifiedCount', 0,
      'totalCount',    0
    )
  );

  INSERT INTO public.qc_cert_chain_audit_runs (
    trigger, status, started_at, completed_at,
    orgs_total, orgs_ok, orgs_broken, breaks, error
  )
  VALUES (
    'SCHEDULED', 'FAILED', now(), now(),
    0, 0, 1, v_breaks_payload,
    'pg_cron watchdog: no COMPLETED audit-hashchain run in 26h'
  );
END;
$$;

COMMENT ON FUNCTION public.phase4_watchdog_hashchain() IS
  'Phase 4 §4.2 watchdog — if the BullMQ audit-hashchain scheduler misses its daily slot, insert a synthetic FAILED qc_cert_chain_audit_runs row so the admin dashboard and Prometheus rule see the gap. Scheduled every hour via pg_cron.';

-- ─── Schedule ─────────────────────────────────────────────────────────
--
-- pg_cron's schedule table is a singleton across databases in the
-- cluster. Upsert by deleting any prior row with the same jobname
-- before inserting so re-running this SQL is idempotent.

DO $$
BEGIN
  PERFORM cron.unschedule('phase4_archive_audit_old_rows')
    WHERE EXISTS (
      SELECT 1 FROM cron.job
        WHERE jobname = 'phase4_archive_audit_old_rows'
    );
  PERFORM cron.unschedule('phase4_watchdog_hashchain')
    WHERE EXISTS (
      SELECT 1 FROM cron.job
        WHERE jobname = 'phase4_watchdog_hashchain'
    );
EXCEPTION WHEN undefined_table THEN
  -- cron.job not yet visible on very first boot — that's fine, schedule
  -- calls below will create the rows outright.
  NULL;
END;
$$;

-- Daily 03:00 — runs AFTER the audit-hashchain worker's 02:00 slot so
-- any rows the sweep produced in the last hour stay in the hot table
-- (i.e. we never archive a row produced in the current verify window).
SELECT cron.schedule(
  'phase4_archive_audit_old_rows',
  '0 3 * * *',
  $$SELECT public.phase4_archive_audit_old_rows();$$
);

-- Hourly — the watchdog itself is cheap (one MAX() query), and hourly
-- firing narrows the detection window to ~1h.
SELECT cron.schedule(
  'phase4_watchdog_hashchain',
  '0 * * * *',
  $$SELECT public.phase4_watchdog_hashchain();$$
);

-- ─── Privileges for the app role ─────────────────────────────────────
--
-- Two surfaces the NOBYPASSRLS `instigenie_app` role needs:
--
-- 1. Read-only visibility into cron.job / cron.job_run_details so the
--    admin audit dashboard ("is the scheduler alive?") and Gate 45's
--    schedule assertion can observe without holding the migration
--    credential. pg_cron stores its catalogs in schema `cron`, owned
--    by the superuser; the default grants in seed/99-app-role.sql
--    don't reach it.
--
-- 2. DELETE on the *_archive tables. Default grants (audit schema:
--    SELECT+INSERT; public schema: full DML) cover the write side of
--    the archive sweep, but integration tests — and occasional
--    compliance-ops manual cleanups — need DELETE on audit.log_archive
--    specifically. Hot `audit.log` remains DELETE-locked (that's the
--    immutability invariant); only the cold table gets DELETE.
--
-- Both grants are idempotent (GRANT is a no-op if already granted).

GRANT USAGE ON SCHEMA cron TO instigenie_app;
GRANT SELECT ON cron.job TO instigenie_app;
GRANT SELECT ON cron.job_run_details TO instigenie_app;

-- pg_cron ships cron.job with an RLS policy that restricts rows to
-- `username = CURRENT_USER`. Our schedules are registered by the
-- migration superuser `instigenie`, so the NOBYPASSRLS `instigenie_app`
-- role sees zero rows by default. Add a permissive read-only policy
-- scoped to `instigenie_app` alone — this gives the admin audit
-- dashboard and Gate 45 a way to observe the schedule without
-- escalating to superuser. Write access stays blocked (no INSERT /
-- UPDATE grant), so the app can look but not tamper.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'cron'
       AND tablename  = 'job'
       AND policyname = 'cron_job_read_for_instigenie_app'
  ) THEN
    CREATE POLICY cron_job_read_for_instigenie_app ON cron.job
      FOR SELECT TO instigenie_app
      USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'cron'
       AND tablename  = 'job_run_details'
       AND policyname = 'cron_run_details_read_for_instigenie_app'
  ) THEN
    CREATE POLICY cron_run_details_read_for_instigenie_app ON cron.job_run_details
      FOR SELECT TO instigenie_app
      USING (true);
  END IF;
END
$$;

GRANT SELECT, INSERT, DELETE ON audit.log_archive TO instigenie_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit.archive_runs TO instigenie_app;
