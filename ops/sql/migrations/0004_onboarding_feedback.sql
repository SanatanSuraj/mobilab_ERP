-- 0004_onboarding_feedback — capture admin's "was onboarding easy?" answer.
--
-- One row per submission (an admin can re-submit if they change their
-- mind; we keep all rows for vendor-admin trend reporting). RLS-bound
-- so only the org's own rows are visible to tenant code; vendor-admin
-- BYPASSRLS reads across orgs.
--
-- `easy` is a small enum, not a numeric score: a 5-star rating is
-- noisier and more biased than a 3-bucket pulse, and we mostly care
-- about "did the admin get stuck". Comment is optional and free-text;
-- we cap to 4 KiB so a copy-paste mistake can't fill a row.

CREATE TABLE IF NOT EXISTS onboarding_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  easy        TEXT NOT NULL CHECK (easy IN ('YES', 'SOMEWHAT', 'NO')),
  comment     TEXT CHECK (comment IS NULL OR length(comment) <= 4096),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_feedback_tenant_isolation
  ON onboarding_feedback;
CREATE POLICY onboarding_feedback_tenant_isolation
  ON onboarding_feedback
  USING (org_id = current_setting('app.current_org_id', true)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::UUID);

CREATE INDEX IF NOT EXISTS onboarding_feedback_org_created_idx
  ON onboarding_feedback (org_id, created_at DESC);
