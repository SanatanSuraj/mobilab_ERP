-- Phase 5 — auxiliary dev seeds for QC equipment / CAPA / e-way bills.
--
-- Idempotent: stable UUIDs + ON CONFLICT DO NOTHING. Maps onto the tables
-- introduced in ops/sql/init/22-phase5-aux-tables.sql.
--
-- UUID fixture conventions:
--   fe1xxx — qc_equipment rows
--   fe2xxx — qc_capa_actions rows
--   fe3xxx — eway_bills rows

DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-00000000a001';
BEGIN
  PERFORM set_config('app.current_org', v_org::text, true);

  -- ============================================================
  -- 1. QC Equipment — calibration register
  -- ============================================================
  INSERT INTO qc_equipment (
    id, org_id, asset_code, name, category, manufacturer, model_number,
    serial_number, location, status, calibration_interval_days,
    last_calibrated_at, next_due_at, notes
  ) VALUES
    ('00000000-0000-0000-0000-000000fe1001', v_org, 'EQP-DMM-001', 'Fluke 87V Multimeter',         'TEST_INSTRUMENT', 'Fluke',     '87V',     'F87V-2891234',  'QC Lab Bench A', 'ACTIVE',         365, now() - interval '60 days',  now() + interval '305 days', 'Bench DMM for line QC'),
    ('00000000-0000-0000-0000-000000fe1002', v_org, 'EQP-DMM-002', 'Keysight U1242C DMM',          'TEST_INSTRUMENT', 'Keysight',  'U1242C',  'KS-U1242-44128', 'QC Lab Bench A', 'ACTIVE',         365, now() - interval '350 days', now() + interval '15 days',  'Calibration due soon'),
    ('00000000-0000-0000-0000-000000fe1003', v_org, 'EQP-OSC-001', 'Tektronix MDO34 Oscilloscope', 'TEST_INSTRUMENT', 'Tektronix', 'MDO34',   'TEK-MDO34-9911', 'QC Lab Bench B', 'ACTIVE',         730, now() - interval '120 days', now() + interval '610 days', 'Used for ECG signal QC'),
    ('00000000-0000-0000-0000-000000fe1004', v_org, 'EQP-PSU-001', 'Rigol DP832 Power Supply',     'TEST_INSTRUMENT', 'Rigol',     'DP832',   'RGL-DP832-7720', 'QC Lab Bench B', 'ACTIVE',         365, now() - interval '200 days', now() + interval '165 days', NULL),
    ('00000000-0000-0000-0000-000000fe1005', v_org, 'EQP-BAL-001', 'Mettler Toledo XPR Balance',   'BALANCE',         'Mettler',   'XPR204',  'MT-XPR204-3041', 'QA Weigh Room',  'IN_CALIBRATION', 180, now() - interval '370 days', now() - interval '5 days',   'Sent to vendor for calibration on 2026-04-20'),
    ('00000000-0000-0000-0000-000000fe1006', v_org, 'EQP-OVN-001', 'Memmert UF55 Drying Oven',     'OVEN',            'Memmert',   'UF55',    'MEM-UF55-1180',  'Process Hall',   'ACTIVE',         365, now() - interval '15 days',  now() + interval '350 days', 'Reflow pre-bake oven'),
    ('00000000-0000-0000-0000-000000fe1007', v_org, 'EQP-CHM-001', 'Climatic Chamber 5C-50C',      'CHAMBER',         'Espec',     'SH-242',  'ESP-SH242-2256', 'Reliability Lab','OUT_OF_SERVICE', 365, now() - interval '410 days', now() - interval '45 days',  'Compressor failure; awaiting service'),
    ('00000000-0000-0000-0000-000000fe1008', v_org, 'EQP-CAL-001', 'Mitutoyo 0-150mm Caliper',     'GAUGE',            'Mitutoyo',  'CD-15CXR','MIT-CD15-7741',  'PCB Assembly',   'ACTIVE',         365, now() - interval '90 days',  now() + interval '275 days', NULL),
    ('00000000-0000-0000-0000-000000fe1009', v_org, 'EQP-MIC-001', 'Mitutoyo Outside Micrometer',  'GAUGE',            'Mitutoyo',  '293-340',  'MIT-293-9982',   'PCB Assembly',   'ACTIVE',         365, now() - interval '320 days', now() + interval '45 days',  'Calibration due in 6 weeks'),
    ('00000000-0000-0000-0000-000000fe1010', v_org, 'EQP-PRT-001', 'Pressure Tester 0-10 bar',     'METER',            'Druck',     'DPI-104', 'DRK-DPI104-5520','Final QC',       'ACTIVE',         365, now() - interval '180 days', now() + interval '185 days', NULL),
    ('00000000-0000-0000-0000-000000fe1011', v_org, 'EQP-LCR-001', 'BK Precision LCR Meter',       'METER',            'BK Prec.',  '889B',    'BK-889B-3308',   'QC Lab Bench A', 'ACTIVE',         365, now() - interval '420 days', now() - interval '55 days',  'OVERDUE — schedule recall'),
    ('00000000-0000-0000-0000-000000fe1012', v_org, 'EQP-IRP-001', 'IR Thermometer Fluke 568',     'TEST_INSTRUMENT', 'Fluke',     '568',     'F568-1124',      'Process Hall',   'RETIRED',        365, now() - interval '900 days', now() - interval '500 days', 'Replaced by EQP-IRP-002 in 2025')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 2. QC CAPA Actions
  -- ============================================================
  INSERT INTO qc_capa_actions (
    id, org_id, capa_number, title, description, source_type, source_ref,
    action_type, severity, status, owner_name, due_date, closed_at,
    root_cause, effectiveness_check
  ) VALUES
    ('00000000-0000-0000-0000-000000fe2001', v_org, 'CAPA-2026-001', 'PCB solder mask defect on batch B-411', 'Visual inspection found pinholes on solder mask covering 30% of batch B-411 PCBs', 'NCR',      'NCR-2026-0014', 'CORRECTIVE', 'HIGH',     'IN_PROGRESS',          'Priya Krishnan',  CURRENT_DATE + 14, NULL,                            '5-Why traced to vendor screen-print process drift', NULL),
    ('00000000-0000-0000-0000-000000fe2002', v_org, 'CAPA-2026-002', 'PSU voltage out-of-spec on incoming', 'Three of five sampled PSUs failed +/-2% tolerance on output voltage during IQC', 'NCR',      'NCR-2026-0019', 'CORRECTIVE', 'CRITICAL', 'OPEN',                 'Vikram Reddy',    CURRENT_DATE + 7,  NULL,                            NULL,                                                 NULL),
    ('00000000-0000-0000-0000-000000fe2003', v_org, 'CAPA-2026-003', 'ECG calibration drift after 6 months', 'Customer feedback indicating drift; preventive recalibration needed at 6 months instead of 12', 'COMPLAINT','COMP-2026-007', 'PREVENTIVE', 'MEDIUM',   'IN_PROGRESS',          'Anand Iyer',      CURRENT_DATE + 30, NULL,                            'Component aging on reference voltage chip',         NULL),
    ('00000000-0000-0000-0000-000000fe2004', v_org, 'CAPA-2026-004', 'Internal audit finding: missing GMP signoffs', 'Audit found 4 BMRs without final-stage signoff', 'AUDIT',    'AUDIT-2026-Q1', 'BOTH',       'HIGH',     'PENDING_VERIFICATION', 'Sanjana Pillai',  CURRENT_DATE + 5,  NULL,                            'Operator training gap on close-out checklist',      'Effectiveness review at next quarter audit'),
    ('00000000-0000-0000-0000-000000fe2005', v_org, 'CAPA-2026-005', 'Spirometer flow sensor false-fail', 'Final QC flow-test rejecting good units due to threshold tolerance bug', 'INTERNAL', 'BUG-2026-0034', 'CORRECTIVE', 'MEDIUM',   'CLOSED',               'Rohit Saxena',    CURRENT_DATE - 10, now() - interval '10 days',     'Threshold incorrect by 5% in firmware',             'Re-tested 50 units after fix; all PASS'),
    ('00000000-0000-0000-0000-000000fe2006', v_org, 'CAPA-2026-006', 'Cap leak on incoming batch (vendor LED)', 'GRN inspection found 2/100 caps leaking electrolyte', 'NCR',      'NCR-2026-0021', 'CORRECTIVE', 'LOW',      'CLOSED',               'Priya Krishnan',  CURRENT_DATE - 25, now() - interval '21 days',     'Vendor process: storage humidity excursion',        'Vendor switched to vacuum-sealed boxes; 200 sample = 0 fails'),
    ('00000000-0000-0000-0000-000000fe2007', v_org, 'CAPA-2026-007', 'Calibration overdue on EQP-LCR-001', 'LCR meter EQP-LCR-001 missed calibration window by 55 days', 'INTERNAL', 'EQP-LCR-001',   'CORRECTIVE', 'HIGH',     'OPEN',                 'Sanjana Pillai',  CURRENT_DATE + 3,  NULL,                            NULL,                                                 NULL),
    ('00000000-0000-0000-0000-000000fe2008', v_org, 'CAPA-2026-008', 'Mislabeled lot in finished-goods rack', 'FG operator noticed two ECG units labeled with wrong serial range', 'INTERNAL', 'INC-2026-0089', 'BOTH',       'CRITICAL', 'IN_PROGRESS',          'Anand Iyer',      CURRENT_DATE + 2,  NULL,                            'Label printer queue buffer not cleared between runs','Pending verification on 100-unit print run'),
    ('00000000-0000-0000-0000-000000fe2009', v_org, 'CAPA-2026-009', 'IR thermometer reading mismatch', 'Process hall IR thermometer reading 4C higher than reference', 'INTERNAL', 'INC-2026-0092', 'CORRECTIVE', 'LOW',      'CANCELLED',            'Vikram Reddy',    CURRENT_DATE - 5,  NULL,                            'Found to be measurement-distance error, not equipment','Closed without action — operator retraining instead'),
    ('00000000-0000-0000-0000-000000fe2010', v_org, 'CAPA-2026-010', 'Customer complaint: noisy fan in batch FG-2026-03', 'Two installs reported audible fan noise above spec', 'COMPLAINT','COMP-2026-011', 'CORRECTIVE', 'MEDIUM',   'PENDING_VERIFICATION', 'Rohit Saxena',    CURRENT_DATE + 8,  NULL,                            'Vendor supplied wrong fan grade for one batch',     'Field replacement underway; check at 30-day mark')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 3. E-Way Bills (GST EWB register)
  -- ============================================================
  INSERT INTO eway_bills (
    id, org_id, ewb_number, invoice_number, invoice_date, invoice_value,
    consignor_gstin, consignee_gstin, consignee_name, from_place, from_state_code,
    to_place, to_state_code, distance_km, transport_mode, vehicle_number,
    transporter_name, status, generated_at, valid_until
  ) VALUES
    ('00000000-0000-0000-0000-000000fe3001', v_org, '281000123456', 'INV-2026-0117', CURRENT_DATE - 8,  '485000.00', '29AAAAA0000A1Z5', '29APOLLO1234B1Z6', 'Apollo Hospitals', 'Bangalore', '29', 'Chennai',   '33', 350,  'ROAD', 'KA01AB1234', 'Swift Logistics Ltd',  'ACTIVE',    now() - interval '8 days', now() + interval '7 days'),
    ('00000000-0000-0000-0000-000000fe3002', v_org, '281000123457', 'INV-2026-0118', CURRENT_DATE - 7,  '725000.00', '29AAAAA0000A1Z5', '06FORTIS5678C1Z7', 'Fortis Healthcare','Bangalore', '29', 'Gurugram',  '06', 2080, 'ROAD', 'KA01CD5678', 'Swift Logistics Ltd',  'ACTIVE',    now() - interval '7 days', now() + interval '14 days'),
    ('00000000-0000-0000-0000-000000fe3003', v_org, '281000123458', 'INV-2026-0119', CURRENT_DATE - 6,  '99800.00',  '29AAAAA0000A1Z5', '27MANIPAL9012D1Z8','Manipal Hospitals', 'Bangalore','29', 'Pune',      '27', 870,  'ROAD', 'KA01EF9012', 'Swift Logistics Ltd',  'ACTIVE',    now() - interval '6 days', now() + interval '4 days'),
    ('00000000-0000-0000-0000-000000fe3004', v_org, '281000123459', 'INV-2026-0120', CURRENT_DATE - 5,  '1245000.00','29AAAAA0000A1Z5', '07AIIMS3456E1Z9',  'AIIMS Delhi',      'Bangalore', '29', 'New Delhi', '07', 2150, 'AIR',  NULL,        'Blue Dart Aviation',   'ACTIVE',    now() - interval '5 days', now() + interval '15 days'),
    ('00000000-0000-0000-0000-000000fe3005', v_org, '281000123460', 'INV-2026-0121', CURRENT_DATE - 4,  '54600.00',  '29AAAAA0000A1Z5', '29APOLLO1234B1Z6', 'Apollo Hospitals', 'Bangalore', '29', 'Mysuru',    '29', 145,  'ROAD', 'KA01GH3456', 'In-house Fleet',       'ACTIVE',    now() - interval '4 days', now() + interval '1 days'),
    ('00000000-0000-0000-0000-000000fe3006', v_org, '281000123461', 'INV-2026-0122', CURRENT_DATE - 3,  '67500.00',  '29AAAAA0000A1Z5', '36HCG7890F1Z0',    'HCG Cancer Centre','Bangalore', '29', 'Hyderabad', '36', 575,  'ROAD', 'KA01IJ7890', 'Swift Logistics Ltd',  'ACTIVE',    now() - interval '3 days', now() + interval '2 days'),
    ('00000000-0000-0000-0000-000000fe3007', v_org, '281000123462', 'INV-2026-0115', CURRENT_DATE - 12, '85000.00',  '29AAAAA0000A1Z5', '24RUBY1122G1Z1',   'Ruby Hall Clinic', 'Bangalore', '29', 'Ahmedabad', '24', 1490, 'ROAD', 'KA01KL1122', 'VRL Logistics',        'EXPIRED',   now() - interval '12 days',now() - interval '4 days'),
    ('00000000-0000-0000-0000-000000fe3008', v_org, '281000123463', 'INV-2026-0116', CURRENT_DATE - 10, '52400.00',  '29AAAAA0000A1Z5', '19TATAMED3344H1Z2','Tata Medical',     'Bangalore', '29', 'Kolkata',   '19', 1880, 'ROAD', 'KA01MN3344', 'Gati-KWE',             'CANCELLED', now() - interval '10 days', now() - interval '6 days'),
    ('00000000-0000-0000-0000-000000fe3009', v_org, '281000123464', 'INV-2026-0123', CURRENT_DATE - 2,  '198500.00', '29AAAAA0000A1Z5', '32KIMS5566I1Z3',   'KIMS Hospital',    'Bangalore', '29', 'Trivandrum','32', 590,  'ROAD', 'KA01OP5566', 'Swift Logistics Ltd',  'ACTIVE',    now() - interval '2 days', now() + interval '6 days'),
    ('00000000-0000-0000-0000-000000fe3010', v_org, '281000123465', 'INV-2026-0124', CURRENT_DATE - 1,  '375000.00', '29AAAAA0000A1Z5', '06MAXHC7788J1Z4',  'Max Healthcare',   'Bangalore', '29', 'Saket',     '07', 2150, 'AIR',  NULL,        'Blue Dart Aviation',   'ACTIVE',    now() - interval '1 days', now() + interval '14 days')
  ON CONFLICT (id) DO NOTHING;

END $$;

UPDATE eway_bills
   SET cancelled_at = now() - interval '7 days',
       cancellation_reason = 'Customer cancelled order before dispatch'
 WHERE id = '00000000-0000-0000-0000-000000fe3008'
   AND cancelled_at IS NULL;
