-- Phase 4 §4.2 — QC certificate hash-chain audit ledger.
--
-- A BullMQ repeatable job ("audit-hashchain", scheduled daily at 02:00
-- via upsertJobScheduler per §6.5) walks every org's qc_certs chain
-- using verifyQcCertChain() and persists the result here. Rows are
-- never modified in place — each run produces exactly one new row. The
-- latest COMPLETED row with orgs_broken > 0 is what the ops dashboard
-- watches; the Prometheus counter erp_audit_chain_break_total is also
-- bumped by the processor at the moment of detection.
--
-- Deliberately NOT multi-tenant / NOT RLS-scoped: hash-chain integrity
-- is cross-org operational data owned by the platform, not the
-- customer. Only the vendor audit role reads this table.
--
-- Shape:
--   qc_cert_chain_audit_runs
--     one row per audit invocation. Summary counts plus a jsonb
--     `breaks` array whose shape mirrors VerifyChainResult.firstBroken:
--
--       [
--         { "orgId": "<uuid>",
--           "certId": "<uuid>",
--           "certNumber": "QCC-2026-0042",
--           "expected": "<64-hex>",
--           "actual": "<64-hex>|null",
--           "verifiedCount": 17,
--           "totalCount": 25 },
--         …
--       ]
--
--   A RUNNING row is written at invocation start; the SAME row is
--   UPDATEd to COMPLETED|FAILED on exit. The processor uses a unique
--   job id per day so BullMQ retries land on the existing row rather
--   than producing duplicate runs.

CREATE TABLE IF NOT EXISTS qc_cert_chain_audit_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger         text NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (trigger IN ('SCHEDULED', 'MANUAL')),
  status          text NOT NULL DEFAULT 'RUNNING'
                    CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  orgs_total      integer NOT NULL DEFAULT 0,
  orgs_ok         integer NOT NULL DEFAULT 0,
  orgs_broken     integer NOT NULL DEFAULT 0,
  breaks          jsonb NOT NULL DEFAULT '[]'::jsonb,
  error           text
);

-- Ops queries: "last completed run", "history of broken runs".
CREATE INDEX IF NOT EXISTS qc_cert_chain_audit_runs_started_idx
  ON qc_cert_chain_audit_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS qc_cert_chain_audit_runs_broken_idx
  ON qc_cert_chain_audit_runs (completed_at DESC)
  WHERE orgs_broken > 0;

COMMENT ON TABLE qc_cert_chain_audit_runs IS
  'Phase-4 §4.2 daily audit ledger: one row per hash-chain audit invocation. breaks jsonb array carries per-org VerifyChainResult.firstBroken objects for rows that failed verification.';

-- ─── Cross-tenant enumerator (SECURITY DEFINER) ─────────────────────────
--
-- The audit sweep (apps/worker/src/processors/audit-hashchain.ts) needs
-- to enumerate every org that has at least one non-deleted qc_cert — by
-- definition a cross-tenant read. The worker runs as `instigenie_app`
-- (NOBYPASSRLS, §9.2.1) so a plain `SELECT DISTINCT org_id FROM qc_certs`
-- from the worker's pool returns zero rows: `app.current_org` is unset,
-- and the qc_certs tenant-isolation policy filters everything.
--
-- Same precedent as ops/sql/rls/03-auth-cross-tenant.sql:
-- SECURITY DEFINER function owned by the migration superuser. RLS is
-- bypassed ONLY for this one query shape, with no parameters and no
-- writable surface. The per-org `verifyQcCertChain` read inside the
-- sweep still runs through withOrg() — so the ONLY thing this function
-- widens is the list of org_ids the worker learns.
--
-- `search_path = ''` blocks the classic SECURITY DEFINER escalation
-- where a caller plants a same-named table in their schema to swap the
-- physical target.

DROP FUNCTION IF EXISTS public.qc_audit_list_orgs_with_certs();

CREATE FUNCTION public.qc_audit_list_orgs_with_certs()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT org_id
    FROM public.qc_certs
   WHERE deleted_at IS NULL
   ORDER BY org_id ASC;
$$;

REVOKE ALL ON FUNCTION public.qc_audit_list_orgs_with_certs() FROM PUBLIC;

-- Grant EXECUTE to whichever app role is configured in this environment.
-- Dev compose uses `instigenie_app`; some developer machines run against
-- a renamed `instigenie_app` role. Both are NOBYPASSRLS per §9.2.1 — the
-- GRANT is equally safe in either.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.qc_audit_list_orgs_with_certs() TO instigenie_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.qc_audit_list_orgs_with_certs() TO instigenie_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_vendor') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.qc_audit_list_orgs_with_certs() TO instigenie_vendor';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'instigenie_vendor') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.qc_audit_list_orgs_with_certs() TO instigenie_vendor';
  END IF;
END
$$;

COMMENT ON FUNCTION public.qc_audit_list_orgs_with_certs() IS
  'Phase-4 §4.2 cross-tenant enumerator for the daily hash-chain audit sweep. Returns org_ids that have at least one non-deleted qc_cert. SECURITY DEFINER, narrowly scoped; the actual per-org hash verification still runs through withOrg().';
