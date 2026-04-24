-- Dev-only production seed. Mirrors ARCHITECTURE.md §13.2 and the existing
-- frontend mock in apps/web/src/data/manufacturing-mock.ts so a fresh
-- `pnpm infra:up && pnpm db:migrate` boot has products, BOMs, WIP stage
-- templates, and sample work orders to click on.
--
-- Rules (same as 08/09 seeds):
--   * All IDs are stable deterministic UUIDs so re-running is idempotent.
--   * All rows belong to the Dev org from 03-dev-org-users.sql.
--   * Items referenced here live in 08-inventory-dev-data.sql — the FK
--     constraint forces seed order (Phase 2 only has one dev org so this
--     is fine; per-tenant seeds will need per-tenant item IDs).
--   * No audit actor set — the audit trigger tolerates NULL.
--
-- UUID fixture conventions:
--   fc00x — products
--   fc1xx — bom_versions (header)
--   fc2xx — bom_lines
--   fc3xx — wip_stage_templates
--   fc4xx — work_orders (header)
--   fc5xx — wip_stages

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';

  -- Users (from 03-dev-org-users.sql)
  v_prodmgr  uuid := '00000000-0000-0000-0000-00000000b007'; -- Production Manager
  v_rd_lead  uuid := '00000000-0000-0000-0000-00000000b008'; -- R&D Lead (if exists; fall back to admin)
  v_ops_op   uuid := '00000000-0000-0000-0000-00000000b009'; -- Operator

  -- Items (from 08-inventory-dev-data.sql)
  v_it_res   uuid := '00000000-0000-0000-0000-000000fb0001'; -- Resistor 1k
  v_it_cap   uuid := '00000000-0000-0000-0000-000000fb0002'; -- Cap 10uF
  v_it_pcb   uuid := '00000000-0000-0000-0000-000000fb0003'; -- PCB ECG v2
  v_it_bat   uuid := '00000000-0000-0000-0000-000000fb0004'; -- LiPo battery
  v_it_lcd   uuid := '00000000-0000-0000-0000-000000fb0005'; -- LCD 3"
  v_it_wire  uuid := '00000000-0000-0000-0000-000000fb0006'; -- Silicone wire
  v_it_psu   uuid := '00000000-0000-0000-0000-000000fb0007'; -- PSU subassembly
  v_it_box   uuid := '00000000-0000-0000-0000-000000fb000a'; -- Shipping box

  -- Products
  v_pr_ecg   uuid := '00000000-0000-0000-0000-000000fc0001'; -- ECG Patient Monitor v2
  v_pr_spir  uuid := '00000000-0000-0000-0000-000000fc0002'; -- Digital Spirometer C1
  v_pr_glu   uuid := '00000000-0000-0000-0000-000000fc0003'; -- Glucometer Strip Lot

  -- BOM versions
  v_bm_ecg3  uuid := '00000000-0000-0000-0000-000000fc0101'; -- ECG v3 (ACTIVE)
  v_bm_ecg2  uuid := '00000000-0000-0000-0000-000000fc0102'; -- ECG v2 (SUPERSEDED)
  v_bm_spir1 uuid := '00000000-0000-0000-0000-000000fc0103'; -- Spiro v1 (ACTIVE)

  -- BOM lines
  v_bml_01   uuid := '00000000-0000-0000-0000-000000fc0201';
  v_bml_02   uuid := '00000000-0000-0000-0000-000000fc0202';
  v_bml_03   uuid := '00000000-0000-0000-0000-000000fc0203';
  v_bml_04   uuid := '00000000-0000-0000-0000-000000fc0204';
  v_bml_05   uuid := '00000000-0000-0000-0000-000000fc0205';
  v_bml_06   uuid := '00000000-0000-0000-0000-000000fc0206';
  v_bml_07   uuid := '00000000-0000-0000-0000-000000fc0207';
  v_bml_08   uuid := '00000000-0000-0000-0000-000000fc0208';
  v_bml_09   uuid := '00000000-0000-0000-0000-000000fc0209';
  v_bml_10   uuid := '00000000-0000-0000-0000-000000fc020a';
  v_bml_11   uuid := '00000000-0000-0000-0000-000000fc020b';
  v_bml_12   uuid := '00000000-0000-0000-0000-000000fc020c';

  -- WIP stage templates (MODULE family, 8 stages)
  v_wst_01   uuid := '00000000-0000-0000-0000-000000fc0301';
  v_wst_02   uuid := '00000000-0000-0000-0000-000000fc0302';
  v_wst_03   uuid := '00000000-0000-0000-0000-000000fc0303';
  v_wst_04   uuid := '00000000-0000-0000-0000-000000fc0304';
  v_wst_05   uuid := '00000000-0000-0000-0000-000000fc0305';
  v_wst_06   uuid := '00000000-0000-0000-0000-000000fc0306';
  v_wst_07   uuid := '00000000-0000-0000-0000-000000fc0307';
  v_wst_08   uuid := '00000000-0000-0000-0000-000000fc0308';

  -- Work orders
  v_wo_001   uuid := '00000000-0000-0000-0000-000000fc0401'; -- PID-2026-0001 (IN_PROGRESS)
  v_wo_002   uuid := '00000000-0000-0000-0000-000000fc0402'; -- PID-2026-0002 (QC_HOLD)
  v_wo_003   uuid := '00000000-0000-0000-0000-000000fc0403'; -- PID-2026-0003 (PLANNED)

  -- WIP stages (per-WO instances)
  v_ws_101   uuid := '00000000-0000-0000-0000-000000fc0501';
  v_ws_102   uuid := '00000000-0000-0000-0000-000000fc0502';
  v_ws_103   uuid := '00000000-0000-0000-0000-000000fc0503';
  v_ws_104   uuid := '00000000-0000-0000-0000-000000fc0504';
  v_ws_105   uuid := '00000000-0000-0000-0000-000000fc0505';
  v_ws_106   uuid := '00000000-0000-0000-0000-000000fc0506';
  v_ws_107   uuid := '00000000-0000-0000-0000-000000fc0507';
  v_ws_108   uuid := '00000000-0000-0000-0000-000000fc0508';

  v_ws_201   uuid := '00000000-0000-0000-0000-000000fc0511';
  v_ws_202   uuid := '00000000-0000-0000-0000-000000fc0512';
  v_ws_203   uuid := '00000000-0000-0000-0000-000000fc0513';
  v_ws_204   uuid := '00000000-0000-0000-0000-000000fc0514';
  v_ws_205   uuid := '00000000-0000-0000-0000-000000fc0515';
  v_ws_206   uuid := '00000000-0000-0000-0000-000000fc0516';
  v_ws_207   uuid := '00000000-0000-0000-0000-000000fc0517';
  v_ws_208   uuid := '00000000-0000-0000-0000-000000fc0518';

  v_ws_301   uuid := '00000000-0000-0000-0000-000000fc0521';
  v_ws_302   uuid := '00000000-0000-0000-0000-000000fc0522';
  v_ws_303   uuid := '00000000-0000-0000-0000-000000fc0523';
  v_ws_304   uuid := '00000000-0000-0000-0000-000000fc0524';
  v_ws_305   uuid := '00000000-0000-0000-0000-000000fc0525';
  v_ws_306   uuid := '00000000-0000-0000-0000-000000fc0526';
  v_ws_307   uuid := '00000000-0000-0000-0000-000000fc0527';
  v_ws_308   uuid := '00000000-0000-0000-0000-000000fc0528';
BEGIN
  -- Set RLS context.
  PERFORM set_config('app.current_org', v_org::text, true);

  -- ─── Products ──────────────────────────────────────────────────────────────
  INSERT INTO products (
    id, org_id, product_code, name, family, description, uom,
    standard_cycle_days, has_serial_tracking, rework_limit, is_active
  ) VALUES
    (v_pr_ecg,  v_org, 'ECG-MONITOR-V2',  'ECG Patient Monitor v2',
     'MODULE', 'Finished clinical ECG monitor — CDSCO cleared', 'PCS',
     8, true, 2, true),
    (v_pr_spir, v_org, 'SPIROMETER-C1',   'Digital Spirometer C1',
     'MODULE', 'Handheld clinical spirometer', 'PCS',
     6, true, 2, true),
    (v_pr_glu,  v_org, 'GLUCO-STRIP-500', 'Glucometer Strip Lot 500',
     'REAGENT',    'Single-use glucose strips, batch-controlled', 'BOX',
     4, false, 1, true)
  ON CONFLICT (id) DO NOTHING;

  -- ─── BOM Versions ──────────────────────────────────────────────────────────
  INSERT INTO bom_versions (
    id, org_id, product_id, version_label, status, effective_from,
    total_std_cost, ecn_ref, notes, created_by, approved_by, approved_at
  ) VALUES
    (v_bm_ecg3,  v_org, v_pr_ecg,  'v3', 'ACTIVE',     '2026-01-01',
     214330, 'ECN-2025-008',
     'Upgraded flow cell sensor (precision grade)',
     v_rd_lead, v_prodmgr, '2025-12-28T10:00:00Z'),
    (v_bm_ecg2,  v_org, v_pr_ecg,  'v2', 'SUPERSEDED', '2025-06-01',
     202500, 'ECN-2025-008',
     'Legacy BOM — grandfathered for 2025 POs',
     v_rd_lead, v_prodmgr, '2025-05-20T10:00:00Z'),
    (v_bm_spir1, v_org, v_pr_spir, 'v1', 'ACTIVE',     '2025-04-01',
     92400, NULL,
     'Initial Spirometer release',
     v_rd_lead, v_prodmgr, '2025-03-25T10:00:00Z')
  ON CONFLICT (id) DO NOTHING;

  -- effective_to on the superseded ECG v2
  UPDATE bom_versions
     SET effective_to = '2025-12-31'
   WHERE id = v_bm_ecg2;

  -- Denormalised active BOM pointers on products.
  UPDATE products SET active_bom_id = v_bm_ecg3  WHERE id = v_pr_ecg;
  UPDATE products SET active_bom_id = v_bm_spir1 WHERE id = v_pr_spir;

  -- ─── BOM Lines ─────────────────────────────────────────────────────────────
  INSERT INTO bom_lines (
    id, org_id, bom_id, line_no, component_item_id, qty_per_unit, uom,
    reference_designator, is_critical, tracking_type, lead_time_days, std_unit_cost
  ) VALUES
    -- ECG v3 (6 lines)
    (v_bml_01, v_org, v_bm_ecg3, 1, v_it_pcb,  1.000, 'EA',  'PCB-MAIN-01', true,  'BATCH', 30, 850),
    (v_bml_02, v_org, v_bm_ecg3, 2, v_it_psu,  1.000, 'EA',  'PSU-01',      true,  'BATCH', 18, 1250),
    (v_bml_03, v_org, v_bm_ecg3, 3, v_it_lcd,  1.000, 'EA',  'DISP-01',     false, 'BATCH', 10, 680),
    (v_bml_04, v_org, v_bm_ecg3, 4, v_it_bat,  1.000, 'EA',  'BAT-01',      true,  'BATCH', 21, 320),
    (v_bml_05, v_org, v_bm_ecg3, 5, v_it_wire, 0.500, 'M',   NULL,          false, 'NONE',   7, 9),
    (v_bml_06, v_org, v_bm_ecg3, 6, v_it_box,  1.000, 'EA',  NULL,          false, 'NONE',   3, 22),

    -- ECG v2 (3 lines — simpler, grandfathered)
    (v_bml_07, v_org, v_bm_ecg2, 1, v_it_pcb,  1.000, 'EA',  'PCB-MAIN-01', true,  'BATCH', 30, 850),
    (v_bml_08, v_org, v_bm_ecg2, 2, v_it_lcd,  1.000, 'EA',  'DISP-01',     false, 'BATCH', 10, 680),
    (v_bml_09, v_org, v_bm_ecg2, 3, v_it_bat,  1.000, 'EA',  'BAT-01',      true,  'BATCH', 21, 320),

    -- Spirometer v1 (3 lines)
    (v_bml_10, v_org, v_bm_spir1, 1, v_it_pcb,  1.000, 'EA', 'PCB-MAIN-01', true,  'BATCH', 30, 850),
    (v_bml_11, v_org, v_bm_spir1, 2, v_it_lcd,  1.000, 'EA', 'DISP-01',     false, 'BATCH', 10, 680),
    (v_bml_12, v_org, v_bm_spir1, 3, v_it_bat,  1.000, 'EA', 'BAT-01',      true,  'BATCH', 21, 320)
  ON CONFLICT (id) DO NOTHING;

  -- ─── WIP Stage Templates (MODULE family, 8 stages) ────────────────────
  INSERT INTO wip_stage_templates (
    id, org_id, product_family, sequence_number, stage_name,
    requires_qc_signoff, expected_duration_hours, responsible_role, is_active
  ) VALUES
    (v_wst_01, v_org, 'MODULE', 1, 'Component Kitting',        false, 2,   'Stores',     true),
    (v_wst_02, v_org, 'MODULE', 2, 'PCB Sub-Assembly',          true,  4,   'Production', true),
    (v_wst_03, v_org, 'MODULE', 3, 'Mechanical Assembly',       false, 3,   'Production', true),
    (v_wst_04, v_org, 'MODULE', 4, 'Main Integration',          false, 4,   'Production', true),
    (v_wst_05, v_org, 'MODULE', 5, 'Electrical Testing',        true,  3,   'QC',         true),
    (v_wst_06, v_org, 'MODULE', 6, 'Software/Firmware Load',    false, 1,   'Production', true),
    (v_wst_07, v_org, 'MODULE', 7, 'Burn-in / Soak Test',       false, 4,   'Production', true),
    (v_wst_08, v_org, 'MODULE', 8, 'Final QC',                  true,  2,   'QC',         true)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Work Orders ───────────────────────────────────────────────────────────
  INSERT INTO work_orders (
    id, org_id, pid, product_id, bom_id, bom_version_label, quantity,
    status, priority, target_date, started_at, assigned_to, created_by,
    current_stage_index, rework_count, device_serials, notes
  ) VALUES
    -- IN_PROGRESS: 3 ECG units, currently on stage 4 (Main Integration)
    (v_wo_001, v_org, 'PID-2026-0001', v_pr_ecg, v_bm_ecg3, 'v3', 3,
     'IN_PROGRESS', 'HIGH', '2026-04-30', '2026-04-03T08:00:00Z',
     v_ops_op, v_prodmgr, 3, 0,
     ARRAY['ECG-2026-0001', 'ECG-2026-0002', 'ECG-2026-0003'],
     'Apollo Diagnostics order — 3 units'),

    -- QC_HOLD: 2 ECG units, stage 5 failed electrical test
    (v_wo_002, v_org, 'PID-2026-0002', v_pr_ecg, v_bm_ecg3, 'v3', 2,
     'QC_HOLD', 'HIGH', '2026-04-25', '2026-04-04T08:00:00Z',
     v_ops_op, v_prodmgr, 4, 1,
     ARRAY['ECG-2026-0004', 'ECG-2026-0005'],
     'Unit 1 voltage regulator out of spec — rework required'),

    -- PLANNED: 5 Spirometers, no stages started yet
    (v_wo_003, v_org, 'PID-2026-0003', v_pr_spir, v_bm_spir1, 'v1', 5,
     'PLANNED', 'NORMAL', '2026-05-15', NULL,
     v_ops_op, v_prodmgr, 0, 0,
     ARRAY[]::text[],
     'Replenishment batch — internal stocking')
  ON CONFLICT (id) DO NOTHING;

  -- ─── WIP Stages ───────────────────────────────────────────────────────────
  -- WO 001 (IN_PROGRESS): stages 1-3 complete, 4 in progress
  INSERT INTO wip_stages (
    id, org_id, wo_id, template_id, sequence_number, stage_name,
    requires_qc_signoff, expected_duration_hours, status,
    started_at, completed_at, qc_result, rework_count, assigned_to, notes
  ) VALUES
    (v_ws_101, v_org, v_wo_001, v_wst_01, 1, 'Component Kitting',
     false, 2, 'COMPLETED',
     '2026-04-03T08:00:00Z', '2026-04-03T10:30:00Z', NULL, 0, v_ops_op, NULL),
    (v_ws_102, v_org, v_wo_001, v_wst_02, 2, 'PCB Sub-Assembly',
     true, 4, 'COMPLETED',
     '2026-04-03T11:00:00Z', '2026-04-04T09:00:00Z', 'PASS', 0, v_ops_op, NULL),
    (v_ws_103, v_org, v_wo_001, v_wst_03, 3, 'Mechanical Assembly',
     false, 3, 'COMPLETED',
     '2026-04-04T10:00:00Z', '2026-04-06T14:00:00Z', NULL, 0, v_ops_op, NULL),
    (v_ws_104, v_org, v_wo_001, v_wst_04, 4, 'Main Integration',
     false, 4, 'IN_PROGRESS',
     '2026-04-07T09:00:00Z', NULL, NULL, 0, v_ops_op,
     'Unit 2 integration complete, unit 3 started'),
    (v_ws_105, v_org, v_wo_001, v_wst_05, 5, 'Electrical Testing',
     true, 3, 'PENDING',  NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_106, v_org, v_wo_001, v_wst_06, 6, 'Software/Firmware Load',
     false, 1, 'PENDING',  NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_107, v_org, v_wo_001, v_wst_07, 7, 'Burn-in / Soak Test',
     false, 4, 'PENDING',  NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_108, v_org, v_wo_001, v_wst_08, 8, 'Final QC',
     true, 2, 'PENDING',  NULL, NULL, NULL, 0, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- WO 002 (QC_HOLD): stages 1-4 complete, 5 failed QC
  INSERT INTO wip_stages (
    id, org_id, wo_id, template_id, sequence_number, stage_name,
    requires_qc_signoff, expected_duration_hours, status,
    started_at, completed_at, qc_result, rework_count, assigned_to, notes
  ) VALUES
    (v_ws_201, v_org, v_wo_002, v_wst_01, 1, 'Component Kitting',
     false, 2, 'COMPLETED',
     '2026-04-04T08:00:00Z', '2026-04-04T10:00:00Z', NULL, 0, v_ops_op, NULL),
    (v_ws_202, v_org, v_wo_002, v_wst_02, 2, 'PCB Sub-Assembly',
     true, 4, 'COMPLETED',
     '2026-04-05T09:00:00Z', '2026-04-06T14:00:00Z', 'PASS', 0, v_ops_op, NULL),
    (v_ws_203, v_org, v_wo_002, v_wst_03, 3, 'Mechanical Assembly',
     false, 3, 'COMPLETED',
     '2026-04-07T09:00:00Z', '2026-04-08T12:00:00Z', NULL, 0, v_ops_op, NULL),
    (v_ws_204, v_org, v_wo_002, v_wst_04, 4, 'Main Integration',
     false, 4, 'COMPLETED',
     '2026-04-09T09:00:00Z', '2026-04-11T15:00:00Z', NULL, 0, v_ops_op, NULL),
    (v_ws_205, v_org, v_wo_002, v_wst_05, 5, 'Electrical Testing',
     true, 3, 'QC_HOLD',
     '2026-04-12T09:00:00Z', NULL, 'FAIL', 1, v_ops_op,
     'Unit 1 voltage regulator output out of spec — QC FAIL, rework required'),
    (v_ws_206, v_org, v_wo_002, v_wst_06, 6, 'Software/Firmware Load',
     false, 1, 'PENDING',  NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_207, v_org, v_wo_002, v_wst_07, 7, 'Burn-in / Soak Test',
     false, 4, 'PENDING',  NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_208, v_org, v_wo_002, v_wst_08, 8, 'Final QC',
     true, 2, 'PENDING',  NULL, NULL, NULL, 0, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- WO 003 (PLANNED): all stages pending
  INSERT INTO wip_stages (
    id, org_id, wo_id, template_id, sequence_number, stage_name,
    requires_qc_signoff, expected_duration_hours, status,
    started_at, completed_at, qc_result, rework_count, assigned_to, notes
  ) VALUES
    (v_ws_301, v_org, v_wo_003, v_wst_01, 1, 'Component Kitting',      false, 2, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_302, v_org, v_wo_003, v_wst_02, 2, 'PCB Sub-Assembly',       true,  4, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_303, v_org, v_wo_003, v_wst_03, 3, 'Mechanical Assembly',    false, 3, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_304, v_org, v_wo_003, v_wst_04, 4, 'Main Integration',       false, 4, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_305, v_org, v_wo_003, v_wst_05, 5, 'Electrical Testing',     true,  3, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_306, v_org, v_wo_003, v_wst_06, 6, 'Software/Firmware Load', false, 1, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_307, v_org, v_wo_003, v_wst_07, 7, 'Burn-in / Soak Test',    false, 4, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL),
    (v_ws_308, v_org, v_wo_003, v_wst_08, 8, 'Final QC',               true,  2, 'PENDING', NULL, NULL, NULL, 0, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Bump WO sequence so next manual create starts at 0004.
  INSERT INTO production_number_sequences (org_id, kind, year, last_seq)
    VALUES (v_org, 'WO', 2026, 3)
  ON CONFLICT (org_id, kind, year) DO UPDATE SET last_seq = 3;
END $$;
