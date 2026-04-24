-- Vendor role: BYPASSRLS, scoped to the `vendor` schema plus read-only
-- visibility into all tenant-scoped data.
--
-- Why BYPASSRLS: vendor admins must be able to list every tenant ("show me
-- all suspended orgs this week") without the app.current_org GUC dance.
-- RLS is for tenant boundaries; vendor traffic is explicitly ABOVE those
-- boundaries by design.
--
-- Safety boundary:
--   - Tenant API code MUST use the `instigenie_app` role (99-app-role.sql).
--   - Vendor API code MUST use `instigenie_vendor` and nothing else.
--   - The two roles are separate LOGIN accounts with separate passwords, so
--     a leak in one credential does not grant the other.
--
-- Gate 19 (tests/gates/gate-19-vendor-bypassrls.test.ts) asserts this
-- separation end-to-end by running the same SELECT under both roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_vendor') THEN
    CREATE ROLE instigenie_vendor
      LOGIN
      NOSUPERUSER
      BYPASSRLS                 -- the whole point of this role
      NOCREATEDB
      NOCREATEROLE
      PASSWORD 'instigenie_dev';
  ELSE
    ALTER ROLE instigenie_vendor
      LOGIN
      NOSUPERUSER
      BYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      PASSWORD 'instigenie_dev';
  END IF;
END
$$;

-- ── Schema usage ─────────────────────────────────────────────────────────
-- Vendor admins read tenant-scoped tables for cross-tenant dashboards and
-- incident response, and they own the `vendor` schema entirely.
GRANT USAGE ON SCHEMA public TO instigenie_vendor;
GRANT USAGE ON SCHEMA audit  TO instigenie_vendor;
GRANT USAGE ON SCHEMA vendor TO instigenie_vendor;

-- Keep instigenie_app explicitly out of the vendor schema so a tenant-side
-- SQL injection cannot peek at vendor admin users or the action log.
--
-- 99-app-role.sql runs AFTER this file, so on a fresh bootstrap the role
-- doesn't exist yet and a bare REVOKE would fail with ON_ERROR_STOP. Guard
-- with pg_roles; the post-seed `pnpm db:migrate` (apply-to-running.sh) pass
-- re-runs this file and the REVOKE lands then. Once 99-app-role has run
-- once, subsequent invocations see the role and this block is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA vendor FROM instigenie_app';
  END IF;
END
$$;

-- ── Public schema: full DML for tenant tables (needed for suspend /
--    reinstate / change plan). BYPASSRLS means these INSERT/UPDATEs land
--    without any app.current_org GUC.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO instigenie_vendor;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO instigenie_vendor;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO instigenie_vendor;

-- Audit schema: read-only — for forensics, never for mutation. The tenant
-- audit log belongs to the tenant; vendor admin actions land in vendor.action_log.
GRANT SELECT ON ALL TABLES IN SCHEMA audit TO instigenie_vendor;

-- ── vendor schema grants ─────────────────────────────────────────────────
-- vendor.admins — full DML: CRUD of vendor admin accounts.
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor.admins TO instigenie_vendor;

-- vendor.action_log — APPEND-ONLY. Instigenie employees cannot tamper with
-- the audit trail, even their own entries. The ops team edits via
-- superuser out-of-band if a row ever needs correction.
GRANT SELECT, INSERT ON vendor.action_log TO instigenie_vendor;
-- (No UPDATE, no DELETE.)

-- vendor.refresh_tokens — full DML: mint on login, rotate on refresh,
-- revoke on logout. Not append-only because we need to flip revoked_at.
GRANT SELECT, INSERT, UPDATE, DELETE ON vendor.refresh_tokens TO instigenie_vendor;

-- Sequences in the vendor schema (for serial keys, though we don't use any
-- right now — future-proofing).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA vendor TO instigenie_vendor;

-- ── Default privileges for anything created later by instigenie ─────────────
ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO instigenie_vendor;
ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO instigenie_vendor;
ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA vendor
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO instigenie_vendor;
