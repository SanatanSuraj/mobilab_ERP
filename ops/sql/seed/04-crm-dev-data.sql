-- Dev-only CRM seed data. Mirrors ARCHITECTURE.md §13.1 sample rows so a
-- fresh `pnpm infra:up && pnpm db:migrate` boot has something to click on.
--
-- Rules:
--   * All IDs are stable deterministic UUIDs so re-running the seed is idempotent.
--   * All rows belong to the same Dev org seeded in 03-dev-org-users.sql.
--   * No audit actor set here — the audit trigger tolerates NULL.
--   * kept in seed/ so prod migrations never run it (Gate 7).

DO $$
DECLARE
  v_org     uuid := '00000000-0000-0000-0000-00000000a001';
  v_sales   uuid := '00000000-0000-0000-0000-00000000b003'; -- Sales Rep
  v_salesm  uuid := '00000000-0000-0000-0000-00000000b004'; -- Sales Manager
  v_qcmgr   uuid := '00000000-0000-0000-0000-00000000b00a'; -- QC Manager (support)
BEGIN
  -- Set RLS context so the inserts below pass the tenant policies.
  PERFORM set_config('app.current_org', v_org::text, true);

  -- ─── Accounts ───────────────────────────────────────────────────────────
  INSERT INTO accounts (
    id, org_id, name, industry, website, phone, email, city, state, country,
    gstin, health_score, is_key_account, annual_revenue, employee_count,
    owner_id
  ) VALUES
    ('00000000-0000-0000-0000-0000000ac001', v_org, 'Apollo Hospitals',   'HEALTHCARE', 'apollo.example.com',  '+91-40-0000001', 'accounts@apollo.example.com',   'Hyderabad',     'TG', 'IN', '36AABCA1234D1Z5', 80, true,  '250000000.00', 5000, v_salesm),
    ('00000000-0000-0000-0000-0000000ac002', v_org, 'Fortis Healthcare',  'HEALTHCARE', 'fortis.example.com',  '+91-11-0000002', 'purchasing@fortis.example.com', 'Delhi',         'DL', 'IN', '07AABCF5678K1Z9', 72, true,  '180000000.00', 3000, v_salesm),
    ('00000000-0000-0000-0000-0000000ac003', v_org, 'City Diagnostics',   'DIAGNOSTICS','citydiag.example.com','+91-22-0000003', 'procurement@citydiag.example.com','Mumbai',       'MH', 'IN', '27AABCC3456P1Z1', 55, false, '35000000.00',   250, v_sales),
    ('00000000-0000-0000-0000-0000000ac004', v_org, 'Rural Health Mission','NGO',       'rhm.example.com',     '+91-80-0000004', 'admin@rhm.example.com',         'Bengaluru',    'KA', 'IN', NULL,              40, false, '5000000.00',     80,  v_sales)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Contacts ───────────────────────────────────────────────────────────
  INSERT INTO contacts (
    id, org_id, account_id, first_name, last_name, email, phone,
    designation, department, is_primary
  ) VALUES
    ('00000000-0000-0000-0000-0000000cc001', v_org, '00000000-0000-0000-0000-0000000ac001', 'Ravi',     'Menon',  'ravi.menon@apollo.example.com',    '+91-98000-11001', 'Head of Biomedical Engineering', 'Biomedical', true),
    ('00000000-0000-0000-0000-0000000cc002', v_org, '00000000-0000-0000-0000-0000000ac001', 'Anjali',   'Gupta',  'anjali.gupta@apollo.example.com',  '+91-98000-11002', 'Procurement Manager',            'Purchasing', false),
    ('00000000-0000-0000-0000-0000000cc003', v_org, '00000000-0000-0000-0000-0000000ac002', 'Vikram',   'Shah',   'vikram.shah@fortis.example.com',   '+91-98000-11003', 'Chief Technology Officer',       'IT',         true),
    ('00000000-0000-0000-0000-0000000cc004', v_org, '00000000-0000-0000-0000-0000000ac003', 'Priya',    'Iyer',   'priya.iyer@citydiag.example.com',  '+91-98000-11004', 'Operations Lead',                'Operations', true)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Leads ──────────────────────────────────────────────────────────────
  INSERT INTO leads (
    id, org_id, name, company, email, phone, status, source, assigned_to,
    estimated_value
  ) VALUES
    ('00000000-0000-0000-0000-0000000dd001', v_org, 'Sameer Khan',    'Star Labs',         'sameer@starlabs.example.com',      '+91-99900-00001', 'NEW',       'WEBSITE',       v_sales,  '2500000.00'),
    ('00000000-0000-0000-0000-0000000dd002', v_org, 'Meera Nair',     'Greenvalley Clinics','meera@greenvalley.example.com',   '+91-99900-00002', 'CONTACTED', 'REFERRAL',      v_sales,  '1500000.00'),
    ('00000000-0000-0000-0000-0000000dd003', v_org, 'Arjun Desai',    'Unified Hospitals', 'arjun@unifiedhospitals.example.com','+91-99900-00003','QUALIFIED', 'EXHIBITION',    v_salesm, '8000000.00')
  ON CONFLICT (id) DO NOTHING;

  -- Seed a few activities so the timeline isn't empty.
  INSERT INTO lead_activities (id, org_id, lead_id, type, content, actor_id) VALUES
    ('00000000-0000-0000-0000-0000000ad001', v_org, '00000000-0000-0000-0000-0000000dd001', 'NOTE',    'Inbound demo request from website.', v_sales),
    ('00000000-0000-0000-0000-0000000ad002', v_org, '00000000-0000-0000-0000-0000000dd002', 'CALL',    'Spoke to Meera — sent brochure.',    v_sales),
    ('00000000-0000-0000-0000-0000000ad003', v_org, '00000000-0000-0000-0000-0000000dd003', 'MEETING', 'Demo at their Pune branch.',        v_salesm)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Deal number counter seed ───────────────────────────────────────────
  -- Pre-insert so the two seeded deals below use DEAL-YYYY-0001 and 0002.
  INSERT INTO crm_number_sequences (org_id, kind, year, last_seq) VALUES
    (v_org, 'DEAL',   extract(year from now())::int, 2),
    (v_org, 'TICKET', extract(year from now())::int, 2)
  ON CONFLICT (org_id, kind, year) DO UPDATE SET last_seq = GREATEST(crm_number_sequences.last_seq, EXCLUDED.last_seq);

  -- ─── Deals ──────────────────────────────────────────────────────────────
  INSERT INTO deals (
    id, org_id, deal_number, title, account_id, contact_id, company,
    contact_name, stage, value, probability, assigned_to, expected_close
  ) VALUES
    ('00000000-0000-0000-0000-0000000de001', v_org,
       'DEAL-' || extract(year from now())::text || '-0001',
       'Apollo — 50x patient monitors', '00000000-0000-0000-0000-0000000ac001',
       '00000000-0000-0000-0000-0000000cc001', 'Apollo Hospitals', 'Ravi Menon',
       'NEGOTIATION', '4500000.00', 60, v_salesm,
       (now() + interval '45 days')::date),
    ('00000000-0000-0000-0000-0000000de002', v_org,
       'DEAL-' || extract(year from now())::text || '-0002',
       'Fortis — pilot deployment', '00000000-0000-0000-0000-0000000ac002',
       '00000000-0000-0000-0000-0000000cc003', 'Fortis Healthcare', 'Vikram Shah',
       'PROPOSAL', '1800000.00', 40, v_sales,
       (now() + interval '60 days')::date)
  ON CONFLICT (id) DO NOTHING;

  -- ─── Tickets ────────────────────────────────────────────────────────────
  INSERT INTO tickets (
    id, org_id, ticket_number, account_id, contact_id, subject, description,
    category, priority, status, device_serial, product_code, assigned_to,
    sla_deadline
  ) VALUES
    ('00000000-0000-0000-0000-0000000ee001', v_org,
       'TK-' || extract(year from now())::text || '-0001',
       '00000000-0000-0000-0000-0000000ac001',
       '00000000-0000-0000-0000-0000000cc001',
       'ECG monitor display flickers',
       'The ECG waveform on device #MLB-ECG-00012 flickers intermittently during use. Issue persists after soft reset.',
       'HARDWARE_DEFECT', 'HIGH', 'IN_PROGRESS',
       'MLB-ECG-00012', 'ECG-MONITOR-V2', v_qcmgr,
       now() + interval '2 days'),
    ('00000000-0000-0000-0000-0000000ee002', v_org,
       'TK-' || extract(year from now())::text || '-0002',
       '00000000-0000-0000-0000-0000000ac003',
       '00000000-0000-0000-0000-0000000cc004',
       'Annual calibration requested',
       'City Diagnostics requested the yearly calibration visit for their spirometer fleet (6 units).',
       'CALIBRATION', 'MEDIUM', 'OPEN',
       NULL, 'SPIROMETER-C1', v_qcmgr,
       now() + interval '14 days')
  ON CONFLICT (id) DO NOTHING;

  -- Seed an internal comment on the first ticket.
  INSERT INTO ticket_comments (id, org_id, ticket_id, visibility, actor_id, content) VALUES
    ('00000000-0000-0000-0000-0000000ec001', v_org,
       '00000000-0000-0000-0000-0000000ee001', 'INTERNAL', v_qcmgr,
       'Reproduced on bench — capacitor C17 likely out of spec. Sourcing replacement.')
  ON CONFLICT (id) DO NOTHING;
END $$;
