-- 0002_finance_invoice_awaiting_approval — extend sales_invoices.status enum.
--
-- Wires finance invoice posting through the central approvals engine. Today
-- POST /finance/sales-invoices/:id/post does both the approval gate and the
-- ledger append in one shot. This migration adds an intermediate state so an
-- invoice can sit "submitted, waiting for finance/management to act" without
-- being either DRAFT (still editable) or POSTED (committed to AR).
--
-- Lifecycle after this migration:
--   DRAFT             ──submit-for-posting──▶ AWAITING_APPROVAL
--   AWAITING_APPROVAL ──finaliser APPROVE──▶  POSTED
--                     ──finaliser REJECT──▶   DRAFT     (re-edit + resubmit)
--   DRAFT|POSTED      ──cancel──▶            CANCELLED  (unchanged)
--
-- The CHECK constraint is unnamed in init/07-finance.sql, so Postgres named
-- it `sales_invoices_status_check` automatically. We drop + recreate so
-- existing rows (DRAFT/POSTED/CANCELLED) keep validating, and the new
-- AWAITING_APPROVAL value becomes legal.

ALTER TABLE sales_invoices
  DROP CONSTRAINT IF EXISTS sales_invoices_status_check;

ALTER TABLE sales_invoices
  ADD CONSTRAINT sales_invoices_status_check
    CHECK (status IN ('DRAFT', 'AWAITING_APPROVAL', 'POSTED', 'CANCELLED'));
