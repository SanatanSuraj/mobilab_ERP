-- Dev-only bootstrap: one organization + one identity per internal role
-- + one portal customer, each with an ACTIVE membership and the right
-- role assignment.
--
-- Passwords are all `instigenie_dev_2026` (bcrypt hash pinned below, cost 10).
-- Gate 7 (bootstrap-policy) verifies that this seed only exists in dev.
-- Production migrations MUST NOT run this file — keep it in seed/, not init/.
--
-- Identity model (Option 2): a human is a `user_identities` row, and their
-- presence in an org is a `memberships` row plus a per-tenant `users` row.
--
-- UUID fixture conventions (hex-only):
--   a001  — Mobilab Dev organization
--   b00x  — users (per-tenant profile)
--   f00x  — user_identities (global identity, paired 1:1 with b00x in dev)
--   900x  — memberships (paired 1:1 with b00x in dev)

DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-00000000a001';
  -- bcrypt $2b$10$ of "instigenie_dev_2026"
  v_pw     text := '$2b$10$NMi.pgkQYWK/B2HuV2c/YOat1FjOwURKL5nML1P7Q.9itOxWMSqIu';
BEGIN
  -- Organization (seeded under its own RLS context for the memberships
  -- insert below — organizations.RLS also checks app.current_org).
  PERFORM set_config('app.current_org', v_org_id::text, true);

  INSERT INTO organizations (id, name)
  VALUES (v_org_id, 'Mobilab Dev')
  ON CONFLICT (id) DO NOTHING;

  -- ── Identities (global; no org_id, no RLS) ───────────────────────────────
  INSERT INTO user_identities (id, email, password_hash, email_verified_at) VALUES
    ('00000000-0000-0000-0000-00000000f001', 'admin@mobilab.local',    v_pw, now()),
    ('00000000-0000-0000-0000-00000000f002', 'mgmt@mobilab.local',     v_pw, now()),
    ('00000000-0000-0000-0000-00000000f003', 'sales@mobilab.local',    v_pw, now()),
    ('00000000-0000-0000-0000-00000000f004', 'salesmgr@mobilab.local', v_pw, now()),
    ('00000000-0000-0000-0000-00000000f005', 'finance@mobilab.local',  v_pw, now()),
    ('00000000-0000-0000-0000-00000000f006', 'prod@mobilab.local',     v_pw, now()),
    ('00000000-0000-0000-0000-00000000f007', 'prodmgr@mobilab.local',  v_pw, now()),
    ('00000000-0000-0000-0000-00000000f008', 'rd@mobilab.local',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f009', 'qc@mobilab.local',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f00a', 'qcmgr@mobilab.local',    v_pw, now()),
    ('00000000-0000-0000-0000-00000000f00b', 'stores@mobilab.local',   v_pw, now()),
    ('00000000-0000-0000-0000-00000000f00c', 'customer@mobilab.local', v_pw, now())
  ON CONFLICT (id) DO NOTHING;

  -- ── Per-tenant user profiles ─────────────────────────────────────────────
  INSERT INTO users (id, org_id, identity_id, email, name, is_active) VALUES
    ('00000000-0000-0000-0000-00000000b001', v_org_id, '00000000-0000-0000-0000-00000000f001', 'admin@mobilab.local',    'Dev Admin',              true),
    ('00000000-0000-0000-0000-00000000b002', v_org_id, '00000000-0000-0000-0000-00000000f002', 'mgmt@mobilab.local',     'Dev Management',         true),
    ('00000000-0000-0000-0000-00000000b003', v_org_id, '00000000-0000-0000-0000-00000000f003', 'sales@mobilab.local',    'Dev Sales Rep',          true),
    ('00000000-0000-0000-0000-00000000b004', v_org_id, '00000000-0000-0000-0000-00000000f004', 'salesmgr@mobilab.local', 'Dev Sales Manager',      true),
    ('00000000-0000-0000-0000-00000000b005', v_org_id, '00000000-0000-0000-0000-00000000f005', 'finance@mobilab.local',  'Dev Finance',            true),
    ('00000000-0000-0000-0000-00000000b006', v_org_id, '00000000-0000-0000-0000-00000000f006', 'prod@mobilab.local',     'Dev Production',         true),
    ('00000000-0000-0000-0000-00000000b007', v_org_id, '00000000-0000-0000-0000-00000000f007', 'prodmgr@mobilab.local',  'Dev Production Manager', true),
    ('00000000-0000-0000-0000-00000000b008', v_org_id, '00000000-0000-0000-0000-00000000f008', 'rd@mobilab.local',       'Dev R&D',                true),
    ('00000000-0000-0000-0000-00000000b009', v_org_id, '00000000-0000-0000-0000-00000000f009', 'qc@mobilab.local',       'Dev QC Inspector',       true),
    ('00000000-0000-0000-0000-00000000b00a', v_org_id, '00000000-0000-0000-0000-00000000f00a', 'qcmgr@mobilab.local',    'Dev QC Manager',         true),
    ('00000000-0000-0000-0000-00000000b00b', v_org_id, '00000000-0000-0000-0000-00000000f00b', 'stores@mobilab.local',   'Dev Stores',             true),
    ('00000000-0000-0000-0000-00000000b00c', v_org_id, '00000000-0000-0000-0000-00000000f00c', 'customer@mobilab.local', 'Dev Customer (Portal)',  true)
  ON CONFLICT (id) DO NOTHING;

  -- ── Memberships (identity + org + user profile link) ─────────────────────
  INSERT INTO memberships (id, org_id, identity_id, user_id, status, joined_at) VALUES
    ('00000000-0000-0000-0000-000000009001', v_org_id, '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000b001', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009002', v_org_id, '00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000b002', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009003', v_org_id, '00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-00000000b003', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009004', v_org_id, '00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-00000000b004', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009005', v_org_id, '00000000-0000-0000-0000-00000000f005', '00000000-0000-0000-0000-00000000b005', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009006', v_org_id, '00000000-0000-0000-0000-00000000f006', '00000000-0000-0000-0000-00000000b006', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009007', v_org_id, '00000000-0000-0000-0000-00000000f007', '00000000-0000-0000-0000-00000000b007', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009008', v_org_id, '00000000-0000-0000-0000-00000000f008', '00000000-0000-0000-0000-00000000b008', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009009', v_org_id, '00000000-0000-0000-0000-00000000f009', '00000000-0000-0000-0000-00000000b009', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-00000000900a', v_org_id, '00000000-0000-0000-0000-00000000f00a', '00000000-0000-0000-0000-00000000b00a', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-00000000900b', v_org_id, '00000000-0000-0000-0000-00000000f00b', '00000000-0000-0000-0000-00000000b00b', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-00000000900c', v_org_id, '00000000-0000-0000-0000-00000000f00c', '00000000-0000-0000-0000-00000000b00c', 'ACTIVE', now())
  ON CONFLICT (id) DO NOTHING;

  -- ── Role bindings ────────────────────────────────────────────────────────
  INSERT INTO user_roles (user_id, role_id, org_id) VALUES
    ('00000000-0000-0000-0000-00000000b001', 'SUPER_ADMIN',        v_org_id),
    ('00000000-0000-0000-0000-00000000b002', 'MANAGEMENT',         v_org_id),
    ('00000000-0000-0000-0000-00000000b003', 'SALES_REP',          v_org_id),
    ('00000000-0000-0000-0000-00000000b004', 'SALES_MANAGER',      v_org_id),
    ('00000000-0000-0000-0000-00000000b005', 'FINANCE',            v_org_id),
    ('00000000-0000-0000-0000-00000000b006', 'PRODUCTION',         v_org_id),
    ('00000000-0000-0000-0000-00000000b007', 'PRODUCTION_MANAGER', v_org_id),
    ('00000000-0000-0000-0000-00000000b008', 'RD',                 v_org_id),
    ('00000000-0000-0000-0000-00000000b009', 'QC_INSPECTOR',       v_org_id),
    ('00000000-0000-0000-0000-00000000b00a', 'QC_MANAGER',         v_org_id),
    ('00000000-0000-0000-0000-00000000b00b', 'STORES',             v_org_id),
    ('00000000-0000-0000-0000-00000000b00c', 'CUSTOMER',           v_org_id)
  ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;
