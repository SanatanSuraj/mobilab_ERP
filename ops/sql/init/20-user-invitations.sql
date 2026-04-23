-- User invitation flow. New in Phase "invite" (post-Track 1).
--
-- Two tables:
--
--   user_invitations   — the pending invite row. Written by the invite route,
--                        cleared (accepted_at set) by the accept route.
--   invitation_emails  — dev mailbox. The outbox handler writes a row here
--                        instead of hitting SMTP (no mailer wired yet). Prod
--                        will swap this for a real adapter — the handler
--                        contract stays identical.
--
-- Token-at-rest: we store sha256(raw_token). The raw token only appears in
-- the email URL. Mirrors refresh_tokens.token_hash (see
-- ops/sql/init/01-schemas.sql).
--
-- Idempotent re-runs: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- throughout. Safe to apply via pnpm db:migrate against a running cluster.

CREATE TABLE IF NOT EXISTS user_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role_id       text NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  -- sha256 hex of the raw token. Raw token only appears in the email URL.
  token_hash    text NOT NULL,
  -- users.id (the inviter's per-tenant profile). Nullable for seeding /
  -- system-emitted invites; API route always supplies it.
  invited_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  -- Free-form metadata the inviter may include (e.g. display name hint).
  -- Keep schemaless for now; the Zod contract is the real schema.
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- O(1) validation lookup for the accept flow (hash is the primary fetch key).
CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_token_hash_unique
  ON user_invitations (token_hash);

-- List invitations for a tenant. Most queries filter by org (via RLS) + open.
CREATE INDEX IF NOT EXISTS user_invitations_org_pending_idx
  ON user_invitations (org_id, accepted_at, expires_at);

-- Prevent two live invitations for the same (org, email). A pending invite
-- blocks another one to the same recipient until the first expires or is
-- accepted. The partial predicate keeps re-invites possible after the
-- first row is consumed or expired.
CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_org_email_active_unique
  ON user_invitations (org_id, lower(email))
  WHERE accepted_at IS NULL;

-- updated_at auto-bump is wired in ops/sql/triggers/02-updated-at.sql
-- (public.tg_set_updated_at). Init files only declare columns + indexes;
-- triggers land in a later apply-phase so the function exists.

-- ─── invitation_emails: dev mailbox ─────────────────────────────────────────
-- The outbox handler for `user.invite.created` writes here so you can SELECT
-- out the accept-invite URL during development. Production replaces this
-- with a real SMTP / transactional-email adapter; the handler keeps writing
-- a row for audit/debug either way.

CREATE TABLE IF NOT EXISTS invitation_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL REFERENCES user_invitations(id) ON DELETE CASCADE,
  recipient     text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  -- Raw accept URL (contains the one-time token). Only persisted in dev —
  -- production adapters will redact this column before emit.
  accept_url    text NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitation_emails_invitation_id_idx
  ON invitation_emails (invitation_id);
CREATE INDEX IF NOT EXISTS invitation_emails_org_sent_idx
  ON invitation_emails (org_id, sent_at DESC);
