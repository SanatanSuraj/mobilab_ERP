-- Phase 5 — auxiliary tables for QC equipment / CAPA / e-way bills.
--
-- Each is a thin, read-mostly table that backs a single dashboard surface
-- in the prototype. They are deliberately NOT wired into the existing QC
-- or finance lifecycles — those belong to a later phase. The intent here
-- is to lift the corresponding pages off `AwaitingBackend` placeholders
-- and onto real data so demos can show the full module sweep.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- RLS is added inline (instead of a separate file in rls/) to keep the
-- three new tables together. Same tenant_isolation pattern as every
-- other tenant-scoped table — keyed on app.current_org GUC.

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_equipment — calibration register for inspection / production equipment.
-- One row per piece of equipment under calibration control.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qc_equipment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_code          text NOT NULL,
  name                text NOT NULL,
  category            text NOT NULL
                        CHECK (category IN (
                          'TEST_INSTRUMENT',
                          'GAUGE',
                          'METER',
                          'BALANCE',
                          'OVEN',
                          'CHAMBER',
                          'OTHER'
                        )),
  manufacturer        text,
  model_number        text,
  serial_number       text,
  location            text,
  status              text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN (
                          'ACTIVE',
                          'OUT_OF_SERVICE',
                          'IN_CALIBRATION',
                          'RETIRED'
                        )),
  calibration_interval_days integer NOT NULL DEFAULT 365 CHECK (calibration_interval_days > 0),
  last_calibrated_at  timestamptz,
  next_due_at         timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qc_equipment_org_idx ON qc_equipment (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS qc_equipment_asset_org_unique
  ON qc_equipment (org_id, lower(asset_code));
CREATE INDEX IF NOT EXISTS qc_equipment_due_idx
  ON qc_equipment (org_id, next_due_at);

ALTER TABLE qc_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_equipment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qc_equipment_tenant_isolation ON qc_equipment;
CREATE POLICY qc_equipment_tenant_isolation ON qc_equipment
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_capa_actions — Corrective and Preventive Actions raised off NCRs / audits.
-- Standalone for now; the link from a parent NCR/inspection is text only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qc_capa_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  capa_number         text NOT NULL,
  title               text NOT NULL,
  description         text,
  source_type         text NOT NULL
                        CHECK (source_type IN ('NCR', 'AUDIT', 'COMPLAINT', 'INTERNAL')),
  source_ref          text,
  action_type         text NOT NULL
                        CHECK (action_type IN ('CORRECTIVE', 'PREVENTIVE', 'BOTH')),
  severity            text NOT NULL
                        CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status              text NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN (
                          'OPEN',
                          'IN_PROGRESS',
                          'PENDING_VERIFICATION',
                          'CLOSED',
                          'CANCELLED'
                        )),
  owner_name          text,
  due_date            date,
  closed_at           timestamptz,
  root_cause          text,
  effectiveness_check text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qc_capa_actions_org_idx ON qc_capa_actions (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS qc_capa_actions_number_org_unique
  ON qc_capa_actions (org_id, lower(capa_number));
CREATE INDEX IF NOT EXISTS qc_capa_actions_status_idx
  ON qc_capa_actions (org_id, status);
CREATE INDEX IF NOT EXISTS qc_capa_actions_due_idx
  ON qc_capa_actions (org_id, due_date);

ALTER TABLE qc_capa_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_capa_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qc_capa_actions_tenant_isolation ON qc_capa_actions;
CREATE POLICY qc_capa_actions_tenant_isolation ON qc_capa_actions
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- eway_bills — GST e-way bill register for shipments above the value
-- threshold (₹50,000 for inter-state, varies by state for intra-state).
-- One row per generated EWB.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS eway_bills (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ewb_number          text NOT NULL,
  invoice_number      text NOT NULL,
  invoice_date        date NOT NULL,
  invoice_value       numeric(18,2) NOT NULL,
  consignor_gstin     text NOT NULL,
  consignee_gstin     text,
  consignee_name      text,
  from_place          text NOT NULL,
  from_state_code     text NOT NULL,
  to_place            text NOT NULL,
  to_state_code       text NOT NULL,
  distance_km         integer NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
  transport_mode      text NOT NULL
                        CHECK (transport_mode IN ('ROAD', 'RAIL', 'AIR', 'SHIP')),
  vehicle_number      text,
  transporter_name    text,
  transporter_id      text,
  status              text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'CANCELLED', 'EXPIRED')),
  generated_at        timestamptz NOT NULL,
  valid_until         timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eway_bills_org_idx ON eway_bills (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS eway_bills_number_org_unique
  ON eway_bills (org_id, lower(ewb_number));
CREATE INDEX IF NOT EXISTS eway_bills_invoice_idx
  ON eway_bills (org_id, invoice_number);
CREATE INDEX IF NOT EXISTS eway_bills_status_idx
  ON eway_bills (org_id, status, generated_at DESC);

ALTER TABLE eway_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE eway_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eway_bills_tenant_isolation ON eway_bills;
CREATE POLICY eway_bills_tenant_isolation ON eway_bills
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- Grant minimum privileges to the app role (SELECT for reads via RLS).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON qc_equipment      TO instigenie_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON qc_capa_actions   TO instigenie_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON eway_bills        TO instigenie_app;
  END IF;
END $$;
