-- Seed the 12 roles. ARCHITECTURE.md §9.4 — keep in sync with
-- packages/contracts/src/roles.ts. Gate 6 verifies this.

INSERT INTO roles (id, label) VALUES
  ('SUPER_ADMIN',        'Super Admin'),
  ('MANAGEMENT',         'Management'),
  ('SALES_REP',          'Sales Representative'),
  ('SALES_MANAGER',      'Sales Manager'),
  ('FINANCE',            'Finance'),
  ('PRODUCTION',         'Production Operator'),
  ('PRODUCTION_MANAGER', 'Production Manager'),
  ('RD',                 'R&D'),
  ('QC_INSPECTOR',       'QC Inspector'),
  ('QC_MANAGER',         'QC Manager'),
  ('STORES',             'Stores'),
  ('CUSTOMER',           'Customer (Portal)')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
