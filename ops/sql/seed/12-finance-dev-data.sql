-- Dev-only Finance seed. ARCHITECTURE.md §13.6.
--
-- Provides a browsable dataset for the /finance/* pages:
--   * 2 POSTED sales invoices against real CRM accounts (Apollo, Fortis)
--   * 1 DRAFT sales invoice (editable surface)
--   * 1 POSTED purchase invoice against a real vendor (Elcon Mart)
--   * 1 DRAFT purchase invoice (editable surface)
--   * Customer-ledger + vendor-ledger rows auto-snapshotted for POSTED
--   * 1 CUSTOMER_RECEIPT payment partially applying to SI-2026-0001
--   * 1 VENDOR_PAYMENT fully applying to PI-2026-0001
--
-- Rules (same as 11-qc-dev-data.sql):
--   * Stable deterministic UUIDs, idempotent re-run.
--   * References live in 04-crm-dev-data.sql (accounts) and
--     09-procurement-dev-data.sql (vendors, POs, GRNs).
--   * RLS context is set via set_config('app.current_org', ...).
--
-- UUID fixture conventions (ff00x namespace — Finance module):
--   ff0xx — sales_invoices (header)
--   ff1xx — sales_invoice_lines
--   ff2xx — purchase_invoices (header)
--   ff3xx — purchase_invoice_lines
--   ff4xx — customer_ledger
--   ff5xx — vendor_ledger
--   ff6xx — payments

DO $$
DECLARE
  v_org        uuid := '00000000-0000-0000-0000-00000000a001';

  -- Users
  v_finmgr     uuid := '00000000-0000-0000-0000-00000000b005';  -- Finance Manager (if seeded)
  v_admin      uuid := '00000000-0000-0000-0000-00000000b001';  -- Admin (fallback)

  -- Accounts (from 04-crm-dev-data.sql)
  v_ac_apollo  uuid := '00000000-0000-0000-0000-0000000ac001';  -- Apollo Hospitals
  v_ac_fortis  uuid := '00000000-0000-0000-0000-0000000ac002';  -- Fortis Healthcare
  v_ac_city    uuid := '00000000-0000-0000-0000-0000000ac003';  -- City Diagnostics

  -- Vendors (from 09-procurement-dev-data.sql)
  v_vn_ecm     uuid := '00000000-0000-0000-0000-000000fe0001';  -- Elcon Mart
  v_vn_sil     uuid := '00000000-0000-0000-0000-000000fe0002';  -- Silicon Distributors

  -- Sales invoices
  v_si_1       uuid := '00000000-0000-0000-0000-000000ff0001';
  v_si_2       uuid := '00000000-0000-0000-0000-000000ff0002';
  v_si_3       uuid := '00000000-0000-0000-0000-000000ff0003';

  -- Sales invoice lines
  v_sil_1a     uuid := '00000000-0000-0000-0000-000000ff0101';
  v_sil_1b     uuid := '00000000-0000-0000-0000-000000ff0102';
  v_sil_2a     uuid := '00000000-0000-0000-0000-000000ff0103';
  v_sil_3a     uuid := '00000000-0000-0000-0000-000000ff0104';

  -- Purchase invoices
  v_pi_1       uuid := '00000000-0000-0000-0000-000000ff0201';
  v_pi_2       uuid := '00000000-0000-0000-0000-000000ff0202';

  -- Purchase invoice lines
  v_pil_1a     uuid := '00000000-0000-0000-0000-000000ff0301';
  v_pil_1b     uuid := '00000000-0000-0000-0000-000000ff0302';
  v_pil_2a     uuid := '00000000-0000-0000-0000-000000ff0303';

  -- Ledger rows
  v_cl_1       uuid := '00000000-0000-0000-0000-000000ff0401';  -- Apollo: invoice SI-0001
  v_cl_2       uuid := '00000000-0000-0000-0000-000000ff0402';  -- Fortis: invoice SI-0002
  v_cl_3       uuid := '00000000-0000-0000-0000-000000ff0403';  -- Apollo: partial payment
  v_vl_1       uuid := '00000000-0000-0000-0000-000000ff0501';  -- Elcon Mart: bill PI-0001
  v_vl_2       uuid := '00000000-0000-0000-0000-000000ff0502';  -- Elcon Mart: full payment

  -- Payments
  v_pay_1      uuid := '00000000-0000-0000-0000-000000ff0601';  -- Customer receipt
  v_pay_2      uuid := '00000000-0000-0000-0000-000000ff0602';  -- Vendor payment
BEGIN
  PERFORM set_config('app.current_org', v_org::text, true);

  -- Fall back to admin if finance manager user wasn't seeded
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_finmgr) THEN
    v_finmgr := v_admin;
  END IF;

  -- ─── Number sequences ─────────────────────────────────────────────────────
  INSERT INTO finance_number_sequences (org_id, kind, year, last_seq) VALUES
    (v_org, 'SI',  2026, 3),
    (v_org, 'PI',  2026, 2),
    (v_org, 'PAY', 2026, 2)
  ON CONFLICT (org_id, kind, year) DO UPDATE SET last_seq = EXCLUDED.last_seq;

  -- ─── Sales invoices ───────────────────────────────────────────────────────
  INSERT INTO sales_invoices (
    id, org_id, invoice_number, status,
    customer_id, customer_name, customer_gstin, customer_address,
    invoice_date, due_date,
    currency, subtotal, tax_total, discount_total, grand_total, amount_paid,
    notes, terms, place_of_supply,
    posted_at, posted_by,
    created_by
  ) VALUES
    (v_si_1, v_org, 'SI-2026-0001', 'POSTED',
      v_ac_apollo, 'Apollo Hospitals', '36AABCA1234D1Z5', 'Jubilee Hills, Hyderabad',
      '2026-03-15', '2026-04-14',
      'INR', '1500000.0000', '270000.0000', '0.0000', '1770000.0000', '1000000.0000',
      'Annual maintenance contract renewal', 'Net 30',
      '36-Telangana',
      '2026-03-15 14:30:00+00', v_finmgr,
      v_finmgr),
    (v_si_2, v_org, 'SI-2026-0002', 'POSTED',
      v_ac_fortis, 'Fortis Healthcare', '07AABCF5678K1Z9', 'Okhla Road, Delhi',
      '2026-03-20', '2026-04-19',
      'INR', '850000.0000', '153000.0000', '10000.0000', '993000.0000', '0.0000',
      'ECG Patient Monitor x 4 units', 'Net 30',
      '07-Delhi',
      '2026-03-20 11:00:00+00', v_finmgr,
      v_finmgr),
    (v_si_3, v_org, 'SI-2026-0003', 'DRAFT',
      v_ac_city, 'City Diagnostics', '27AABCC3456P1Z1', 'Andheri East, Mumbai',
      '2026-04-10', '2026-05-10',
      'INR', '275000.0000', '49500.0000', '0.0000', '324500.0000', '0.0000',
      'Diagnostic kit refills (Q2)', 'Net 30',
      '27-Maharashtra',
      NULL, NULL,
      v_finmgr)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Sales invoice lines ──────────────────────────────────────────────────
  INSERT INTO sales_invoice_lines (
    id, org_id, invoice_id, sequence_number,
    description, hsn_sac,
    quantity, uom, unit_price,
    discount_percent, tax_rate_percent,
    line_subtotal, line_tax, line_total
  ) VALUES
    (v_sil_1a, v_org, v_si_1, 1,
      'Annual Maintenance Contract — ECG Monitors Q1',
      '998719', '1.0000', 'nos', '900000.0000',
      '0.0000', '18.0000',
      '900000.0000', '162000.0000', '1062000.0000'),
    (v_sil_1b, v_org, v_si_1, 2,
      'On-site Calibration Visit × 2',
      '998719', '2.0000', 'visit', '300000.0000',
      '0.0000', '18.0000',
      '600000.0000', '108000.0000', '708000.0000'),
    (v_sil_2a, v_org, v_si_2, 1,
      'ECG Patient Monitor v2',
      '901890', '4.0000', 'nos', '212500.0000',
      '1.1765', '18.0000',
      '840000.0000', '153000.0000', '993000.0000'),
    (v_sil_3a, v_org, v_si_3, 1,
      'Diagnostic test kit — ECG consumables',
      '300220', '100.0000', 'pack', '2750.0000',
      '0.0000', '18.0000',
      '275000.0000', '49500.0000', '324500.0000')
  ON CONFLICT (id) DO NOTHING;

  -- ─── Purchase invoices ────────────────────────────────────────────────────
  INSERT INTO purchase_invoices (
    id, org_id, invoice_number, vendor_invoice_no, status, match_status,
    vendor_id, vendor_name, vendor_gstin, vendor_address,
    invoice_date, due_date,
    currency, subtotal, tax_total, discount_total, grand_total, amount_paid,
    notes, place_of_supply,
    posted_at, posted_by,
    created_by
  ) VALUES
    (v_pi_1, v_org, 'PI-2026-0001', 'ECM/2026/00421', 'POSTED', 'MATCHED',
      v_vn_ecm, 'Elcon Mart', '27AAACE0001D1Z5', 'Electronic City, Bengaluru',
      '2026-03-05', '2026-04-04',
      'INR', '500000.0000', '90000.0000', '0.0000', '590000.0000', '590000.0000',
      'PCB components — batch B-0421',
      '29-Karnataka',
      '2026-03-06 10:00:00+00', v_finmgr,
      v_finmgr),
    (v_pi_2, v_org, 'PI-2026-0002', 'SIL/BILL/2026/112', 'DRAFT', 'PENDING',
      v_vn_sil, 'Silicon Distributors', '27AAACS0002D1Z5', 'Andheri East, Mumbai',
      '2026-04-08', '2026-05-08',
      'INR', '320000.0000', '57600.0000', '5000.0000', '372600.0000', '0.0000',
      'Microcontrollers + display modules',
      '27-Maharashtra',
      NULL, NULL,
      v_finmgr)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Purchase invoice lines ───────────────────────────────────────────────
  INSERT INTO purchase_invoice_lines (
    id, org_id, invoice_id, sequence_number,
    description, hsn_sac,
    quantity, uom, unit_price,
    discount_percent, tax_rate_percent,
    line_subtotal, line_tax, line_total
  ) VALUES
    (v_pil_1a, v_org, v_pi_1, 1,
      'PCB assembly — ECG v2',
      '854231', '100.0000', 'nos', '4000.0000',
      '0.0000', '18.0000',
      '400000.0000', '72000.0000', '472000.0000'),
    (v_pil_1b, v_org, v_pi_1, 2,
      'LiPo battery pack 2500mAh',
      '850760', '100.0000', 'nos', '1000.0000',
      '0.0000', '18.0000',
      '100000.0000', '18000.0000', '118000.0000'),
    (v_pil_2a, v_org, v_pi_2, 1,
      'STM32F4 MCU + 7" TFT display combo kit',
      '854231', '80.0000', 'nos', '4000.0000',
      '1.5625', '18.0000',
      '320000.0000', '57600.0000', '372600.0000')
  ON CONFLICT (id) DO NOTHING;

  -- ─── Customer ledger ──────────────────────────────────────────────────────
  -- SI-2026-0001 posted → debit Apollo
  INSERT INTO customer_ledger (
    id, org_id, customer_id, entry_date, entry_type,
    debit, credit, running_balance, currency,
    reference_type, reference_id, reference_number,
    description, recorded_by
  ) VALUES
    (v_cl_1, v_org, v_ac_apollo, '2026-03-15', 'INVOICE',
      '1770000.0000', '0.0000', '1770000.0000', 'INR',
      'SALES_INVOICE', v_si_1, 'SI-2026-0001',
      'AMC Q1 + calibration visits', v_finmgr),
    (v_cl_2, v_org, v_ac_fortis, '2026-03-20', 'INVOICE',
      '993000.0000', '0.0000', '993000.0000', 'INR',
      'SALES_INVOICE', v_si_2, 'SI-2026-0002',
      'ECG Monitor x 4', v_finmgr),
    (v_cl_3, v_org, v_ac_apollo, '2026-04-01', 'PAYMENT',
      '0.0000', '1000000.0000', '770000.0000', 'INR',
      'PAYMENT', v_pay_1, 'PAY-2026-0001',
      'Partial payment against SI-2026-0001', v_finmgr)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Vendor ledger ────────────────────────────────────────────────────────
  INSERT INTO vendor_ledger (
    id, org_id, vendor_id, entry_date, entry_type,
    debit, credit, running_balance, currency,
    reference_type, reference_id, reference_number,
    description, recorded_by
  ) VALUES
    (v_vl_1, v_org, v_vn_ecm, '2026-03-06', 'BILL',
      '0.0000', '590000.0000', '-590000.0000', 'INR',
      'PURCHASE_INVOICE', v_pi_1, 'PI-2026-0001',
      'PCB components batch B-0421', v_finmgr),
    (v_vl_2, v_org, v_vn_ecm, '2026-04-05', 'PAYMENT',
      '590000.0000', '0.0000', '0.0000', 'INR',
      'PAYMENT', v_pay_2, 'PAY-2026-0002',
      'Full payment PI-2026-0001', v_finmgr)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Payments ─────────────────────────────────────────────────────────────
  INSERT INTO payments (
    id, org_id, payment_number, payment_type, status,
    customer_id, vendor_id, counterparty_name,
    payment_date, amount, currency, mode, reference_no,
    applied_to, notes,
    recorded_by, recorded_at
  ) VALUES
    (v_pay_1, v_org, 'PAY-2026-0001', 'CUSTOMER_RECEIPT', 'RECORDED',
      v_ac_apollo, NULL, 'Apollo Hospitals',
      '2026-04-01', '1000000.0000', 'INR', 'BANK_TRANSFER', 'RTGS/HDFC/2026/0419',
      jsonb_build_array(jsonb_build_object(
        'invoiceId',     v_si_1::text,
        'invoiceType',   'SALES_INVOICE',
        'amountApplied', '1000000.0000'
      )),
      'Partial payment against SI-2026-0001',
      v_finmgr, '2026-04-01 15:00:00+00'),
    (v_pay_2, v_org, 'PAY-2026-0002', 'VENDOR_PAYMENT', 'RECORDED',
      NULL, v_vn_ecm, 'Elcon Mart',
      '2026-04-05', '590000.0000', 'INR', 'BANK_TRANSFER', 'NEFT/ICICI/2026/1120',
      jsonb_build_array(jsonb_build_object(
        'invoiceId',     v_pi_1::text,
        'invoiceType',   'PURCHASE_INVOICE',
        'amountApplied', '590000.0000'
      )),
      'Full payment PI-2026-0001',
      v_finmgr, '2026-04-05 12:00:00+00')
  ON CONFLICT (id) DO NOTHING;

END $$;
