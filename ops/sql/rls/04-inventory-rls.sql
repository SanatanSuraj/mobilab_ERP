-- Inventory module RLS policies. ARCHITECTURE.md §9.2.
--
-- Same pattern as ops/sql/rls/02-crm-rls.sql: every tenant-scoped
-- inventory table gets ENABLE+FORCE+tenant_isolation keyed on the
-- app.current_org GUC. Requests that forget to call withOrg() see zero
-- rows — Gate 5 / Gate 8 verify.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouses',
    'items',
    'item_warehouse_bindings',
    'stock_ledger',
    'stock_summary',
    'stock_reservations'
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
