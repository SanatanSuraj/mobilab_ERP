-- QC module triggers. Mirror of 07-production.sql.
--
--   * Bump updated_at on every UPDATE (all tables).
--   * Bump `version` on the mutable header tables (inspection_templates,
--     qc_inspections). inspection_parameters / qc_findings bump their
--     header via the service layer (same contract as bom_lines /
--     wip_stages / po_lines / grn_lines).
--   * qc_certs is append-only from the service layer (no version bump
--     trigger required; updated_at is still maintained in case of soft
--     delete).
--   * Append audit rows on INSERT/UPDATE/DELETE on every table.

-- ── qc_number_sequences ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS qc_number_sequences_updated_at ON qc_number_sequences;
CREATE TRIGGER qc_number_sequences_updated_at
BEFORE UPDATE ON qc_number_sequences
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS qc_number_sequences_audit ON qc_number_sequences;
CREATE TRIGGER qc_number_sequences_audit
AFTER INSERT OR UPDATE OR DELETE ON qc_number_sequences
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── inspection_templates ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS inspection_templates_updated_at ON inspection_templates;
CREATE TRIGGER inspection_templates_updated_at
BEFORE UPDATE ON inspection_templates
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS inspection_templates_version ON inspection_templates;
CREATE TRIGGER inspection_templates_version
BEFORE UPDATE ON inspection_templates
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS inspection_templates_audit ON inspection_templates;
CREATE TRIGGER inspection_templates_audit
AFTER INSERT OR UPDATE OR DELETE ON inspection_templates
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── inspection_parameters ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS inspection_parameters_updated_at ON inspection_parameters;
CREATE TRIGGER inspection_parameters_updated_at
BEFORE UPDATE ON inspection_parameters
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS inspection_parameters_audit ON inspection_parameters;
CREATE TRIGGER inspection_parameters_audit
AFTER INSERT OR UPDATE OR DELETE ON inspection_parameters
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── qc_inspections ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS qc_inspections_updated_at ON qc_inspections;
CREATE TRIGGER qc_inspections_updated_at
BEFORE UPDATE ON qc_inspections
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS qc_inspections_version ON qc_inspections;
CREATE TRIGGER qc_inspections_version
BEFORE UPDATE ON qc_inspections
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS qc_inspections_audit ON qc_inspections;
CREATE TRIGGER qc_inspections_audit
AFTER INSERT OR UPDATE OR DELETE ON qc_inspections
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── qc_findings ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS qc_findings_updated_at ON qc_findings;
CREATE TRIGGER qc_findings_updated_at
BEFORE UPDATE ON qc_findings
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS qc_findings_audit ON qc_findings;
CREATE TRIGGER qc_findings_audit
AFTER INSERT OR UPDATE OR DELETE ON qc_findings
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── qc_certs ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS qc_certs_updated_at ON qc_certs;
CREATE TRIGGER qc_certs_updated_at
BEFORE UPDATE ON qc_certs
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS qc_certs_audit ON qc_certs;
CREATE TRIGGER qc_certs_audit
AFTER INSERT OR UPDATE OR DELETE ON qc_certs
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
