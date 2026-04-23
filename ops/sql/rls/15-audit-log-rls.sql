-- Phase 4 §4.2 — RLS for audit.log + audit.log_archive.
--
-- The admin audit dashboard queries these tables from the tenant app
-- role, which is NOBYPASSRLS. Without a policy here the tenant would
-- see zero rows (rows exist but are filtered). The policy is a
-- standard tenant-isolation match against app.current_org.
--
-- SECURITY DEFINER triggers that INSERT into audit.log do NOT need
-- relaxing here — they run under the migration superuser, which
-- Postgres exempts from RLS. The ALTER FORCE is intentional: it
-- makes sure the GRANT we've given to instigenie_app is gated by the
-- tenant-isolation policy even when the migration role happens to
-- connect as the app.

ALTER TABLE audit.log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.log FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit.log;
CREATE POLICY audit_log_tenant_isolation ON audit.log
  USING      (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- The cold-storage archive table carries the same shape + tenant column
-- and the admin dashboard can opt into searching it.
DO $$
BEGIN
  IF to_regclass('audit.log_archive') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE audit.log_archive ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE audit.log_archive FORCE  ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS audit_log_archive_tenant_isolation ON audit.log_archive';
    EXECUTE $pol$
      CREATE POLICY audit_log_archive_tenant_isolation ON audit.log_archive
        USING      (org_id::text = current_setting('app.current_org', true))
        WITH CHECK (org_id::text = current_setting('app.current_org', true))
    $pol$;
  END IF;
END
$$;
