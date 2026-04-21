-- Dev-only QC seed. ARCHITECTURE.md §13.4.
--
-- Mirrors the frontend mock in apps/web/src/data/qc-mock.ts so a fresh
-- `pnpm infra:up && pnpm db:migrate` boot has inspection templates, sample
-- inspections, findings, and a signed certificate to click on.
--
-- Rules (same as 10-production-dev-data.sql):
--   * All IDs are stable deterministic UUIDs so re-running is idempotent.
--   * All rows belong to the Dev org from 03-dev-org-users.sql.
--   * References live in 08-inventory-dev-data.sql and 10-production-dev-data.sql.
--   * No audit actor set — the audit trigger tolerates NULL.
--
-- UUID fixture conventions (fd00x namespace — QC module):
--   fd0xx — inspection_templates (header)
--   fd1xx — inspection_parameters
--   fd2xx — qc_inspections (header)
--   fd3xx — qc_findings
--   fd4xx — qc_certs

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';

  -- Users
  v_prodmgr  uuid := '00000000-0000-0000-0000-00000000b007';  -- Production Manager
  v_qc       uuid := '00000000-0000-0000-0000-00000000b00a';  -- QC Lead (if exists; fall back to prodmgr)
  v_ops_op   uuid := '00000000-0000-0000-0000-00000000b009';  -- Operator

  -- Inventory items (from 08-inventory-dev-data.sql)
  v_it_pcb   uuid := '00000000-0000-0000-0000-000000fb0003';  -- PCB ECG v2
  v_it_bat   uuid := '00000000-0000-0000-0000-000000fb0004';  -- LiPo battery

  -- Production refs (from 10-production-dev-data.sql)
  v_pr_ecg   uuid := '00000000-0000-0000-0000-000000fc0001';  -- ECG Patient Monitor v2
  v_wst_02   uuid := '00000000-0000-0000-0000-000000fc0302';  -- PCB Sub-Assembly stage template
  v_wst_08   uuid := '00000000-0000-0000-0000-000000fc0308';  -- Final QC stage template
  v_wo_001   uuid := '00000000-0000-0000-0000-000000fc0401';  -- PID-2026-0001
  v_wo_002   uuid := '00000000-0000-0000-0000-000000fc0402';  -- PID-2026-0002
  v_ws_102   uuid := '00000000-0000-0000-0000-000000fc0502';  -- WO-001 stage 2 (PCB Sub-Assembly)
  v_ws_205   uuid := '00000000-0000-0000-0000-000000fc0515';  -- WO-002 stage 5 (Electrical Testing)

  -- Inspection templates
  v_tmpl_iqc_pcb   uuid := '00000000-0000-0000-0000-000000fd0001';
  v_tmpl_iqc_bat   uuid := '00000000-0000-0000-0000-000000fd0002';
  v_tmpl_sub_pcb   uuid := '00000000-0000-0000-0000-000000fd0003';
  v_tmpl_final_ecg uuid := '00000000-0000-0000-0000-000000fd0004';

  -- Inspection parameters
  v_par_pcb_1  uuid := '00000000-0000-0000-0000-000000fd0101';
  v_par_pcb_2  uuid := '00000000-0000-0000-0000-000000fd0102';
  v_par_pcb_3  uuid := '00000000-0000-0000-0000-000000fd0103';
  v_par_pcb_4  uuid := '00000000-0000-0000-0000-000000fd0104';

  v_par_bat_1  uuid := '00000000-0000-0000-0000-000000fd0111';
  v_par_bat_2  uuid := '00000000-0000-0000-0000-000000fd0112';
  v_par_bat_3  uuid := '00000000-0000-0000-0000-000000fd0113';

  v_par_sub_1  uuid := '00000000-0000-0000-0000-000000fd0121';
  v_par_sub_2  uuid := '00000000-0000-0000-0000-000000fd0122';
  v_par_sub_3  uuid := '00000000-0000-0000-0000-000000fd0123';
  v_par_sub_4  uuid := '00000000-0000-0000-0000-000000fd0124';

  v_par_fin_1  uuid := '00000000-0000-0000-0000-000000fd0131';
  v_par_fin_2  uuid := '00000000-0000-0000-0000-000000fd0132';
  v_par_fin_3  uuid := '00000000-0000-0000-0000-000000fd0133';
  v_par_fin_4  uuid := '00000000-0000-0000-0000-000000fd0134';
  v_par_fin_5  uuid := '00000000-0000-0000-0000-000000fd0135';

  -- QC inspections
  v_insp_sub_pass uuid := '00000000-0000-0000-0000-000000fd0201';  -- PASSED SUB_QC on WO-001 stage 2
  v_insp_sub_fail uuid := '00000000-0000-0000-0000-000000fd0202';  -- FAILED SUB_QC on WO-002 stage 5
  v_insp_fin_draft uuid := '00000000-0000-0000-0000-000000fd0203'; -- DRAFT FINAL_QC prep

  -- QC findings
  v_fin_sub_pass_1 uuid := '00000000-0000-0000-0000-000000fd0301';
  v_fin_sub_pass_2 uuid := '00000000-0000-0000-0000-000000fd0302';
  v_fin_sub_pass_3 uuid := '00000000-0000-0000-0000-000000fd0303';
  v_fin_sub_pass_4 uuid := '00000000-0000-0000-0000-000000fd0304';

  v_fin_sub_fail_1 uuid := '00000000-0000-0000-0000-000000fd0311';
  v_fin_sub_fail_2 uuid := '00000000-0000-0000-0000-000000fd0312';
  v_fin_sub_fail_3 uuid := '00000000-0000-0000-0000-000000fd0313';
  v_fin_sub_fail_4 uuid := '00000000-0000-0000-0000-000000fd0314';

  -- QC cert
  v_cert_001 uuid := '00000000-0000-0000-0000-000000fd0401';
BEGIN
  -- Set RLS context.
  PERFORM set_config('app.current_org', v_org::text, true);

  -- Back-fill QC lead user if not present; we don't want the FK to fail on
  -- fresh volumes where only the baseline users from 03-dev-org-users.sql
  -- exist. SELECT first, fall back to prodmgr if missing.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_qc) THEN
    v_qc := v_prodmgr;
  END IF;

  -- ─── Inspection Templates ──────────────────────────────────────────────────
  INSERT INTO inspection_templates (
    id, org_id, code, name, kind, product_family,
    wip_stage_template_id, item_id, product_id,
    description, sampling_plan, is_active, created_by
  ) VALUES
    (v_tmpl_iqc_pcb,  v_org, 'IQC-PCB-ECG',
     'Incoming PCB (ECG) — Visual + Continuity', 'IQC', 'INSTRUMENT',
     NULL, v_it_pcb, NULL,
     'Standard IQC checklist for ECG main PCB batches',
     'AQL 1.0 — 5% sample, min 3 units per lot', true, v_prodmgr),

    (v_tmpl_iqc_bat,  v_org, 'IQC-LIPO-BATT',
     'Incoming LiPo Battery — Voltage + Capacity', 'IQC', 'INSTRUMENT',
     NULL, v_it_bat, NULL,
     'Voltage-under-load and capacity discharge test for incoming LiPo batteries',
     '100% inspection — every cell tested', true, v_prodmgr),

    (v_tmpl_sub_pcb,  v_org, 'SUB-PCB-ASM',
     'PCB Sub-Assembly In-Process QC', 'SUB_QC', 'INSTRUMENT',
     v_wst_02, NULL, NULL,
     'Mandatory QC after PCB sub-assembly stage before mechanical assembly',
     '100% inspection', true, v_prodmgr),

    (v_tmpl_final_ecg, v_org, 'FIN-ECG-MONITOR',
     'Final QC — ECG Patient Monitor', 'FINAL_QC', 'INSTRUMENT',
     v_wst_08, NULL, v_pr_ecg,
     'End-of-line final QC for ECG Patient Monitor; prerequisite for QC cert issue',
     '100% inspection', true, v_prodmgr)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Inspection Parameters ────────────────────────────────────────────────
  -- IQC PCB (4 params)
  INSERT INTO inspection_parameters (
    id, org_id, template_id, sequence_number, name, parameter_type,
    expected_value, min_value, max_value, expected_text, uom, is_critical, notes
  ) VALUES
    (v_par_pcb_1, v_org, v_tmpl_iqc_pcb, 1,
     'Visual inspection — solder bridges', 'BOOLEAN',
     NULL, NULL, NULL, 'No solder bridges or cold joints', NULL, true,
     'Use 10x magnifier'),
    (v_par_pcb_2, v_org, v_tmpl_iqc_pcb, 2,
     'Trace continuity — main rail', 'NUMERIC',
     0, 0, 2, NULL, 'ohm', true,
     '4-wire resistance measurement'),
    (v_par_pcb_3, v_org, v_tmpl_iqc_pcb, 3,
     'Component placement accuracy', 'TEXT',
     NULL, NULL, NULL, 'All components within placement tolerance', NULL, false,
     NULL),
    (v_par_pcb_4, v_org, v_tmpl_iqc_pcb, 4,
     'Board thickness', 'NUMERIC',
     1.60, 1.55, 1.65, NULL, 'mm', false,
     'Calipers at three marked points'),

    -- IQC battery (3 params)
    (v_par_bat_1, v_org, v_tmpl_iqc_bat, 1,
     'Open-circuit voltage', 'NUMERIC',
     4.20, 4.15, 4.25, NULL, 'V', true, NULL),
    (v_par_bat_2, v_org, v_tmpl_iqc_bat, 2,
     'Internal resistance', 'NUMERIC',
     45, 0, 60, NULL, 'mohm', true, NULL),
    (v_par_bat_3, v_org, v_tmpl_iqc_bat, 3,
     'Capacity test (0.2C discharge)', 'NUMERIC',
     2000, 1900, 2100, NULL, 'mAh', true,
     'Full discharge to 3.0V cutoff'),

    -- SUB PCB ASM (4 params)
    (v_par_sub_1, v_org, v_tmpl_sub_pcb, 1,
     'Solder joint AOI pass', 'BOOLEAN',
     NULL, NULL, NULL, 'Automatic optical inspection pass', NULL, true, NULL),
    (v_par_sub_2, v_org, v_tmpl_sub_pcb, 2,
     'In-circuit test (ICT) pass', 'BOOLEAN',
     NULL, NULL, NULL, 'All ICT nets verified', NULL, true, NULL),
    (v_par_sub_3, v_org, v_tmpl_sub_pcb, 3,
     'Board clean — no flux residue', 'BOOLEAN',
     NULL, NULL, NULL, 'No visible flux residue post-wash', NULL, false, NULL),
    (v_par_sub_4, v_org, v_tmpl_sub_pcb, 4,
     'Power-on current draw (idle)', 'NUMERIC',
     120, 100, 150, NULL, 'mA', false, NULL),

    -- FINAL ECG (5 params)
    (v_par_fin_1, v_org, v_tmpl_final_ecg, 1,
     'Firmware version match', 'CHECKBOX',
     NULL, NULL, NULL, 'Firmware v2.4.1 installed and verified', NULL, true, NULL),
    (v_par_fin_2, v_org, v_tmpl_final_ecg, 2,
     'ECG signal trace — 1mV calibration', 'NUMERIC',
     1.00, 0.95, 1.05, NULL, 'mV', true,
     'Simulator input 1mV @ 10mm deflection expected'),
    (v_par_fin_3, v_org, v_tmpl_final_ecg, 3,
     'Heart rate reading accuracy', 'NUMERIC',
     72, 70, 74, NULL, 'bpm', true,
     'Simulator 72 bpm; device must read 70-74'),
    (v_par_fin_4, v_org, v_tmpl_final_ecg, 4,
     'Battery life test (2h soak)', 'BOOLEAN',
     NULL, NULL, NULL, 'Device runs 2 hours continuously', NULL, true, NULL),
    (v_par_fin_5, v_org, v_tmpl_final_ecg, 5,
     'Label / serial print quality', 'CHECKBOX',
     NULL, NULL, NULL, 'Serial / CDSCO / MDR labels present and legible', NULL, false, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- ─── QC Inspections ────────────────────────────────────────────────────────
  INSERT INTO qc_inspections (
    id, org_id, inspection_number, template_id, template_code, template_name,
    kind, status, source_type, source_id, source_label,
    wip_stage_id, work_order_id, product_id,
    sample_size, inspector_id, started_at, completed_at,
    verdict, verdict_notes, notes
  ) VALUES
    -- PASSED SUB_QC on WO-001 stage 2 (PCB Sub-Assembly)
    (v_insp_sub_pass, v_org, 'QC-2026-0001',
     v_tmpl_sub_pcb, 'SUB-PCB-ASM', 'PCB Sub-Assembly In-Process QC',
     'SUB_QC', 'PASSED',
     'WIP_STAGE', v_ws_102, 'PID-2026-0001 / stage 2 (PCB Sub-Assembly)',
     v_ws_102, v_wo_001, v_pr_ecg,
     3, v_qc, '2026-04-04T06:00:00Z', '2026-04-04T08:30:00Z',
     'PASS', 'All three units passed AOI + ICT. Current draw within spec.',
     NULL),

    -- FAILED SUB_QC on WO-002 stage 5 (Electrical Testing) — triggers rework
    (v_insp_sub_fail, v_org, 'QC-2026-0002',
     v_tmpl_sub_pcb, 'SUB-PCB-ASM', 'PCB Sub-Assembly In-Process QC',
     'SUB_QC', 'FAILED',
     'WIP_STAGE', v_ws_205, 'PID-2026-0002 / stage 5 (Electrical Testing)',
     v_ws_205, v_wo_002, v_pr_ecg,
     2, v_qc, '2026-04-12T07:00:00Z', '2026-04-12T09:45:00Z',
     'FAIL', 'Unit 1 voltage regulator output 4.7V (spec 5.0V ±0.1V). Rework required.',
     'Sent back to PCB sub-assembly for voltage regulator replacement.'),

    -- DRAFT FINAL_QC on WO-001 (not yet started; WO still in progress)
    (v_insp_fin_draft, v_org, 'QC-2026-0003',
     v_tmpl_final_ecg, 'FIN-ECG-MONITOR', 'Final QC — ECG Patient Monitor',
     'FINAL_QC', 'DRAFT',
     'WO', v_wo_001, 'PID-2026-0001 (Final QC)',
     NULL, v_wo_001, v_pr_ecg,
     3, NULL, NULL, NULL,
     NULL, NULL,
     'Pre-created in DRAFT — will start once WO-001 reaches stage 8')
  ON CONFLICT (id) DO NOTHING;

  -- ─── QC Findings ───────────────────────────────────────────────────────────
  -- Findings for PASSED SUB_QC (v_insp_sub_pass)
  INSERT INTO qc_findings (
    id, org_id, inspection_id, parameter_id, sequence_number,
    parameter_name, parameter_type, expected_value, min_value, max_value,
    expected_text, uom, is_critical,
    actual_value, actual_numeric, actual_boolean, result, inspector_notes
  ) VALUES
    (v_fin_sub_pass_1, v_org, v_insp_sub_pass, v_par_sub_1, 1,
     'Solder joint AOI pass', 'BOOLEAN',
     NULL, NULL, NULL, 'Automatic optical inspection pass', NULL, true,
     'true', NULL, true, 'PASS', NULL),
    (v_fin_sub_pass_2, v_org, v_insp_sub_pass, v_par_sub_2, 2,
     'In-circuit test (ICT) pass', 'BOOLEAN',
     NULL, NULL, NULL, 'All ICT nets verified', NULL, true,
     'true', NULL, true, 'PASS', NULL),
    (v_fin_sub_pass_3, v_org, v_insp_sub_pass, v_par_sub_3, 3,
     'Board clean — no flux residue', 'BOOLEAN',
     NULL, NULL, NULL, 'No visible flux residue post-wash', NULL, false,
     'true', NULL, true, 'PASS', NULL),
    (v_fin_sub_pass_4, v_org, v_insp_sub_pass, v_par_sub_4, 4,
     'Power-on current draw (idle)', 'NUMERIC',
     120, 100, 150, NULL, 'mA', false,
     '118', 118, NULL, 'PASS', 'Measured on all 3 units, avg 118 mA'),

    -- Findings for FAILED SUB_QC (v_insp_sub_fail)
    (v_fin_sub_fail_1, v_org, v_insp_sub_fail, v_par_sub_1, 1,
     'Solder joint AOI pass', 'BOOLEAN',
     NULL, NULL, NULL, 'Automatic optical inspection pass', NULL, true,
     'true', NULL, true, 'PASS', NULL),
    (v_fin_sub_fail_2, v_org, v_insp_sub_fail, v_par_sub_2, 2,
     'In-circuit test (ICT) pass', 'BOOLEAN',
     NULL, NULL, NULL, 'All ICT nets verified', NULL, true,
     'false', NULL, false, 'FAIL',
     'Unit 1 ICT net 42 (VREG_OUT) reads 4.7V, expected 5.0V'),
    (v_fin_sub_fail_3, v_org, v_insp_sub_fail, v_par_sub_3, 3,
     'Board clean — no flux residue', 'BOOLEAN',
     NULL, NULL, NULL, 'No visible flux residue post-wash', NULL, false,
     'true', NULL, true, 'PASS', NULL),
    (v_fin_sub_fail_4, v_org, v_insp_sub_fail, v_par_sub_4, 4,
     'Power-on current draw (idle)', 'NUMERIC',
     120, 100, 150, NULL, 'mA', false,
     '135', 135, NULL, 'PASS', 'Unit 1 slightly high but within spec')
  ON CONFLICT (id) DO NOTHING;

  -- ─── QC Certificates ──────────────────────────────────────────────────────
  -- One historical cert to demonstrate the shape (would belong to a completed
  -- WO; we use WO-001 as the stand-in since no WO is truly COMPLETED in the
  -- production seed).
  INSERT INTO qc_certs (
    id, org_id, cert_number, inspection_id,
    work_order_id, product_id, product_name, wo_pid,
    device_serials, issued_at, signed_by, signed_by_name,
    signature_hash, notes
  ) VALUES
    (v_cert_001, v_org, 'QCC-2026-0001', v_insp_sub_pass,
     v_wo_001, v_pr_ecg, 'ECG Patient Monitor v2', 'PID-2026-0001',
     ARRAY['ECG-2026-0001', 'ECG-2026-0002', 'ECG-2026-0003'],
     '2026-04-04T09:00:00Z', v_qc, 'QC Lead (dev seed)',
     'sha256:dev-seed-signature-placeholder',
     'Dev seed cert — issued against PASSED SUB_QC for demo purposes')
  ON CONFLICT (id) DO NOTHING;

  -- Bump QC sequence so next manual create starts at 0004/0002.
  INSERT INTO qc_number_sequences (org_id, kind, year, last_seq)
    VALUES (v_org, 'QC', 2026, 3)
  ON CONFLICT (org_id, kind, year) DO UPDATE SET last_seq = 3;

  INSERT INTO qc_number_sequences (org_id, kind, year, last_seq)
    VALUES (v_org, 'QCC', 2026, 1)
  ON CONFLICT (org_id, kind, year) DO UPDATE SET last_seq = 1;
END $$;
