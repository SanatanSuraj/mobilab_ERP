-- CRM module triggers.
--
--   1. Bump updated_at on every UPDATE.
--   2. Bump `version` on deals + tickets for optimistic concurrency.
--   3. Append audit rows on INSERT/UPDATE/DELETE.

-- ── version bumper ──────────────────────────────────────────────────────────
-- Same pattern as tg_set_updated_at but bumps an integer `version` column.
-- Referenced by deals + tickets. Services pass `expected_version` in UPDATE
-- WHERE clauses; a row where the version has moved returns 0 rows — the
-- service maps that to a 409 Conflict.
CREATE OR REPLACE FUNCTION public.tg_bump_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

-- ── accounts ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS accounts_updated_at ON accounts;
CREATE TRIGGER accounts_updated_at
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS accounts_audit ON accounts;
CREATE TRIGGER accounts_audit
AFTER INSERT OR UPDATE OR DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── contacts ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS contacts_audit ON contacts;
CREATE TRIGGER contacts_audit
AFTER INSERT OR UPDATE OR DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── leads ───────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS leads_audit ON leads;
CREATE TRIGGER leads_audit
AFTER INSERT OR UPDATE OR DELETE ON leads
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- lead_activities are append-only (no UPDATE trigger). We still audit
-- inserts/deletes for 21 CFR Part 11 tamper-evidence.
DROP TRIGGER IF EXISTS lead_activities_audit ON lead_activities;
CREATE TRIGGER lead_activities_audit
AFTER INSERT OR DELETE ON lead_activities
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── deals ───────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS deals_updated_at ON deals;
CREATE TRIGGER deals_updated_at
BEFORE UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Fires BEFORE updated_at so the version bump & timestamp land together.
DROP TRIGGER IF EXISTS deals_version ON deals;
CREATE TRIGGER deals_version
BEFORE UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS deals_audit ON deals;
CREATE TRIGGER deals_audit
AFTER INSERT OR UPDATE OR DELETE ON deals
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── deal_line_items ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS deal_line_items_audit ON deal_line_items;
CREATE TRIGGER deal_line_items_audit
AFTER INSERT OR UPDATE OR DELETE ON deal_line_items
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── tickets ─────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tickets_updated_at ON tickets;
CREATE TRIGGER tickets_updated_at
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS tickets_version ON tickets;
CREATE TRIGGER tickets_version
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS tickets_audit ON tickets;
CREATE TRIGGER tickets_audit
AFTER INSERT OR UPDATE OR DELETE ON tickets
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── ticket_comments ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS ticket_comments_audit ON ticket_comments;
CREATE TRIGGER ticket_comments_audit
AFTER INSERT OR DELETE ON ticket_comments
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── quotations ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS quotations_updated_at ON quotations;
CREATE TRIGGER quotations_updated_at
BEFORE UPDATE ON quotations
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS quotations_version ON quotations;
CREATE TRIGGER quotations_version
BEFORE UPDATE ON quotations
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS quotations_audit ON quotations;
CREATE TRIGGER quotations_audit
AFTER INSERT OR UPDATE OR DELETE ON quotations
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── quotation_line_items ────────────────────────────────────────────────────
-- No version/updated_at — line items are immutable once created (replaced
-- via DELETE+INSERT inside the same tx when a quotation is edited). Audit
-- still fires so the tamper-evident ledger includes every line-item edit.
DROP TRIGGER IF EXISTS quotation_line_items_audit ON quotation_line_items;
CREATE TRIGGER quotation_line_items_audit
AFTER INSERT OR UPDATE OR DELETE ON quotation_line_items
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── sales_orders ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sales_orders_updated_at ON sales_orders;
CREATE TRIGGER sales_orders_updated_at
BEFORE UPDATE ON sales_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS sales_orders_version ON sales_orders;
CREATE TRIGGER sales_orders_version
BEFORE UPDATE ON sales_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS sales_orders_audit ON sales_orders;
CREATE TRIGGER sales_orders_audit
AFTER INSERT OR UPDATE OR DELETE ON sales_orders
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── sales_order_line_items ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sales_order_line_items_audit ON sales_order_line_items;
CREATE TRIGGER sales_order_line_items_audit
AFTER INSERT OR UPDATE OR DELETE ON sales_order_line_items
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- crm_number_sequences is a counter; no audit (it's not a domain entity).
