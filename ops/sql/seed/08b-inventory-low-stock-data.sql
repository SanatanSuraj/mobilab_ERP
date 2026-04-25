-- Dev-only inventory low-stock seed.
--
-- 08-inventory-dev-data.sql sets up healthy stock levels. This file posts
-- ADJUSTMENT ledger rows to push a handful of items below their
-- reorder_level so the /inventory/reorder page has real low-stock data
-- to render. Idempotent via stable UUIDs + ON CONFLICT DO NOTHING.
--
-- UUID fixture conventions:
--   fd1xx — adjustment rows (continuation of fd0xx in the parent seed)

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';
  v_stores   uuid := '00000000-0000-0000-0000-00000000b00b'; -- Stores

  -- Items (must match 08-inventory-dev-data.sql fixtures)
  v_it_res   uuid := '00000000-0000-0000-0000-000000fb0001'; -- Resistor 1k     (reorder 500)
  v_it_cap   uuid := '00000000-0000-0000-0000-000000fb0002'; -- Cap 10uF        (reorder 200)
  v_it_pcb   uuid := '00000000-0000-0000-0000-000000fb0003'; -- PCB ECG v2      (reorder 20)
  v_it_psu   uuid := '00000000-0000-0000-0000-000000fb0007'; -- PSU subassembly (reorder 15)
  v_it_ecg   uuid := '00000000-0000-0000-0000-000000fb0008'; -- ECG monitor     (reorder 5)
  v_it_spir  uuid := '00000000-0000-0000-0000-000000fb0009'; -- Spirometer      (reorder 5)
  v_it_glv   uuid := '00000000-0000-0000-0000-000000fb000b'; -- Latex gloves    (reorder 50)

  -- Warehouse
  v_wh_main  uuid := '00000000-0000-0000-0000-000000fa0001';
BEGIN
  PERFORM set_config('app.current_org', v_org::text, true);

  -- Adjust stock down so the items end up at the targets below.
  -- Targets are chosen to span the severity bands the UI computes:
  --   stock-out (available <= 0)            → critical
  --   available <= 0.5 * reorder_level      → high
  --   else                                  → medium
  --
  -- (Trigger tg_stock_summary_from_ledger keeps stock_summary in sync.)
  INSERT INTO stock_ledger (
    id, org_id, item_id, warehouse_id, quantity, uom, txn_type, ref_doc_type,
    ref_doc_id, unit_cost, posted_by, posted_at, reason
  ) VALUES
    -- Resistor 1k: 2254 -> 380 (medium: below 500 but above 250)
    ('00000000-0000-0000-0000-000000fd0101', v_org, v_it_res,  v_wh_main, '-1874.000', 'EA',   'ADJUSTMENT', 'ADJUSTMENT', NULL, '0.50',     v_stores, now() - interval '4 hours', 'Cycle count: shrinkage'),
    -- Cap 10uF: 980 -> 80 (high: below half of 200)
    ('00000000-0000-0000-0000-000000fd0102', v_org, v_it_cap,  v_wh_main, '-900.000',  'EA',   'ADJUSTMENT', 'ADJUSTMENT', NULL, '2.50',     v_stores, now() - interval '4 hours', 'Cycle count: damage write-off'),
    -- PCB-ECG-V2: 30 -> 8 (high: below half of 20)
    ('00000000-0000-0000-0000-000000fd0103', v_org, v_it_pcb,  v_wh_main, '-22.000',   'EA',   'WO_ISSUE',   'WO',         NULL, '850.00',   v_stores, now() - interval '6 hours', 'Issued to WO PID-2026-0021'),
    -- PSU-SA-12V: 40 -> 4 (critical: well below 15, almost stock-out)
    ('00000000-0000-0000-0000-000000fd0104', v_org, v_it_psu,  v_wh_main, '-36.000',   'EA',   'WO_ISSUE',   'WO',         NULL, '1250.00',  v_stores, now() - interval '8 hours', 'Issued to WO PID-2026-0019'),
    -- ECG-MONITOR-V2: 6 -> 0 (critical: stock-out — finished goods all dispatched)
    ('00000000-0000-0000-0000-000000fd0105', v_org, v_it_ecg,  v_wh_main, '-6.000',    'EA',   'CUSTOMER_ISSUE', 'SI',     NULL, '24500.00', v_stores, now() - interval '12 hours', 'Dispatched against SI'),
    -- Spirometer: 12 -> 2 (high: below half of 5)
    ('00000000-0000-0000-0000-000000fd0106', v_org, v_it_spir, v_wh_main, '-10.000',   'EA',   'CUSTOMER_ISSUE', 'SI',     NULL, '18900.00', v_stores, now() - interval '14 hours', 'Dispatched against SI'),
    -- Gloves: 294 -> 24 (critical: below half of 50)
    ('00000000-0000-0000-0000-000000fd0107', v_org, v_it_glv,  v_wh_main, '-270.000',  'PAIR', 'ADJUSTMENT', 'ADJUSTMENT', NULL, '12.00',    v_stores, now() - interval '5 hours', 'Cycle count: heavy consumption since count')
  ON CONFLICT (id) DO NOTHING;
END $$;
