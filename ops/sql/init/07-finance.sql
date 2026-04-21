-- Finance module tables. ARCHITECTURE.md §13.6.
--
-- Scope (Phase 2): sales_invoices + sales_invoice_lines (customer-facing
-- invoices), purchase_invoices + purchase_invoice_lines (vendor bills),
-- customer_ledger + vendor_ledger (append-only running ledgers), and a
-- polymorphic `payments` table that can apply to either invoice type.
--
-- Explicitly OUT of scope for Phase 2 (see §13.6 Phase 3+):
--   * EWB (e-Way Bill) generation — NIC API integration
--   * GST returns (GSTR-1, GSTR-3B)
--   * TDS entries (Form 26Q feed)
--   * Credit notes / debit notes
--   * Invoice approval workflow beyond single-signature POST
--   * Three-way match validator (PO ↔ GRN ↔ PI beyond tolerance flagging)
--   * Materialised dashboard view
--
-- Invoice lifecycle (service-layer enforced):
--   * DRAFT     — editable; lines can be added/removed/repriced
--   * POSTED    — immutable; ledger rows appended; counts toward AR/AP
--   * CANCELLED — terminal; reverses ledger via offsetting row
--
-- Payment lifecycle:
--   * RECORDED  — immutable on create; applies to N invoices atomically
--   * VOIDED    — reversal via paired ledger row (original untouched)
--
-- Naming conventions match 06-qc.sql:
--   * Plural snake_case, org_id NOT NULL on every tenant-scoped row.
--   * NUMERIC(18,4) for money (matches ARCHITECTURE §5.3 decimal-string
--     handling; wider than default to avoid fixed-point surprises when
--     tax-on-tax math accumulates sub-paisa remainders).
--   * Every mutable header has version + tg_bump_version trigger via
--     ops/sql/triggers/09-finance.sql.

-- ─────────────────────────────────────────────────────────────────────────────
-- finance_number_sequences — per-(org, kind, year) monotonic counter feeding
-- SI-YYYY-NNNN  (sales invoices)
-- PI-YYYY-NNNN  (purchase invoices)
-- PAY-YYYY-NNNN (payments)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_number_sequences (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('SI', 'PI', 'PAY')),
  year        integer NOT NULL CHECK (year >= 2000 AND year < 3000),
  last_seq    integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, year)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- sales_invoices — customer-facing invoice headers. Generated manually or
-- auto-drafted from device.dispatched events. Go through DRAFT → POSTED on
-- finance approval; posting appends one row to customer_ledger.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_number      text NOT NULL,
  status              text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  -- Optional links back to origin docs
  -- `customer_id` references the CRM `accounts` table which is the customer
  -- master in this codebase. The name column uses the finance nomenclature
  -- for UI clarity even though the FK target is accounts(id).
  customer_id         uuid REFERENCES accounts(id) ON DELETE SET NULL,
  customer_name       text,
  customer_gstin      text,
  customer_address    text,
  work_order_id       uuid REFERENCES work_orders(id) ON DELETE SET NULL,
  sales_order_id      uuid,  -- FK enforced at service layer (sales_orders may not exist yet)
  -- Dates
  invoice_date        date NOT NULL DEFAULT current_date,
  due_date            date,
  -- Money (decimal strings from wire) — totals recomputed by service
  currency            text NOT NULL DEFAULT 'INR' CHECK (char_length(currency) = 3),
  subtotal            numeric(18, 4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total           numeric(18, 4) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  discount_total      numeric(18, 4) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  grand_total         numeric(18, 4) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  amount_paid         numeric(18, 4) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  -- Meta
  notes               text,
  terms               text,
  place_of_supply     text,  -- GST: state code string like "27-Maharashtra"
  posted_at           timestamptz,
  posted_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at        timestamptz,
  cancelled_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  version             integer NOT NULL DEFAULT 1,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX IF NOT EXISTS sales_invoices_org_idx ON sales_invoices (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_number_unique
  ON sales_invoices (org_id, invoice_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_invoices_status_idx
  ON sales_invoices (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_invoices_customer_idx
  ON sales_invoices (org_id, customer_id)
  WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_invoices_date_idx
  ON sales_invoices (org_id, invoice_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_invoices_wo_idx
  ON sales_invoices (org_id, work_order_id)
  WHERE work_order_id IS NOT NULL AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- sales_invoice_lines — line items on a sales invoice. Each line carries
-- its own tax breakup so different HSN/SAC codes in a multi-line invoice
-- compute correctly. Money stored as numeric(18,4); frontend sends strings.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id        uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  sequence_number   integer NOT NULL CHECK (sequence_number > 0),
  -- What we're billing — either a product (finished good) or an item (spare
  -- / service). One of the two is normally set but not enforced by DB.
  product_id        uuid REFERENCES products(id) ON DELETE SET NULL,
  item_id           uuid REFERENCES items(id) ON DELETE SET NULL,
  description       text NOT NULL,
  hsn_sac           text,
  quantity          numeric(18, 4) NOT NULL CHECK (quantity > 0),
  uom               text,
  unit_price        numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  discount_percent  numeric(8, 4) NOT NULL DEFAULT 0
                      CHECK (discount_percent >= 0 AND discount_percent <= 100),
  tax_rate_percent  numeric(8, 4) NOT NULL DEFAULT 0
                      CHECK (tax_rate_percent >= 0 AND tax_rate_percent <= 100),
  -- Derived (service recomputes — we still store for query-time totals)
  line_subtotal     numeric(18, 4) NOT NULL DEFAULT 0,
  line_tax          numeric(18, 4) NOT NULL DEFAULT 0,
  line_total        numeric(18, 4) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_invoice_lines_org_idx ON sales_invoice_lines (org_id);
CREATE INDEX IF NOT EXISTS sales_invoice_lines_invoice_idx
  ON sales_invoice_lines (org_id, invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_lines_unique
  ON sales_invoice_lines (org_id, invoice_id, sequence_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- purchase_invoices — vendor bills. Mirror of sales_invoices but scoped to
-- vendors. Auto-draftable from grn.created. Posting appends to vendor_ledger.
-- Phase 2 skips three-way match; match_status + match_notes are captured
-- as advisory columns for Phase 3 validator.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_number      text NOT NULL,
  vendor_invoice_no   text,  -- Vendor's own bill number
  status              text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  match_status        text NOT NULL DEFAULT 'PENDING'
                        CHECK (match_status IN ('PENDING', 'MATCHED', 'MATCH_FAILED', 'BYPASSED')),
  match_notes         text,
  vendor_id           uuid REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name         text,
  vendor_gstin        text,
  vendor_address      text,
  purchase_order_id   uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  grn_id              uuid REFERENCES grns(id) ON DELETE SET NULL,
  invoice_date        date NOT NULL DEFAULT current_date,
  due_date            date,
  currency            text NOT NULL DEFAULT 'INR' CHECK (char_length(currency) = 3),
  subtotal            numeric(18, 4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total           numeric(18, 4) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  discount_total      numeric(18, 4) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  grand_total         numeric(18, 4) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  amount_paid         numeric(18, 4) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  notes               text,
  terms               text,
  place_of_supply     text,
  posted_at           timestamptz,
  posted_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at        timestamptz,
  cancelled_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  version             integer NOT NULL DEFAULT 1,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX IF NOT EXISTS purchase_invoices_org_idx ON purchase_invoices (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_number_unique
  ON purchase_invoices (org_id, invoice_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_invoices_status_idx
  ON purchase_invoices (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_invoices_vendor_idx
  ON purchase_invoices (org_id, vendor_id)
  WHERE vendor_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_invoices_po_idx
  ON purchase_invoices (org_id, purchase_order_id)
  WHERE purchase_order_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_invoices_date_idx
  ON purchase_invoices (org_id, invoice_date DESC) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- purchase_invoice_lines — child of purchase_invoices. Mirror of
-- sales_invoice_lines shape.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id        uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  sequence_number   integer NOT NULL CHECK (sequence_number > 0),
  item_id           uuid REFERENCES items(id) ON DELETE SET NULL,
  grn_line_id       uuid REFERENCES grn_lines(id) ON DELETE SET NULL,
  description       text NOT NULL,
  hsn_sac           text,
  quantity          numeric(18, 4) NOT NULL CHECK (quantity > 0),
  uom               text,
  unit_price        numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  discount_percent  numeric(8, 4) NOT NULL DEFAULT 0
                      CHECK (discount_percent >= 0 AND discount_percent <= 100),
  tax_rate_percent  numeric(8, 4) NOT NULL DEFAULT 0
                      CHECK (tax_rate_percent >= 0 AND tax_rate_percent <= 100),
  line_subtotal     numeric(18, 4) NOT NULL DEFAULT 0,
  line_tax          numeric(18, 4) NOT NULL DEFAULT 0,
  line_total        numeric(18, 4) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_invoice_lines_org_idx ON purchase_invoice_lines (org_id);
CREATE INDEX IF NOT EXISTS purchase_invoice_lines_invoice_idx
  ON purchase_invoice_lines (org_id, invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoice_lines_unique
  ON purchase_invoice_lines (org_id, invoice_id, sequence_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- customer_ledger — append-only running ledger per customer. One row per
-- debit (invoice POSTED) or credit (payment RECEIVED). NEVER updated, NEVER
-- deleted — reversals post a new offsetting row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entry_date        date NOT NULL DEFAULT current_date,
  entry_type        text NOT NULL
                      CHECK (entry_type IN (
                        'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'OPENING_BALANCE', 'ADJUSTMENT'
                      )),
  -- Exactly one of debit/credit is positive; the other is 0.
  debit             numeric(18, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit            numeric(18, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  -- Running balance computed by the service at insert time (not a trigger,
  -- because we may backfill out-of-order during migrations).
  running_balance   numeric(18, 4) NOT NULL DEFAULT 0,
  currency          text NOT NULL DEFAULT 'INR' CHECK (char_length(currency) = 3),
  reference_type    text NOT NULL
                      CHECK (reference_type IN (
                        'SALES_INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'MANUAL'
                      )),
  reference_id      uuid,
  reference_number  text,
  description       text,
  recorded_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_ledger_org_idx ON customer_ledger (org_id);
CREATE INDEX IF NOT EXISTS customer_ledger_customer_idx
  ON customer_ledger (org_id, customer_id, entry_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_ledger_reference_idx
  ON customer_ledger (org_id, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- vendor_ledger — append-only running ledger per vendor. Mirror of
-- customer_ledger. Payments to vendors are credits from the company's POV;
-- vendor bills are debits.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendor_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  vendor_id         uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  entry_date        date NOT NULL DEFAULT current_date,
  entry_type        text NOT NULL
                      CHECK (entry_type IN (
                        'BILL', 'PAYMENT', 'DEBIT_NOTE', 'OPENING_BALANCE', 'ADJUSTMENT'
                      )),
  debit             numeric(18, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit            numeric(18, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  running_balance   numeric(18, 4) NOT NULL DEFAULT 0,
  currency          text NOT NULL DEFAULT 'INR' CHECK (char_length(currency) = 3),
  reference_type    text NOT NULL
                      CHECK (reference_type IN (
                        'PURCHASE_INVOICE', 'PAYMENT', 'DEBIT_NOTE', 'MANUAL'
                      )),
  reference_id      uuid,
  reference_number  text,
  description       text,
  recorded_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_ledger_org_idx ON vendor_ledger (org_id);
CREATE INDEX IF NOT EXISTS vendor_ledger_vendor_idx
  ON vendor_ledger (org_id, vendor_id, entry_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS vendor_ledger_reference_idx
  ON vendor_ledger (org_id, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- payments — polymorphic cash ledger. One row per cash movement; the
-- `applied_to` JSONB column holds the {invoice_id, invoice_type,
-- amount_applied} allocations.
--
-- Polymorphism intentional: one payment can partially settle N invoices of
-- the same type, but NOT across types (sales + purchase cannot be mixed in
-- a single payment — use two payment rows).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  payment_number    text NOT NULL,
  payment_type      text NOT NULL
                      CHECK (payment_type IN ('CUSTOMER_RECEIPT', 'VENDOR_PAYMENT')),
  status            text NOT NULL DEFAULT 'RECORDED'
                      CHECK (status IN ('RECORDED', 'VOIDED')),
  -- Counterparty — one of the two is set; enforced at service layer.
  customer_id       uuid REFERENCES accounts(id) ON DELETE SET NULL,
  vendor_id         uuid REFERENCES vendors(id) ON DELETE SET NULL,
  counterparty_name text,
  payment_date      date NOT NULL DEFAULT current_date,
  amount            numeric(18, 4) NOT NULL CHECK (amount > 0),
  currency          text NOT NULL DEFAULT 'INR' CHECK (char_length(currency) = 3),
  mode              text NOT NULL
                      CHECK (mode IN (
                        'BANK_TRANSFER', 'CHEQUE', 'UPI', 'CASH', 'CARD', 'OTHER'
                      )),
  reference_no      text,
  -- JSONB [{ invoiceId, invoiceType: SALES_INVOICE|PURCHASE_INVOICE, amountApplied }]
  applied_to        jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes             text,
  voided_at         timestamptz,
  voided_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  void_reason       text,
  signature_hash    text,
  recorded_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS payments_org_idx ON payments (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_number_unique
  ON payments (org_id, payment_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_type_idx
  ON payments (org_id, payment_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_status_idx
  ON payments (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_customer_idx
  ON payments (org_id, customer_id)
  WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_vendor_idx
  ON payments (org_id, vendor_id)
  WHERE vendor_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_date_idx
  ON payments (org_id, payment_date DESC) WHERE deleted_at IS NULL;
