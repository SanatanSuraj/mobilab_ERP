-- Phase 4 §4.2 / §9.5 — Electronic-signature hash columns on the remaining
-- "critical action" tables.
--
-- The approvals module has its own e-sig column on approval_steps +
-- workflow_transitions (09-approvals.sql). Gate 42 proved the primitive.
-- This migration plumbs the same HMAC-SHA256 hash through the three
-- non-approval critical actions called out in §9.5:
--
--    Critical action              │ Owning table      │ Trigger
--    ─────────────────────────────┼───────────────────┼────────────────────
--    Invoice issue                │ sales_invoices    │ status POST on POST
--    Stock write-off              │ stock_ledger      │ txn_type = SCRAP
--    Device release               │ stock_ledger      │ txn_type = CUSTOMER_ISSUE
--
-- Why one column per owning row (not a separate e-sig table):
--   * payments.signature_hash and approval_steps.e_signature_hash both
--     already follow this pattern. Auditors reading a single row see the
--     cryptographic proof inline.
--   * stock_ledger is append-only at the service contract layer; a
--     populated signature_hash on a row is as immutable as the row itself.
--   * No JOIN on hot paths — list/getById queries already read the whole
--     row, one extra column is free.
--
-- Hash scheme (identical to approvals, sourced from EsignatureService):
--    HMAC-SHA256(
--      key = ESIGNATURE_PEPPER,
--      msg = reason || '\0' || userIdentityId || '\0' || actedAt
--    )
-- where actedAt is the exact ISO-8601 string persisted on the owning row
-- (posted_at for sales_invoices, posted_at for stock_ledger). Gate 43
-- recomputes against these columns to prove reproducibility.
--
-- Nullable on purpose:
--   * Existing rows (pre-4.2c) stay valid — the migration doesn't
--     retroactively invent hashes.
--   * Non-critical stock_ledger txn_types (GRN_RECEIPT, ADJUSTMENT, …)
--     leave this NULL forever; the service only writes it for the
--     critical-action subset.
--
-- IF NOT EXISTS on every ADD so idempotent across init re-runs.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS signature_hash text;

ALTER TABLE stock_ledger
  ADD COLUMN IF NOT EXISTS signature_hash text;

COMMENT ON COLUMN sales_invoices.signature_hash IS
  'Phase 4 §9.5 — HMAC-SHA256(ESIGNATURE_PEPPER, reason||userIdentityId||postedAt) captured on POST. NULL for DRAFT/CANCELLED rows and for rows issued before Phase 4 §4.2c shipped.';

COMMENT ON COLUMN stock_ledger.signature_hash IS
  'Phase 4 §9.5 — HMAC-SHA256(ESIGNATURE_PEPPER, reason||userIdentityId||postedAt) captured on SCRAP (stock write-off) and CUSTOMER_ISSUE (device release) txns. NULL for every other txn_type.';
