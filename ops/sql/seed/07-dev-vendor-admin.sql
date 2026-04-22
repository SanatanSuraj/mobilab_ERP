-- Dev-only bootstrap: one vendor admin in vendor.admins so the
-- /vendor-admin/auth/login flow has something to authenticate against
-- without hand-inserting a row every time the DB is reset.
--
-- The password is `instigenie_dev_2026` — same bcrypt hash as 03-dev-org-users.sql
-- (cost 10). Reusing the hash keeps the dev environment memorizable.
--
-- Gate 7 (bootstrap-policy) verifies this seed only runs in dev. Production
-- tenants onboard through a separate invite flow (not yet built).
--
-- UUID fixture conventions (hex-only) — vendor-side adds `cccX`:
--   ccc1  — Instigenie vendor admin #1 (primary dev account)
--   ccc2  — Instigenie vendor admin #2 (spare, used by Gate 18/19 for
--           cross-admin audit scenarios if needed)

DO $$
DECLARE
  -- bcrypt $2b$10$ of "instigenie_dev_2026" — identical hash to 03-dev-org-users.sql
  v_pw text := '$2b$10$NMi.pgkQYWK/B2HuV2c/YOat1FjOwURKL5nML1P7Q.9itOxWMSqIu';
BEGIN
  INSERT INTO vendor.admins (id, email, password_hash, name, is_active) VALUES
    ('00000000-0000-0000-0000-00000000ccc1', 'vendor@instigenie.local',    v_pw, 'Instigenie Vendor Admin', true),
    ('00000000-0000-0000-0000-00000000ccc2', 'vendor2@instigenie.local',   v_pw, 'Instigenie Vendor Admin #2', true)
  ON CONFLICT (id) DO UPDATE SET
    email         = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name          = EXCLUDED.name,
    is_active     = EXCLUDED.is_active,
    updated_at    = now();
END $$;
