-- Dev-only procurement seed. Mirrors ARCHITECTURE.md §13.5 sample data so a
-- fresh `pnpm infra:up && pnpm db:migrate` boot has vendors, indents, POs
-- and GRNs to click on.
--
-- Rules (same as 08-inventory-dev-data.sql):
--   * All IDs are stable deterministic UUIDs so re-running the seed is idempotent.
--   * All rows belong to the same Dev org seeded in 03-dev-org-users.sql.
--   * No audit actor set — the audit trigger tolerates NULL.
--   * Kept in seed/ so prod migrations never run it (Gate 7).
--
-- UUID fixture conventions:
--   fe00x  — vendors
--   f100x  — indents (header)
--   f11xx  — indent_lines
--   f200x  — purchase_orders (header)
--   f21xx  — po_lines
--   f300x  — grns (header)
--   f31xx  — grn_lines

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';

  -- Users (from 03-dev-org-users.sql)
  v_stores   uuid := '00000000-0000-0000-0000-00000000b00b'; -- Stores
  v_prodmgr  uuid := '00000000-0000-0000-0000-00000000b007'; -- Production Manager
  v_finance  uuid := '00000000-0000-0000-0000-00000000b006'; -- Finance

  -- Warehouses (from 08-inventory-dev-data.sql)
  v_wh_main  uuid := '00000000-0000-0000-0000-000000fa0001';

  -- Items (from 08-inventory-dev-data.sql)
  v_it_res   uuid := '00000000-0000-0000-0000-000000fb0001';
  v_it_cap   uuid := '00000000-0000-0000-0000-000000fb0002';
  v_it_pcb   uuid := '00000000-0000-0000-0000-000000fb0003';
  v_it_bat   uuid := '00000000-0000-0000-0000-000000fb0004';
  v_it_lcd   uuid := '00000000-0000-0000-0000-000000fb0005';

  -- Vendors
  v_vn_ecm   uuid := '00000000-0000-0000-0000-000000fe0001'; -- Elcon Mart
  v_vn_sil   uuid := '00000000-0000-0000-0000-000000fe0002'; -- Silicon Distributors
  v_vn_led   uuid := '00000000-0000-0000-0000-000000fe0003'; -- LED & Display Co
  v_vn_log   uuid := '00000000-0000-0000-0000-000000fe0004'; -- Swift Logistics

  -- Indents
  v_in_001   uuid := '00000000-0000-0000-0000-0000000f1001'; -- IND-2026-0001
  v_in_002   uuid := '00000000-0000-0000-0000-0000000f1002'; -- IND-2026-0002

  -- Indent lines
  v_inl_01   uuid := '00000000-0000-0000-0000-0000000f1101';
  v_inl_02   uuid := '00000000-0000-0000-0000-0000000f1102';
  v_inl_03   uuid := '00000000-0000-0000-0000-0000000f1103';
  v_inl_04   uuid := '00000000-0000-0000-0000-0000000f1104';

  -- Purchase orders
  v_po_001   uuid := '00000000-0000-0000-0000-0000000f2001'; -- PO-2026-0001
  v_po_002   uuid := '00000000-0000-0000-0000-0000000f2002'; -- PO-2026-0002

  -- PO lines
  v_pol_01   uuid := '00000000-0000-0000-0000-0000000f2101';
  v_pol_02   uuid := '00000000-0000-0000-0000-0000000f2102';
  v_pol_03   uuid := '00000000-0000-0000-0000-0000000f2103';
  v_pol_04   uuid := '00000000-0000-0000-0000-0000000f2104';

  -- GRNs
  v_gr_001   uuid := '00000000-0000-0000-0000-0000000f3001'; -- GRN-2026-0001

  -- GRN lines
  v_grl_01   uuid := '00000000-0000-0000-0000-0000000f3101';
BEGIN
  -- Set RLS context.
  PERFORM set_config('app.current_org', v_org::text, true);

  -- ─── Vendors ───────────────────────────────────────────────────────────────
  INSERT INTO vendors (
    id, org_id, code, name, vendor_type, gstin, pan, is_msme, msme_number,
    address, city, state, country, postal_code,
    contact_name, email, phone, website,
    payment_terms_days, credit_limit,
    bank_account, bank_ifsc, bank_name,
    notes, is_active
  ) VALUES
    (v_vn_ecm, v_org, 'V-ECM', 'Elcon Mart Pvt Ltd', 'SUPPLIER',
     '29ABCDE1234F1Z5', 'ABCDE1234F', true, 'UDYAM-KA-01-0012345',
     '221 SP Road, Electronics City', 'Bengaluru', 'KA', 'IN', '560100',
     'Ravi Kumar', 'sales@elconmart.example.com', '+91-9876543210',
     'https://elconmart.example.com',
     30, '500000.00',
     '123456789012', 'HDFC0001234', 'HDFC Bank',
     'Primary vendor for passive components.', true),

    (v_vn_sil, v_org, 'V-SIL', 'Silicon Distributors India', 'SUPPLIER',
     '27PQRST5678G2Z6', 'PQRST5678G', false, NULL,
     '88 MIDC Rabale', 'Mumbai', 'MH', 'IN', '400701',
     'Neha Sharma', 'orders@silicondist.example.com', '+91-9123456780',
     'https://silicondist.example.com',
     45, '1200000.00',
     '987654321098', 'ICIC0005678', 'ICICI Bank',
     'Semiconductors and ICs.', true),

    (v_vn_led, v_org, 'V-LED', 'LED & Display Co', 'SUPPLIER',
     '33LMNOP9012H3Z7', 'LMNOP9012H', true, 'UDYAM-TN-05-0098765',
     '5 Industrial Ave', 'Chennai', 'TN', 'IN', '600096',
     'Arun Iyer', 'hello@leddisplay.example.com', '+91-9988776655',
     NULL,
     30, '300000.00',
     '112233445566', 'SBIN0009876', 'SBI',
     NULL, true),

    (v_vn_log, v_org, 'V-LOG', 'Swift Logistics Ltd', 'LOGISTICS',
     '06UVWXY3456I4Z8', 'UVWXY3456I', false, NULL,
     'Logistics Park, Phase 2', 'Gurugram', 'HR', 'IN', '122002',
     'Dispatch Desk', 'dispatch@swiftlog.example.com', '+91-9000000001',
     'https://swiftlog.example.com',
     15, '0.00',
     NULL, NULL, NULL,
     'Inbound carrier for urgent lanes.', true)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Procurement number sequences (seed 2026) ─────────────────────────────
  INSERT INTO procurement_number_sequences (org_id, kind, year, last_seq) VALUES
    (v_org, 'INDENT', 2026, 2),
    (v_org, 'PO',     2026, 2),
    (v_org, 'GRN',    2026, 1)
  ON CONFLICT (org_id, kind, year) DO NOTHING;

  -- ─── Indents ───────────────────────────────────────────────────────────────
  INSERT INTO indents (
    id, org_id, indent_number, department, purpose, status, priority,
    required_by, requested_by, notes
  ) VALUES
    (v_in_001, v_org, 'IND-2026-0001', 'Production', 'ECG build batch #12',
     'CONVERTED', 'HIGH', current_date + 7, v_prodmgr,
     'Approved and converted to PO-2026-0001.'),
    (v_in_002, v_org, 'IND-2026-0002', 'Production',
     'LiPo + LCD stock top-up', 'SUBMITTED', 'NORMAL',
     current_date + 14, v_prodmgr,
     'Awaiting finance approval.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO indent_lines (
    id, org_id, indent_id, line_no, item_id, quantity, uom, estimated_cost, notes
  ) VALUES
    (v_inl_01, v_org, v_in_001, 1, v_it_res, '2000.000', 'EA', '5000.00',
     'Standard 1/4W tolerance.'),
    (v_inl_02, v_org, v_in_001, 2, v_it_cap, '800.000', 'EA', '4800.00',
     NULL),
    (v_inl_03, v_org, v_in_002, 1, v_it_bat, '50.000', 'EA', '45000.00',
     NULL),
    (v_inl_04, v_org, v_in_002, 2, v_it_lcd, '40.000', 'EA', '60000.00',
     'Backlit variant preferred.')
  ON CONFLICT (id) DO NOTHING;

  -- ─── Purchase Orders ──────────────────────────────────────────────────────
  -- PO-2026-0001: converted indent 001, PARTIALLY_RECEIVED after GRN-001.
  -- PO-2026-0002: fresh ad-hoc, status APPROVED and not yet received.
  INSERT INTO purchase_orders (
    id, org_id, po_number, indent_id, vendor_id, status,
    currency, order_date, expected_date,
    delivery_warehouse_id, billing_address, shipping_address,
    payment_terms_days, subtotal, tax_total, discount_total, grand_total,
    created_by, approved_by, approved_at, sent_at, notes
  ) VALUES
    (v_po_001, v_org, 'PO-2026-0001', v_in_001, v_vn_ecm, 'PARTIALLY_RECEIVED',
     'INR', current_date - 5, current_date + 2,
     v_wh_main,
     'Instigenie Bengaluru, Plot 42, Electronics Park, Bengaluru, KA 560100',
     'Instigenie Bengaluru, Plot 42, Electronics Park, Bengaluru, KA 560100',
     30,
     '9800.00', '1764.00', '0.00', '11564.00',
     v_stores, v_finance, now() - interval '5 days', now() - interval '5 days',
     'Rush for batch #12.'),

    (v_po_002, v_org, 'PO-2026-0002', NULL, v_vn_sil, 'APPROVED',
     'INR', current_date - 2, current_date + 14,
     v_wh_main,
     'Instigenie Bengaluru, Plot 42, Electronics Park, Bengaluru, KA 560100',
     'Instigenie Bengaluru, Plot 42, Electronics Park, Bengaluru, KA 560100',
     45,
     '40000.00', '7200.00', '0.00', '47200.00',
     v_stores, v_finance, now() - interval '2 days', NULL,
     'Display + batteries ad-hoc buy.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO po_lines (
    id, org_id, po_id, indent_line_id, line_no, item_id, description,
    quantity, uom, unit_price, discount_pct, tax_pct,
    line_subtotal, line_tax, line_total, received_qty
  ) VALUES
    -- PO-001 lines (against indent 001)
    (v_pol_01, v_org, v_po_001, v_inl_01, 1, v_it_res, '1k ohm resistor 1/4W',
     '2000.000', 'EA', '2.50', '0.00', '18.00',
     '5000.00', '900.00', '5900.00', '2000.000'),
    (v_pol_02, v_org, v_po_001, v_inl_02, 2, v_it_cap, '10uF cap 25V X7R',
     '800.000', 'EA', '6.00', '0.00', '18.00',
     '4800.00', '864.00', '5664.00', '0.000'),
    -- PO-002 lines (ad-hoc, no indent)
    (v_pol_03, v_org, v_po_002, NULL, 1, v_it_bat, 'LiPo 3.7V 2000mAh',
     '50.000', 'EA', '500.00', '0.00', '18.00',
     '25000.00', '4500.00', '29500.00', '0.000'),
    (v_pol_04, v_org, v_po_002, NULL, 2, v_it_lcd, '3" TFT 240x320',
     '40.000', 'EA', '375.00', '0.00', '18.00',
     '15000.00', '2700.00', '17700.00', '0.000')
  ON CONFLICT (id) DO NOTHING;

  -- ─── GRN for PO-001 / line 1 (resistors) ─────────────────────────────────
  INSERT INTO grns (
    id, org_id, grn_number, po_id, vendor_id, warehouse_id, status,
    received_date, vehicle_number, invoice_number, invoice_date,
    received_by, posted_by, posted_at, notes
  ) VALUES
    (v_gr_001, v_org, 'GRN-2026-0001', v_po_001, v_vn_ecm, v_wh_main, 'POSTED',
     current_date - 3, 'KA05-AB-1234', 'INV-ECM-9912', current_date - 3,
     v_stores, v_stores, now() - interval '3 days',
     'Full resistors shipment; caps still in transit.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO grn_lines (
    id, org_id, grn_id, po_line_id, line_no, item_id,
    quantity, uom, unit_cost, batch_no, serial_no,
    mfg_date, expiry_date, qc_status, qc_rejected_qty
  ) VALUES
    (v_grl_01, v_org, v_gr_001, v_pol_01, 1, v_it_res,
     '2000.000', 'EA', '2.50', 'R-2026-W12-A', NULL,
     current_date - 30, NULL, 'ACCEPTED', '0.000')
  ON CONFLICT (id) DO NOTHING;

  -- NOTE: We intentionally do NOT write a stock_ledger entry here for the
  -- POSTED GRN above, because the inventory seed (08-inventory-dev-data.sql)
  -- already seeds OPENING_BALANCE rows for these SKUs. A matching GRN_RECEIPT
  -- ledger row for the resistors would double-count in the demo data. In
  -- production, posting a GRN through the service writes the ledger row
  -- transactionally.
END $$;
