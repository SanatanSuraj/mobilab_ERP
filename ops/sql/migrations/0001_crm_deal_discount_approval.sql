-- 0001_crm_deal_discount_approval — header-level discount approval state on deals.
--
-- Wires CRM deal-discount approvals through the central approvals engine.
-- A sales rep proposes a header-level discount % via
-- POST /crm/deals/:id/submit-discount-for-approval. That endpoint stamps
-- pending_discount_pct + discount_request_id and opens an approval_request
-- (entity_type='deal_discount'). The finaliser, once SALES_MANAGER + FINANCE
-- act, copies pending → approved (or clears on REJECT).
--
-- Why columns rather than a side table: discount approval is 1:1 with the
-- deal at any moment (approval_requests already enforces a single PENDING
-- request per (org, entity_type, entity_id) via partial unique index), and
-- list/detail reads stay single-trip. The full audit trail is in
-- workflow_transitions; these columns are the denormalised current state.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS pending_discount_pct numeric(5, 2)
    CHECK (pending_discount_pct IS NULL OR pending_discount_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS approved_discount_pct numeric(5, 2)
    CHECK (approved_discount_pct IS NULL OR approved_discount_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS discount_approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS discount_request_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL;

-- Index for fast lookup from finaliser (request_id → deal).
CREATE INDEX IF NOT EXISTS deals_discount_request_idx
  ON deals (discount_request_id)
  WHERE discount_request_id IS NOT NULL;
