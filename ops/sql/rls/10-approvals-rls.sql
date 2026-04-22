-- Approval workflow RLS policies. ARCHITECTURE.md §9.2, §3.3.
--
-- Mirror of 09-notifications-rls.sql. Every tenant-scoped approval table gets
-- ENABLE+FORCE RLS with a tenant_isolation policy keyed on the
-- app.current_org GUC set by withOrg(). workflow_transitions is append-only
-- by service contract; RLS still allows UPDATE/DELETE as a safety net but the
-- module's repository never emits those — the audit-trigger in 11-approvals.sql
-- would preserve evidence of any policy escape.
--
-- Cross-user visibility within an org is a service-layer concern:
--   - /approvals/pending filters by role membership (a FINANCE approver
--     cannot see pending PRODUCTION_MANAGER steps).
--   - /approvals/:id allows anyone with approvals:read to see any single
--     request in the org, but the act() RPC refuses if the actor's role
--     doesn't match the current step's role_id.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'approval_chain_definitions',
    'approval_requests',
    'approval_steps',
    'workflow_transitions'
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
