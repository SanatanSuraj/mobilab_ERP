-- Customer Portal triggers. ARCHITECTURE.md §3.7 + §11.

DROP TRIGGER IF EXISTS account_portal_users_updated_at ON account_portal_users;
CREATE TRIGGER account_portal_users_updated_at
BEFORE UPDATE ON account_portal_users
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS account_portal_users_audit ON account_portal_users;
CREATE TRIGGER account_portal_users_audit
AFTER INSERT OR UPDATE OR DELETE ON account_portal_users
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
