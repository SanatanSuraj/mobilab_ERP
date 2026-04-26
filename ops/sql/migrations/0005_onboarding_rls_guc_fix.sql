-- 0005_onboarding_rls_guc_fix — fix RLS policies on onboarding_* tables.
--
-- Migrations 0003 and 0004 originally referenced `app.current_org_id` as
-- the GUC name in the RLS policy expressions. The rest of the codebase
-- uses `app.current_org` (set by withOrg() in packages/db/src/with-org.ts).
-- The mismatch meant `current_setting('app.current_org_id', true)` always
-- returned NULL during request handling, which made the policy comparison
-- `org_id = NULL::UUID` evaluate NULL → fail the WITH CHECK on every
-- INSERT, returning PG 42501 ("permission denied for table") to the
-- caller.
--
-- Fix: drop + recreate both policies with the correct GUC name and the
-- text-cast comparison shape used elsewhere in ops/sql/rls/. We keep the
-- 0003/0004 files unchanged so the migration ledger sha-hash check
-- doesn't trip; this migration is the one that actually puts the
-- correct policy in place.
--
-- Idempotent: DROP POLICY IF EXISTS so re-running is safe.

DROP POLICY IF EXISTS onboarding_progress_tenant_isolation
  ON onboarding_progress;
CREATE POLICY onboarding_progress_tenant_isolation
  ON onboarding_progress
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

DROP POLICY IF EXISTS onboarding_feedback_tenant_isolation
  ON onboarding_feedback;
CREATE POLICY onboarding_feedback_tenant_isolation
  ON onboarding_feedback
  USING (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));
