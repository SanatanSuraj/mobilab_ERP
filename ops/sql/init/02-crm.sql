-- CRM module tables. ARCHITECTURE.md §13.1.
--
-- Scope (Phase 2): leads, accounts, contacts, deals, deal_line_items,
-- tickets, ticket_comments. Quotations, orders, delivery challans, lead
-- activities follow in subsequent iterations but share the same pattern
-- (every table has org_id + RLS + audit trigger + updated_at trigger).
--
-- Naming conventions — ARCHITECTURE.md §4:
--   * Plural snake_case table names.
--   * Every tenant-scoped table carries `org_id uuid NOT NULL`.
--   * Money/quantities are NUMERIC(18,2) and round-trip as strings via
--     packages/db/src/types.ts (installNumericTypeParser).
--   * Every mutable table carries created_at + updated_at timestamptz.
--   * Soft-delete via deleted_at when present (Phase 2 soft-delete policy §5.5).

-- ── Status enums (referenced by CHECK constraints) ─────────────────────────
-- Kept inline as CHECK/text pairs rather than PG ENUMs so additions don't
-- require an expensive ALTER TYPE across giant tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- Accounts — the account/company buying our products (post-lead-qualify).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name              text NOT NULL,
  industry          text,
  website           text,
  phone             text,
  email             citext,
  address           text,
  city              text,
  state             text,
  country           text NOT NULL DEFAULT 'IN',
  postal_code       text,
  gstin             text,
  -- Relationship health 0–100. Prototype UI colors by bucket.
  health_score      integer NOT NULL DEFAULT 50
                      CHECK (health_score BETWEEN 0 AND 100),
  is_key_account    boolean NOT NULL DEFAULT false,
  -- NUMERIC for currency — Rule #1. Stored in INR; display layer formats.
  annual_revenue    numeric(18, 2),
  employee_count    integer,
  -- owner_id is the sales rep who owns this account. FK to users.
  owner_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS accounts_org_idx ON accounts (org_id);
CREATE INDEX IF NOT EXISTS accounts_owner_idx ON accounts (org_id, owner_id);
CREATE INDEX IF NOT EXISTS accounts_deleted_at_idx
  ON accounts (org_id) WHERE deleted_at IS NULL;
-- Name uniqueness is per-org and case-insensitive (sales reps hate
-- "Apollo Diagnostics" vs "apollo diagnostics" duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS accounts_name_org_unique
  ON accounts (org_id, lower(name)) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Contacts — people at accounts we talk to.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  email          citext,
  phone          text,
  designation    text,
  department     text,
  is_primary     boolean NOT NULL DEFAULT false,
  linkedin_url   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS contacts_org_idx ON contacts (org_id);
CREATE INDEX IF NOT EXISTS contacts_account_idx ON contacts (org_id, account_id);
-- Only one primary contact per account. Partial unique index skips
-- soft-deleted rows.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_primary_per_account
  ON contacts (account_id) WHERE is_primary = true AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Leads — top-of-funnel. Lifecycle: NEW → CONTACTED → QUALIFIED → CONVERTED | LOST.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leads (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name                   text NOT NULL,
  company                text NOT NULL,
  email                  citext NOT NULL,
  phone                  text NOT NULL,
  status                 text NOT NULL DEFAULT 'NEW'
                           CHECK (status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST')),
  source                 text,                -- 'Trade Show', 'Website', 'Referral', 'Cold Call', 'LinkedIn', ...
  assigned_to            uuid REFERENCES users(id) ON DELETE SET NULL,
  estimated_value        numeric(18, 2) NOT NULL DEFAULT 0,
  -- Dedup hints; service layer fills these on create based on case-insensitive match.
  is_duplicate           boolean NOT NULL DEFAULT false,
  duplicate_of_lead_id   uuid REFERENCES leads(id) ON DELETE SET NULL,
  -- After CONVERTED, link the resulting account/deal rows so the UI can jump.
  converted_to_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  converted_to_deal_id    uuid,  -- FK added after `deals` is created (self-referential avoidance)
  lost_reason            text,
  last_activity_at       timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);
CREATE INDEX IF NOT EXISTS leads_org_idx ON leads (org_id);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_assigned_idx ON leads (org_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (org_id, email) WHERE deleted_at IS NULL;

-- Activity feed on a lead: calls, emails, notes, meetings, status changes.
CREATE TABLE IF NOT EXISTS lead_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type        text NOT NULL
                CHECK (type IN ('CALL', 'EMAIL', 'WHATSAPP', 'NOTE', 'MEETING', 'STATUS_CHANGE')),
  content     text NOT NULL,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_activities_org_idx ON lead_activities (org_id);
CREATE INDEX IF NOT EXISTS lead_activities_lead_idx ON lead_activities (lead_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Deals — opportunities in the sales pipeline.
-- Lifecycle: DISCOVERY → PROPOSAL → NEGOTIATION → CLOSED_WON | CLOSED_LOST
-- Deal number format: DEAL-YYYY-NNNN (per §13.1).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  deal_number     text NOT NULL,  -- DEAL-YYYY-NNNN, generated by service
  title           text NOT NULL,
  account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Company/contact_name denormalized because leads-not-yet-converted can
  -- have deals (for forecast accuracy) before account/contact rows exist.
  company         text NOT NULL,
  contact_name    text NOT NULL,
  stage           text NOT NULL DEFAULT 'DISCOVERY'
                    CHECK (stage IN ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST')),
  value           numeric(18, 2) NOT NULL DEFAULT 0,
  probability     integer NOT NULL DEFAULT 20
                    CHECK (probability BETWEEN 0 AND 100),
  assigned_to     uuid REFERENCES users(id) ON DELETE SET NULL,
  expected_close  date,
  closed_at       timestamptz,
  lost_reason     text,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  -- Header-level discount approval state. Discounts proposed via
  -- POST /crm/deals/:id/submit-discount-for-approval flow through the
  -- central approvals engine (entity_type='deal_discount'); the finaliser
  -- copies pending → approved on APPROVE or clears on REJECT.
  -- discount_request_id is the FK back into approval_requests; added in a
  -- second pass (below) once approvals tables exist in the bootstrap order.
  pending_discount_pct  numeric(5, 2)
                          CHECK (pending_discount_pct IS NULL OR pending_discount_pct BETWEEN 0 AND 100),
  approved_discount_pct numeric(5, 2)
                          CHECK (approved_discount_pct IS NULL OR approved_discount_pct BETWEEN 0 AND 100),
  discount_approved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  discount_approved_at  timestamptz,
  discount_request_id   uuid,
  -- Optimistic concurrency: bumped by trigger on every UPDATE.
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS deals_org_idx ON deals (org_id);
CREATE INDEX IF NOT EXISTS deals_stage_idx ON deals (org_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deals_assigned_idx ON deals (org_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deals_account_idx ON deals (org_id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS deals_number_org_unique
  ON deals (org_id, deal_number);
CREATE INDEX IF NOT EXISTS deals_discount_request_idx
  ON deals (discount_request_id)
  WHERE discount_request_id IS NOT NULL;

-- Deferred FK: leads.converted_to_deal_id → deals.id.
ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_converted_to_deal_fk;
ALTER TABLE leads
  ADD CONSTRAINT leads_converted_to_deal_fk
    FOREIGN KEY (converted_to_deal_id) REFERENCES deals(id) ON DELETE SET NULL;

-- Line items on a deal (one row per product). Used by quotations in a
-- future iteration; for now it's just the forecast breakdown.
CREATE TABLE IF NOT EXISTS deal_line_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  deal_id        uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_code   text NOT NULL,          -- product master lives in inventory module (Phase 2)
  product_name   text NOT NULL,
  quantity       integer NOT NULL CHECK (quantity > 0),
  unit_price     numeric(18, 2) NOT NULL,
  discount_pct   numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  line_total     numeric(18, 2) NOT NULL,  -- computed by service, not DB, so we can do tax later
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_line_items_org_idx ON deal_line_items (org_id);
CREATE INDEX IF NOT EXISTS deal_line_items_deal_idx ON deal_line_items (deal_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Support tickets.
-- Lifecycle: OPEN → IN_PROGRESS → WAITING_CUSTOMER → RESOLVED → CLOSED
-- Priority: LOW | MEDIUM | HIGH | CRITICAL
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ticket_number   text NOT NULL,  -- TK-YYYY-NNNN
  account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  subject         text NOT NULL,
  description     text NOT NULL,
  category        text NOT NULL
                    CHECK (category IN (
                      'HARDWARE_DEFECT', 'CALIBRATION', 'SOFTWARE_BUG',
                      'TRAINING', 'WARRANTY_CLAIM', 'GENERAL_INQUIRY'
                    )),
  priority        text NOT NULL DEFAULT 'MEDIUM'
                    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status          text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')),
  device_serial   text,
  product_code    text,
  assigned_to     uuid REFERENCES users(id) ON DELETE SET NULL,
  sla_deadline    timestamptz,
  resolved_at     timestamptz,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS tickets_number_org_unique ON tickets (org_id, ticket_number);
CREATE INDEX IF NOT EXISTS tickets_org_idx ON tickets (org_id);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_priority_idx ON tickets (org_id, priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_assigned_idx ON tickets (org_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_account_idx ON tickets (org_id, account_id);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  visibility  text NOT NULL DEFAULT 'INTERNAL'
                CHECK (visibility IN ('INTERNAL', 'CUSTOMER')),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_comments_org_idx ON ticket_comments (org_id);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket_idx
  ON ticket_comments (ticket_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Deal number sequence — one logical counter per (org_id, year). Used by the
-- deal service to produce DEAL-2026-0001 style identifiers. Likewise for tickets.
-- Kept as a tiny counter table rather than a PG SEQUENCE because sequences
-- are not tenant-scoped.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_number_sequences (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('DEAL', 'TICKET', 'QUOTATION', 'SALES_ORDER')),
  year        integer NOT NULL,
  last_seq    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, year)
);

-- Redundant if the CHECK is already relaxed; drop and re-add so re-running
-- this migration against an older DB updates the constraint.
ALTER TABLE crm_number_sequences
  DROP CONSTRAINT IF EXISTS crm_number_sequences_kind_check;
ALTER TABLE crm_number_sequences
  ADD  CONSTRAINT crm_number_sequences_kind_check
       CHECK (kind IN ('DEAL', 'TICKET', 'QUOTATION', 'SALES_ORDER'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Quotations — customer-facing price + validity proposal.
-- Numbering: Q-YYYY-NNNN (per-org, per-year).
-- Status graph: DRAFT → AWAITING_APPROVAL → APPROVED → SENT →
--               ACCEPTED → CONVERTED   (CONVERTED is terminal)
--                                    → REJECTED | EXPIRED
-- AWAITING_APPROVAL is entered by the service when grand_total exceeds the
-- tenant's approval threshold (tenant setting, not a DB concern).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  quotation_number      text NOT NULL,  -- Q-YYYY-NNNN
  deal_id               uuid REFERENCES deals(id) ON DELETE SET NULL,
  account_id            uuid REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id            uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company               text NOT NULL,   -- denorm for historical fidelity
  contact_name          text NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN (
                            'DRAFT', 'AWAITING_APPROVAL', 'APPROVED',
                            'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED',
                            'CONVERTED'
                          )),
  subtotal              numeric(18, 2) NOT NULL DEFAULT 0,
  tax_amount            numeric(18, 2) NOT NULL DEFAULT 0,
  grand_total           numeric(18, 2) NOT NULL DEFAULT 0,
  valid_until           date,
  notes                 text,
  requires_approval     boolean NOT NULL DEFAULT false,
  approved_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  converted_to_order_id uuid,  -- FK added below (deferred until sales_orders exists)
  rejected_reason       text,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS quotations_number_org_unique
  ON quotations (org_id, quotation_number);
CREATE INDEX IF NOT EXISTS quotations_org_idx ON quotations (org_id);
CREATE INDEX IF NOT EXISTS quotations_status_idx
  ON quotations (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS quotations_account_idx
  ON quotations (org_id, account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS quotations_deal_idx
  ON quotations (org_id, deal_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS quotation_line_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  quotation_id   uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_code   text NOT NULL,
  product_name   text NOT NULL,
  quantity       integer NOT NULL CHECK (quantity > 0),
  unit_price     numeric(18, 2) NOT NULL,
  discount_pct   numeric(5, 2)  NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_pct        numeric(5, 2)  NOT NULL DEFAULT 0 CHECK (tax_pct BETWEEN 0 AND 100),
  tax_amount     numeric(18, 2) NOT NULL DEFAULT 0,
  line_total     numeric(18, 2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotation_line_items_org_idx ON quotation_line_items (org_id);
CREATE INDEX IF NOT EXISTS quotation_line_items_quotation_idx
  ON quotation_line_items (quotation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sales Orders — post-quotation commitment.
-- Numbering: SO-YYYY-NNNN.
-- Status graph: DRAFT → CONFIRMED → PROCESSING → DISPATCHED →
--               IN_TRANSIT → DELIVERED    (DELIVERED is terminal)
--               any-non-terminal → CANCELLED
-- Finance approval is orthogonal (approved_by/approved_at). Fulfillment can
-- progress while finance signs off.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  order_number          text NOT NULL,  -- SO-YYYY-NNNN
  quotation_id          uuid REFERENCES quotations(id) ON DELETE SET NULL,
  account_id            uuid REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id            uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company               text NOT NULL,
  contact_name          text NOT NULL,
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN (
                            'DRAFT', 'CONFIRMED', 'PROCESSING',
                            'DISPATCHED', 'IN_TRANSIT', 'DELIVERED',
                            'CANCELLED'
                          )),
  subtotal              numeric(18, 2) NOT NULL DEFAULT 0,
  tax_amount            numeric(18, 2) NOT NULL DEFAULT 0,
  grand_total           numeric(18, 2) NOT NULL DEFAULT 0,
  expected_delivery     date,
  finance_approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  finance_approved_at   timestamptz,
  notes                 text,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_number_org_unique
  ON sales_orders (org_id, order_number);
CREATE INDEX IF NOT EXISTS sales_orders_org_idx ON sales_orders (org_id);
CREATE INDEX IF NOT EXISTS sales_orders_status_idx
  ON sales_orders (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_orders_account_idx
  ON sales_orders (org_id, account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_orders_quotation_idx
  ON sales_orders (org_id, quotation_id) WHERE deleted_at IS NULL;

-- Deferred FK: quotations.converted_to_order_id → sales_orders.id.
ALTER TABLE quotations
  DROP CONSTRAINT IF EXISTS quotations_converted_order_fk;
ALTER TABLE quotations
  ADD  CONSTRAINT quotations_converted_order_fk
       FOREIGN KEY (converted_to_order_id)
       REFERENCES sales_orders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sales_order_line_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  order_id       uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_code   text NOT NULL,
  product_name   text NOT NULL,
  quantity       integer NOT NULL CHECK (quantity > 0),
  unit_price     numeric(18, 2) NOT NULL,
  discount_pct   numeric(5, 2)  NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_pct        numeric(5, 2)  NOT NULL DEFAULT 0 CHECK (tax_pct BETWEEN 0 AND 100),
  tax_amount     numeric(18, 2) NOT NULL DEFAULT 0,
  line_total     numeric(18, 2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_order_line_items_org_idx ON sales_order_line_items (org_id);
CREATE INDEX IF NOT EXISTS sales_order_line_items_order_idx
  ON sales_order_line_items (order_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Quotation send log — append-only record of outbound email dispatches
-- produced by the worker after processing a `quotation.sent` outbox event.
-- The API never writes here; the worker is the sole producer.
-- Used to answer "did we send this, when, to whom, did it bounce?".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotation_send_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  quotation_id        uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  quotation_version   integer NOT NULL,
  channel             text NOT NULL DEFAULT 'EMAIL'
                        CHECK (channel IN ('EMAIL')),
  status              text NOT NULL
                        CHECK (status IN ('SENT','SKIPPED_DEV','FAILED')),
  recipient_email     citext,
  subject             text,
  provider            text,                 -- 'resend' | 'stub'
  provider_message_id text,                 -- id returned by the email provider
  error_message       text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotation_send_log_quotation_idx
  ON quotation_send_log (quotation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotation_send_log_org_idx
  ON quotation_send_log (org_id, created_at DESC);
