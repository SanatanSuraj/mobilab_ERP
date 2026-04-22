-- Manual-entry queue RLS. ARCHITECTURE.md §9.2, §3.4.
--
-- Same tenant_isolation policy shape as the rest of the module tables
-- (08-finance-rls.sql, 10-approvals-rls.sql) — the queue is per-org and
-- RLS is the only thing between a misbehaving route handler and cross-
-- tenant leakage.

ALTER TABLE manual_entry_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_entry_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_entry_queue_tenant_isolation ON manual_entry_queue;

CREATE POLICY manual_entry_queue_tenant_isolation ON manual_entry_queue
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));
