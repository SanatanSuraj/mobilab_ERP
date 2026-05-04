-- Prod-safe vendor admin bootstrap.
--
-- Unlike 07-dev-vendor-admin.sql, this file does NOT have the `dev-`
-- prefix and is therefore included by ops/scripts/migrate-prod.sh. It
-- creates the primary vendor admin account so /vendor-admin/auth/login
-- has something to authenticate against in production from day one.
--
-- Idempotent: ON CONFLICT (email) DO NOTHING — if the row already
-- exists (e.g. password was rotated via the reset flow), this seed
-- never overwrites it.
--
-- Password rotation: use POST /vendor-admin/auth/forgot-password →
-- POST /vendor-admin/auth/reset-password (vendor-password-reset module).
-- Do NOT edit the hash here after first deploy.

INSERT INTO vendor.admins (id, email, password_hash, name, is_active)
VALUES (
  'bd2c8e31-a2b0-455f-a0bc-1df731e64adb',
  'skc.suraj32@gmail.com',
  '$2b$12$hIJm7uDy2mU8rcy29vzQruQfUBRB9kNEn.N26vdRy40RZGX7NF0Te',
  'Suraj (Vendor Admin)',
  true
)
ON CONFLICT (email) DO NOTHING;
