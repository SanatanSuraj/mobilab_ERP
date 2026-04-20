-- Row-level security. ARCHITECTURE.md §9.2.
--
-- Pattern: for every tenant-scoped table, enable RLS and add a single
-- policy that checks `org_id = current_setting('app.current_org')::uuid`.
-- The GUC is set by packages/db/src/with-org.ts inside a txn, so a
-- request that forgets to call withOrg() sees zero rows (not an error).
--
-- IMPORTANT: `mobilab` also OWNS these tables, and Postgres exempts table
-- owners from RLS by default. We FORCE it so the app role (which happens
-- to be the same account in dev) is never silently bypassed. In a more
-- segregated environment the app runs as a separate, non-owner role and
-- FORCE becomes redundant — but it stays here as belt-and-braces.
--
-- Gate 5 (tests/gates/gate-5-rls.test.ts) verifies that cross-tenant
-- access is silently filtered.

-- ── users ──────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ── user_roles ─────────────────────────────────────────────────────────────
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_roles_tenant_isolation ON user_roles;
CREATE POLICY user_roles_tenant_isolation ON user_roles
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ── refresh_tokens ─────────────────────────────────────────────────────────
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refresh_tokens_tenant_isolation ON refresh_tokens;
CREATE POLICY refresh_tokens_tenant_isolation ON refresh_tokens
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ── memberships ────────────────────────────────────────────────────────────
-- Identity ↔ org links. Tenant-scoped so Apollo's admin cannot enumerate
-- who is in Fortis. The AuthService has a second, carefully-scoped path to
-- list memberships for a single identity during login (that path skips
-- withOrg because the tenant is not yet chosen).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_tenant_isolation ON memberships;
CREATE POLICY memberships_tenant_isolation ON memberships
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- organizations is a LOOKUP table (every user sees their own org only).
-- The policy filters by id — a user can SELECT their own org row via join
-- to users/user_roles.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;
CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id::text = current_setting('app.current_org', true))
  WITH CHECK (id::text = current_setting('app.current_org', true));

-- user_identities is GLOBAL (no org_id). It has NO RLS. Access is limited
-- by convention: only AuthService queries this table. If a future module
-- needs cross-tenant identity lookup (e.g. duplicate-email detection on
-- signup) keep it funnelled through a single helper so the invariant
-- stays auditable.
--
-- roles / permissions / role_permissions are GLOBAL (no org_id). They are
-- effectively read-only to the app — only migrations modify them — so no
-- RLS is applied. If that changes, revisit this file.
--
-- plans / plan_features are GLOBAL (vendor's SaaS catalog). Read by any
-- tenant during plan-picker UX; write only from vendor admin routes. No
-- RLS — access control is "everyone can read, only vendor admin can write"
-- and is enforced at the API layer.

-- ── subscriptions (tenant-scoped — Sprint 1B) ─────────────────────────────
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_tenant_isolation ON subscriptions;
CREATE POLICY subscriptions_tenant_isolation ON subscriptions
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ── usage_records (tenant-scoped — Sprint 1B) ─────────────────────────────
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_records_tenant_isolation ON usage_records;
CREATE POLICY usage_records_tenant_isolation ON usage_records
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));
