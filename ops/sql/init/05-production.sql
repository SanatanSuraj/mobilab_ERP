-- Production module tables. ARCHITECTURE.md §13.2.
--
-- Scope (Phase 2): products master, bom_versions + bom_lines, wip_stage_templates
-- (seeded per product_family), work_orders + wip_stages (per-WO instances of the
-- template). Device serials are retained as a denormalised text[] on work_orders
-- (per-unit identity is sufficient for the Phase 2 UI; a dedicated device_ids
-- table with 13-state lifecycle lands in Phase 3 alongside BMR).
--
-- Explicitly OUT of scope for Phase 2 (see §13.2.3-9):
--   * ECN workflow (approval chain stored only as a free-text `ecn_ref` column)
--   * BMR dual-signature
--   * Scrap entries + downtime events + OEE computation
--   * MRP reservation (materials check is a read-only computation against
--     inventory.stock_summary — no reservation rows are written here)
--   * Assembly lines L1-L5 + operator capability + shifts
--
-- Lifecycle notes (service-layer enforced; CHECK constraints only validate enum):
--   * Product : active | inactive (simple toggle, no lifecycle state)
--   * BOM     : DRAFT → ACTIVE → SUPERSEDED | OBSOLETE (only one ACTIVE per product)
--   * WO      : PLANNED → MATERIAL_CHECK → IN_PROGRESS → QC_HOLD ↔ REWORK
--                                       → COMPLETED | CANCELLED
--   * Stage   : PENDING → IN_PROGRESS → QC_HOLD ↔ REWORK → COMPLETED
--
-- Naming conventions match 02-crm.sql, 03-inventory.sql, 04-procurement.sql:
--   * Plural snake_case table names, org_id NOT NULL on every tenant-scoped row.
--   * NUMERIC(18,2) money / NUMERIC(18,3) quantities / NUMERIC(10,2) for
--     durations (hours, with two decimals for precision).
--   * Every mutable header has version + tg_bump_version trigger; child
--     *_lines bump parent version via audit trigger.

-- ─────────────────────────────────────────────────────────────────────────────
-- products — manufactured-output master. Distinct from inventory.items
-- (which covers raw materials, consumables, and finished goods bought for
-- resale). A products row represents something this org actually assembles.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_code         text NOT NULL,
  name                 text NOT NULL,
  family               text NOT NULL DEFAULT 'INSTRUMENT'
                         CHECK (family IN ('INSTRUMENT', 'DEVICE', 'REAGENT', 'CONSUMABLE')),
  description          text,
  uom                  text NOT NULL DEFAULT 'PCS',
  standard_cycle_days  integer NOT NULL DEFAULT 0 CHECK (standard_cycle_days >= 0),
  has_serial_tracking  boolean NOT NULL DEFAULT true,
  rework_limit         integer NOT NULL DEFAULT 2 CHECK (rework_limit >= 0),
  -- Denormalised pointer to currently-ACTIVE bom_versions.id, maintained by
  -- the BOM service when a version is promoted. Nullable until first ACTIVE
  -- BOM is published.
  active_bom_id        uuid,
  notes                text,
  is_active            boolean NOT NULL DEFAULT true,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
CREATE INDEX IF NOT EXISTS products_org_idx ON products (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_code_org_unique
  ON products (org_id, lower(product_code)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_family_idx
  ON products (org_id, family) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_active_idx
  ON products (org_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (lower(name) gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- production_number_sequences — per-(org, kind, year) monotonic counter
-- feeding PID-YYYY-NNNN (WO PIDs) and BOM-YYYY-NNNN (if we need them later).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS production_number_sequences (
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind      text NOT NULL CHECK (kind IN ('WO')),
  year      integer NOT NULL CHECK (year >= 2000 AND year < 3000),
  last_seq  integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, year)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- bom_versions — BOM header, versioned per product. Only one ACTIVE version
-- per product at a time (enforced by partial unique index). Version promotion
-- transitions the prior ACTIVE → SUPERSEDED in the same transaction.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bom_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version_label     text NOT NULL,     -- e.g. "v1", "v2", "v3-R1"
  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'OBSOLETE')),
  effective_from    date,
  effective_to      date,
  total_std_cost    numeric(18, 2) NOT NULL DEFAULT 0 CHECK (total_std_cost >= 0),
  ecn_ref           text,              -- free text until Phase 3 ECN table lands
  notes             text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS bom_versions_org_idx ON bom_versions (org_id);
CREATE INDEX IF NOT EXISTS bom_versions_product_idx
  ON bom_versions (org_id, product_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bom_versions_label_unique
  ON bom_versions (org_id, product_id, version_label)
  WHERE deleted_at IS NULL;
-- At most one ACTIVE BOM per product (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS bom_versions_one_active_per_product
  ON bom_versions (org_id, product_id)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;

-- Deferred FK — products.active_bom_id references bom_versions(id). Has to be
-- deferred until bom_versions exists.
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_active_bom_id_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_active_bom_id_fkey
  FOREIGN KEY (active_bom_id) REFERENCES bom_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS bom_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  bom_id                uuid NOT NULL REFERENCES bom_versions(id) ON DELETE CASCADE,
  line_no               integer NOT NULL CHECK (line_no > 0),
  component_item_id     uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  qty_per_unit          numeric(18, 3) NOT NULL CHECK (qty_per_unit > 0),
  uom                   text NOT NULL,
  reference_designator  text,
  is_critical           boolean NOT NULL DEFAULT false,
  tracking_type         text NOT NULL DEFAULT 'NONE'
                          CHECK (tracking_type IN ('SERIAL', 'BATCH', 'NONE')),
  lead_time_days        integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  std_unit_cost         numeric(18, 2) NOT NULL DEFAULT 0 CHECK (std_unit_cost >= 0),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bom_lines_org_idx ON bom_lines (org_id);
CREATE INDEX IF NOT EXISTS bom_lines_bom_idx ON bom_lines (org_id, bom_id);
CREATE UNIQUE INDEX IF NOT EXISTS bom_lines_unique
  ON bom_lines (org_id, bom_id, line_no);
CREATE INDEX IF NOT EXISTS bom_lines_component_idx
  ON bom_lines (org_id, component_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- wip_stage_templates — per-product-family stage sequence, seeded by SQL seed.
-- Changed only by admin tooling (ECN flow in Phase 3). A work_order copies
-- the relevant templates into wip_stages at creation time so subsequent
-- template edits don't mutate in-flight WOs.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wip_stage_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  product_family            text NOT NULL
                              CHECK (product_family IN ('INSTRUMENT', 'DEVICE', 'REAGENT', 'CONSUMABLE')),
  sequence_number           integer NOT NULL CHECK (sequence_number > 0),
  stage_name                text NOT NULL,
  requires_qc_signoff       boolean NOT NULL DEFAULT false,
  expected_duration_hours   numeric(10, 2) NOT NULL DEFAULT 0 CHECK (expected_duration_hours >= 0),
  responsible_role          text NOT NULL DEFAULT 'Production',
  notes                     text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wip_stage_templates_org_idx ON wip_stage_templates (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS wip_stage_templates_unique
  ON wip_stage_templates (org_id, product_family, sequence_number)
  WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- work_orders — the central production entity. `pid` is the public work-order
-- identifier (PID-YYYY-NNNN). `current_stage_index` tracks where the WO is in
-- its wip_stages sequence; the stage-log UI reads this to render a kanban.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  pid                  text NOT NULL,
  product_id           uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  bom_id               uuid NOT NULL REFERENCES bom_versions(id) ON DELETE RESTRICT,
  bom_version_label    text NOT NULL,     -- snapshot so WO is stable if BOM gets new version
  quantity             numeric(18, 3) NOT NULL CHECK (quantity > 0),
  status               text NOT NULL DEFAULT 'PLANNED'
                         CHECK (status IN (
                           'PLANNED',
                           'MATERIAL_CHECK',
                           'IN_PROGRESS',
                           'QC_HOLD',
                           'REWORK',
                           'COMPLETED',
                           'CANCELLED'
                         )),
  priority             text NOT NULL DEFAULT 'NORMAL'
                         CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  target_date          date,
  started_at           timestamptz,
  completed_at         timestamptz,
  -- Optional links back to the triggering deal; we keep this as an opaque
  -- string so crm deletion doesn't cascade into production.
  deal_id              uuid REFERENCES deals(id) ON DELETE SET NULL,
  assigned_to          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Current position in the wip_stages sequence (0-indexed). Service-layer
  -- updates this when a stage advances.
  current_stage_index  integer NOT NULL DEFAULT 0 CHECK (current_stage_index >= 0),
  rework_count         integer NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
  -- Reagents carry a lot number; serialised products use device_serials.
  lot_number           text,
  -- Unit-level device identifiers. Phase 2 keeps this as a simple array;
  -- Phase 3 swaps for a dedicated device_ids table with 13-state lifecycle.
  device_serials       text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes                text,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);
CREATE INDEX IF NOT EXISTS work_orders_org_idx ON work_orders (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_pid_org_unique
  ON work_orders (org_id, pid) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_product_idx
  ON work_orders (org_id, product_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_status_idx
  ON work_orders (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_target_idx
  ON work_orders (org_id, target_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_deal_idx
  ON work_orders (org_id, deal_id) WHERE deal_id IS NOT NULL AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- wip_stages — per-WO instances copied from wip_stage_templates at WO create
-- time. Each stage has its own PENDING → IN_PROGRESS → QC_HOLD ↔ REWORK →
-- COMPLETED mini-lifecycle. Completing stage n transitions the next stage
-- (n+1) to IN_PROGRESS via service-layer logic.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wip_stages (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  wo_id                    uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  template_id              uuid REFERENCES wip_stage_templates(id) ON DELETE SET NULL,
  sequence_number          integer NOT NULL CHECK (sequence_number > 0),
  stage_name               text NOT NULL,
  requires_qc_signoff      boolean NOT NULL DEFAULT false,
  expected_duration_hours  numeric(10, 2) NOT NULL DEFAULT 0 CHECK (expected_duration_hours >= 0),
  status                   text NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING', 'IN_PROGRESS', 'QC_HOLD', 'REWORK', 'COMPLETED')),
  started_at               timestamptz,
  completed_at             timestamptz,
  qc_result                text CHECK (qc_result IN ('PASS', 'FAIL')),
  qc_notes                 text,
  rework_count             integer NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
  assigned_to              uuid REFERENCES users(id) ON DELETE SET NULL,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wip_stages_org_idx ON wip_stages (org_id);
CREATE INDEX IF NOT EXISTS wip_stages_wo_idx ON wip_stages (org_id, wo_id);
CREATE UNIQUE INDEX IF NOT EXISTS wip_stages_unique
  ON wip_stages (org_id, wo_id, sequence_number);
CREATE INDEX IF NOT EXISTS wip_stages_status_idx
  ON wip_stages (org_id, status) WHERE status IN ('IN_PROGRESS', 'QC_HOLD', 'REWORK');
