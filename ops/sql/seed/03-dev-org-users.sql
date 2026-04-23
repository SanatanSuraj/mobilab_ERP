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
--   a001       — Instigenie Dev organization
--   b00x       — users, role-archetype accounts (per-tenant profile)
--   f00x       — user_identities for b00x (global identity, 1:1)
--   900x       — memberships for b00x
--   b101..b10c — users, named dev accounts matching MOCK_USERS on
--                apps/web/src/app/(dashboard)/admin/users/page.tsx
--                (Chetan, Shubham, Sanju, Jatin, Rishabh, Binsu, Saurabh,
--                 Minakshi, Priya, Anita, QC Manager, Management User)
--   f101..f10c — user_identities for b101..b10c
--   9101..910c — memberships for b101..b10c

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
  VALUES (v_org_id, 'Instigenie Dev')
  ON CONFLICT (id) DO NOTHING;

  -- ── Identities (global; no org_id, no RLS) ───────────────────────────────
  INSERT INTO user_identities (id, email, password_hash, email_verified_at) VALUES
    ('00000000-0000-0000-0000-00000000f001', 'admin@instigenie.local',    v_pw, now()),
    ('00000000-0000-0000-0000-00000000f002', 'mgmt@instigenie.local',     v_pw, now()),
    ('00000000-0000-0000-0000-00000000f003', 'sales@instigenie.local',    v_pw, now()),
    ('00000000-0000-0000-0000-00000000f004', 'salesmgr@instigenie.local', v_pw, now()),
    ('00000000-0000-0000-0000-00000000f005', 'finance@instigenie.local',  v_pw, now()),
    ('00000000-0000-0000-0000-00000000f006', 'prod@instigenie.local',     v_pw, now()),
    ('00000000-0000-0000-0000-00000000f007', 'prodmgr@instigenie.local',  v_pw, now()),
    ('00000000-0000-0000-0000-00000000f008', 'rd@instigenie.local',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f009', 'qc@instigenie.local',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f00a', 'qcmgr@instigenie.local',    v_pw, now()),
    ('00000000-0000-0000-0000-00000000f00b', 'stores@instigenie.local',   v_pw, now()),
    ('00000000-0000-0000-0000-00000000f00c', 'customer@instigenie.local', v_pw, now()),
    -- Named dev accounts (match MOCK_USERS on the /admin/users page).
    ('00000000-0000-0000-0000-00000000f101', 'chetan@instigenie.in',      v_pw, now()),
    ('00000000-0000-0000-0000-00000000f102', 'shubham@instigenie.in',     v_pw, now()),
    ('00000000-0000-0000-0000-00000000f103', 'sanju@instigenie.in',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f104', 'jatin@instigenie.in',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f105', 'rishabh@instigenie.in',     v_pw, now()),
    ('00000000-0000-0000-0000-00000000f106', 'binsu@instigenie.in',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f107', 'saurabh@instigenie.in',     v_pw, now()),
    ('00000000-0000-0000-0000-00000000f108', 'minakshi@instigenie.in',    v_pw, now()),
    ('00000000-0000-0000-0000-00000000f109', 'priya@instigenie.in',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f10a', 'anita@instigenie.in',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f10b', 'qcmgr@instigenie.in',       v_pw, now()),
    ('00000000-0000-0000-0000-00000000f10c', 'mgmt@instigenie.in',        v_pw, now())
  ON CONFLICT (id) DO NOTHING;

  -- ── Per-tenant user profiles ─────────────────────────────────────────────
  INSERT INTO users (id, org_id, identity_id, email, name, is_active) VALUES
    ('00000000-0000-0000-0000-00000000b001', v_org_id, '00000000-0000-0000-0000-00000000f001', 'admin@instigenie.local',    'Dev Admin',              true),
    ('00000000-0000-0000-0000-00000000b002', v_org_id, '00000000-0000-0000-0000-00000000f002', 'mgmt@instigenie.local',     'Dev Management',         true),
    ('00000000-0000-0000-0000-00000000b003', v_org_id, '00000000-0000-0000-0000-00000000f003', 'sales@instigenie.local',    'Dev Sales Rep',          true),
    ('00000000-0000-0000-0000-00000000b004', v_org_id, '00000000-0000-0000-0000-00000000f004', 'salesmgr@instigenie.local', 'Dev Sales Manager',      true),
    ('00000000-0000-0000-0000-00000000b005', v_org_id, '00000000-0000-0000-0000-00000000f005', 'finance@instigenie.local',  'Dev Finance',            true),
    ('00000000-0000-0000-0000-00000000b006', v_org_id, '00000000-0000-0000-0000-00000000f006', 'prod@instigenie.local',     'Dev Production',         true),
    ('00000000-0000-0000-0000-00000000b007', v_org_id, '00000000-0000-0000-0000-00000000f007', 'prodmgr@instigenie.local',  'Dev Production Manager', true),
    ('00000000-0000-0000-0000-00000000b008', v_org_id, '00000000-0000-0000-0000-00000000f008', 'rd@instigenie.local',       'Dev R&D',                true),
    ('00000000-0000-0000-0000-00000000b009', v_org_id, '00000000-0000-0000-0000-00000000f009', 'qc@instigenie.local',       'Dev QC Inspector',       true),
    ('00000000-0000-0000-0000-00000000b00a', v_org_id, '00000000-0000-0000-0000-00000000f00a', 'qcmgr@instigenie.local',    'Dev QC Manager',         true),
    ('00000000-0000-0000-0000-00000000b00b', v_org_id, '00000000-0000-0000-0000-00000000f00b', 'stores@instigenie.local',   'Dev Stores',             true),
    ('00000000-0000-0000-0000-00000000b00c', v_org_id, '00000000-0000-0000-0000-00000000f00c', 'customer@instigenie.local', 'Dev Customer (Portal)',  true),
    -- Named dev accounts (match MOCK_USERS on the /admin/users page).
    ('00000000-0000-0000-0000-00000000b101', v_org_id, '00000000-0000-0000-0000-00000000f101', 'chetan@instigenie.in',      'Chetan (HOD)',           true),
    ('00000000-0000-0000-0000-00000000b102', v_org_id, '00000000-0000-0000-0000-00000000f102', 'shubham@instigenie.in',     'Shubham',                true),
    ('00000000-0000-0000-0000-00000000b103', v_org_id, '00000000-0000-0000-0000-00000000f103', 'sanju@instigenie.in',       'Sanju',                  true),
    ('00000000-0000-0000-0000-00000000b104', v_org_id, '00000000-0000-0000-0000-00000000f104', 'jatin@instigenie.in',       'Jatin',                  true),
    ('00000000-0000-0000-0000-00000000b105', v_org_id, '00000000-0000-0000-0000-00000000f105', 'rishabh@instigenie.in',     'Rishabh',                true),
    ('00000000-0000-0000-0000-00000000b106', v_org_id, '00000000-0000-0000-0000-00000000f106', 'binsu@instigenie.in',       'Binsu',                  true),
    ('00000000-0000-0000-0000-00000000b107', v_org_id, '00000000-0000-0000-0000-00000000f107', 'saurabh@instigenie.in',     'Saurabh',                true),
    ('00000000-0000-0000-0000-00000000b108', v_org_id, '00000000-0000-0000-0000-00000000f108', 'minakshi@instigenie.in',    'Minakshi',               true),
    ('00000000-0000-0000-0000-00000000b109', v_org_id, '00000000-0000-0000-0000-00000000f109', 'priya@instigenie.in',       'Priya Sharma',           true),
    ('00000000-0000-0000-0000-00000000b10a', v_org_id, '00000000-0000-0000-0000-00000000f10a', 'anita@instigenie.in',       'Anita Das',              true),
    ('00000000-0000-0000-0000-00000000b10b', v_org_id, '00000000-0000-0000-0000-00000000f10b', 'qcmgr@instigenie.in',       'QC Manager',             true),
    ('00000000-0000-0000-0000-00000000b10c', v_org_id, '00000000-0000-0000-0000-00000000f10c', 'mgmt@instigenie.in',        'Management User',        true)
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
    ('00000000-0000-0000-0000-00000000900c', v_org_id, '00000000-0000-0000-0000-00000000f00c', '00000000-0000-0000-0000-00000000b00c', 'ACTIVE', now()),
    -- Named dev accounts (match MOCK_USERS on the /admin/users page).
    ('00000000-0000-0000-0000-000000009101', v_org_id, '00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000b101', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009102', v_org_id, '00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000b102', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009103', v_org_id, '00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-00000000b103', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009104', v_org_id, '00000000-0000-0000-0000-00000000f104', '00000000-0000-0000-0000-00000000b104', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009105', v_org_id, '00000000-0000-0000-0000-00000000f105', '00000000-0000-0000-0000-00000000b105', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009106', v_org_id, '00000000-0000-0000-0000-00000000f106', '00000000-0000-0000-0000-00000000b106', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009107', v_org_id, '00000000-0000-0000-0000-00000000f107', '00000000-0000-0000-0000-00000000b107', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009108', v_org_id, '00000000-0000-0000-0000-00000000f108', '00000000-0000-0000-0000-00000000b108', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-000000009109', v_org_id, '00000000-0000-0000-0000-00000000f109', '00000000-0000-0000-0000-00000000b109', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-00000000910a', v_org_id, '00000000-0000-0000-0000-00000000f10a', '00000000-0000-0000-0000-00000000b10a', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-00000000910b', v_org_id, '00000000-0000-0000-0000-00000000f10b', '00000000-0000-0000-0000-00000000b10b', 'ACTIVE', now()),
    ('00000000-0000-0000-0000-00000000910c', v_org_id, '00000000-0000-0000-0000-00000000f10c', '00000000-0000-0000-0000-00000000b10c', 'ACTIVE', now())
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
    ('00000000-0000-0000-0000-00000000b00c', 'CUSTOMER',           v_org_id),
    -- Named dev accounts (roles match MOCK_USERS on /admin/users).
    ('00000000-0000-0000-0000-00000000b101', 'PRODUCTION_MANAGER', v_org_id),  -- Chetan (HOD)
    ('00000000-0000-0000-0000-00000000b102', 'PRODUCTION',         v_org_id),  -- Shubham
    ('00000000-0000-0000-0000-00000000b103', 'PRODUCTION',         v_org_id),  -- Sanju
    ('00000000-0000-0000-0000-00000000b104', 'PRODUCTION',         v_org_id),  -- Jatin
    ('00000000-0000-0000-0000-00000000b105', 'PRODUCTION',         v_org_id),  -- Rishabh
    ('00000000-0000-0000-0000-00000000b106', 'QC_INSPECTOR',       v_org_id),  -- Binsu
    ('00000000-0000-0000-0000-00000000b107', 'STORES',             v_org_id),  -- Saurabh
    ('00000000-0000-0000-0000-00000000b108', 'STORES',             v_org_id),  -- Minakshi
    ('00000000-0000-0000-0000-00000000b109', 'SALES_REP',          v_org_id),  -- Priya Sharma
    ('00000000-0000-0000-0000-00000000b10a', 'FINANCE',            v_org_id),  -- Anita Das
    ('00000000-0000-0000-0000-00000000b10b', 'QC_MANAGER',         v_org_id),  -- QC Manager
    ('00000000-0000-0000-0000-00000000b10c', 'MANAGEMENT',         v_org_id)   -- Management User
  ON CONFLICT (user_id, role_id) DO NOTHING;
END $$;
