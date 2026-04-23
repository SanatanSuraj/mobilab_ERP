-- Generic updated_at auto-bumper. Attach to every table that has an
-- updated_at column. Cheap, no-op-safe.

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_updated_at ON organizations;
CREATE TRIGGER organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- User invitations. Schema in ops/sql/init/20-user-invitations.sql.
DROP TRIGGER IF EXISTS user_invitations_updated_at ON user_invitations;
CREATE TRIGGER user_invitations_updated_at
BEFORE UPDATE ON user_invitations
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
