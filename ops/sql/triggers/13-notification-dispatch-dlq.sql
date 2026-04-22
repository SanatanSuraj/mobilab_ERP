-- Notification dispatch DLQ triggers. ARCHITECTURE.md §3.6 + §11.

DROP TRIGGER IF EXISTS notification_dispatch_dlq_updated_at ON notification_dispatch_dlq;
CREATE TRIGGER notification_dispatch_dlq_updated_at
BEFORE UPDATE ON notification_dispatch_dlq
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS notification_dispatch_dlq_audit ON notification_dispatch_dlq;
CREATE TRIGGER notification_dispatch_dlq_audit
AFTER INSERT OR UPDATE OR DELETE ON notification_dispatch_dlq
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
