-- Generic audit trigger. Attach to any table to automatically log INSERT /
-- UPDATE / DELETE into audit.log. ARCHITECTURE.md §11.
--
-- Actor is read from a GUC `app.current_user` (uuid) set by the API layer
-- at request start; if it's empty (system migrations, seed), actor=NULL.
-- Org id is read from `app.current_org` (same GUC as RLS).

CREATE OR REPLACE FUNCTION audit.tg_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER -- SECURITY DEFINER lets us bypass RLS on audit.log
SET search_path = audit, public
AS $$
DECLARE
  v_org_id  uuid;
  v_actor   uuid;
  v_row_id  uuid;
  v_action  text := TG_OP;
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

  -- Every audited table has an `id` uuid column. We read it via to_jsonb to
  -- stay schema-agnostic.
  IF v_action = 'DELETE' THEN
    v_row_id := (to_jsonb(OLD) ->> 'id')::uuid;
    INSERT INTO audit.log (org_id, table_name, row_id, action, actor, before, after)
    VALUES (
      coalesce(v_org_id, (to_jsonb(OLD) ->> 'org_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid),
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      v_row_id, v_action, v_actor, to_jsonb(OLD), NULL
    );
    RETURN OLD;
  ELSE
    v_row_id := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit.log (org_id, table_name, row_id, action, actor, before, after)
    VALUES (
      coalesce(v_org_id, (to_jsonb(NEW) ->> 'org_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid),
      TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
      v_row_id, v_action, v_actor,
      CASE WHEN v_action = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
      to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;
END;
$$;

-- Attach to the Phase 1 auth tables. Work-order / device / invoice audit
-- triggers get added as those tables land.
DROP TRIGGER IF EXISTS users_audit ON users;
CREATE TRIGGER users_audit
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

DROP TRIGGER IF EXISTS user_roles_audit ON user_roles;
CREATE TRIGGER user_roles_audit
AFTER INSERT OR UPDATE OR DELETE ON user_roles
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
