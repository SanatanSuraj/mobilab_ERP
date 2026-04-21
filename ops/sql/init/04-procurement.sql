-- Procurement module tables. ARCHITECTURE.md §13.5.
--
-- Scope (Phase 2): vendors (master), indents (purchase requests),
-- purchase_orders + po_lines, grns + grn_lines. No RTV, no approval
-- workflow, no three-way match — those land in Phase 3.
--
-- Lifecycle notes (enforced at service layer, not in CHECKs; CHECKs only
-- validate the enum):
--   * Indent    : DRAFT → SUBMITTED → APPROVED → CONVERTED | REJECTED
--   * PO        : DRAFT → PENDING_APPROVAL → APPROVED → SENT
--                        → PARTIALLY_RECEIVED → RECEIVED | CANCELLED
--   * GRN       : DRAFT → POSTED
--
-- GRN ↔ Inventory integration:
--   * Posting a GRN writes a row per grn_line to stock_ledger with
--     txn_type = 'GRN_RECEIPT' via the stock service — stock_summary
--     projection trigger keeps on-hand in sync.
--   * grn_lines carries the batch_no/serial_no snapshot; future Phase 3
--     QC workflow mutates a `qc_status` column per line.
--
-- Naming conventions — ARCHITECTURE.md §4 (matches 02-crm.sql, 03-inventory.sql):
--   * Plural snake_case table names.
--   * org_id NOT NULL on every tenant-scoped row.
--   * Money is NUMERIC(18,2), quantities NUMERIC(18,3).
--   * Every mutable header table has version + tg_bump_version trigger;
--     child `*_lines` tables bump their header's version via the audit
--     trigger instead (simpler + keeps the line UI responsive).

-- ─────────────────────────────────────────────────────────────────────────────
-- Vendors — supplier/service-provider master. Distinct from CRM accounts
-- (which are customers); a tenant rarely has an entity playing both roles.
-- When they do, it's two rows (one per direction) for clarity.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code          text NOT NULL,
  name          text NOT NULL,
  vendor_type   text NOT NULL DEFAULT 'SUPPLIER'
                  CHECK (vendor_type IN ('SUPPLIER', 'SERVICE', 'LOGISTICS', 'BOTH')),
  -- Tax/compliance
  gstin         text,
  pan           text,
  msme_number   text,
  is_msme       boolean NOT NULL DEFAULT false,
  -- Primary address / contact
  address       text,
  city          text,
  state         text,
  country       text NOT NULL DEFAULT 'IN',
  postal_code   text,
  contact_name  text,
  email         text,
  phone         text,
  website       text,
  -- Commercial terms
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  credit_limit  numeric(18, 2) NOT NULL DEFAULT 0,
  -- Bank details for payments (Phase 3 finance module consumes these)
  bank_account  text,
  bank_ifsc     text,
  bank_name     text,
  -- Audit / lifecycle
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS vendors_org_idx ON vendors (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS vendors_code_org_unique
  ON vendors (org_id, lower(code)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vendors_active_idx
  ON vendors (org_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vendors_name_trgm_idx
  ON vendors USING gin (lower(name) gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- procurement_number_sequences — per-(org, kind, year) monotonic counter
-- feeding IND-YYYY-NNNN / PO-YYYY-NNNN / GRN-YYYY-NNNN. Same shape as the
-- CRM one in 02-crm.sql; keeping them separate so module deletion is clean.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS procurement_number_sequences (
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind      text NOT NULL CHECK (kind IN ('INDENT', 'PO', 'GRN')),
  year      integer NOT NULL CHECK (year >= 2000 AND year < 3000),
  last_seq  integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, year)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indents — internal purchase requests. An indent's lines specify what
-- items (and how many) a department wants to procure. Approval turns the
-- indent into one or more POs. For Phase 2 CRUD we store the lifecycle
-- column but no approval workflow manipulates it — state transitions
-- are driven by the service layer.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS indents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  indent_number   text NOT NULL,
  department      text,
  purpose         text,
  status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED')),
  priority        text NOT NULL DEFAULT 'NORMAL'
                    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  required_by     date,
  requested_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  notes           text,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS indents_org_idx ON indents (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS indents_number_org_unique
  ON indents (org_id, indent_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS indents_status_idx
  ON indents (org_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS indent_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  indent_id       uuid NOT NULL REFERENCES indents(id) ON DELETE CASCADE,
  line_no         integer NOT NULL CHECK (line_no > 0),
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity        numeric(18, 3) NOT NULL CHECK (quantity > 0),
  uom             text NOT NULL,
  estimated_cost  numeric(18, 2) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS indent_lines_org_idx ON indent_lines (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS indent_lines_unique
  ON indent_lines (org_id, indent_id, line_no);

-- ─────────────────────────────────────────────────────────────────────────────
-- purchase_orders — committed buy. `indent_id` is nullable (ad-hoc POs are
-- allowed), `vendor_id` is not. Totals are denormalised on header so list
-- views don't have to roll up lines on every read. Service layer recomputes
-- them on every line mutation.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  po_number       text NOT NULL,
  indent_id       uuid REFERENCES indents(id) ON DELETE SET NULL,
  vendor_id       uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN (
                      'DRAFT',
                      'PENDING_APPROVAL',
                      'APPROVED',
                      'SENT',
                      'PARTIALLY_RECEIVED',
                      'RECEIVED',
                      'CANCELLED'
                    )),
  currency        text NOT NULL DEFAULT 'INR',
  order_date      date NOT NULL DEFAULT current_date,
  expected_date   date,
  delivery_warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  billing_address text,
  shipping_address text,
  payment_terms_days integer NOT NULL DEFAULT 30,
  -- Denormalised roll-ups from po_lines, maintained by service.
  subtotal        numeric(18, 2) NOT NULL DEFAULT 0,
  tax_total       numeric(18, 2) NOT NULL DEFAULT 0,
  discount_total  numeric(18, 2) NOT NULL DEFAULT 0,
  grand_total     numeric(18, 2) NOT NULL DEFAULT 0,
  -- Audit / lifecycle
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  sent_at         timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  notes           text,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS purchase_orders_org_idx ON purchase_orders (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_number_org_unique
  ON purchase_orders (org_id, po_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_orders_vendor_idx
  ON purchase_orders (org_id, vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx
  ON purchase_orders (org_id, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS po_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  indent_line_id  uuid REFERENCES indent_lines(id) ON DELETE SET NULL,
  line_no         integer NOT NULL CHECK (line_no > 0),
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  description     text,
  quantity        numeric(18, 3) NOT NULL CHECK (quantity > 0),
  uom             text NOT NULL,
  unit_price      numeric(18, 2) NOT NULL CHECK (unit_price >= 0),
  discount_pct    numeric(5, 2)  NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  tax_pct         numeric(5, 2)  NOT NULL DEFAULT 0 CHECK (tax_pct >= 0 AND tax_pct <= 100),
  -- Computed per line for reporting; recomputed by service on line write.
  line_subtotal   numeric(18, 2) NOT NULL DEFAULT 0,
  line_tax        numeric(18, 2) NOT NULL DEFAULT 0,
  line_total      numeric(18, 2) NOT NULL DEFAULT 0,
  -- Tracks how much has been received across GRNs for fulfilment view.
  received_qty    numeric(18, 3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS po_lines_org_idx ON po_lines (org_id);
CREATE INDEX IF NOT EXISTS po_lines_po_idx ON po_lines (org_id, po_id);
CREATE UNIQUE INDEX IF NOT EXISTS po_lines_unique
  ON po_lines (org_id, po_id, line_no);

-- ─────────────────────────────────────────────────────────────────────────────
-- grns — Goods Receipt Notes. One GRN per physical delivery event against
-- a PO. Posting a GRN:
--   1. Writes one stock_ledger row per grn_line (txn_type = 'GRN_RECEIPT')
--      — the stock_summary projection trigger updates on-hand.
--   2. Bumps the PO's po_lines.received_qty and header status
--      (DRAFT → PARTIALLY_RECEIVED → RECEIVED).
-- This is all done in the service layer transactionally.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  grn_number      text NOT NULL,
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  vendor_id       uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'POSTED')),
  received_date   date NOT NULL DEFAULT current_date,
  vehicle_number  text,
  invoice_number  text,              -- vendor's invoice # for three-way match (Phase 3)
  invoice_date    date,
  received_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  posted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  posted_at       timestamptz,
  notes           text,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS grns_org_idx ON grns (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS grns_number_org_unique
  ON grns (org_id, grn_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS grns_po_idx ON grns (org_id, po_id);
CREATE INDEX IF NOT EXISTS grns_status_idx ON grns (org_id, status);

CREATE TABLE IF NOT EXISTS grn_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  grn_id          uuid NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
  po_line_id      uuid NOT NULL REFERENCES po_lines(id) ON DELETE RESTRICT,
  line_no         integer NOT NULL CHECK (line_no > 0),
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity        numeric(18, 3) NOT NULL CHECK (quantity > 0),
  uom             text NOT NULL,
  unit_cost       numeric(18, 2) NOT NULL DEFAULT 0,
  batch_no        text,
  serial_no       text,
  mfg_date        date,
  expiry_date     date,
  -- Outcome of inward QC, populated in Phase 3. Phase 2 leaves as NULL.
  qc_status       text CHECK (qc_status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'PARTIAL')),
  qc_rejected_qty numeric(18, 3) NOT NULL DEFAULT 0 CHECK (qc_rejected_qty >= 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grn_lines_org_idx ON grn_lines (org_id);
CREATE INDEX IF NOT EXISTS grn_lines_grn_idx ON grn_lines (org_id, grn_id);
CREATE UNIQUE INDEX IF NOT EXISTS grn_lines_unique
  ON grn_lines (org_id, grn_id, line_no);
