-- 0003_onboarding_progress — guided client-onboarding state.
--
-- Tracks per-tenant progress through the post-invite setup flow:
-- /onboarding/start picks industry, optionally seeds sample data, then
-- the wizard walks the admin through their first business cycle.
--
-- One row per tenant. PK = org_id (no separate id column) — the row IS
-- the tenant's onboarding state and there's nothing to identify it by
-- other than the tenant.
--
-- `steps_completed` is a TEXT[] of step keys (see contracts/onboarding.ts)
-- rather than separate booleans because the step list will grow as the
-- wizard expands; adding a step shouldn't require a column.
--
-- RLS: standard tenant isolation. The `instigenie_app` role's queries
-- only see their own org's row; the vendor-admin BYPASSRLS surface can
-- see all rows for support diagnostics.

CREATE TABLE IF NOT EXISTS onboarding_progress (
  org_id              UUID PRIMARY KEY
                        REFERENCES organizations(id) ON DELETE CASCADE,
  industry            TEXT NOT NULL
                        CHECK (industry IN ('MANUFACTURING', 'TRADING')),
  steps_completed     TEXT[] NOT NULL DEFAULT '{}',
  sample_data_seeded  BOOLEAN NOT NULL DEFAULT FALSE,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_progress_tenant_isolation
  ON onboarding_progress;
CREATE POLICY onboarding_progress_tenant_isolation
  ON onboarding_progress
  USING (org_id = current_setting('app.current_org_id', true)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::UUID);

CREATE INDEX IF NOT EXISTS onboarding_progress_started_at_idx
  ON onboarding_progress (started_at DESC);
