-- Phase 5 — Mobicase manufacturing slice.
--
-- Part A: Rename the INSTRUMENT product family to MODULE so that sub-assembly
--         components (MBA analyser, MBM mixer, MBC incubator) can be tracked as
--         their own product family while the finished Mobicase (MCC) continues
--         to live under DEVICE.
--
-- Part B: Create the `device_instances` table. Each row is one physical unit
--         flowing through the Mobicase production lines (L1-L5). The shape
--         mirrors apps/web/src/data/instigenie-mock.ts MobiDeviceID so the UI
--         can move from mock imports to live API calls without changing shape.
--
-- Idempotency:
--   * All CHECK-constraint renames go through DROP … IF EXISTS + ADD, so a
--     fresh boot (where init/05-production.sql / init/06-qc.sql already carry
--     the renamed constraint) and a replay against a running cluster both
--     succeed.
--   * Data UPDATE is keyed on the OLD value, so a replay against already-
--     migrated data is a no-op.
--   * CREATE TABLE IF NOT EXISTS + DROP CONSTRAINT IF EXISTS for the new
--     device_instances table.

-- ─────────────────────────────────────────────────────────────────────────────
-- Part A — products.family / wip_stage_templates.product_family /
--          inspection_templates.product_family :: INSTRUMENT → MODULE
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1. Drop the old CHECK so the UPDATE below is accepted.
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_family_check;
ALTER TABLE wip_stage_templates
  DROP CONSTRAINT IF EXISTS wip_stage_templates_product_family_check;
ALTER TABLE inspection_templates
  DROP CONSTRAINT IF EXISTS inspection_templates_product_family_check;

-- Step 2. Rename the enum value on existing rows.
UPDATE products
   SET family = 'MODULE'
 WHERE family = 'INSTRUMENT';
UPDATE wip_stage_templates
   SET product_family = 'MODULE'
 WHERE product_family = 'INSTRUMENT';
UPDATE inspection_templates
   SET product_family = 'MODULE'
 WHERE product_family = 'INSTRUMENT';

-- Step 3. Re-add the CHECK constraint with MODULE in place of INSTRUMENT.
ALTER TABLE products
  ADD CONSTRAINT products_family_check
  CHECK (family IN ('MODULE', 'DEVICE', 'REAGENT', 'CONSUMABLE'));
ALTER TABLE wip_stage_templates
  ADD CONSTRAINT wip_stage_templates_product_family_check
  CHECK (product_family IN ('MODULE', 'DEVICE', 'REAGENT', 'CONSUMABLE'));
ALTER TABLE inspection_templates
  ADD CONSTRAINT inspection_templates_product_family_check
  CHECK (product_family IN ('MODULE', 'DEVICE', 'REAGENT', 'CONSUMABLE'));

-- Step 4. Flip the column default on products so new rows fall back to MODULE.
ALTER TABLE products
  ALTER COLUMN family SET DEFAULT 'MODULE';

-- ─────────────────────────────────────────────────────────────────────────────
-- Part B — device_instances
--
-- Each row is one Mobicase unit in production. The table is denormalised to
-- match the mock: module rows (MBA/MBM/MBC) store their own PCB/sensor/etc.
-- IDs, while the MCC roll-up row stores references to all sub-assembly IDs
-- plus vendor IDs for the centrifuge and accessories. The `product_code`
-- column distinguishes layouts at read time.
--
-- `work_order_ref` is plain text (WO-YYYY-MM-NNN) rather than an FK to
-- work_orders.id because the mock WO numbering (Mobicase line-assignments)
-- is distinct from the generic work_orders.pid (PID-YYYY-NNNN) already seeded
-- in ops/sql/seed/10-production-dev-data.sql. Keeping it as text avoids
-- cross-lifecycle coupling until the Mobicase WO table lands (§13.2.9).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_instances (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  -- Scannable unit identifier, e.g. MBA-2026-04-0001-0 or MCC-2026-03-0091-0.
  device_code            text NOT NULL,

  -- Mobicase product taxonomy. MCC is the finished device; the others are
  -- sub-assembly modules that exist either standalone or embedded in an MCC.
  product_code           text NOT NULL
                           CHECK (product_code IN ('MBA', 'MBM', 'MBC', 'MCC', 'CFG')),

  -- Mobicase WO reference. Free text so the CRM-side WO seeding (PID-YYYY-NNNN)
  -- and the manufacturing-side WO numbering (WO-YYYY-MM-NNN) can co-exist
  -- without an implicit FK.
  work_order_ref         text NOT NULL,

  status                 text NOT NULL
                           CHECK (status IN (
                             'CREATED',
                             'IN_PRODUCTION',
                             'SUB_QC_PASS',
                             'SUB_QC_FAIL',
                             'IN_REWORK',
                             'REWORK_LIMIT_EXCEEDED',
                             'FINAL_ASSEMBLY',
                             'FINAL_QC_PASS',
                             'FINAL_QC_FAIL',
                             'RELEASED',
                             'DISPATCHED',
                             'SCRAPPED',
                             'RECALLED'
                           )),
  rework_count           integer NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
  max_rework_limit       integer NOT NULL DEFAULT 3 CHECK (max_rework_limit >= 0),
  assigned_line          text CHECK (assigned_line IN ('L1', 'L2', 'L3', 'L4', 'L5')),

  -- ── Standalone module component IDs (MBA, MBM, MBC) ───────────────────────
  pcb_id                 text,  -- e.g. PCB-MBA-2604-0001
  sensor_id              text,  -- e.g. SNS-MBA-2604-0001
  detector_id            text,  -- e.g. DET-MBA-2604-0001
  machine_id             text,  -- e.g. MCH-MBM-2604-0001 (MBM body)

  -- ── Vendor (CFG centrifuge arrives built; we only scan vendor IDs) ────────
  cfg_vendor_id          text,  -- e.g. OMRON-CFG-20260301-0044
  cfg_serial_no          text,  -- nameplate serial

  -- ── MCC internal sub-assembly component IDs (embedded inside one MCC) ─────
  analyzer_pcb_id        text,
  analyzer_sensor_id     text,
  analyzer_detector_id   text,
  mixer_machine_id       text,
  mixer_pcb_id           text,
  incubator_pcb_id       text,

  -- ── Unit-level accessories bundled with a finished Mobicase ───────────────
  micropipette_id        text,
  centrifuge_id          text,

  -- ── Dispatch / FG (nullable until status advances past FINAL_QC_PASS) ─────
  finished_goods_ref     text,
  invoice_ref            text,
  delivery_challan_ref   text,
  sales_order_ref        text,
  dispatched_at          timestamptz,

  -- ── Scrap (mutually exclusive with dispatch) ──────────────────────────────
  scrapped_at            timestamptz,
  scrapped_reason        text,

  notes                  text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

CREATE INDEX IF NOT EXISTS device_instances_org_idx
  ON device_instances (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS device_instances_code_org_unique
  ON device_instances (org_id, lower(device_code)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS device_instances_product_idx
  ON device_instances (org_id, product_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS device_instances_status_idx
  ON device_instances (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS device_instances_wo_idx
  ON device_instances (org_id, work_order_ref) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS device_instances_line_idx
  ON device_instances (org_id, assigned_line)
  WHERE deleted_at IS NULL AND assigned_line IS NOT NULL;
