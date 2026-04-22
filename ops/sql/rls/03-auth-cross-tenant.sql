-- Cross-tenant auth path — the ONE place outside vendor admin that reads
-- across tenants. Referenced by 01-enable-rls.sql's memberships comment
-- ("AuthService has a second, carefully-scoped path …").
--
-- WHY A SECURITY DEFINER FUNCTION
-- --------------------------------
-- At login time, before a tenant is picked, the AuthService needs to find
-- every ACTIVE membership for a given identity across all orgs so the UI
-- can render a tenant picker. That query is inherently cross-tenant:
--
--   SELECT m.*, o.*, u.*
--     FROM memberships m
--     JOIN organizations o ON o.id = m.org_id
--     JOIN users u         ON u.id = m.user_id
--    WHERE m.identity_id = $1 AND m.status = 'ACTIVE';
--
-- All three tables have RLS enabled with `app.current_org` policies. During
-- login no org is chosen yet, so `app.current_org` is NULL and RLS filters
-- every row to zero. The symptom is a 403 "no internal membership for this
-- identity" even when memberships exist.
--
-- Alternatives and why they were rejected:
--   1. Route through the vendor BYPASSRLS pool → semantically wrong; that
--      pool is for vendor-admin cross-tenant work, not tenant auth.
--   2. Add `app.current_identity` OR-clauses to three policies → every
--      tenant-scoped SELECT from users/organizations pays for a subquery
--      even when the GUC is NULL.
--   3. `SET LOCAL row_security = off` → requires role privilege that
--      `instigenie_app` (intentionally) doesn't have.
--   4. Dedicated auth role with BYPASSRLS → violates gate-11, widens the
--      blast radius of any future code that uses the wrong pool.
--
-- A SECURITY DEFINER function is the narrowest workable option. It runs as
-- the function owner (the migration role `instigenie`, a superuser) and so
-- bypasses RLS — but ONLY for this one query shape with one argument. The
-- app role `instigenie_app` is granted EXECUTE; it cannot call anything else
-- that crosses tenants.
--
-- SAFETY ARGUMENT
-- ---------------
-- The AuthService calls this function AFTER verifying the caller's
-- password (bcrypt.compare against user_identities.password_hash). So the
-- only rows exposed are those the caller would see anyway after picking
-- any one of their tenants — no new data surface, just earlier access.
--
-- `search_path = ''` forces every reference inside the body to be
-- schema-qualified (`public.memberships`, etc.), which blocks a classic
-- SECURITY DEFINER escalation where a caller creates a same-named table
-- in their own schema and has the function read it instead.

-- DROP first because CREATE OR REPLACE can't change the OUT parameter
-- list. Idempotent — subsequent runs (e.g. DB rebuild) start clean.
DROP FUNCTION IF EXISTS public.auth_load_active_memberships(uuid);

CREATE FUNCTION public.auth_load_active_memberships(
  p_identity_id uuid
) RETURNS TABLE (
  org_id       uuid,
  org_name     text,
  user_id      uuid,
  email        text,
  name         text,
  capabilities jsonb,
  roles        text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.org_id,
         o.name         AS org_name,
         m.user_id,
         u.email,
         u.name,
         u.capabilities,
         COALESCE(
           array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL),
           ARRAY[]::text[]
         ) AS roles
    FROM public.memberships   m
    JOIN public.organizations o ON o.id = m.org_id
    JOIN public.users         u ON u.id = m.user_id
    LEFT JOIN public.user_roles ur ON ur.user_id = u.id
   WHERE m.identity_id = p_identity_id
     AND m.status      = 'ACTIVE'
     AND u.is_active   = true
   GROUP BY m.org_id, o.name, m.user_id, u.email, u.name, u.capabilities
   ORDER BY o.name;
$$;

-- Revoke PUBLIC so only roles we explicitly GRANT can call this.
REVOKE ALL ON FUNCTION public.auth_load_active_memberships(uuid) FROM PUBLIC;

-- The app role — the only tenant-side caller that should invoke this.
GRANT EXECUTE ON FUNCTION public.auth_load_active_memberships(uuid) TO instigenie_app;

-- Vendor pool (BYPASSRLS already) may also call it; harmless and useful
-- for maintenance scripts that ride on that pool.
GRANT EXECUTE ON FUNCTION public.auth_load_active_memberships(uuid) TO instigenie_vendor;

COMMENT ON FUNCTION public.auth_load_active_memberships(uuid) IS
  'Cross-tenant ACTIVE-membership lookup for login. SECURITY DEFINER so it bypasses RLS; the AuthService calls this ONLY after verifying the identity password. See ops/sql/rls/03-auth-cross-tenant.sql.';

-- ─── auth_load_refresh_token ────────────────────────────────────────────────
--
-- Used by AuthService.refresh() and AuthService.logout(). At those entry
-- points the caller presents a refresh-token value; we hash it to
-- token_hash and look up the row. We don't know the org_id yet, so
-- RLS-enabled `refresh_tokens` would return zero rows. The hash itself
-- is a 256-bit secret (see TokenFactory.mintRefresh), so a global lookup
-- by hash is no weaker than the RLS-guarded shape — an attacker without
-- the hash can't forge one.
--
-- Once this function returns the row, refresh() switches to withOrg(org_id)
-- for the rotation INSERT/UPDATE so those writes are RLS-checked normally.

DROP FUNCTION IF EXISTS public.auth_load_refresh_token(text);

CREATE FUNCTION public.auth_load_refresh_token(
  p_token_hash text
) RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  org_id      uuid,
  identity_id uuid,
  audience    text,
  expires_at  timestamptz,
  revoked_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id, user_id, org_id, identity_id, audience, expires_at, revoked_at
    FROM public.refresh_tokens
   WHERE token_hash = p_token_hash
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_load_refresh_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_load_refresh_token(text) TO instigenie_app;
GRANT EXECUTE ON FUNCTION public.auth_load_refresh_token(text) TO instigenie_vendor;

COMMENT ON FUNCTION public.auth_load_refresh_token(text) IS
  'Cross-tenant refresh-token lookup by token_hash. SECURITY DEFINER bypasses RLS; safe because token_hash is a 256-bit secret. Caller switches to withOrg(row.org_id) for any follow-up mutations.';
