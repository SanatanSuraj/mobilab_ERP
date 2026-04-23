-- RLS for the invite flow. ARCHITECTURE.md §9.2 + ops/sql/rls/02-crm-rls.sql
-- for the shared pattern.
--
-- Both tables are tenant-scoped via org_id and are reached by the NOBYPASSRLS
-- `instigenie_app` role through the admin-users API and worker handlers. The
-- worker uses withOrg() before touching these rows, so the GUC is always set.
--
-- user_invitations: read by /admin/users list + /auth/accept-invite token
--                   lookup, written by /admin/users/invite + accept flow.
-- invitation_emails: dev mailbox rows. SELECT-only from the admin dashboard
--                    during development; the worker handler writes them.
--
-- FORCE RLS keeps the gate on even if the table owner ever happens to be the
-- connecting role (matches the rest of the schema).

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_invitations_tenant_isolation ON user_invitations;
CREATE POLICY user_invitations_tenant_isolation ON user_invitations
  USING      (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

ALTER TABLE invitation_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_emails FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitation_emails_tenant_isolation ON invitation_emails;
CREATE POLICY invitation_emails_tenant_isolation ON invitation_emails
  USING      (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ─── auth_load_invitation ───────────────────────────────────────────────────
--
-- Used by the /auth/accept-invite route. At that entry point the caller
-- presents a raw token from the invite email; we sha256() it to token_hash
-- and look up the invitation. No JWT is in play yet — the user is
-- pre-auth — so `app.current_org` is unset and RLS would filter the row to
-- zero. The token_hash itself is a 256-bit secret (mirrors refresh_tokens),
-- so a global lookup by hash is no weaker than an RLS-guarded shape: an
-- attacker without the hash can't forge one.
--
-- Once this function returns the row, the accept route switches to
-- withOrg(row.org_id) for every follow-up write (user_identities upsert,
-- users insert, memberships insert, user_roles insert, invitation UPDATE).
-- See ops/sql/rls/03-auth-cross-tenant.sql for the same pattern applied to
-- refresh tokens.
--
-- `search_path = ''` forces schema-qualification inside the body, blocking
-- the classic SECURITY DEFINER shadow-table escalation.

DROP FUNCTION IF EXISTS public.auth_load_invitation(text);

CREATE FUNCTION public.auth_load_invitation(
  p_token_hash text
) RETURNS TABLE (
  id           uuid,
  org_id       uuid,
  email        text,
  role_id      text,
  invited_by   uuid,
  expires_at   timestamptz,
  accepted_at  timestamptz,
  metadata     jsonb,
  org_name     text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT i.id,
         i.org_id,
         i.email,
         i.role_id,
         i.invited_by,
         i.expires_at,
         i.accepted_at,
         i.metadata,
         o.name AS org_name
    FROM public.user_invitations i
    JOIN public.organizations    o ON o.id = i.org_id
   WHERE i.token_hash = p_token_hash
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_load_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_load_invitation(text) TO instigenie_app;
GRANT EXECUTE ON FUNCTION public.auth_load_invitation(text) TO instigenie_vendor;

COMMENT ON FUNCTION public.auth_load_invitation(text) IS
  'Cross-tenant invitation lookup by token_hash. SECURITY DEFINER bypasses RLS; safe because token_hash is a 256-bit secret. Caller switches to withOrg(row.org_id) for any follow-up mutations.';
