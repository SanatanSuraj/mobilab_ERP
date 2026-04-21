-- Dev-only inventory seed. Mirrors ARCHITECTURE.md §13.3 sample data so a
-- fresh `pnpm infra:up && pnpm db:migrate` boot has stock to click on.
--
-- Rules (same as 04-crm-dev-data.sql):
--   * All IDs are stable deterministic UUIDs so re-running the seed is idempotent.
--   * All rows belong to the same Dev org seeded in 03-dev-org-users.sql.
--   * No audit actor set here — the audit trigger tolerates NULL.
--   * Kept in seed/ so prod migrations never run it (Gate 7).
--
-- UUID fixture conventions (hex-only):
--   fa00x  — warehouses
--   fb00x  — items
--   fc00x  — item_warehouse_bindings
--   fd0xx  — stock_ledger rows
--
-- Note: stock_summary rows are created automatically by the
-- tg_stock_summary_from_ledger trigger on every ledger INSERT — we never
-- touch stock_summary directly here.

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';
  v_stores   uuid := '00000000-0000-0000-0000-00000000b00b'; -- Stores
  v_qcmgr    uuid := '00000000-0000-0000-0000-00000000b00a'; -- QC Manager
  v_prodmgr  uuid := '00000000-0000-0000-0000-00000000b007'; -- Production Manager

  -- Warehouses
  v_wh_main  uuid := '00000000-0000-0000-0000-000000fa0001';
  v_wh_qa    uuid := '00000000-0000-0000-0000-000000fa0002';

  -- Items
  v_it_res   uuid := '00000000-0000-0000-0000-000000fb0001'; -- Resistor 1k
  v_it_cap   uuid := '00000000-0000-0000-0000-000000fb0002'; -- Cap 10uF
  v_it_pcb   uuid := '00000000-0000-0000-0000-000000fb0003'; -- PCB ECG v2
  v_it_bat   uuid := '00000000-0000-0000-0000-000000fb0004'; -- LiPo battery
  v_it_lcd   uuid := '00000000-0000-0000-0000-000000fb0005'; -- LCD 3"
  v_it_wire  uuid := '00000000-0000-0000-0000-000000fb0006'; -- Silicone wire
  v_it_psu   uuid := '00000000-0000-0000-0000-000000fb0007'; -- PSU subassembly
  v_it_ecg   uuid := '00000000-0000-0000-0000-000000fb0008'; -- ECG monitor
  v_it_spir  uuid := '00000000-0000-0000-0000-000000fb0009'; -- Spirometer
  v_it_box   uuid := '00000000-0000-0000-0000-000000fb000a'; -- Shipping box
  v_it_glv   uuid := '00000000-0000-0000-0000-000000fb000b'; -- Latex gloves
  v_it_fuse  uuid := '00000000-0000-0000-0000-000000fb000c'; -- Fuse 5A
BEGIN
  -- Set RLS context so the inserts below pass the tenant policies.
  PERFORM set_config('app.current_org', v_org::text, true);

  -- ─── Warehouses ─────────────────────────────────────────────────────────
  INSERT INTO warehouses (
    id, org_id, code, name, kind, address, city, state, country, postal_code,
    is_default, is_active, manager_id
  ) VALUES
    (v_wh_main, v_org, 'WH-001', 'Main Plant Store',   'PRIMARY',
     'Plot 42, Electronics Park', 'Bengaluru', 'KA', 'IN', '560100',
     true,  true, v_stores),
    (v_wh_qa,   v_org, 'WH-002', 'Quarantine Bay',     'QUARANTINE',
     'Plot 42, Electronics Park (QC Bay)', 'Bengaluru', 'KA', 'IN', '560100',
     false, true, v_qcmgr)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Items ──────────────────────────────────────────────────────────────
  INSERT INTO items (
    id, org_id, sku, name, description, category, uom, hsn_code, unit_cost,
    default_warehouse_id, is_serialised, is_batched, shelf_life_days
  ) VALUES
    (v_it_res,  v_org, 'RES-1K',        'Resistor 1kΩ 1/4W',          'Carbon film resistor, 5% tolerance', 'RAW_MATERIAL',  'EA',   '8533',  '0.50',     v_wh_main, false, false, NULL),
    (v_it_cap,  v_org, 'CAP-10UF',      'Capacitor 10µF Electrolytic','16V radial electrolytic',            'RAW_MATERIAL',  'EA',   '8532',  '2.50',     v_wh_main, false, true,  1825),
    (v_it_pcb,  v_org, 'PCB-ECG-V2',    'PCB ECG Main Board v2',      '4-layer PCB, FR4, 2oz copper',       'SUB_ASSEMBLY',  'EA',   '8534',  '850.00',   v_wh_main, false, true,  NULL),
    (v_it_bat,  v_org, 'BAT-LIPO-3.7',  'LiPo Battery 3.7V 2000mAh',  'Single-cell LiPo with PCM',          'RAW_MATERIAL',  'EA',   '8507',  '320.00',   v_wh_main, false, true,  730),
    (v_it_lcd,  v_org, 'LCD-3IN-TFT',   'LCD Display 3" TFT 320x240', 'SPI interface, backlight included',  'RAW_MATERIAL',  'EA',   '8531',  '680.00',   v_wh_main, false, false, NULL),
    (v_it_wire, v_org, 'WIRE-SILI-22',  'Silicone wire 22AWG',        'Medical-grade silicone jacket',      'RAW_MATERIAL',  'M',    '8544',  '18.00',    v_wh_main, false, false, NULL),
    (v_it_psu,  v_org, 'PSU-SA-12V',    'Power subassembly 12V',      'In-house built PSU for ECG-MONITOR', 'SUB_ASSEMBLY',  'EA',   '8504',  '1250.00',  v_wh_main, false, false, NULL),
    (v_it_ecg,  v_org, 'ECG-MONITOR-V2','ECG Patient Monitor v2',     'Final finished device, CDSCO cleared','FINISHED_GOOD','EA',   '9018',  '24500.00', v_wh_main, true,  false, NULL),
    (v_it_spir, v_org, 'SPIROMETER-C1', 'Digital Spirometer C1',      'Handheld clinical spirometer',       'FINISHED_GOOD', 'EA',   '9018',  '18900.00', v_wh_main, true,  false, NULL),
    (v_it_box,  v_org, 'BOX-S-CORR',    'Corrugated box small',       '300x200x150mm 5-ply',                'PACKAGING',     'EA',   '4819',  '22.00',    v_wh_main, false, false, NULL),
    (v_it_glv,  v_org, 'GLV-LTX-M',     'Latex exam gloves M',        'Powder-free, medical grade',         'CONSUMABLE',    'PAIR', '4015',  '12.00',    v_wh_main, false, true,  1095),
    (v_it_fuse, v_org, 'FUSE-5A-GL',    'Fuse 5A glass-tube',         '5x20mm glass tube fuse',             'SPARE_PART',    'EA',   '8536',  '8.50',     v_wh_main, false, false, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Item-warehouse bindings (reorder thresholds) ───────────────────────
  INSERT INTO item_warehouse_bindings (
    id, org_id, item_id, warehouse_id, reorder_level, reorder_qty, max_level, bin_location
  ) VALUES
    ('00000000-0000-0000-0000-000000fc0001', v_org, v_it_res,  v_wh_main, '500.000',  '1000.000', '5000.000', 'A-01-01'),
    ('00000000-0000-0000-0000-000000fc0002', v_org, v_it_cap,  v_wh_main, '200.000',  '500.000',  '3000.000', 'A-01-02'),
    ('00000000-0000-0000-0000-000000fc0003', v_org, v_it_pcb,  v_wh_main, '20.000',   '50.000',   '200.000',  'B-02-01'),
    ('00000000-0000-0000-0000-000000fc0004', v_org, v_it_pcb,  v_wh_qa,   '0.000',    '0.000',    NULL,       'QA-01'),
    ('00000000-0000-0000-0000-000000fc0005', v_org, v_it_bat,  v_wh_main, '30.000',   '100.000',  '400.000',  'B-03-01'),
    ('00000000-0000-0000-0000-000000fc0006', v_org, v_it_lcd,  v_wh_main, '25.000',   '50.000',   '200.000',  'B-04-01'),
    ('00000000-0000-0000-0000-000000fc0007', v_org, v_it_wire, v_wh_main, '100.000',  '500.000',  '2000.000', 'C-01-01'),
    ('00000000-0000-0000-0000-000000fc0008', v_org, v_it_psu,  v_wh_main, '15.000',   '30.000',   '100.000',  'B-05-01'),
    ('00000000-0000-0000-0000-000000fc0009', v_org, v_it_ecg,  v_wh_main, '5.000',    '20.000',   '80.000',   'D-01-01'),
    ('00000000-0000-0000-0000-000000fc000a', v_org, v_it_spir, v_wh_main, '5.000',    '10.000',   '40.000',   'D-02-01'),
    ('00000000-0000-0000-0000-000000fc000b', v_org, v_it_box,  v_wh_main, '100.000',  '300.000',  '1000.000', 'E-01-01'),
    ('00000000-0000-0000-0000-000000fc000c', v_org, v_it_glv,  v_wh_main, '50.000',   '200.000',  '800.000',  'E-02-01'),
    ('00000000-0000-0000-0000-000000fc000d', v_org, v_it_fuse, v_wh_main, '100.000',  '200.000',  '800.000',  'A-01-03')
  ON CONFLICT (org_id, item_id, warehouse_id) DO NOTHING;

  -- ─── Stock ledger entries ───────────────────────────────────────────────
  -- Opening balances first; the tg_stock_summary_from_ledger trigger will
  -- UPSERT the stock_summary projection for each insert. Then a couple of
  -- GRN receipts to show ongoing activity, and a small ADJUSTMENT. One
  -- item (resistors) is kept below its reorder_level to exercise the
  -- low-stock report (OPENING_BALANCE 400 vs reorder_level 500).

  -- Opening balances.
  INSERT INTO stock_ledger (
    id, org_id, item_id, warehouse_id, quantity, uom, txn_type, ref_doc_type,
    ref_doc_id, batch_no, unit_cost, posted_by, posted_at, reason
  ) VALUES
    ('00000000-0000-0000-0000-000000fd0001', v_org, v_it_res,  v_wh_main, '400.000',  'EA',   'OPENING_BALANCE', 'OPENING', NULL, NULL,            '0.50',     v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0002', v_org, v_it_cap,  v_wh_main, '1200.000', 'EA',   'OPENING_BALANCE', 'OPENING', NULL, 'BATCH-CAP-001', '2.50',     v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0003', v_org, v_it_pcb,  v_wh_main, '75.000',   'EA',   'OPENING_BALANCE', 'OPENING', NULL, 'BATCH-PCB-101', '850.00',   v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0004', v_org, v_it_bat,  v_wh_main, '140.000',  'EA',   'OPENING_BALANCE', 'OPENING', NULL, 'BATCH-BAT-023', '320.00',   v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0005', v_org, v_it_lcd,  v_wh_main, '60.000',   'EA',   'OPENING_BALANCE', 'OPENING', NULL, NULL,            '680.00',   v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0006', v_org, v_it_wire, v_wh_main, '850.000',  'M',    'OPENING_BALANCE', 'OPENING', NULL, NULL,            '18.00',    v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0007', v_org, v_it_psu,  v_wh_main, '40.000',   'EA',   'OPENING_BALANCE', 'OPENING', NULL, NULL,            '1250.00',  v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0008', v_org, v_it_ecg,  v_wh_main, '18.000',   'EA',   'OPENING_BALANCE', 'OPENING', NULL, NULL,            '24500.00', v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd0009', v_org, v_it_spir, v_wh_main, '12.000',   'EA',   'OPENING_BALANCE', 'OPENING', NULL, NULL,            '18900.00', v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd000a', v_org, v_it_box,  v_wh_main, '550.000',  'EA',   'OPENING_BALANCE', 'OPENING', NULL, NULL,            '22.00',    v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd000b', v_org, v_it_glv,  v_wh_main, '300.000',  'PAIR', 'OPENING_BALANCE', 'OPENING', NULL, 'BATCH-GLV-007', '12.00',    v_stores, now() - interval '14 days', 'Opening balance FY boot'),
    ('00000000-0000-0000-0000-000000fd000c', v_org, v_it_fuse, v_wh_main, '220.000',  'EA',   'OPENING_BALANCE', 'OPENING', NULL, NULL,            '8.50',     v_stores, now() - interval '14 days', 'Opening balance FY boot')
  ON CONFLICT (id) DO NOTHING;

  -- Some incoming GRN receipts (pretend Phase 2 procurement already ran).
  INSERT INTO stock_ledger (
    id, org_id, item_id, warehouse_id, quantity, uom, txn_type, ref_doc_type,
    ref_doc_id, batch_no, unit_cost, posted_by, posted_at, reason
  ) VALUES
    ('00000000-0000-0000-0000-000000fd0010', v_org, v_it_cap,  v_wh_main, '500.000',  'EA',   'GRN_RECEIPT',     'GRN',     NULL, 'BATCH-CAP-002', '2.55',     v_stores, now() - interval '7 days',  'GRN from Electronica Supplies'),
    ('00000000-0000-0000-0000-000000fd0011', v_org, v_it_pcb,  v_wh_qa,   '40.000',   'EA',   'GRN_RECEIPT',     'GRN',     NULL, 'BATCH-PCB-102', '870.00',   v_stores, now() - interval '5 days',  'GRN from Hyderabad PCB — pending QC'),
    ('00000000-0000-0000-0000-000000fd0012', v_org, v_it_bat,  v_wh_main, '80.000',   'EA',   'GRN_RECEIPT',     'GRN',     NULL, 'BATCH-BAT-024', '325.00',   v_stores, now() - interval '3 days',  'GRN from Apex Cells'),
    ('00000000-0000-0000-0000-000000fd0013', v_org, v_it_lcd,  v_wh_main, '30.000',   'EA',   'GRN_RECEIPT',     'GRN',     NULL, NULL,            '680.00',   v_stores, now() - interval '2 days',  'GRN from Shenzhen Displays')
  ON CONFLICT (id) DO NOTHING;

  -- One adjustment to show negative-signed movements work (stock count
  -- found a shortage on gloves).
  INSERT INTO stock_ledger (
    id, org_id, item_id, warehouse_id, quantity, uom, txn_type, ref_doc_type,
    ref_doc_id, unit_cost, posted_by, posted_at, reason
  ) VALUES
    ('00000000-0000-0000-0000-000000fd0020', v_org, v_it_glv,  v_wh_main, '-6.000',   'PAIR', 'ADJUSTMENT',      'ADJUSTMENT', NULL, '12.00', v_qcmgr,    now() - interval '1 day',   'Cycle count variance — 6 pairs short'),
    ('00000000-0000-0000-0000-000000fd0021', v_org, v_it_fuse, v_wh_main, '-2.000',   'EA',   'SCRAP',           'SCRAP',      NULL, '8.50',  v_prodmgr,  now() - interval '1 day',   'Dropped on concrete — scrapped')
  ON CONFLICT (id) DO NOTHING;
END $$;
