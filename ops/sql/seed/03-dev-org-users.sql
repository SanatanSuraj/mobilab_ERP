-- Dev-only bootstrap: one organization + a user per internal role + a customer.
-- Passwords are all `mobilab_dev_2026` (bcrypt hash below, cost 10).
-- The hash was generated once and is pinned here for reproducible dev.
--
-- Gate 7 (bootstrap-policy) verifies that these seed rows only exist in dev.
-- Production migrations MUST NOT run this file — keep it in seed/ not init/.

DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-00000000a001';
  -- bcrypt $2b$10$ of "mobilab_dev_2026"
  v_pw   text := '$2b$10$H1PNE/5YwOC2GrgskBmybu3BGtaovwiS/NwKe0YR0olA7PFiYEg7q';
BEGIN
  INSERT INTO organizations (id, name)
  VALUES (v_org_id, 'Mobilab Dev')
  ON CONFLICT (id) DO NOTHING;

  -- Users (one per internal role) + one portal CUSTOMER.
  INSERT INTO users (id, org_id, email, password_hash, name, is_active) VALUES
    ('00000000-0000-0000-0000-00000000b001', v_org_id, 'admin@mobilab.local',    v_pw, 'Dev Admin',              true),
    ('00000000-0000-0000-0000-00000000b002', v_org_id, 'mgmt@mobilab.local',     v_pw, 'Dev Management',         true),
    ('00000000-0000-0000-0000-00000000b003', v_org_id, 'sales@mobilab.local',    v_pw, 'Dev Sales Rep',          true),
    ('00000000-0000-0000-0000-00000000b004', v_org_id, 'salesmgr@mobilab.local', v_pw, 'Dev Sales Manager',      true),
    ('00000000-0000-0000-0000-00000000b005', v_org_id, 'finance@mobilab.local',  v_pw, 'Dev Finance',            true),
    ('00000000-0000-0000-0000-00000000b006', v_org_id, 'prod@mobilab.local',     v_pw, 'Dev Production',         true),
    ('00000000-0000-0000-0000-00000000b007', v_org_id, 'prodmgr@mobilab.local',  v_pw, 'Dev Production Manager', true),
    ('00000000-0000-0000-0000-00000000b008', v_org_id, 'rd@mobilab.local',       v_pw, 'Dev R&D',                true),
    ('00000000-0000-0000-0000-00000000b009', v_org_id, 'qc@mobilab.local',       v_pw, 'Dev QC Inspector',       true),
    ('00000000-0000-0000-0000-00000000b00a', v_org_id, 'qcmgr@mobilab.local',    v_pw, 'Dev QC Manager',         true),
    ('00000000-0000-0000-0000-00000000b00b', v_org_id, 'stores@mobilab.local',   v_pw, 'Dev Stores',             true),
    ('00000000-0000-0000-0000-00000000b00c', v_org_id, 'customer@mobilab.local', v_pw, 'Dev Customer (Portal)',  true)
  ON CONFLICT (id) DO NOTHING;

  -- Role bindings.
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
