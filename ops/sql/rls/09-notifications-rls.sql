-- Notifications module RLS policies. ARCHITECTURE.md §9.2.
--
-- Mirror of ops/sql/rls/08-finance-rls.sql. Every tenant-scoped notifications
-- table gets ENABLE+FORCE RLS with a tenant_isolation policy keyed on the
-- app.current_org GUC set by withOrg().
--
-- Per-user filtering of the notifications feed (user A cannot see user B's
-- inbox even inside the same org) is enforced at the service layer by
-- `user_id = app.current_user`, not by RLS — admins with
-- notifications:admin_read intentionally see across users for moderation.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'notification_templates',
    'notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I
         USING (org_id::text = current_setting(''app.current_org'', true))
         WITH CHECK (org_id::text = current_setting(''app.current_org'', true))',
      t, t
    );
  END LOOP;
END $$;
