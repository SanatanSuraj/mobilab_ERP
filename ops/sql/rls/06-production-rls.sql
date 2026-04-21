-- Production module RLS policies. ARCHITECTURE.md §9.2.
--
-- Same pattern as ops/sql/rls/05-procurement-rls.sql. Every tenant-scoped
-- production table gets ENABLE+FORCE RLS with a tenant_isolation policy
-- keyed on the app.current_org GUC set by withOrg().

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products',
    'production_number_sequences',
    'bom_versions',
    'bom_lines',
    'wip_stage_templates',
    'work_orders',
    'wip_stages'
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
