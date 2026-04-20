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
  ('MANAGEMENT', 'customers:read'),
  ('MANAGEMENT', 'quotations:read'),
  ('MANAGEMENT', 'sales_orders:read'),
  ('MANAGEMENT', 'work_orders:read'),
  ('MANAGEMENT', 'bmr:read'),
  ('MANAGEMENT', 'devices:read'),
  ('MANAGEMENT', 'ncr:read'),
  ('MANAGEMENT', 'inventory:read'),
  ('MANAGEMENT', 'purchase_orders:read'),
  ('MANAGEMENT', 'purchase_invoices:read'),
  ('MANAGEMENT', 'sales_invoices:read'),
  ('MANAGEMENT', 'payments:read'),
  ('MANAGEMENT', 'reports:read'),
  ('MANAGEMENT', 'reports:export'),
  ('MANAGEMENT', 'admin:audit:read');

-- SALES_REP
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('SALES_REP', 'customers:create'),
  ('SALES_REP', 'customers:read'),
  ('SALES_REP', 'customers:update'),
  ('SALES_REP', 'quotations:create'),
  ('SALES_REP', 'quotations:read'),
  ('SALES_REP', 'quotations:update'),
  ('SALES_REP', 'quotations:convert_to_so'),
  ('SALES_REP', 'sales_orders:create'),
  ('SALES_REP', 'sales_orders:read'),
  ('SALES_REP', 'sales_orders:update'),
  ('SALES_REP', 'sales_invoices:read'),
  ('SALES_REP', 'payments:read');

-- SALES_MANAGER
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('SALES_MANAGER', 'customers:create'),
  ('SALES_MANAGER', 'customers:read'),
  ('SALES_MANAGER', 'customers:update'),
  ('SALES_MANAGER', 'customers:delete'),
  ('SALES_MANAGER', 'quotations:create'),
  ('SALES_MANAGER', 'quotations:read'),
  ('SALES_MANAGER', 'quotations:update'),
  ('SALES_MANAGER', 'quotations:approve'),
  ('SALES_MANAGER', 'quotations:convert_to_so'),
  ('SALES_MANAGER', 'sales_orders:create'),
  ('SALES_MANAGER', 'sales_orders:read'),
  ('SALES_MANAGER', 'sales_orders:update'),
  ('SALES_MANAGER', 'sales_orders:convert_to_wo'),
  ('SALES_MANAGER', 'sales_invoices:read'),
  ('SALES_MANAGER', 'payments:read'),
  ('SALES_MANAGER', 'reports:read');

-- FINANCE
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('FINANCE', 'customers:read'),
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
  ('PRODUCTION', 'work_orders:read'),
  ('PRODUCTION', 'work_orders:transition'),
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
  ('PRODUCTION_MANAGER', 'work_orders:create'),
  ('PRODUCTION_MANAGER', 'work_orders:read'),
  ('PRODUCTION_MANAGER', 'work_orders:release'),
  ('PRODUCTION_MANAGER', 'work_orders:close'),
  ('PRODUCTION_MANAGER', 'work_orders:transition'),
  ('PRODUCTION_MANAGER', 'work_orders:assign_operator'),
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
  ('RD', 'devices:read'),
  ('RD', 'work_orders:read'),
  ('RD', 'bmr:read');

-- QC_INSPECTOR
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('QC_INSPECTOR', 'work_orders:read'),
  ('QC_INSPECTOR', 'bmr:read'),
  ('QC_INSPECTOR', 'devices:read'),
  ('QC_INSPECTOR', 'devices:update'),
  ('QC_INSPECTOR', 'qc:inspect'),
  ('QC_INSPECTOR', 'ncr:create'),
  ('QC_INSPECTOR', 'ncr:read');

-- QC_MANAGER
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('QC_MANAGER', 'work_orders:read'),
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
