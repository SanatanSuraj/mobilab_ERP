-- Phase 5 — Mobicase device_instances seed.
--
-- Mirrors apps/web/src/data/instigenie-mock.ts mobiDeviceIDs (dev-001..dev-010)
-- so the live /production/device-instances API returns the same 10 records the
-- UI previously rendered from the mock. Also seeds the one catalog-level
-- Mobicase device (MCC-MOBICASE, family=DEVICE) — MBA/MBM/MBC/CFG are modules
-- of the MCC and are tracked on device_instances, not in the products catalog.
--
-- UUID fixture conventions (extends 10-production-dev-data.sql):
--   fc0004     — MCC Mobicase product row (family=DEVICE)
--   fc06xx     — device_instances rows (one per mobiDeviceIDs entry)

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';

  -- Catalog row (the finished Mobicase)
  v_pr_mcc   uuid := '00000000-0000-0000-0000-000000fc0004';

  -- Device instances (10 rows from the mock)
  v_di_001   uuid := '00000000-0000-0000-0000-000000fc0601'; -- MBA-2026-04-0001-0
  v_di_002   uuid := '00000000-0000-0000-0000-000000fc0602'; -- MBA-2026-04-0002-0
  v_di_003   uuid := '00000000-0000-0000-0000-000000fc0603'; -- MBA-2026-04-0003-0
  v_di_004   uuid := '00000000-0000-0000-0000-000000fc0604'; -- MBM-2026-04-0001-0
  v_di_005   uuid := '00000000-0000-0000-0000-000000fc0605'; -- MBM-2026-04-0002-0
  v_di_006   uuid := '00000000-0000-0000-0000-000000fc0606'; -- MBC-2026-04-0001-0
  v_di_007   uuid := '00000000-0000-0000-0000-000000fc0607'; -- MBA-2026-04-0201-1
  v_di_008   uuid := '00000000-0000-0000-0000-000000fc0608'; -- MBA-2026-04-0202-0
  v_di_009   uuid := '00000000-0000-0000-0000-000000fc0609'; -- MCC-2026-03-0091-0
  v_di_010   uuid := '00000000-0000-0000-0000-000000fc0610'; -- MBA-2026-03-0035-0
BEGIN
  PERFORM set_config('app.current_org', v_org::text, true);

  -- ─── MCC Mobicase catalog entry ───────────────────────────────────────────
  -- The Mobicase is the saleable finished device. Analyser/Mixer/Incubator
  -- assemblies live inside it; centrifuge is vendor-supplied. Rework limit 3
  -- matches max_rework_limit on the mock device records.
  INSERT INTO products (
    id, org_id, product_code, name, family, description, uom,
    standard_cycle_days, has_serial_tracking, rework_limit, is_active
  ) VALUES
    (v_pr_mcc, v_org, 'MCC-MOBICASE',
     'Mobicase Diagnostic Suite',
     'DEVICE',
     'Finished Mobicase: Analyser (MBA) + Mixer (MBM) + Incubator (MBC) + vendor Centrifuge (CFG) + micropipette accessory. ISO 13485 / 21 CFR Part 11 / IEC 62304 compliant.',
     'PCS',
     25, true, 3, true)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Device Instances ─────────────────────────────────────────────────────
  -- WO-2026-04-001 (April batch, IN_PROGRESS) ────────────────────────────────
  INSERT INTO device_instances (
    id, org_id, device_code, product_code, work_order_ref, status,
    rework_count, max_rework_limit, assigned_line,
    pcb_id, sensor_id, detector_id, machine_id,
    cfg_vendor_id, cfg_serial_no,
    analyzer_pcb_id, analyzer_sensor_id, analyzer_detector_id,
    mixer_machine_id, mixer_pcb_id, incubator_pcb_id,
    micropipette_id, centrifuge_id,
    finished_goods_ref, invoice_ref, delivery_challan_ref, sales_order_ref,
    dispatched_at, scrapped_at, scrapped_reason,
    created_at
  ) VALUES
    (v_di_001, v_org, 'MBA-2026-04-0001-0', 'MBA', 'WO-2026-04-001',
     'IN_PRODUCTION', 0, 3, 'L2',
     'PCB-MBA-2604-0001', 'SNS-MBA-2604-0001', 'DET-MBA-2604-0001', NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-03T08:00:00Z'),

    (v_di_002, v_org, 'MBA-2026-04-0002-0', 'MBA', 'WO-2026-04-001',
     'IN_PRODUCTION', 0, 3, 'L2',
     'PCB-MBA-2604-0002', 'SNS-MBA-2604-0002', 'DET-MBA-2604-0002', NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-03T08:00:00Z'),

    (v_di_003, v_org, 'MBA-2026-04-0003-0', 'MBA', 'WO-2026-04-001',
     'SUB_QC_PASS', 0, 3, 'L2',
     'PCB-MBA-2604-0003', 'SNS-MBA-2604-0003', 'DET-MBA-2604-0003', NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     'MP-2026-0003', 'CFG-2026-0003',
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-03T08:00:00Z'),

    (v_di_004, v_org, 'MBM-2026-04-0001-0', 'MBM', 'WO-2026-04-001',
     'SUB_QC_PASS', 0, 3, 'L1',
     'PCB-MBM-2604-0001', NULL, NULL, 'MCH-MBM-2604-0001',
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-03T08:00:00Z'),

    (v_di_005, v_org, 'MBM-2026-04-0002-0', 'MBM', 'WO-2026-04-001',
     'SUB_QC_PASS', 0, 3, 'L1',
     'PCB-MBM-2604-0002', NULL, NULL, 'MCH-MBM-2604-0002',
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-03T08:00:00Z'),

    (v_di_006, v_org, 'MBC-2026-04-0001-0', 'MBC', 'WO-2026-04-001',
     'SUB_QC_PASS', 0, 3, 'L3',
     'PCB-MBC-2604-0001', NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-03T08:00:00Z'),

  -- WO-2026-04-002 (April batch, partial issues) ─────────────────────────────
    (v_di_007, v_org, 'MBA-2026-04-0201-1', 'MBA', 'WO-2026-04-002',
     'IN_REWORK', 1, 3, 'L2',
     'PCB-MBA-2604-0201', 'SNS-MBA-2604-0201', 'DET-MBA-2604-0201', NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-04T08:00:00Z'),

    (v_di_008, v_org, 'MBA-2026-04-0202-0', 'MBA', 'WO-2026-04-002',
     'SUB_QC_FAIL', 0, 3, 'L2',
     'PCB-MBA-2604-0202', 'SNS-MBA-2604-0202', 'DET-MBA-2604-0202', NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     '2026-04-04T08:00:00Z'),

  -- WO-2026-03-004 (March dispatched MCC — full roll-up) ─────────────────────
    (v_di_009, v_org, 'MCC-2026-03-0091-0', 'MCC', 'WO-2026-03-004',
     'DISPATCHED', 0, 3, 'L4',
     NULL, NULL, NULL, NULL,
     'OMRON-CFG-20260301-0044', 'OMR-SN-20260301-0044',
     'PCB-MBA-2603-0091', 'SNS-MBA-2603-0091', 'DET-MBA-2603-0091',
     'MCH-MBM-2603-0091', 'PCB-MBM-2603-0091', 'PCB-MBC-2603-0091',
     'MP-2026-0091', NULL,
     'FG-2026-0091', 'MBL/24-25/0028', 'DC-2026-0028', 'SO-2026-008',
     '2026-03-28T10:00:00Z', NULL, NULL,
     '2026-03-07T08:00:00Z'),

  -- WO-2026-03-003 (scrapped unit — rework limit exceeded) ───────────────────
    (v_di_010, v_org, 'MBA-2026-03-0035-0', 'MBA', 'WO-2026-03-003',
     'SCRAPPED', 3, 3, 'L2',
     'PCB-MBA-2603-0035', 'SNS-MBA-2603-0035', 'DET-MBA-2603-0035', NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL,
     NULL, NULL, NULL, NULL, NULL,
     '2026-03-22T10:00:00Z',
     'REWORK_LIMIT_EXCEEDED — OC Assembly defect persisted after 3 rework attempts',
     '2026-03-10T08:00:00Z')
  ON CONFLICT (id) DO NOTHING;
END $$;
