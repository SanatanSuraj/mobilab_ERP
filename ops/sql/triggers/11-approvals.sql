-- Approval workflow triggers. ARCHITECTURE.md §3.3 + §11.
--
-- Conventions match 10-notifications.sql:
--   * updated_at bumped on every UPDATE (chain_defs, requests, steps).
--   * version bumped on chain_defs only — requests/steps use explicit
--     state-machine transitions and the workflow_transitions log as their
--     audit source; optimistic concurrency is redundant.
--   * Full audit.log coverage on every table, including workflow_transitions
--     (DELETE of audit rows would itself be audited — defence in depth).

-- ── approval_chain_definitions ────────────────────────────────────────────
DROP TRIGGER IF EXISTS approval_chain_defs_updated_at ON approval_chain_definitions;
CREATE TRIGGER approval_chain_defs_updated_at
BEFORE UPDATE ON approval_chain_definitions
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS approval_chain_defs_version ON approval_chain_definitions;
CREATE TRIGGER approval_chain_defs_version
BEFORE UPDATE ON approval_chain_definitions
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS approval_chain_defs_audit ON approval_chain_definitions;
CREATE TRIGGER approval_chain_defs_audit
AFTER INSERT OR UPDATE OR DELETE ON approval_chain_definitions
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── approval_requests ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS approval_requests_updated_at ON approval_requests;
CREATE TRIGGER approval_requests_updated_at
BEFORE UPDATE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS approval_requests_audit ON approval_requests;
CREATE TRIGGER approval_requests_audit
AFTER INSERT OR UPDATE OR DELETE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── approval_steps ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS approval_steps_updated_at ON approval_steps;
CREATE TRIGGER approval_steps_updated_at
BEFORE UPDATE ON approval_steps
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS approval_steps_audit ON approval_steps;
CREATE TRIGGER approval_steps_audit
AFTER INSERT OR UPDATE OR DELETE ON approval_steps
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── workflow_transitions ──────────────────────────────────────────────────
-- No updated_at trigger — rows are immutable by service contract. Audit still
-- attached so a policy escape that UPDATE/DELETEs a row leaves a trail.
DROP TRIGGER IF EXISTS workflow_transitions_audit ON workflow_transitions;
CREATE TRIGGER workflow_transitions_audit
AFTER INSERT OR UPDATE OR DELETE ON workflow_transitions
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
