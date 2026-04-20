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
  kind        text NOT NULL CHECK (kind IN ('DEAL', 'TICKET')),
  year        integer NOT NULL,
  last_seq    integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, year)
);
