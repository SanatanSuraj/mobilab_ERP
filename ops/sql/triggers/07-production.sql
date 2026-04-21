-- Production module triggers. Mirror of 06-procurement.sql.
--
--   * Bump updated_at on every UPDATE (all tables).
--   * Bump `version` on the 4 header tables (products, bom_versions,
--     work_orders; BOM lines/WIP stages bump their header via the service
--     layer — same contract as procurement po_lines/grn_lines).
--   * Append audit rows on INSERT/UPDATE/DELETE on every table.

-- ── products ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS products_version ON products;
CREATE TRIGGER products_version
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS products_audit ON products;
CREATE TRIGGER products_audit
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── production_number_sequences ────────────────────────────────────────────
-- No version column — same pattern as procurement sequences.
DROP TRIGGER IF EXISTS production_number_sequences_updated_at ON production_number_sequences;
CREATE TRIGGER production_number_sequences_updated_at
BEFORE UPDATE ON production_number_sequences
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS production_number_sequences_audit ON production_number_sequences;
CREATE TRIGGER production_number_sequences_audit
AFTER INSERT OR UPDATE OR DELETE ON production_number_sequences
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── bom_versions ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS bom_versions_updated_at ON bom_versions;
CREATE TRIGGER bom_versions_updated_at
BEFORE UPDATE ON bom_versions
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS bom_versions_version ON bom_versions;
CREATE TRIGGER bom_versions_version
BEFORE UPDATE ON bom_versions
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS bom_versions_audit ON bom_versions;
CREATE TRIGGER bom_versions_audit
AFTER INSERT OR UPDATE OR DELETE ON bom_versions
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── bom_lines ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS bom_lines_updated_at ON bom_lines;
CREATE TRIGGER bom_lines_updated_at
BEFORE UPDATE ON bom_lines
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS bom_lines_audit ON bom_lines;
CREATE TRIGGER bom_lines_audit
AFTER INSERT OR UPDATE OR DELETE ON bom_lines
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── wip_stage_templates ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS wip_stage_templates_updated_at ON wip_stage_templates;
CREATE TRIGGER wip_stage_templates_updated_at
BEFORE UPDATE ON wip_stage_templates
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS wip_stage_templates_audit ON wip_stage_templates;
CREATE TRIGGER wip_stage_templates_audit
AFTER INSERT OR UPDATE OR DELETE ON wip_stage_templates
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── work_orders ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS work_orders_updated_at ON work_orders;
CREATE TRIGGER work_orders_updated_at
BEFORE UPDATE ON work_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS work_orders_version ON work_orders;
CREATE TRIGGER work_orders_version
BEFORE UPDATE ON work_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS work_orders_audit ON work_orders;
CREATE TRIGGER work_orders_audit
AFTER INSERT OR UPDATE OR DELETE ON work_orders
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── wip_stages ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS wip_stages_updated_at ON wip_stages;
CREATE TRIGGER wip_stages_updated_at
BEFORE UPDATE ON wip_stages
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS wip_stages_audit ON wip_stages;
CREATE TRIGGER wip_stages_audit
AFTER INSERT OR UPDATE OR DELETE ON wip_stages
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
