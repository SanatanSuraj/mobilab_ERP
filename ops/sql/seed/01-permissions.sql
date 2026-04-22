-- Seed the permission catalogue. ARCHITECTURE.md §9.4 — keep in sync with
-- packages/contracts/src/permissions.ts. Gate 6 verifies this.
--
-- One row per `resource:action`.

INSERT INTO permissions (id, resource, action, description) VALUES
  -- accounts (CRM)
  ('accounts:create',             'accounts',          'create',            'Create CRM accounts'),
  ('accounts:read',               'accounts',          'read',              'Read CRM accounts'),
  ('accounts:update',             'accounts',          'update',            'Update CRM accounts'),
  ('accounts:delete',             'accounts',          'delete',            'Soft-delete CRM accounts'),

  -- contacts (CRM)
  ('contacts:create',             'contacts',          'create',            'Create CRM contacts'),
  ('contacts:read',               'contacts',          'read',              'Read CRM contacts'),
  ('contacts:update',             'contacts',          'update',            'Update CRM contacts'),
  ('contacts:delete',             'contacts',          'delete',            'Soft-delete CRM contacts'),

  -- customers
  ('customers:create',            'customers',         'create',            'Create customer records'),
  ('customers:read',              'customers',         'read',              'Read customer records'),
  ('customers:update',            'customers',         'update',            'Update customer records'),
  ('customers:delete',            'customers',         'delete',            'Delete customer records'),

  -- deals (CRM)
  ('deals:create',                'deals',             'create',            'Create deals'),
  ('deals:read',                  'deals',             'read',              'Read deals'),
  ('deals:update',                'deals',             'update',            'Update deals'),
  ('deals:delete',                'deals',             'delete',            'Soft-delete deals'),
  ('deals:transition',            'deals',             'transition',        'Transition deal stage'),

  -- leads (CRM)
  ('leads:create',                'leads',             'create',            'Create leads'),
  ('leads:read',                  'leads',             'read',              'Read leads'),
  ('leads:update',                'leads',             'update',            'Update leads'),
  ('leads:delete',                'leads',             'delete',            'Soft-delete leads'),
  ('leads:convert',               'leads',             'convert',           'Convert lead to deal/account'),

  -- tickets (CRM support)
  ('tickets:create',              'tickets',           'create',            'Create support tickets'),
  ('tickets:read',                'tickets',           'read',              'Read support tickets'),
  ('tickets:update',              'tickets',           'update',            'Update support tickets'),
  ('tickets:delete',              'tickets',           'delete',            'Soft-delete support tickets'),
  ('tickets:transition',          'tickets',           'transition',        'Transition ticket status'),
  ('tickets:comment',             'tickets',           'comment',           'Add ticket comments'),

  -- quotations
  ('quotations:create',           'quotations',        'create',            NULL),
  ('quotations:read',             'quotations',        'read',              NULL),
  ('quotations:update',           'quotations',        'update',            NULL),
  ('quotations:approve',          'quotations',        'approve',           'Sales manager approval'),
  ('quotations:convert_to_so',    'quotations',        'convert_to_so',     NULL),

  -- sales_orders
  ('sales_orders:create',             'sales_orders', 'create',             NULL),
  ('sales_orders:read',               'sales_orders', 'read',               NULL),
  ('sales_orders:update',             'sales_orders', 'update',             NULL),
  ('sales_orders:approve_finance',    'sales_orders', 'approve_finance',    'Finance approval step'),
  ('sales_orders:convert_to_wo',      'sales_orders', 'convert_to_wo',      NULL),

  -- products (production module master)
  ('products:create',        'products', 'create',        NULL),
  ('products:read',          'products', 'read',          NULL),
  ('products:update',        'products', 'update',        NULL),
  ('products:delete',        'products', 'delete',        'Soft-delete products'),

  -- bom (bill of materials)
  ('bom:read',               'bom', 'read',               NULL),
  ('bom:edit',               'bom', 'edit',               'Draft and update BOM versions'),
  ('bom:activate',           'bom', 'activate',           'Promote a BOM version to ACTIVE'),
  ('bom:supersede',          'bom', 'supersede',          'Mark a BOM version SUPERSEDED or OBSOLETE'),

  -- work_orders
  ('work_orders:create',             'work_orders', 'create',             NULL),
  ('work_orders:read',               'work_orders', 'read',               NULL),
  ('work_orders:update',             'work_orders', 'update',             NULL),
  ('work_orders:release',            'work_orders', 'release',            NULL),
  ('work_orders:close',              'work_orders', 'close',              NULL),
  ('work_orders:transition',         'work_orders', 'transition',         'Advance through 15-state lifecycle'),
  ('work_orders:assign_operator',    'work_orders', 'assign_operator',    NULL),
  ('wip_stages:advance',             'wip_stages', 'advance',             'Advance a WIP stage (complete/QC/rework)'),

  -- bmr
  ('bmr:read',                'bmr', 'read',                NULL),
  ('bmr:sign_production',     'bmr', 'sign_production',     'Production signature'),
  ('bmr:sign_qc',             'bmr', 'sign_qc',             'QC signature'),
  ('bmr:close',               'bmr', 'close',               NULL),

  -- devices
  ('devices:create',    'devices', 'create',    NULL),
  ('devices:read',      'devices', 'read',      NULL),
  ('devices:update',    'devices', 'update',    NULL),
  ('devices:recall',    'devices', 'recall',    'Mark device RECALLED'),

  -- qc
  ('qc:inspect',    'qc', 'inspect',    NULL),
  ('qc:approve',    'qc', 'approve',    NULL),
  ('qc:reject',     'qc', 'reject',     NULL),

  -- ncr
  ('ncr:create',        'ncr', 'create',        NULL),
  ('ncr:read',          'ncr', 'read',          NULL),
  ('ncr:investigate',   'ncr', 'investigate',   NULL),
  ('ncr:sign_rca',      'ncr', 'sign_rca',      NULL),
  ('ncr:disposition',   'ncr', 'disposition',   NULL),
  ('ncr:close',         'ncr', 'close',         NULL),

  -- inventory
  ('inventory:read',       'inventory', 'read',       NULL),
  ('inventory:adjust',     'inventory', 'adjust',     NULL),
  ('inventory:transfer',   'inventory', 'transfer',   NULL),
  ('inventory:receive',    'inventory', 'receive',    NULL),
  ('inventory:issue',      'inventory', 'issue',      NULL),

  -- purchase_orders
  ('purchase_orders:create',            'purchase_orders', 'create',            NULL),
  ('purchase_orders:read',              'purchase_orders', 'read',              NULL),
  ('purchase_orders:update',            'purchase_orders', 'update',            NULL),
  ('purchase_orders:approve_finance',   'purchase_orders', 'approve_finance',   NULL),

  -- purchase_invoices
  ('purchase_invoices:create',    'purchase_invoices', 'create',    NULL),
  ('purchase_invoices:read',      'purchase_invoices', 'read',      NULL),
  ('purchase_invoices:approve',   'purchase_invoices', 'approve',   NULL),

  -- sales_invoices
  ('sales_invoices:create',        'sales_invoices', 'create',       NULL),
  ('sales_invoices:read',          'sales_invoices', 'read',         NULL),
  ('sales_invoices:approve',       'sales_invoices', 'approve',      NULL),
  ('sales_invoices:credit_note',   'sales_invoices', 'credit_note',  NULL),

  -- payments
  ('payments:create',      'payments', 'create',     NULL),
  ('payments:read',        'payments', 'read',       NULL),
  ('payments:reconcile',   'payments', 'reconcile',  NULL),

  -- notifications
  ('notifications:read',        'notifications', 'read',        'Read own notification feed'),
  ('notifications:admin_read',  'notifications', 'admin_read',  'Read notifications across users (moderation)'),
  ('notifications:dispatch',    'notifications', 'dispatch',    'Emit notifications to other users'),
  ('notifications:templates:manage', 'notification_templates', 'manage', 'Manage notification templates'),

  -- approvals (§3.3 workflow engine)
  ('approvals:read',            'approvals',     'read',        'Read approval requests in own org'),
  ('approvals:request',         'approvals',     'request',     'Create an approval request on a business entity'),
  ('approvals:act',             'approvals',     'act',         'Approve or reject the step assigned to your role'),
  ('approvals:cancel',          'approvals',     'cancel',      'Cancel an in-flight approval request'),
  ('approvals:chains:manage',   'approval_chains', 'manage',    'Manage approval chain definitions'),

  -- reports
  ('reports:read',     'reports', 'read',    NULL),
  ('reports:export',   'reports', 'export',  NULL),

  -- admin
  ('admin:users:manage',     'admin_users',    'manage',  NULL),
  ('admin:roles:manage',     'admin_roles',    'manage',  NULL),
  ('admin:settings:manage',  'admin_settings', 'manage',  NULL),
  ('admin:audit:read',       'admin_audit',    'read',    NULL),

  -- portal (CUSTOMER)
  ('portal:orders:read',     'portal_orders',    'read',  NULL),
  ('portal:invoices:read',   'portal_invoices',  'read',  NULL),
  ('portal:devices:read',    'portal_devices',   'read',  NULL)
ON CONFLICT (id) DO UPDATE
  SET resource = EXCLUDED.resource,
      action = EXCLUDED.action,
      description = EXCLUDED.description;
