-- Phase 4 §4.2 — carry trace_id on every audit.log row.
--
-- The admin audit dashboard surfaces a trace_id column with a deep-link
-- to Loki/Tempo. For that to work the API must propagate its OTel
-- trace-parent into every SQL statement that fires an audit trigger,
-- and the trigger function must read and stamp it.
--
-- The API sets `app.current_trace_id` on the session / transaction at
-- request start (alongside app.current_user and app.current_org). The
-- trigger function is updated in ops/sql/triggers/03-audit.sql — but
-- because that file creates the function with no trace_id awareness,
-- we CREATE OR REPLACE here with the enriched version. Idempotent: if
-- the column + updated function are already present, both statements
-- are no-ops.

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

-- Enriched trigger — picks up `app.current_trace_id` GUC. Missing GUC
-- → NULL, which is fine for pre-§4.2 callers.
CREATE OR REPLACE FUNCTION audit.tg_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = audit, public
AS $$
DECLARE
  v_org_id    uuid;
  v_actor     uuid;
  v_trace_id  text;
  v_row_id    uuid;
  v_action    text := TG_OP;
BEGIN
  BEGIN
    v_org_id := nullif(current_setting('app.current_org', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_org_id := NULL;
  END;
  BEGIN
    v_actor := nullif(current_setting('app.current_user', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor := NULL;
  END;
  BEGIN
    v_trace_id := nullif(current_setting('app.current_trace_id', true), '');
  EXCEPTION WHEN others THEN
    v_trace_id := NULL;
  END;

  IF v_action = 'DELETE' THEN
    v_row_id := (to_jsonb(OLD) ->> 'id')::uuid;
    INSERT INTO audit.log (
      org_id, table_name, row_id, action, actor,
      before, after, trace_id
    )
    VALUES (
      coalesce(
        v_org_id,
        (to_jsonb(OLD) ->> 'org_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
      ),
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      v_row_id, v_action, v_actor,
      to_jsonb(OLD), NULL, v_trace_id
    );
    RETURN OLD;
  ELSE
    v_row_id := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit.log (
      org_id, table_name, row_id, action, actor,
      before, after, trace_id
    )
    VALUES (
      coalesce(
        v_org_id,
        (to_jsonb(NEW) ->> 'org_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
      ),
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      v_row_id, v_action, v_actor,
      CASE WHEN v_action = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
      to_jsonb(NEW), v_trace_id
    );
    RETURN NEW;
  END IF;
END;
$$;

COMMENT ON COLUMN audit.log.trace_id IS
  'W3C trace-parent propagated from the API request. Nullable — pre-§4.2 rows and system-generated rows have no trace.';
