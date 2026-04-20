-- Schemas used by the platform.
--
-- public  — application tables (orgs, users, work_orders, ...)
-- outbox  — transactional outbox; only INSERT from app code, reads from listen-notify
-- audit   — append-only trigger-populated audit trail

CREATE SCHEMA IF NOT EXISTS outbox;
CREATE SCHEMA IF NOT EXISTS audit;

-- ── Core auth tables ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email          text NOT NULL,
  password_hash  text NOT NULL,
  name           text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  capabilities   jsonb NOT NULL DEFAULT
                   '{"permittedLines":[],"canPCBRework":false,"canOCAssembly":false}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_org_unique
  ON users (org_id, lower(email));
CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id);

CREATE TABLE IF NOT EXISTS roles (
  id    text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id      text NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS user_roles_org_idx ON user_roles (org_id);

CREATE TABLE IF NOT EXISTS permissions (
  id           text PRIMARY KEY,
  resource     text NOT NULL,
  action       text NOT NULL,
  description  text
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  text NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  audience     text NOT NULL CHECK (audience IN ('mobilab-internal', 'mobilab-portal')),
  user_agent   text,
  ip_address   text,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_unique ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

-- ── Outbox ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outbox.events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type   text NOT NULL,
  aggregate_id     uuid NOT NULL,
  event_type       text NOT NULL,
  payload          jsonb NOT NULL,
  idempotency_key  text,
  dispatched_at    timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- Partial index: only undispatched rows — keeps the listener fast as the
-- table grows.
CREATE INDEX IF NOT EXISTS outbox_events_undispatched_idx
  ON outbox.events (created_at)
  WHERE dispatched_at IS NULL;
-- Idempotency keys are nullable but must be unique when present.
CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_idempotency_unique
  ON outbox.events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_events_aggregate_idx
  ON outbox.events (aggregate_type, aggregate_id);

-- ── Audit ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit.log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  table_name  text NOT NULL,
  row_id      uuid,
  action      text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor       uuid,
  before      jsonb,
  after       jsonb,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_table_idx ON audit.log (org_id, table_name);
CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx ON audit.log (changed_at);
