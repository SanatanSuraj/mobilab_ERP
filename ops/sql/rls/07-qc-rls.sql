-- QC module RLS policies. ARCHITECTURE.md §9.2.
--
-- Same pattern as ops/sql/rls/06-production-rls.sql. Every tenant-scoped
-- QC table gets ENABLE+FORCE RLS with a tenant_isolation policy keyed on
-- the app.current_org GUC set by withOrg().

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'qc_number_sequences',
    'inspection_templates',
    'inspection_parameters',
    'qc_inspections',
    'qc_findings',
    'qc_certs'
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
