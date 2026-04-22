-- Notification dispatch DLQ RLS. ARCHITECTURE.md §9.2, §3.6.

ALTER TABLE notification_dispatch_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_dispatch_dlq FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_dispatch_dlq_tenant_isolation
  ON notification_dispatch_dlq;

CREATE POLICY notification_dispatch_dlq_tenant_isolation ON notification_dispatch_dlq
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));
