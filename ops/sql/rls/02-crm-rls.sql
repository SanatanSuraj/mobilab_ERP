-- CRM module RLS policies. ARCHITECTURE.md §9.2.
--
-- Every tenant-scoped CRM table gets:
--   1. ENABLE ROW LEVEL SECURITY
--   2. FORCE ROW LEVEL SECURITY (so table owners don't silently bypass)
--   3. A single tenant-isolation policy keyed on app.current_org GUC
--
-- If a request hits one of these tables without setting app.current_org
-- (via withOrg()), it sees zero rows — which Gate 5 / Gate 8 verify.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts',
    'contacts',
    'leads',
    'lead_activities',
    'deals',
    'deal_line_items',
    'tickets',
    'ticket_comments',
    'quotations',
    'quotation_line_items',
    'sales_orders',
    'sales_order_line_items',
    'crm_number_sequences'
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
