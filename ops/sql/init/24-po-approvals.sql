-- PO approval audit trail. Pairs with apps/api/src/modules/procurement/
-- po-approvals.{repository,service}.ts and packages/contracts/src/procurement.ts.
--
-- Append-only history: one row per approve/reject action against a PO. The
-- service layer also stamps purchase_orders.approved_by / approved_at on
-- APPROVE so single-row reads are still cheap; this table preserves the
-- full audit trail (who, when, why, prior + new status) for compliance.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Tenant-scoped via the same `app.current_org` GUC pattern as every other
-- tenant-scoped table.
--
-- Also extends purchase_orders.status CHECK to include 'REJECTED' — the
-- prior list (DRAFT, PENDING_APPROVAL, APPROVED, SENT, PARTIALLY_RECEIVED,
-- RECEIVED, CANCELLED) had no rejected-terminal state.

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend PO status CHECK to include REJECTED. Drop + recreate is the only
-- way to alter a CHECK constraint in PostgreSQL; the new list is a strict
-- superset of the old, so existing rows are valid.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'purchase_orders'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE purchase_orders DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'SENT',
    'PARTIALLY_RECEIVED',
    'RECEIVED',
    'CANCELLED'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- po_approvals — append-only history of approve/reject actions.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS po_approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('APPROVE', 'REJECT')),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  prior_status    text NOT NULL,
  new_status      text NOT NULL,
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_approvals_org_idx
  ON po_approvals (org_id);
CREATE INDEX IF NOT EXISTS po_approvals_po_idx
  ON po_approvals (org_id, po_id, created_at DESC);
CREATE INDEX IF NOT EXISTS po_approvals_user_idx
  ON po_approvals (org_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE po_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_approvals_tenant_isolation ON po_approvals;
CREATE POLICY po_approvals_tenant_isolation ON po_approvals
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    GRANT SELECT, INSERT ON po_approvals TO instigenie_app;
  END IF;
END $$;
