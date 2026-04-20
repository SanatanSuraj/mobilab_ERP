-- Vendor's SaaS plans catalog (Sprint 1B).
-- Global — no RLS. Read by tenants during plan-picker UX; edited only by
-- vendor admins through a dedicated route.
--
-- UUID fixture conventions for plans:
--   e001 FREE
--   e002 STARTER
--   e003 PRO
--   e004 ENTERPRISE
--
-- Design notes:
--   - Prices in integer cents to avoid FP pennies.
--   - Annual prices are ~17% off monthly (10 months for the price of 12).
--   - `sort_order` controls plan-picker column order.
--   - ENTERPRISE has unlimited caps (limit_value = NULL).

INSERT INTO plans (id, code, name, description, monthly_price_cents, annual_price_cents, currency, is_active, sort_order)
VALUES
  ('00000000-0000-0000-0000-00000000e001', 'FREE',       'Free',
   'Hobby / eval tier. 1 user, CRM only, no API.',
   0,     0,     'USD', true, 10),
  ('00000000-0000-0000-0000-00000000e002', 'STARTER',    'Starter',
   'Small teams. 10 users, CRM + inventory.',
   2900,  29000, 'USD', true, 20),
  ('00000000-0000-0000-0000-00000000e003', 'PRO',        'Pro',
   'Growing teams. 50 users, full manufacturing stack.',
   9900,  99000, 'USD', true, 30),
  ('00000000-0000-0000-0000-00000000e004', 'ENTERPRISE', 'Enterprise',
   'Unlimited seats, all modules, priority support, SSO.',
   49900, 499000, 'USD', true, 40)
ON CONFLICT (code) DO UPDATE SET
  name                 = EXCLUDED.name,
  description          = EXCLUDED.description,
  monthly_price_cents  = EXCLUDED.monthly_price_cents,
  annual_price_cents   = EXCLUDED.annual_price_cents,
  currency             = EXCLUDED.currency,
  is_active            = EXCLUDED.is_active,
  sort_order           = EXCLUDED.sort_order,
  updated_at           = now();

-- ── Feature matrix ──────────────────────────────────────────────────────────
-- module.<name>     boolean — is this product module available?
-- <noun>.max        integer — hard cap (NULL = unlimited)
-- <noun>.quota      integer — rolling monthly quota

-- FREE
INSERT INTO plan_features (plan_id, feature_key, limit_value, is_enabled) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'module.crm',           NULL,     true),
  ('00000000-0000-0000-0000-00000000e001', 'module.inventory',     NULL,     false),
  ('00000000-0000-0000-0000-00000000e001', 'module.manufacturing', NULL,     false),
  ('00000000-0000-0000-0000-00000000e001', 'module.qc',            NULL,     false),
  ('00000000-0000-0000-0000-00000000e001', 'module.procurement',   NULL,     false),
  ('00000000-0000-0000-0000-00000000e001', 'module.finance',       NULL,     false),
  ('00000000-0000-0000-0000-00000000e001', 'module.hr',            NULL,     false),
  ('00000000-0000-0000-0000-00000000e001', 'users.max',            1,        true),
  ('00000000-0000-0000-0000-00000000e001', 'crm.contacts.max',     100,      true),
  ('00000000-0000-0000-0000-00000000e001', 'api.calls.quota',      1000,     true),
  ('00000000-0000-0000-0000-00000000e001', 'storage.gb',           1,        true)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  limit_value = EXCLUDED.limit_value,
  is_enabled  = EXCLUDED.is_enabled;

-- STARTER
INSERT INTO plan_features (plan_id, feature_key, limit_value, is_enabled) VALUES
  ('00000000-0000-0000-0000-00000000e002', 'module.crm',           NULL,     true),
  ('00000000-0000-0000-0000-00000000e002', 'module.inventory',     NULL,     true),
  ('00000000-0000-0000-0000-00000000e002', 'module.manufacturing', NULL,     false),
  ('00000000-0000-0000-0000-00000000e002', 'module.qc',            NULL,     false),
  ('00000000-0000-0000-0000-00000000e002', 'module.procurement',   NULL,     false),
  ('00000000-0000-0000-0000-00000000e002', 'module.finance',       NULL,     false),
  ('00000000-0000-0000-0000-00000000e002', 'module.hr',            NULL,     false),
  ('00000000-0000-0000-0000-00000000e002', 'users.max',            10,       true),
  ('00000000-0000-0000-0000-00000000e002', 'crm.contacts.max',     5000,     true),
  ('00000000-0000-0000-0000-00000000e002', 'api.calls.quota',      50000,    true),
  ('00000000-0000-0000-0000-00000000e002', 'storage.gb',           25,       true)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  limit_value = EXCLUDED.limit_value,
  is_enabled  = EXCLUDED.is_enabled;

-- PRO
INSERT INTO plan_features (plan_id, feature_key, limit_value, is_enabled) VALUES
  ('00000000-0000-0000-0000-00000000e003', 'module.crm',           NULL,     true),
  ('00000000-0000-0000-0000-00000000e003', 'module.inventory',     NULL,     true),
  ('00000000-0000-0000-0000-00000000e003', 'module.manufacturing', NULL,     true),
  ('00000000-0000-0000-0000-00000000e003', 'module.qc',            NULL,     true),
  ('00000000-0000-0000-0000-00000000e003', 'module.procurement',   NULL,     true),
  ('00000000-0000-0000-0000-00000000e003', 'module.finance',       NULL,     false),
  ('00000000-0000-0000-0000-00000000e003', 'module.hr',            NULL,     false),
  ('00000000-0000-0000-0000-00000000e003', 'users.max',            50,       true),
  ('00000000-0000-0000-0000-00000000e003', 'crm.contacts.max',     50000,    true),
  ('00000000-0000-0000-0000-00000000e003', 'api.calls.quota',      500000,   true),
  ('00000000-0000-0000-0000-00000000e003', 'storage.gb',           100,      true)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  limit_value = EXCLUDED.limit_value,
  is_enabled  = EXCLUDED.is_enabled;

-- ENTERPRISE — unlimited (limit_value = NULL), every module on.
INSERT INTO plan_features (plan_id, feature_key, limit_value, is_enabled) VALUES
  ('00000000-0000-0000-0000-00000000e004', 'module.crm',           NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'module.inventory',     NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'module.manufacturing', NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'module.qc',            NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'module.procurement',   NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'module.finance',       NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'module.hr',            NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'users.max',            NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'crm.contacts.max',     NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'api.calls.quota',      NULL,     true),
  ('00000000-0000-0000-0000-00000000e004', 'storage.gb',           NULL,     true)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  limit_value = EXCLUDED.limit_value,
  is_enabled  = EXCLUDED.is_enabled;
