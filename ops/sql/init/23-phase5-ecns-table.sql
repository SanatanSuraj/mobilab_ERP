-- Phase 5 — engineering change notices (ECN).
--
-- Read-mostly Phase-5 register backing /production/ecn. Records change requests
-- against a product or BOM with a draft → review → approve/reject → implemented
-- workflow. Writes happen via SQL seed for now; the full draft-to-implement
-- service ships in Phase 6 along with BOM-version cascading.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Tenant-scoped via the same `app.current_org` GUC pattern as every other
-- tenant-scoped table.

CREATE TABLE IF NOT EXISTS engineering_change_notices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ecn_number                  text NOT NULL,
  title                       text NOT NULL,
  description                 text,
  change_type                 text NOT NULL
                                CHECK (change_type IN (
                                  'DESIGN', 'MATERIAL', 'PROCESS', 'DOCUMENTATION', 'OTHER'
                                )),
  severity                    text NOT NULL DEFAULT 'MEDIUM'
                                CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status                      text NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN (
                                  'DRAFT', 'PENDING_REVIEW', 'APPROVED',
                                  'REJECTED', 'IMPLEMENTED', 'CANCELLED'
                                )),
  -- Optional product / BOM the change targets. Both are SET NULL on parent
  -- delete so an obsolete ECN doesn't pin the product row.
  affected_product_id         uuid REFERENCES products(id) ON DELETE SET NULL,
  affected_bom_id             uuid REFERENCES bom_versions(id) ON DELETE SET NULL,
  reason                      text,
  proposed_change             text,
  impact_summary              text,
  raised_by                   text,
  approved_by                 text,
  approved_at                 timestamptz,
  implemented_at              timestamptz,
  target_implementation_date  date,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ecns_org_idx ON engineering_change_notices (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS ecns_number_org_unique
  ON engineering_change_notices (org_id, lower(ecn_number));
CREATE INDEX IF NOT EXISTS ecns_status_idx
  ON engineering_change_notices (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ecns_product_idx
  ON engineering_change_notices (org_id, affected_product_id);

ALTER TABLE engineering_change_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineering_change_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ecns_tenant_isolation ON engineering_change_notices;
CREATE POLICY ecns_tenant_isolation ON engineering_change_notices
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON engineering_change_notices TO instigenie_app;
  END IF;
END $$;
