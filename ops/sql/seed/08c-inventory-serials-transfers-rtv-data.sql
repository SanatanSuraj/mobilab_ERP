-- Dev-only seed for serials, transfers, and RTV demo data.
--
-- Adds three sets of stock_ledger rows so the existing /inventory/serials,
-- /inventory/transfers, and /procurement/returns pages have real signal:
--
--   1. CUSTOMER_ISSUE rows with serial_no for FG dispatches (ECG, Spirometer)
--   2. TRANSFER_OUT/TRANSFER_IN paired rows for stock moves between WHs
--   3. RTV_OUT rows for vendor returns
--
-- Idempotent: stable UUIDs + ON CONFLICT DO NOTHING.
--
-- UUID fixture conventions:
--   fd0201..fd020n — serial dispatches
--   fd0301..fd030n — transfer pairs (out + in share parent ref_doc_id)
--   fd0401..fd040n — RTV outflows

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';
  v_stores   uuid := '00000000-0000-0000-0000-00000000b00b';

  -- Items
  v_it_ecg   uuid := '00000000-0000-0000-0000-000000fb0008'; -- ECG (serialised)
  v_it_spir  uuid := '00000000-0000-0000-0000-000000fb0009'; -- Spirometer (serialised)
  v_it_pcb   uuid := '00000000-0000-0000-0000-000000fb0003'; -- PCB ECG v2 (RTV)
  v_it_psu   uuid := '00000000-0000-0000-0000-000000fb0007'; -- PSU subassembly
  v_it_res   uuid := '00000000-0000-0000-0000-000000fb0001'; -- Resistor 1k

  -- Warehouses
  v_wh_main  uuid := '00000000-0000-0000-0000-000000fa0001'; -- Main Plant Store
  v_wh_quar  uuid := '00000000-0000-0000-0000-000000fa0002'; -- Quarantine Bay
  v_wh_g33   uuid := '00000000-0000-0000-0000-000000fa3301'; -- Gate-33 Load
  v_wh_g35   uuid := '00000000-0000-0000-0000-000000fa3501'; -- Gate-35 MRP

  -- Vendors (used as ref_doc_id for RTV)
  v_v_elcon  uuid := '00000000-0000-0000-0000-000000fe0001';
  v_v_silic  uuid := '00000000-0000-0000-0000-000000fe0002';
  v_v_led    uuid := '00000000-0000-0000-0000-000000fe0003';

  -- Synthetic transfer doc IDs (paired OUT/IN share these)
  v_tx_doc1  uuid := '00000000-0000-0000-0000-0000000fd301';
  v_tx_doc2  uuid := '00000000-0000-0000-0000-0000000fd302';
  v_tx_doc3  uuid := '00000000-0000-0000-0000-0000000fd303';
  v_tx_doc4  uuid := '00000000-0000-0000-0000-0000000fd304';
BEGIN
  PERFORM set_config('app.current_org', v_org::text, true);

  -- ============================================================
  -- 1. SERIALISED FG DISPATCHES (CUSTOMER_ISSUE with serial_no)
  -- ============================================================
  INSERT INTO stock_ledger (
    id, org_id, item_id, warehouse_id, quantity, uom, txn_type,
    ref_doc_type, ref_doc_id, serial_no, unit_cost, posted_by, posted_at, reason
  ) VALUES
    ('00000000-0000-0000-0000-000000fd0201', v_org, v_it_ecg,  v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'ECG-2026-0001', '24500.00', v_stores, now() - interval '6 days',  'Dispatch to Apollo Hospital'),
    ('00000000-0000-0000-0000-000000fd0202', v_org, v_it_ecg,  v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'ECG-2026-0002', '24500.00', v_stores, now() - interval '5 days',  'Dispatch to Apollo Hospital'),
    ('00000000-0000-0000-0000-000000fd0203', v_org, v_it_ecg,  v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'ECG-2026-0003', '24500.00', v_stores, now() - interval '4 days',  'Dispatch to Fortis Bangalore'),
    ('00000000-0000-0000-0000-000000fd0204', v_org, v_it_ecg,  v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'ECG-2026-0004', '24500.00', v_stores, now() - interval '3 days',  'Dispatch to Fortis Bangalore'),
    ('00000000-0000-0000-0000-000000fd0205', v_org, v_it_spir, v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'SPR-2026-0001', '18900.00', v_stores, now() - interval '5 days',  'Dispatch to Manipal Hospitals'),
    ('00000000-0000-0000-0000-000000fd0206', v_org, v_it_spir, v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'SPR-2026-0002', '18900.00', v_stores, now() - interval '4 days',  'Dispatch to Manipal Hospitals'),
    ('00000000-0000-0000-0000-000000fd0207', v_org, v_it_spir, v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'SPR-2026-0003', '18900.00', v_stores, now() - interval '2 days',  'Dispatch to AIIMS Delhi'),
    ('00000000-0000-0000-0000-000000fd0208', v_org, v_it_spir, v_wh_main, '-1.000', 'EA', 'CUSTOMER_ISSUE', 'SI', NULL, 'SPR-2026-0004', '18900.00', v_stores, now() - interval '1 day',   'Dispatch to AIIMS Delhi')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 2. INTER-WAREHOUSE TRANSFERS (paired OUT + IN by ref_doc_id)
  -- ============================================================
  -- Move PCB ECG: Main → Gate-33 (50 units)
  INSERT INTO stock_ledger (
    id, org_id, item_id, warehouse_id, quantity, uom, txn_type,
    ref_doc_type, ref_doc_id, unit_cost, posted_by, posted_at, reason
  ) VALUES
    ('00000000-0000-0000-0000-000000fd0301', v_org, v_it_pcb, v_wh_main, '-50.000', 'EA', 'TRANSFER_OUT', 'STOCK_TRANSFER', v_tx_doc1, '850.00',  v_stores, now() - interval '3 days',  'Transfer to Gate-33 for staging'),
    ('00000000-0000-0000-0000-000000fd0302', v_org, v_it_pcb, v_wh_g33,  '50.000',  'EA', 'TRANSFER_IN',  'STOCK_TRANSFER', v_tx_doc1, '850.00',  v_stores, now() - interval '3 days',  'Receive from Main'),

    -- Move Resistor 1k: Main → Gate-35 (1500 units)
    ('00000000-0000-0000-0000-000000fd0303', v_org, v_it_res, v_wh_main, '-1500.000', 'EA', 'TRANSFER_OUT', 'STOCK_TRANSFER', v_tx_doc2, '0.50',  v_stores, now() - interval '2 days',  'Transfer to Gate-35'),
    ('00000000-0000-0000-0000-000000fd0304', v_org, v_it_res, v_wh_g35,  '1500.000',  'EA', 'TRANSFER_IN',  'STOCK_TRANSFER', v_tx_doc2, '0.50',  v_stores, now() - interval '2 days',  'Receive from Main'),

    -- Move PSU subassembly: Gate-33 → Main (10 units)
    ('00000000-0000-0000-0000-000000fd0305', v_org, v_it_psu, v_wh_g33,  '-10.000', 'EA', 'TRANSFER_OUT', 'STOCK_TRANSFER', v_tx_doc3, '1250.00', v_stores, now() - interval '1 day',   'Return staged PSUs to Main'),
    ('00000000-0000-0000-0000-000000fd0306', v_org, v_it_psu, v_wh_main, '10.000',  'EA', 'TRANSFER_IN',  'STOCK_TRANSFER', v_tx_doc3, '1250.00', v_stores, now() - interval '1 day',   'Receive PSUs from Gate-33'),

    -- Move Resistor 1k: Gate-35 → Quarantine (200 units, dispute)
    ('00000000-0000-0000-0000-000000fd0307', v_org, v_it_res, v_wh_g35,  '-200.000', 'EA', 'TRANSFER_OUT', 'STOCK_TRANSFER', v_tx_doc4, '0.50',   v_stores, now() - interval '6 hours', 'Quarantine batch G38 — pending recheck'),
    ('00000000-0000-0000-0000-000000fd0308', v_org, v_it_res, v_wh_quar, '200.000',  'EA', 'TRANSFER_IN',  'STOCK_TRANSFER', v_tx_doc4, '0.50',   v_stores, now() - interval '6 hours', 'Quarantine batch G38 received')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 3. RTV — RETURN TO VENDOR (RTV_OUT, ref_doc_id = vendor_id)
  -- ============================================================
  INSERT INTO stock_ledger (
    id, org_id, item_id, warehouse_id, quantity, uom, txn_type,
    ref_doc_type, ref_doc_id, unit_cost, posted_by, posted_at, reason
  ) VALUES
    ('00000000-0000-0000-0000-000000fd0401', v_org, v_it_pcb, v_wh_quar, '-5.000',   'EA', 'RTV_OUT', 'VENDOR', v_v_silic, '850.00', v_stores, now() - interval '7 days',  'RTV: solder mask defect, batch B-411'),
    ('00000000-0000-0000-0000-000000fd0402', v_org, v_it_psu, v_wh_quar, '-2.000',   'EA', 'RTV_OUT', 'VENDOR', v_v_elcon, '1250.00', v_stores, now() - interval '5 days', 'RTV: voltage out of spec'),
    ('00000000-0000-0000-0000-000000fd0403', v_org, v_it_res, v_wh_quar, '-300.000', 'EA', 'RTV_OUT', 'VENDOR', v_v_elcon, '0.50',  v_stores, now() - interval '4 days',  'RTV: tolerance failure on QC'),
    ('00000000-0000-0000-0000-000000fd0404', v_org, v_it_pcb, v_wh_quar, '-3.000',   'EA', 'RTV_OUT', 'VENDOR', v_v_led,   '850.00', v_stores, now() - interval '2 days',  'RTV: incorrect silkscreen revision')
  ON CONFLICT (id) DO NOTHING;

END $$;
