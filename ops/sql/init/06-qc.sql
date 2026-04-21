-- QC (Quality Control) module tables. ARCHITECTURE.md §13.4.
--
-- Scope (Phase 2): inspection_templates + inspection_parameters (the reusable
-- checklist definitions), qc_inspections + qc_findings (actual inspections
-- run against GRN lines, WIP stages, or whole WOs), and qc_certs (formal
-- certificates issued on FINAL_QC pass).
--
-- Explicitly OUT of scope for Phase 2 (see §13.4 Phase 3+):
--   * NCR workflow (OPEN → INVESTIGATION → RCA_SIGNED → DISPOSITION → CLOSED)
--   * CAPA management + 8D reports
--   * Calibration schedules + calibration logs
--   * Failure-mode catalogue / defect taxonomy master tables
--   * Statistical process control (SPC) charts
--
-- Inspection kinds (service-layer enforced; CHECK only validates enum):
--   * IQC       — Incoming Quality Control against a GRN line (post-receipt
--                 sample check of purchased raw material). `source_type`
--                 must be 'GRN_LINE'.
--   * SUB_QC    — In-process QC at a wip_stages.requires_qc_signoff = true
--                 stage. `source_type` must be 'WIP_STAGE'.
--   * FINAL_QC  — End-of-line QC for a whole work order. `source_type` must
--                 be 'WO'. Passing FINAL_QC is the only path that can issue
--                 a qc_certs row.
--
-- Lifecycle (service-layer enforced):
--   * Template    : draft-only via is_active toggle; admin edits only.
--   * Inspection  : DRAFT → IN_PROGRESS → PASSED | FAILED
--   * Finding     : created inline with the parent inspection; result is
--                   PASS | FAIL | SKIPPED. No standalone lifecycle.
--   * Cert        : issued once per PASSED FINAL_QC inspection; immutable.
--
-- Naming conventions match 05-production.sql:
--   * Plural snake_case, org_id NOT NULL on every tenant-scoped row.
--   * NUMERIC(18,4) for measurement values (wider than production quantities
--     because instrument outputs regularly go to 4 decimals — e.g. resistor
--     tolerances, calibration offsets).
--   * Every mutable header has version + tg_bump_version trigger via
--     ops/sql/triggers/08-qc.sql. Children bump parent version via the
--     service layer (same contract as bom_lines / wip_stages).

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_number_sequences — per-(org, kind, year) monotonic counter feeding
-- QC-YYYY-NNNN (inspection numbers) and QCC-YYYY-NNNN (cert numbers).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qc_number_sequences (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('QC', 'QCC')),
  year        integer NOT NULL CHECK (year >= 2000 AND year < 3000),
  last_seq    integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, year)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- inspection_templates — reusable QC checklists. A template groups
-- inspection_parameters and is scoped by `kind` + `product_family` +
-- (optionally) a wip_stage_template for SUB_QC templates.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inspection_templates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code                    text NOT NULL,
  name                    text NOT NULL,
  kind                    text NOT NULL
                            CHECK (kind IN ('IQC', 'SUB_QC', 'FINAL_QC')),
  product_family          text
                            CHECK (product_family IN ('INSTRUMENT', 'DEVICE', 'REAGENT', 'CONSUMABLE')),
  -- For SUB_QC templates — which wip_stage_template this template hangs off.
  -- NULL for IQC (bound by item) and FINAL_QC (bound by product).
  wip_stage_template_id   uuid REFERENCES wip_stage_templates(id) ON DELETE SET NULL,
  -- For IQC templates — optional item binding (templates shared across items
  -- leave this NULL).
  item_id                 uuid REFERENCES items(id) ON DELETE SET NULL,
  -- For FINAL_QC templates — optional product binding.
  product_id              uuid REFERENCES products(id) ON DELETE SET NULL,
  description             text,
  -- Sample-size policy for IQC (e.g. "inspect 5% of batch, min 3 units").
  -- Free text in Phase 2; Phase 3 may normalise to (percent, min, max).
  sampling_plan           text,
  is_active               boolean NOT NULL DEFAULT true,
  version                 integer NOT NULL DEFAULT 1,
  created_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);
CREATE INDEX IF NOT EXISTS inspection_templates_org_idx ON inspection_templates (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS inspection_templates_code_unique
  ON inspection_templates (org_id, lower(code)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inspection_templates_kind_idx
  ON inspection_templates (org_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inspection_templates_family_idx
  ON inspection_templates (org_id, product_family) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inspection_templates_stage_idx
  ON inspection_templates (org_id, wip_stage_template_id)
  WHERE wip_stage_template_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inspection_templates_item_idx
  ON inspection_templates (org_id, item_id)
  WHERE item_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inspection_templates_product_idx
  ON inspection_templates (org_id, product_id)
  WHERE product_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS inspection_templates_name_trgm_idx
  ON inspection_templates USING gin (lower(name) gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- inspection_parameters — child rows of inspection_templates. Each row is
-- one checklist item with type-specific expected / min / max bounds.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inspection_parameters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  template_id         uuid NOT NULL REFERENCES inspection_templates(id) ON DELETE CASCADE,
  sequence_number     integer NOT NULL CHECK (sequence_number > 0),
  name                text NOT NULL,
  parameter_type      text NOT NULL
                        CHECK (parameter_type IN ('NUMERIC', 'TEXT', 'BOOLEAN', 'CHECKBOX')),
  -- For NUMERIC parameters
  expected_value      numeric(18, 4),
  min_value           numeric(18, 4),
  max_value           numeric(18, 4),
  uom                 text,
  -- For TEXT/CHECKBOX — free-text description of what to verify
  expected_text       text,
  is_critical         boolean NOT NULL DEFAULT false,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspection_parameters_org_idx ON inspection_parameters (org_id);
CREATE INDEX IF NOT EXISTS inspection_parameters_template_idx
  ON inspection_parameters (org_id, template_id);
CREATE UNIQUE INDEX IF NOT EXISTS inspection_parameters_unique
  ON inspection_parameters (org_id, template_id, sequence_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_inspections — header row per actual inspection run. `source_type` +
-- `source_id` form a polymorphic link back to the GRN line, WIP stage, or
-- WO that triggered the inspection. The FK hygiene is enforced by the
-- service layer (same pattern as other polymorphic refs in the codebase).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qc_inspections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  inspection_number     text NOT NULL,
  template_id           uuid REFERENCES inspection_templates(id) ON DELETE SET NULL,
  -- Denormalised snapshot so inspection is stable if template is edited.
  template_code         text,
  template_name         text,
  kind                  text NOT NULL
                          CHECK (kind IN ('IQC', 'SUB_QC', 'FINAL_QC')),
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'PASSED', 'FAILED')),
  source_type           text NOT NULL
                          CHECK (source_type IN ('GRN_LINE', 'WIP_STAGE', 'WO')),
  source_id             uuid NOT NULL,
  -- Denormalised descriptor (e.g. "GRN-2026-0012 / line 3" or "PID-2026-0001 / stage 5")
  -- so list views don't need a polymorphic join.
  source_label          text,
  -- Conveniences — same as source_id for direct FK joins where possible.
  grn_line_id           uuid REFERENCES grn_lines(id) ON DELETE SET NULL,
  wip_stage_id          uuid REFERENCES wip_stages(id) ON DELETE SET NULL,
  work_order_id         uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  item_id               uuid REFERENCES items(id) ON DELETE SET NULL,
  product_id            uuid REFERENCES products(id) ON DELETE SET NULL,
  sample_size           integer CHECK (sample_size >= 1),
  inspector_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at            timestamptz,
  completed_at          timestamptz,
  verdict               text CHECK (verdict IN ('PASS', 'FAIL')),
  verdict_notes         text,
  notes                 text,
  version               integer NOT NULL DEFAULT 1,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX IF NOT EXISTS qc_inspections_org_idx ON qc_inspections (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS qc_inspections_number_unique
  ON qc_inspections (org_id, inspection_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_inspections_status_idx
  ON qc_inspections (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_inspections_kind_idx
  ON qc_inspections (org_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_inspections_source_idx
  ON qc_inspections (org_id, source_type, source_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_inspections_grn_line_idx
  ON qc_inspections (org_id, grn_line_id)
  WHERE grn_line_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_inspections_wip_stage_idx
  ON qc_inspections (org_id, wip_stage_id)
  WHERE wip_stage_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_inspections_wo_idx
  ON qc_inspections (org_id, work_order_id)
  WHERE work_order_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_inspections_inspector_idx
  ON qc_inspections (org_id, inspector_id)
  WHERE inspector_id IS NOT NULL AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_findings — child rows of qc_inspections. One row per parameter checked
-- (normally a 1:1 copy of inspection_parameters but templates can be
-- overridden inline per inspection, so we snapshot the parameter shape).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qc_findings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  inspection_id         uuid NOT NULL REFERENCES qc_inspections(id) ON DELETE CASCADE,
  parameter_id          uuid REFERENCES inspection_parameters(id) ON DELETE SET NULL,
  sequence_number       integer NOT NULL CHECK (sequence_number > 0),
  parameter_name        text NOT NULL,
  parameter_type        text NOT NULL
                          CHECK (parameter_type IN ('NUMERIC', 'TEXT', 'BOOLEAN', 'CHECKBOX')),
  expected_value        numeric(18, 4),
  min_value             numeric(18, 4),
  max_value             numeric(18, 4),
  expected_text         text,
  uom                   text,
  is_critical           boolean NOT NULL DEFAULT false,
  -- Actual measurement. Stored as text so we can represent numerics,
  -- booleans ("true"/"false"), and free-form text uniformly.
  actual_value          text,
  actual_numeric        numeric(18, 4),
  actual_boolean        boolean,
  result                text NOT NULL DEFAULT 'PENDING'
                          CHECK (result IN ('PENDING', 'PASS', 'FAIL', 'SKIPPED')),
  inspector_notes       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qc_findings_org_idx ON qc_findings (org_id);
CREATE INDEX IF NOT EXISTS qc_findings_inspection_idx
  ON qc_findings (org_id, inspection_id);
CREATE UNIQUE INDEX IF NOT EXISTS qc_findings_unique
  ON qc_findings (org_id, inspection_id, sequence_number);
CREATE INDEX IF NOT EXISTS qc_findings_result_idx
  ON qc_findings (org_id, result) WHERE result IN ('FAIL', 'PENDING');

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_certs — formal QC certificate. Issued once per PASSED FINAL_QC
-- inspection. Immutable after issue (service layer enforces no-update).
-- Phase 2 keeps the PDF object key as a nullable MinIO pointer — actual PDF
-- rendering is a Phase 3 concern; the web UI can display a generated
-- certificate in-browser from the finding data.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qc_certs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  cert_number       text NOT NULL,
  inspection_id     uuid NOT NULL REFERENCES qc_inspections(id) ON DELETE RESTRICT,
  work_order_id     uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  product_id        uuid REFERENCES products(id) ON DELETE SET NULL,
  -- Denormalised descriptor for quick lookups.
  product_name      text,
  wo_pid            text,
  device_serials    text[] NOT NULL DEFAULT ARRAY[]::text[],
  issued_at         timestamptz NOT NULL DEFAULT now(),
  signed_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  signed_by_name    text,
  signature_hash    text,
  pdf_minio_key     text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS qc_certs_org_idx ON qc_certs (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS qc_certs_number_unique
  ON qc_certs (org_id, cert_number) WHERE deleted_at IS NULL;
-- One cert per inspection.
CREATE UNIQUE INDEX IF NOT EXISTS qc_certs_one_per_inspection
  ON qc_certs (org_id, inspection_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_certs_wo_idx
  ON qc_certs (org_id, work_order_id)
  WHERE work_order_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qc_certs_issued_idx
  ON qc_certs (org_id, issued_at) WHERE deleted_at IS NULL;
