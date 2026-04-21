-- Notifications module triggers. Mirror of 09-finance.sql.
--
--   * Bump updated_at on every UPDATE (both tables).
--   * Bump `version` on the mutable header (notification_templates).
--     notifications rows mutate only via is_read flips which are a service
--     concern, not something we need to protect with optimistic concurrency.
--   * Append audit rows on INSERT/UPDATE/DELETE on every table.

-- ── notification_templates ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS notification_templates_updated_at ON notification_templates;
CREATE TRIGGER notification_templates_updated_at
BEFORE UPDATE ON notification_templates
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS notification_templates_version ON notification_templates;
CREATE TRIGGER notification_templates_version
BEFORE UPDATE ON notification_templates
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS notification_templates_audit ON notification_templates;
CREATE TRIGGER notification_templates_audit
AFTER INSERT OR UPDATE OR DELETE ON notification_templates
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── notifications ──────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS notifications_updated_at ON notifications;
CREATE TRIGGER notifications_updated_at
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS notifications_audit ON notifications;
CREATE TRIGGER notifications_audit
AFTER INSERT OR UPDATE OR DELETE ON notifications
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
