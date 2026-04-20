-- Schemas used by the platform.
--
-- public  — application tables (orgs, identities, memberships, users, …)
-- outbox  — transactional outbox; only INSERT from app code, reads from listen-notify
-- audit   — append-only trigger-populated audit trail

CREATE SCHEMA IF NOT EXISTS outbox;
CREATE SCHEMA IF NOT EXISTS audit;

-- ── Organizations (= tenants) ────────────────────────────────────────────────
-- One row per paying customer of the SaaS. All tenant-scoped tables below
-- carry org_id → organizations(id). RLS policies (ops/sql/rls/*) bind every
-- SELECT/INSERT/UPDATE/DELETE to the `app.current_org` GUC so a handler that
-- forgets withOrg() sees zero rows and cannot write.

-- Lifecycle columns (Sprint 1B):
--   status  lifecycle state — auth guard rejects SUSPENDED/DELETED and
--           treats TRIAL with expired trial_ends_at as "trial expired".
--   trial_ends_at  when the free trial ends (NULL = not in trial)
--   suspended_at   when the tenant was suspended (NULL = not suspended)
--   suspended_reason  free-text audit note on suspension
--   deleted_at     soft-delete timestamp (NULL = live)
--   owner_identity_id  identity that created the tenant (root admin).
--                      Nullable until Sprint 4 wires the signup flow.
CREATE TABLE IF NOT EXISTS organizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('TRIAL','ACTIVE','SUSPENDED','DELETED')),
  trial_ends_at      timestamptz,
  suspended_at       timestamptz,
  suspended_reason   text,
  deleted_at         timestamptz,
  owner_identity_id  uuid,  -- FK added after user_identities is defined
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Defensive ALTERs so re-running init on a pre-1B DB still upgrades cleanly.
-- (Fresh volumes get the full CREATE above; existing volumes hit these.)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_identity_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_status_check'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_status_check
      CHECK (status IN ('TRIAL','ACTIVE','SUSPENDED','DELETED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_status_idx     ON organizations (status);
CREATE INDEX IF NOT EXISTS organizations_deleted_at_idx
  ON organizations (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS organizations_owner_identity_idx
  ON organizations (owner_identity_id);

-- ── Identity layer (Option 2 — Slack/Linear model) ───────────────────────────
-- A `user_identity` is a GLOBAL human: one email, one password, one MFA
-- secret. NOT tenant-scoped — an identity can belong to multiple orgs via
-- the `memberships` table below. This enables "log in once, pick tenant"
-- UX for consultants, auditors, staff working across customer orgs.
--
-- NB: because user_identities is global, it has NO RLS — the app role can
-- read it cleanly during login / password reset. This is safe ONLY because
-- the application isolates access to user_identities to the AuthService.
-- (Gate 11 locks down NOBYPASSRLS so superuser bypass is impossible.)

CREATE TABLE IF NOT EXISTS user_identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  password_hash       text,
  email_verified_at   timestamptz,
  mfa_enabled         boolean NOT NULL DEFAULT false,
  mfa_secret          text,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  status              text NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','LOCKED','DISABLED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
-- Lowercase canonical lookup — prevents "Ravi@foo" vs "ravi@foo" duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_email_unique
  ON user_identities (lower(email));

-- Add the deferred FK on organizations.owner_identity_id now that the
-- target table exists. IF NOT EXISTS on the constraint name keeps re-runs
-- idempotent.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_owner_identity_fk'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_owner_identity_fk
      FOREIGN KEY (owner_identity_id)
      REFERENCES user_identities(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ── Per-tenant user profile ──────────────────────────────────────────────────
-- `users` now holds the tenant-specific profile: display name, phone,
-- capabilities, soft-delete flag. Auth (email + password) lives in
-- user_identities; this row links via `identity_id`. Many `users` rows
-- can point to the same identity if one human belongs to several orgs.
--
-- `email` is kept here as a denormalized copy of the identity email for
-- query ergonomics (listing users in an org without a join). It is synced
-- by the application layer on signup / email-change flows.

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  identity_id    uuid NOT NULL REFERENCES user_identities(id) ON DELETE RESTRICT,
  email          text NOT NULL,
  name           text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  capabilities   jsonb NOT NULL DEFAULT
                   '{"permittedLines":[],"canPCBRework":false,"canOCAssembly":false}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_org_unique
  ON users (org_id, lower(email));
-- One profile per (identity, org). Prevents a human being in the same org
-- twice with two profiles — that ambiguity would break role resolution.
CREATE UNIQUE INDEX IF NOT EXISTS users_identity_org_unique
  ON users (identity_id, org_id);
CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id);
CREATE INDEX IF NOT EXISTS users_identity_idx ON users (identity_id);

-- ── Roles & RBAC ─────────────────────────────────────────────────────────────

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

-- ── Memberships (identity ↔ org) ─────────────────────────────────────────────
-- Tenant-scoped: one row per (identity, org). Drives the tenant-picker UX:
-- after login, the client asks the server "which orgs is this identity in?"
-- and gets a list from here. `user_id` denormalizes the per-tenant profile
-- for quick joins.
--
-- Status lifecycle:
--   INVITED   → pending invite not yet accepted (no user row yet)
--   ACTIVE    → joined; has a user row + role(s)
--   SUSPENDED → temporarily blocked (e.g. delinquent subscription)
--   REMOVED   → left or kicked; kept for audit

CREATE TABLE IF NOT EXISTS memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  identity_id  uuid NOT NULL REFERENCES user_identities(id) ON DELETE RESTRICT,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE','INVITED','SUSPENDED','REMOVED')),
  invited_at   timestamptz,
  joined_at    timestamptz,
  removed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_identity_org_unique
  ON memberships (identity_id, org_id);
CREATE INDEX IF NOT EXISTS memberships_org_idx ON memberships (org_id);
CREATE INDEX IF NOT EXISTS memberships_identity_idx ON memberships (identity_id);
CREATE INDEX IF NOT EXISTS memberships_status_idx ON memberships (status);

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

-- ── Refresh tokens (per-tenant session) ──────────────────────────────────────
-- Bound to (user_id, org_id). Rotated on every /auth/refresh. Stored as a
-- SHA-256 hash; raw value is only held briefly on the client.
--
-- `identity_id` is denormalized so we can revoke every session of a given
-- human across all orgs in one statement (password change, MFA setup).

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  identity_id  uuid NOT NULL REFERENCES user_identities(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  audience     text NOT NULL CHECK (audience IN ('mobilab-internal', 'mobilab-portal')),
  user_agent   text,
  ip_address   text,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_unique ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx     ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_identity_idx ON refresh_tokens (identity_id);

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
CREATE INDEX IF NOT EXISTS outbox_events_undispatched_idx
  ON outbox.events (created_at)
  WHERE dispatched_at IS NULL;
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

-- ── Plans catalog (GLOBAL — no RLS) ─────────────────────────────────────────
-- The vendor's catalog of SaaS plans. Tenants subscribe to exactly one plan
-- at a time via `subscriptions`. Read-mostly: the app never inserts; plans
-- are seeded and edited only by vendor admins through a dedicated route.
--
-- Design choice: prices stored in integer cents to avoid FP pennies. Annual
-- and monthly are both stored so the UI can show the "17% off" pitch without
-- doing math client-side.

CREATE TABLE IF NOT EXISTS plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  description           text,
  monthly_price_cents   integer NOT NULL DEFAULT 0,
  annual_price_cents    integer NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'USD',
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_active_idx ON plans (is_active, sort_order);

-- Per-plan feature / limit matrix. Numeric limits via `limit_value` (NULL =
-- unlimited), boolean feature flags via `is_enabled`. Keeps the table narrow
-- and lets new quotas/features ship without migrations.
--
-- Naming convention for feature_key:
--   module.<name>        boolean — access to a product module (crm, mfg, qc…)
--   <noun>.<adj>.max     numeric — hard cap, e.g. users.max, crm.contacts.max
--   <noun>.<adj>.quota   numeric — monthly quota, e.g. api.calls.quota
CREATE TABLE IF NOT EXISTS plan_features (
  plan_id       uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_key   text NOT NULL,
  limit_value   bigint,                         -- NULL = unlimited / N/A
  is_enabled    boolean NOT NULL DEFAULT true,  -- for boolean module flags
  PRIMARY KEY (plan_id, feature_key)
);
CREATE INDEX IF NOT EXISTS plan_features_key_idx ON plan_features (feature_key);

-- ── Subscriptions (tenant-scoped, RLS) ──────────────────────────────────────
-- Exactly one active subscription per org at any given time is enforced by
-- the app layer (there may be historical rows with status CANCELED/EXPIRED).
-- `external_id` is the Stripe/Razorpay/… id once billing integration lands.

CREATE TABLE IF NOT EXISTS subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_id                 uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                  text NOT NULL DEFAULT 'TRIALING'
                            CHECK (status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELED','EXPIRED')),
  current_period_start    timestamptz NOT NULL DEFAULT now(),
  current_period_end      timestamptz NOT NULL,
  trial_ends_at           timestamptz,
  canceled_at             timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  external_id             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_org_idx    ON subscriptions (org_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);
-- One ACTIVE subscription per tenant — enforced with a partial unique index
-- so historical rows (CANCELED/EXPIRED) don't collide. Uses a deterministic
-- expression that Postgres can evaluate for uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_org_active_unique
  ON subscriptions (org_id)
  WHERE status IN ('TRIALING','ACTIVE','PAST_DUE');

-- ── Usage records (tenant-scoped, RLS) ──────────────────────────────────────
-- Counter rows bucketed by (org_id, metric, period). The quota layer does
-- upsert + increment atomically so recordUsage() is safe under concurrency.
--
-- `period` is a calendar bucket string — 'YYYY-MM' for monthly quotas,
-- 'YYYY-MM-DD' for daily, etc. Plain text so we don't lock into one grain.

CREATE TABLE IF NOT EXISTS usage_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric       text NOT NULL,
  period       text NOT NULL,
  count_value  bigint NOT NULL DEFAULT 0,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, metric, period)
);
CREATE INDEX IF NOT EXISTS usage_records_org_idx    ON usage_records (org_id);
CREATE INDEX IF NOT EXISTS usage_records_metric_idx ON usage_records (metric);
CREATE INDEX IF NOT EXISTS usage_records_period_idx ON usage_records (period);

-- ── Vendor side (Sprint 3) ───────────────────────────────────────────────────
-- Everything here is OUT of tenant scope. The `vendor` schema holds the
-- Mobilab operator accounts and the tamper-evident action log of what those
-- operators did across tenants. The `mobilab_vendor` role (created in
-- ops/sql/seed/98-vendor-role.sql) has BYPASSRLS, so queries issued by the
-- vendor-admin API can SELECT across all tenants in one go.
--
-- Crucially, the application role `mobilab_app` does NOT get USAGE on this
-- schema — a tenant-side request cannot see the vendor action log or the
-- vendor admin users even by accident. Gate 19 locks this in.

CREATE SCHEMA IF NOT EXISTS vendor;

-- vendor.admins — Mobilab employees with vendor-admin access. Global (no
-- RLS). One email is one vendor admin. Password stored only as a bcrypt
-- hash; the column is nullable so a vendor admin seeded without a password
-- is forced through the "reset" flow on first login (Sprint 3+).
CREATE TABLE IF NOT EXISTS vendor.admins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,
  password_hash     text,
  name              text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- vendor.action_log — append-only. Every vendor-admin mutation writes one
-- row BEFORE returning 2xx. Downstream trust the log to reconstruct "who
-- suspended this tenant?" and "when did we change this plan?".
--
-- The grants in 98-vendor-role.sql give mobilab_vendor INSERT + SELECT but
-- explicitly NOT UPDATE or DELETE — the log is the source of truth for
-- auditors and must be immutable within the DB.
CREATE TABLE IF NOT EXISTS vendor.action_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_admin_id   uuid NOT NULL REFERENCES vendor.admins(id) ON DELETE RESTRICT,
  action            text NOT NULL,          -- e.g. 'tenant.suspend'
  target_type       text NOT NULL,          -- 'organization' | 'subscription' | ...
  target_id         uuid,
  org_id            uuid,                    -- denormalized for quick filtering
  details           jsonb,                  -- structured per-action context
  ip_address        inet,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_action_log_vendor_idx
  ON vendor.action_log (vendor_admin_id);
CREATE INDEX IF NOT EXISTS vendor_action_log_org_idx
  ON vendor.action_log (org_id);
CREATE INDEX IF NOT EXISTS vendor_action_log_created_idx
  ON vendor.action_log (created_at DESC);

-- vendor.refresh_tokens — separate from the tenant `refresh_tokens` table
-- because vendor sessions have no (org_id, user_id) — they're identity-only.
-- Mirrors the tenant table's column shape for consistency (token_hash,
-- expires_at, revoked_at), and uses the same rotation-on-refresh pattern.
CREATE TABLE IF NOT EXISTS vendor.refresh_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_admin_id   uuid NOT NULL REFERENCES vendor.admins(id) ON DELETE CASCADE,
  token_hash        text NOT NULL,
  user_agent        text,
  ip_address        text,
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_refresh_tokens_hash_unique
  ON vendor.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS vendor_refresh_tokens_admin_idx
  ON vendor.refresh_tokens (vendor_admin_id);
