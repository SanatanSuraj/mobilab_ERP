-- Manual-entry queue triggers. ARCHITECTURE.md §3.4 + §11.
--
-- Conventions match 10-notifications.sql / 11-approvals.sql:
--   * updated_at bumped on every UPDATE
--   * full audit.log coverage so ops decisions leave a trail

DROP TRIGGER IF EXISTS manual_entry_queue_updated_at ON manual_entry_queue;
CREATE TRIGGER manual_entry_queue_updated_at
BEFORE UPDATE ON manual_entry_queue
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS manual_entry_queue_audit ON manual_entry_queue;
CREATE TRIGGER manual_entry_queue_audit
AFTER INSERT OR UPDATE OR DELETE ON manual_entry_queue
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
