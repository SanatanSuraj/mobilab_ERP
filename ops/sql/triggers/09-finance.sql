-- Finance module triggers. Mirror of 08-qc.sql.
--
--   * Bump updated_at on every UPDATE (all tables).
--   * Bump `version` on the mutable header tables (sales_invoices,
--     purchase_invoices). Lines bump parent version via the service layer
--     (same contract as bom_lines / wip_stages / po_lines / inspection_params).
--   * Ledger tables (customer_ledger, vendor_ledger) are append-only; the
--     service never UPDATEs them, so no version trigger is needed. updated_at
--     is also irrelevant — they're immutable.
--   * `payments` is effectively append-only (status transitions only to
--     VOIDED once), so no version trigger; updated_at tracks the VOID moment.
--   * Append audit rows on INSERT/UPDATE/DELETE on every table.

-- ── finance_number_sequences ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS finance_number_sequences_updated_at ON finance_number_sequences;
CREATE TRIGGER finance_number_sequences_updated_at
BEFORE UPDATE ON finance_number_sequences
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS finance_number_sequences_audit ON finance_number_sequences;
CREATE TRIGGER finance_number_sequences_audit
AFTER INSERT OR UPDATE OR DELETE ON finance_number_sequences
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── sales_invoices ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sales_invoices_updated_at ON sales_invoices;
CREATE TRIGGER sales_invoices_updated_at
BEFORE UPDATE ON sales_invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS sales_invoices_version ON sales_invoices;
CREATE TRIGGER sales_invoices_version
BEFORE UPDATE ON sales_invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS sales_invoices_audit ON sales_invoices;
CREATE TRIGGER sales_invoices_audit
AFTER INSERT OR UPDATE OR DELETE ON sales_invoices
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── sales_invoice_lines ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sales_invoice_lines_updated_at ON sales_invoice_lines;
CREATE TRIGGER sales_invoice_lines_updated_at
BEFORE UPDATE ON sales_invoice_lines
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS sales_invoice_lines_audit ON sales_invoice_lines;
CREATE TRIGGER sales_invoice_lines_audit
AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── purchase_invoices ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS purchase_invoices_updated_at ON purchase_invoices;
CREATE TRIGGER purchase_invoices_updated_at
BEFORE UPDATE ON purchase_invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS purchase_invoices_version ON purchase_invoices;
CREATE TRIGGER purchase_invoices_version
BEFORE UPDATE ON purchase_invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS purchase_invoices_audit ON purchase_invoices;
CREATE TRIGGER purchase_invoices_audit
AFTER INSERT OR UPDATE OR DELETE ON purchase_invoices
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── purchase_invoice_lines ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS purchase_invoice_lines_updated_at ON purchase_invoice_lines;
CREATE TRIGGER purchase_invoice_lines_updated_at
BEFORE UPDATE ON purchase_invoice_lines
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS purchase_invoice_lines_audit ON purchase_invoice_lines;
CREATE TRIGGER purchase_invoice_lines_audit
AFTER INSERT OR UPDATE OR DELETE ON purchase_invoice_lines
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── customer_ledger (append-only) ──────────────────────────────────────────
DROP TRIGGER IF EXISTS customer_ledger_audit ON customer_ledger;
CREATE TRIGGER customer_ledger_audit
AFTER INSERT OR UPDATE OR DELETE ON customer_ledger
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── vendor_ledger (append-only) ────────────────────────────────────────────
DROP TRIGGER IF EXISTS vendor_ledger_audit ON vendor_ledger;
CREATE TRIGGER vendor_ledger_audit
AFTER INSERT OR UPDATE OR DELETE ON vendor_ledger
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── payments ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS payments_updated_at ON payments;
CREATE TRIGGER payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS payments_audit ON payments;
CREATE TRIGGER payments_audit
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
