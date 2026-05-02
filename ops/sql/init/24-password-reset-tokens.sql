-- password_reset_tokens — global, identity-scoped tokens for the
-- /auth/forgot-password → /auth/reset-password flow.
--
-- Identity-scoped (not org-scoped) because user_identities is itself global
-- (one row per human across all tenants). The reset operates on
-- user_identities.password_hash, which has no RLS — so this table mirrors
-- that shape: no RLS, direct lookups by SHA-256(token).
--
-- Token storage: only the hash is persisted. The plaintext leaves the server
-- exactly once (in the outgoing email URL) and is never logged.
--
-- Lifecycle (enforced by the password-reset service, not the schema):
--   * created_at = now(), expires_at = now() + 1 hour
--   * consumed_at stamped when the user successfully resets
--   * a successful reset also DELETEs every other open token for the same
--     identity_id (so an attacker who later sees an old email link can't use it)

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id   uuid NOT NULL REFERENCES user_identities(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_ip    inet
);

-- Lookup by token_hash on every reset attempt — must be unique + indexed.
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_unique
  ON password_reset_tokens (token_hash);

-- Rate-limit query: count recent (un-consumed) tokens for an identity.
CREATE INDEX IF NOT EXISTS password_reset_tokens_identity_recent_idx
  ON password_reset_tokens (identity_id, created_at DESC);

-- Grants — global table, same shape as user_identities. instigenie_app
-- needs SELECT/INSERT/UPDATE/DELETE; never grant to instigenie_vendor
-- (vendor admins don't need to read user passwords or reset tokens).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO instigenie_app';
  END IF;
END $$;

-- ─── auth_revoke_refresh_tokens_for_identity ─────────────────────────────
--
-- A successful password reset must wipe every refresh_token row for the
-- identity, across every tenant the identity belongs to. The bare
-- `DELETE FROM refresh_tokens WHERE identity_id = $1` issued by the
-- NOBYPASSRLS `instigenie_app` role hits the per-org RLS policy
-- `org_id = current_setting('app.current_org')` and matches zero rows
-- (the GUC is unset in this code path — password reset is identity-scoped,
-- not org-scoped, so there's no single "current org" to set).
--
-- A SECURITY DEFINER function runs with the privileges of its owner
-- (the bootstrap superuser), which bypasses RLS unconditionally. The
-- function takes an identity_id and returns how many rows it deleted —
-- the caller logs that for ops visibility.
--
-- Mirrors the pattern of public.auth_load_invitation (rls/16-...). The
-- empty search_path forces schema-qualification inside the body, blocking
-- the SECURITY DEFINER shadow-table attack.

CREATE OR REPLACE FUNCTION public.auth_revoke_refresh_tokens_for_identity(
  p_identity_id uuid
) RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH d AS (
    DELETE FROM public.refresh_tokens
    WHERE identity_id = p_identity_id
    RETURNING 1
  )
  SELECT count(*)::int FROM d;
$$;

REVOKE ALL ON FUNCTION public.auth_revoke_refresh_tokens_for_identity(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.auth_revoke_refresh_tokens_for_identity(uuid) TO instigenie_app';
  END IF;
END $$;

COMMENT ON FUNCTION public.auth_revoke_refresh_tokens_for_identity(uuid) IS
  'Cross-tenant refresh-token revocation for password reset. SECURITY DEFINER bypasses RLS. Returns the number of rows deleted.';
