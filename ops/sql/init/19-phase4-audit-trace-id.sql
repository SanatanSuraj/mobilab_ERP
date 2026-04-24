-- Phase 4 §4.2 — carry trace_id on every audit.log row.
--
-- The admin audit dashboard surfaces a trace_id column with a deep-link
-- to Loki/Tempo. For that to work the API must propagate its OTel
-- trace-parent into every SQL statement that fires an audit trigger,
-- and the trigger function must read and stamp it.
--
-- Split of responsibilities:
--   • This file (init/) — schema only: adds the trace_id column to
--     audit.log (and audit.log_archive when it exists).
--   • ops/sql/triggers/03-audit.sql — the authoritative audit.tg_log()
--     definition, including the `app.current_trace_id` GUC read and the
--     INSERT that stamps v_trace_id into the new column.
--
-- Why the split: 00-apply-all.sh runs init/ BEFORE triggers/. An earlier
-- iteration of this file CREATE OR REPLACE'd audit.tg_log() here with the
-- enriched version, but triggers/03-audit.sql then ran and clobbered it
-- back to the no-trace-id version — leaving the column present but never
-- stamped. The function now lives in one place (triggers/), which is
-- guaranteed to run last.

ALTER TABLE audit.log
  ADD COLUMN IF NOT EXISTS trace_id text;

-- log_archive is LIKE audit.log — so it inherits the new column as
-- long as it's created AFTER this file runs. For environments where
-- log_archive already exists (repeat-apply), mirror the column too.
DO $$
BEGIN
  IF to_regclass('audit.log_archive') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE audit.log_archive ADD COLUMN IF NOT EXISTS trace_id text';
  END IF;
END
$$;

COMMENT ON COLUMN audit.log.trace_id IS
  'W3C trace-parent propagated from the API request. Nullable — pre-§4.2 rows and system-generated rows have no trace.';
