-- Finance module RLS policies. ARCHITECTURE.md §9.2.
--
-- Same pattern as ops/sql/rls/07-qc-rls.sql. Every tenant-scoped finance
-- table gets ENABLE+FORCE RLS with a tenant_isolation policy keyed on the
-- app.current_org GUC set by withOrg().
--
-- Ledger tables are append-only at the service layer; RLS here simply
-- scopes visibility to the current org.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_number_sequences',
    'sales_invoices',
    'sales_invoice_lines',
    'purchase_invoices',
    'purchase_invoice_lines',
    'customer_ledger',
    'vendor_ledger',
    'payments'
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
