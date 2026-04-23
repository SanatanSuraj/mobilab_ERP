-- Seed role→permission mappings. ARCHITECTURE.md §9.4 — keep in sync with
-- ROLE_PERMISSIONS in packages/contracts/src/permissions.ts. Gate 6 verifies
-- this.

-- Clear then re-insert so the seed is idempotent.
DELETE FROM role_permissions;

-- SUPER_ADMIN: everything.
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'SUPER_ADMIN', id FROM permissions;

-- MANAGEMENT: read + export only.
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('MANAGEMENT', 'accounts:read'),
  ('MANAGEMENT', 'contacts:read'),
  ('MANAGEMENT', 'customers:read'),
  ('MANAGEMENT', 'deals:read'),
  ('MANAGEMENT', 'leads:read'),
  ('MANAGEMENT', 'tickets:read'),
  ('MANAGEMENT', 'quotations:read'),
  ('MANAGEMENT', 'sales_orders:read'),
  ('MANAGEMENT', 'products:read'),
  ('MANAGEMENT', 'bom:read'),
  ('MANAGEMENT', 'work_orders:read'),
  ('MANAGEMENT', 'bmr:read'),
  ('MANAGEMENT', 'devices:read'),
  ('MANAGEMENT', 'ncr:read'),
  ('MANAGEMENT', 'inventory:read'),
  ('MANAGEMENT', 'purchase_orders:read'),
  ('MANAGEMENT', 'purchase_invoices:read'),
  ('MANAGEMENT', 'sales_invoices:read'),
  ('MANAGEMENT', 'payments:read'),
  ('MANAGEMENT', 'notifications:read'),
  ('MANAGEMENT', 'notifications:admin_read'),
  ('MANAGEMENT', 'reports:read'),
  ('MANAGEMENT', 'reports:export'),
  ('MANAGEMENT', 'admin:audit:read'),
  ('MANAGEMENT', 'users:invite');

-- SALES_REP
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('SALES_REP', 'accounts:create'),
  ('SALES_REP', 'accounts:read'),
  ('SALES_REP', 'accounts:update'),
  ('SALES_REP', 'contacts:create'),
  ('SALES_REP', 'contacts:read'),
  ('SALES_REP', 'contacts:update'),
  ('SALES_REP', 'customers:create'),
  ('SALES_REP', 'customers:read'),
  ('SALES_REP', 'customers:update'),
  ('SALES_REP', 'deals:create'),
  ('SALES_REP', 'deals:read'),
  ('SALES_REP', 'deals:update'),
  ('SALES_REP', 'leads:create'),
  ('SALES_REP', 'leads:read'),
  ('SALES_REP', 'leads:update'),
  ('SALES_REP', 'leads:convert'),
  ('SALES_REP', 'quotations:create'),
  ('SALES_REP', 'quotations:read'),
  ('SALES_REP', 'quotations:update'),
  ('SALES_REP', 'quotations:convert_to_so'),
  ('SALES_REP', 'products:read'),
  ('SALES_REP', 'sales_orders:create'),
  ('SALES_REP', 'sales_orders:read'),
  ('SALES_REP', 'sales_orders:update'),
  ('SALES_REP', 'sales_invoices:read'),
  ('SALES_REP', 'payments:read');

-- SALES_MANAGER
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('SALES_MANAGER', 'accounts:create'),
  ('SALES_MANAGER', 'accounts:read'),
  ('SALES_MANAGER', 'accounts:update'),
  ('SALES_MANAGER', 'accounts:delete'),
  ('SALES_MANAGER', 'contacts:create'),
  ('SALES_MANAGER', 'contacts:read'),
  ('SALES_MANAGER', 'contacts:update'),
  ('SALES_MANAGER', 'contacts:delete'),
  ('SALES_MANAGER', 'customers:create'),
  ('SALES_MANAGER', 'customers:read'),
  ('SALES_MANAGER', 'customers:update'),
  ('SALES_MANAGER', 'customers:delete'),
  ('SALES_MANAGER', 'deals:create'),
  ('SALES_MANAGER', 'deals:read'),
  ('SALES_MANAGER', 'deals:update'),
  ('SALES_MANAGER', 'deals:delete'),
  ('SALES_MANAGER', 'deals:transition'),
  ('SALES_MANAGER', 'leads:create'),
  ('SALES_MANAGER', 'leads:read'),
  ('SALES_MANAGER', 'leads:update'),
  ('SALES_MANAGER', 'leads:delete'),
  ('SALES_MANAGER', 'leads:convert'),
  ('SALES_MANAGER', 'quotations:create'),
  ('SALES_MANAGER', 'quotations:read'),
  ('SALES_MANAGER', 'quotations:update'),
  ('SALES_MANAGER', 'quotations:approve'),
  ('SALES_MANAGER', 'quotations:convert_to_so'),
  ('SALES_MANAGER', 'products:read'),
  ('SALES_MANAGER', 'sales_orders:create'),
  ('SALES_MANAGER', 'sales_orders:read'),
  ('SALES_MANAGER', 'sales_orders:update'),
  ('SALES_MANAGER', 'sales_orders:convert_to_wo'),
  ('SALES_MANAGER', 'sales_invoices:read'),
  ('SALES_MANAGER', 'payments:read'),
  ('SALES_MANAGER', 'reports:read');

-- FINANCE
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('FINANCE', 'accounts:read'),
  ('FINANCE', 'contacts:read'),
  ('FINANCE', 'customers:read'),
  ('FINANCE', 'deals:read'),
  ('FINANCE', 'sales_orders:read'),
  ('FINANCE', 'sales_orders:approve_finance'),
  ('FINANCE', 'purchase_orders:read'),
  ('FINANCE', 'purchase_orders:approve_finance'),
  ('FINANCE', 'purchase_invoices:create'),
  ('FINANCE', 'purchase_invoices:read'),
  ('FINANCE', 'purchase_invoices:approve'),
  ('FINANCE', 'sales_invoices:create'),
  ('FINANCE', 'sales_invoices:read'),
  ('FINANCE', 'sales_invoices:approve'),
  ('FINANCE', 'sales_invoices:credit_note'),
  ('FINANCE', 'payments:create'),
  ('FINANCE', 'payments:read'),
  ('FINANCE', 'payments:reconcile'),
  ('FINANCE', 'reports:read'),
  ('FINANCE', 'reports:export');

-- PRODUCTION
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('PRODUCTION', 'products:read'),
  ('PRODUCTION', 'bom:read'),
  ('PRODUCTION', 'work_orders:read'),
  ('PRODUCTION', 'work_orders:update'),
  ('PRODUCTION', 'work_orders:transition'),
  ('PRODUCTION', 'wip_stages:advance'),
  ('PRODUCTION', 'bmr:read'),
  ('PRODUCTION', 'bmr:sign_production'),
  ('PRODUCTION', 'devices:create'),
  ('PRODUCTION', 'devices:read'),
  ('PRODUCTION', 'devices:update'),
  ('PRODUCTION', 'ncr:create'),
  ('PRODUCTION', 'ncr:read'),
  ('PRODUCTION', 'inventory:read'),
  ('PRODUCTION', 'inventory:issue');

-- PRODUCTION_MANAGER
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('PRODUCTION_MANAGER', 'products:create'),
  ('PRODUCTION_MANAGER', 'products:read'),
  ('PRODUCTION_MANAGER', 'products:update'),
  ('PRODUCTION_MANAGER', 'products:delete'),
  ('PRODUCTION_MANAGER', 'bom:read'),
  ('PRODUCTION_MANAGER', 'bom:edit'),
  ('PRODUCTION_MANAGER', 'bom:activate'),
  ('PRODUCTION_MANAGER', 'bom:supersede'),
  ('PRODUCTION_MANAGER', 'work_orders:create'),
  ('PRODUCTION_MANAGER', 'work_orders:read'),
  ('PRODUCTION_MANAGER', 'work_orders:update'),
  ('PRODUCTION_MANAGER', 'work_orders:release'),
  ('PRODUCTION_MANAGER', 'work_orders:close'),
  ('PRODUCTION_MANAGER', 'work_orders:transition'),
  ('PRODUCTION_MANAGER', 'work_orders:assign_operator'),
  ('PRODUCTION_MANAGER', 'wip_stages:advance'),
  ('PRODUCTION_MANAGER', 'bmr:read'),
  ('PRODUCTION_MANAGER', 'bmr:sign_production'),
  ('PRODUCTION_MANAGER', 'bmr:close'),
  ('PRODUCTION_MANAGER', 'devices:create'),
  ('PRODUCTION_MANAGER', 'devices:read'),
  ('PRODUCTION_MANAGER', 'devices:update'),
  ('PRODUCTION_MANAGER', 'devices:recall'),
  ('PRODUCTION_MANAGER', 'ncr:create'),
  ('PRODUCTION_MANAGER', 'ncr:read'),
  ('PRODUCTION_MANAGER', 'ncr:investigate'),
  ('PRODUCTION_MANAGER', 'inventory:read'),
  ('PRODUCTION_MANAGER', 'inventory:issue'),
  ('PRODUCTION_MANAGER', 'inventory:adjust'),
  ('PRODUCTION_MANAGER', 'reports:read');

-- RD
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('RD', 'customers:read'),
  ('RD', 'quotations:read'),
  ('RD', 'products:read'),
  ('RD', 'bom:read'),
  ('RD', 'bom:edit'),
  ('RD', 'devices:read'),
  ('RD', 'work_orders:read'),
  ('RD', 'bmr:read');

-- QC_INSPECTOR
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('QC_INSPECTOR', 'tickets:read'),
  ('QC_INSPECTOR', 'tickets:comment'),
  ('QC_INSPECTOR', 'products:read'),
  ('QC_INSPECTOR', 'bom:read'),
  ('QC_INSPECTOR', 'work_orders:read'),
  ('QC_INSPECTOR', 'wip_stages:advance'),
  ('QC_INSPECTOR', 'bmr:read'),
  ('QC_INSPECTOR', 'devices:read'),
  ('QC_INSPECTOR', 'devices:update'),
  ('QC_INSPECTOR', 'qc:inspect'),
  ('QC_INSPECTOR', 'ncr:create'),
  ('QC_INSPECTOR', 'ncr:read');

-- QC_MANAGER
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('QC_MANAGER', 'tickets:create'),
  ('QC_MANAGER', 'tickets:read'),
  ('QC_MANAGER', 'tickets:update'),
  ('QC_MANAGER', 'tickets:transition'),
  ('QC_MANAGER', 'tickets:comment'),
  ('QC_MANAGER', 'products:read'),
  ('QC_MANAGER', 'bom:read'),
  ('QC_MANAGER', 'work_orders:read'),
  ('QC_MANAGER', 'wip_stages:advance'),
  ('QC_MANAGER', 'bmr:read'),
  ('QC_MANAGER', 'bmr:sign_qc'),
  ('QC_MANAGER', 'devices:read'),
  ('QC_MANAGER', 'devices:update'),
  ('QC_MANAGER', 'devices:recall'),
  ('QC_MANAGER', 'qc:inspect'),
  ('QC_MANAGER', 'qc:approve'),
  ('QC_MANAGER', 'qc:reject'),
  ('QC_MANAGER', 'ncr:create'),
  ('QC_MANAGER', 'ncr:read'),
  ('QC_MANAGER', 'ncr:investigate'),
  ('QC_MANAGER', 'ncr:sign_rca'),
  ('QC_MANAGER', 'ncr:disposition'),
  ('QC_MANAGER', 'ncr:close'),
  ('QC_MANAGER', 'reports:read');

-- STORES
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('STORES', 'inventory:read'),
  ('STORES', 'inventory:adjust'),
  ('STORES', 'inventory:transfer'),
  ('STORES', 'inventory:receive'),
  ('STORES', 'inventory:issue'),
  ('STORES', 'purchase_orders:read');

-- CUSTOMER (portal)
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('CUSTOMER', 'portal:orders:read'),
  ('CUSTOMER', 'portal:invoices:read'),
  ('CUSTOMER', 'portal:devices:read');

-- Notifications: every non-CUSTOMER role can read their own inbox. Service
-- layer already filters by user_id so this is a safe broad grant. Added as a
-- dedicated block so it's obvious this is a cross-role baseline.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'notifications:read'
  FROM roles r
 WHERE r.id NOT IN ('CUSTOMER', 'SUPER_ADMIN')  -- SUPER_ADMIN already grabs
                                                -- everything via the catch-all
                                                -- INSERT above
ON CONFLICT DO NOTHING;

-- Approvals (§3.3):
--   * :read — every internal role can read approval requests for context.
--   * :request — every mutating internal role can kick off a request;
--     service layer still validates the entity_type belongs to a module
--     they have create/update rights on.
--   * :act — approver-eligible roles only. Service layer additionally
--     checks that the current step's role_id matches the actor's role.
--   * :cancel — requester's own manager ranks + SUPER_ADMIN.
--   * :chains:manage — SUPER_ADMIN and MANAGEMENT; others caught by the
--     blanket SUPER_ADMIN grant at the top of this file.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, 'approvals:read'
  FROM roles r
 WHERE r.id NOT IN ('CUSTOMER', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

-- Request-create perm: any internal role that writes business entities.
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('SALES_REP',          'approvals:request'),
  ('SALES_MANAGER',      'approvals:request'),
  ('FINANCE',            'approvals:request'),
  ('PRODUCTION',         'approvals:request'),
  ('PRODUCTION_MANAGER', 'approvals:request'),
  ('QC_INSPECTOR',       'approvals:request'),
  ('QC_MANAGER',         'approvals:request'),
  ('STORES',             'approvals:request'),
  ('MANAGEMENT',         'approvals:request')
ON CONFLICT DO NOTHING;

-- Act perm: only the roles that appear in chain definitions as approvers.
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('SALES_MANAGER',      'approvals:act'),
  ('FINANCE',            'approvals:act'),
  ('PRODUCTION_MANAGER', 'approvals:act'),
  ('QC_INSPECTOR',       'approvals:act'),
  ('QC_MANAGER',         'approvals:act'),
  ('MANAGEMENT',         'approvals:act')
ON CONFLICT DO NOTHING;

-- Cancel perm: requesters can cancel their own; managers can cancel wider.
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('SALES_MANAGER',      'approvals:cancel'),
  ('FINANCE',            'approvals:cancel'),
  ('PRODUCTION_MANAGER', 'approvals:cancel'),
  ('QC_MANAGER',         'approvals:cancel'),
  ('MANAGEMENT',         'approvals:cancel')
ON CONFLICT DO NOTHING;

-- Chain-management perm: MANAGEMENT + (SUPER_ADMIN via catch-all above).
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('MANAGEMENT', 'approvals:chains:manage')
ON CONFLICT DO NOTHING;
