-- PDF render ledger + DLQ RLS. ARCHITECTURE.md §9.2, §4.1.
--
-- Both tables carry org_id (they track per-tenant render attempts). Gate 12
-- (tests/gates/gate-12-rls-coverage.test.ts) refuses to ship an org_id
-- column without RLS ENABLED + FORCED + at least one policy bound to
-- app.current_org. Without this file those tables would silently
-- leak rows across tenants when the worker processes queued jobs.
--
-- Workers connect with the instigenie_app role (NOSUPERUSER, NOBYPASSRLS)
-- and SET LOCAL app.current_org before touching these tables — same
-- pattern as every other Phase-2+ module.

ALTER TABLE pdf_render_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_render_runs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pdf_render_runs_tenant_isolation ON pdf_render_runs;
CREATE POLICY pdf_render_runs_tenant_isolation ON pdf_render_runs
  USING      (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

ALTER TABLE pdf_render_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_render_dlq FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pdf_render_dlq_tenant_isolation ON pdf_render_dlq;
CREATE POLICY pdf_render_dlq_tenant_isolation ON pdf_render_dlq
  USING      (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));
