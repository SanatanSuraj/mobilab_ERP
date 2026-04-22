-- App role: non-superuser, RLS-bound.
--
-- POSTGRES_USER is created as SUPERUSER by the docker image, and Postgres
-- exempts superusers from every RLS policy — even on tables with FORCE ROW
-- LEVEL SECURITY. The bootstrap user (instigenie) also can't demote itself:
--
--     ERROR: permission denied to alter role
--     DETAIL: The bootstrap user must have the SUPERUSER attribute.
--
-- So we keep `instigenie` as the bootstrap/migration identity and create a
-- separate `instigenie_app` that the API, workers, and gates connect with.
-- That role has no SUPERUSER and no BYPASSRLS, so every SELECT/INSERT is
-- evaluated against the policies in ops/sql/rls/*.sql.
--
-- Password matches POSTGRES_PASSWORD in docker-compose.dev.yml for dev
-- convenience. Rotate in production.
--
-- Gate 5 (tests/gates/gate-5-rls.test.ts) verifies isolation via this role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    CREATE ROLE instigenie_app
      LOGIN
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      PASSWORD 'instigenie_dev';
  ELSE
    ALTER ROLE instigenie_app
      LOGIN
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      PASSWORD 'instigenie_dev';
  END IF;
END
$$;

-- Schema usage.
GRANT USAGE ON SCHEMA public TO instigenie_app;
GRANT USAGE ON SCHEMA outbox TO instigenie_app;
GRANT USAGE ON SCHEMA audit TO instigenie_app;

-- Data privileges on everything that exists now…
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO instigenie_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA outbox TO instigenie_app;
GRANT SELECT, INSERT                 ON ALL TABLES    IN SCHEMA audit  TO instigenie_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO instigenie_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA outbox TO instigenie_app;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO instigenie_app;

-- …and on anything created later by instigenie (migrations).
ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO instigenie_app;
ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO instigenie_app;
ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA public
  GRANT EXECUTE                        ON FUNCTIONS TO instigenie_app;

ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA outbox
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO instigenie_app;
ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA outbox
  GRANT USAGE, SELECT                  ON SEQUENCES TO instigenie_app;

ALTER DEFAULT PRIVILEGES FOR ROLE instigenie IN SCHEMA audit
  GRANT SELECT, INSERT ON TABLES TO instigenie_app;
