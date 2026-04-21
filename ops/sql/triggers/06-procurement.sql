-- Procurement module triggers. Mirror of 05-inventory.sql.
--
--   * Bump updated_at on every UPDATE (all tables).
--   * Bump `version` on the 4 header tables (vendors, indents,
--     purchase_orders, grns) for optimistic concurrency.
--   * Append audit rows on INSERT/UPDATE/DELETE on every table.
--
-- Child `*_lines` tables and procurement_number_sequences don't carry
-- a version column — their mutations bump the parent header's version
-- through the service layer (not through a trigger). This matches the
-- contract pattern in ARCHITECTURE.md §5.3.

-- ── vendors ─────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS vendors_updated_at ON vendors;
CREATE TRIGGER vendors_updated_at
BEFORE UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS vendors_version ON vendors;
CREATE TRIGGER vendors_version
BEFORE UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS vendors_audit ON vendors;
CREATE TRIGGER vendors_audit
AFTER INSERT OR UPDATE OR DELETE ON vendors
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── procurement_number_sequences ───────────────────────────────────────────
-- No version column (sequences aren't optimistically locked — we rely on
-- row locking during INSERT ... ON CONFLICT DO UPDATE). Audit anyway so
-- a skipped sequence is debuggable.
DROP TRIGGER IF EXISTS procurement_number_sequences_updated_at ON procurement_number_sequences;
CREATE TRIGGER procurement_number_sequences_updated_at
BEFORE UPDATE ON procurement_number_sequences
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS procurement_number_sequences_audit ON procurement_number_sequences;
CREATE TRIGGER procurement_number_sequences_audit
AFTER INSERT OR UPDATE OR DELETE ON procurement_number_sequences
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── indents ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS indents_updated_at ON indents;
CREATE TRIGGER indents_updated_at
BEFORE UPDATE ON indents
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS indents_version ON indents;
CREATE TRIGGER indents_version
BEFORE UPDATE ON indents
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS indents_audit ON indents;
CREATE TRIGGER indents_audit
AFTER INSERT OR UPDATE OR DELETE ON indents
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── indent_lines ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS indent_lines_updated_at ON indent_lines;
CREATE TRIGGER indent_lines_updated_at
BEFORE UPDATE ON indent_lines
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS indent_lines_audit ON indent_lines;
CREATE TRIGGER indent_lines_audit
AFTER INSERT OR UPDATE OR DELETE ON indent_lines
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── purchase_orders ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER purchase_orders_updated_at
BEFORE UPDATE ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS purchase_orders_version ON purchase_orders;
CREATE TRIGGER purchase_orders_version
BEFORE UPDATE ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS purchase_orders_audit ON purchase_orders;
CREATE TRIGGER purchase_orders_audit
AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── po_lines ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS po_lines_updated_at ON po_lines;
CREATE TRIGGER po_lines_updated_at
BEFORE UPDATE ON po_lines
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS po_lines_audit ON po_lines;
CREATE TRIGGER po_lines_audit
AFTER INSERT OR UPDATE OR DELETE ON po_lines
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── grns ───────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS grns_updated_at ON grns;
CREATE TRIGGER grns_updated_at
BEFORE UPDATE ON grns
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS grns_version ON grns;
CREATE TRIGGER grns_version
BEFORE UPDATE ON grns
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS grns_audit ON grns;
CREATE TRIGGER grns_audit
AFTER INSERT OR UPDATE OR DELETE ON grns
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── grn_lines ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS grn_lines_updated_at ON grn_lines;
CREATE TRIGGER grn_lines_updated_at
BEFORE UPDATE ON grn_lines
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS grn_lines_audit ON grn_lines;
CREATE TRIGGER grn_lines_audit
AFTER INSERT OR UPDATE OR DELETE ON grn_lines
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
