-- vendor.password_reset_tokens — parallel to public.password_reset_tokens but
-- for the vendor-admin surface.
--
-- Vendor admins live in `vendor.admins` (NOT `user_identities`) and have
-- their own refresh-token table at `vendor.refresh_tokens`. Tenant and
-- vendor authentication are intentionally segregated — see the doc header
-- on packages/vendor-admin/src/auth.service.ts for the rationale. The reset
-- flow follows the same separation: same shape as the tenant table, but
-- everything lives in the `vendor` schema and is owned/granted exclusively
-- to the BYPASSRLS `instigenie_vendor` role.
--
-- Lifecycle (enforced by the vendor-password-reset service):
--   * created_at = now(), expires_at = now() + 1 hour
--   * consumed_at stamped on successful reset
--   * a successful reset DELETEs all other open tokens for the same admin
--     AND wipes every row in vendor.refresh_tokens for that admin so all
--     existing sessions are signed out.

CREATE TABLE IF NOT EXISTS vendor.password_reset_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_admin_id uuid NOT NULL REFERENCES vendor.admins(id) ON DELETE CASCADE,
  token_hash      text NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_ip      inet
);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_password_reset_tokens_hash_unique
  ON vendor.password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS vendor_password_reset_tokens_admin_recent_idx
  ON vendor.password_reset_tokens (vendor_admin_id, created_at DESC);

-- Grants — vendor schema is exclusive to instigenie_vendor (BYPASSRLS).
-- instigenie_app NEVER touches the vendor schema.
--
-- The vendor reset flow ALSO writes to outbox.events (the email-dispatch
-- queue) — that schema isn't covered by 98-vendor-role.sql because before
-- this migration the vendor surface had no outbox writes. Granting it
-- here so the install is self-sufficient; harmless if 98-vendor-role.sql
-- is later updated to include it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_vendor') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA vendor TO instigenie_vendor';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON vendor.password_reset_tokens TO instigenie_vendor';
    -- outbox is a separate schema; vendor flow needs INSERT to enqueue
    -- the password-reset email event.
    EXECUTE 'GRANT USAGE ON SCHEMA outbox TO instigenie_vendor';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA outbox TO instigenie_vendor';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA outbox TO instigenie_vendor';
  END IF;
END $$;
