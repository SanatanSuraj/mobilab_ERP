-- Customer Portal. ARCHITECTURE.md §3.7 (Phase 3) + §13.9.
--
-- The portal is a second audience ("instigenie-portal") on the same apps/api
-- process. Portal users are identities that hold a CUSTOMER role in some org.
-- Each portal user belongs to exactly one customer master record (the CRM
-- `accounts` row that also owns their sales orders + invoices + tickets).
--
-- This module introduces one table:
--
--   account_portal_users — pivot linking (org_id, user_id) → account_id.
--
-- The internal CRM already has the CRM-side master (accounts) and the
-- per-tenant user row. All we need is the link, plus a GUC-driven RLS
-- predicate so a portal session can only see rows belonging to its own
-- account.
--
-- The GUC contract:
--   app.current_org                → set by withOrg (tenant isolation)
--   app.current_user               → set by withRequest (audit actor)
--   app.current_portal_customer    → set ONLY by withPortalUser — unset for
--                                    every internal request. The portal RLS
--                                    predicate in rls/13-portal-rls.sql
--                                    treats "unset / empty" as "internal
--                                    session, permissive", and "set" as
--                                    "portal session, must match row's
--                                    account_id/customer_id".
--
-- Indexes: one user can map to at most one account per org — enforced by the
-- unique index on (org_id, user_id). Lookup by account goes through
-- (org_id, account_id).

CREATE TABLE IF NOT EXISTS account_portal_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id)      ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  -- Denormalized for faster guard lookups without having to join to users.
  -- Kept in sync by the service layer; the pair (org_id, user_id) is the
  -- canonical key so the denorm drift only affects display.
  display_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One portal user ↔ one customer per tenant. If a human is a portal contact
-- for two customer companies they have TWO identities (different emails) and
-- therefore two user rows. This matches how the internal surface handles
-- multi-tenant identities.
CREATE UNIQUE INDEX IF NOT EXISTS account_portal_users_org_user_unique
  ON account_portal_users (org_id, user_id);

CREATE INDEX IF NOT EXISTS account_portal_users_org_account_idx
  ON account_portal_users (org_id, account_id);

COMMENT ON TABLE account_portal_users IS
  'Phase-3 portal: links a CUSTOMER-role user in one org to exactly one accounts row (the customer master). The link is consulted by withPortalUser to set app.current_portal_customer, which the portal RLS policies then enforce against.';
