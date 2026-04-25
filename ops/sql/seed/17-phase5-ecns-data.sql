-- Phase 5 — engineering change notice (ECN) dev seeds.
--
-- Idempotent: stable UUIDs + ON CONFLICT DO NOTHING. Maps onto
-- ops/sql/init/23-phase5-ecns-table.sql.
--
-- UUID fixture convention:
--   fe4xxx — engineering_change_notices rows
--
-- References to existing fixtures:
--   v_pr_ecg   = 00000000-0000-0000-0000-000000fc0001  (ECG Patient Monitor v2)
--   v_pr_spir  = 00000000-0000-0000-0000-000000fc0002  (Digital Spirometer C1)
--   v_bm_ecg3  = 00000000-0000-0000-0000-000000fc0101  (ECG v3 ACTIVE)
--   v_bm_ecg2  = 00000000-0000-0000-0000-000000fc0102  (ECG v2 SUPERSEDED)
--   v_bm_spir1 = 00000000-0000-0000-0000-000000fc0103  (Spiro v1 ACTIVE)

DO $$
DECLARE
  v_org      uuid := '00000000-0000-0000-0000-00000000a001';
  v_pr_ecg   uuid := '00000000-0000-0000-0000-000000fc0001';
  v_pr_spir  uuid := '00000000-0000-0000-0000-000000fc0002';
  v_bm_ecg3  uuid := '00000000-0000-0000-0000-000000fc0101';
  v_bm_ecg2  uuid := '00000000-0000-0000-0000-000000fc0102';
  v_bm_spir1 uuid := '00000000-0000-0000-0000-000000fc0103';
BEGIN
  PERFORM set_config('app.current_org', v_org::text, true);

  INSERT INTO engineering_change_notices (
    id, org_id, ecn_number, title, description, change_type, severity, status,
    affected_product_id, affected_bom_id,
    reason, proposed_change, impact_summary,
    raised_by, approved_by, approved_at, implemented_at,
    target_implementation_date
  ) VALUES
    (
      '00000000-0000-0000-0000-000000fe4001', v_org,
      'ECN-2026-001',
      'Replace ECG front-end op-amp with low-noise variant',
      'Customer feedback: baseline noise above spec on 12-lead readouts. Switch from AD8232 to AD8233 for 30% lower input-referred noise.',
      'DESIGN', 'HIGH', 'IMPLEMENTED',
      v_pr_ecg, v_bm_ecg3,
      'Field complaints from Apollo + Fortis on baseline noise',
      'Replace U3 (AD8232) with AD8233 on PCBA-ECG-V3. Update reference designator silkscreen.',
      'BOM v3 supersedes v2; cost impact +₹85/unit; tooling change none.',
      'Anand Iyer', 'Sanjana Pillai',
      now() - interval '90 days', now() - interval '60 days',
      CURRENT_DATE - 60
    ),
    (
      '00000000-0000-0000-0000-000000fe4002', v_org,
      'ECN-2026-002',
      'Update ECG enclosure plastic to UL94 V-0 grade',
      'Regulatory requirement: medical device flammability rating. Migrate from V-2 to V-0 polycarbonate.',
      'MATERIAL', 'CRITICAL', 'APPROVED',
      v_pr_ecg, v_bm_ecg3,
      'CDSCO compliance — flammability spec change',
      'Switch enclosure supplier line item from PC-V2-GRY to PC-V0-GRY. Validate fit on 5 prototypes.',
      'Cost +₹220/unit; validation lead time 3 weeks; no tooling change.',
      'Vikram Reddy', 'Sanjana Pillai',
      now() - interval '20 days', NULL,
      CURRENT_DATE + 14
    ),
    (
      '00000000-0000-0000-0000-000000fe4003', v_org,
      'ECN-2026-003',
      'Spirometer flow sensor calibration interval reduction',
      'Drift observed at 6 months in field; reduce factory calibration interval from 12 to 6 months for first 1000 units.',
      'PROCESS', 'MEDIUM', 'PENDING_REVIEW',
      v_pr_spir, v_bm_spir1,
      'CAPA-2026-003 root cause: aging on reference voltage chip',
      'Update WIP_TEMPLATE_SPIR final-QC cycle to flag 6-month recal sticker.',
      'Adds 8 minutes per unit on final QC stage; capacity loss ~6%.',
      'Anand Iyer', NULL, NULL, NULL,
      CURRENT_DATE + 30
    ),
    (
      '00000000-0000-0000-0000-000000fe4004', v_org,
      'ECN-2026-004',
      'Add tamper-evident label to finished-goods packaging',
      'Quality complaint: two units returned with broken inner foil but no outer-box evidence.',
      'PROCESS', 'MEDIUM', 'IMPLEMENTED',
      v_pr_ecg, v_bm_ecg3,
      'COMP-2026-009 — tamper evidence on FG packaging',
      'Insert "Quality Sealed" hologram label at packaging stage. Update PKG SOP rev to 2.4.',
      'Material cost +₹4/unit; one extra QC checkpoint.',
      'Rohit Saxena', 'Sanjana Pillai',
      now() - interval '40 days', now() - interval '15 days',
      CURRENT_DATE - 15
    ),
    (
      '00000000-0000-0000-0000-000000fe4005', v_org,
      'ECN-2026-005',
      'Update ECG IFU to reflect software v4.2 features',
      'Documentation refresh — IFU still references software v3.8 alarm thresholds.',
      'DOCUMENTATION', 'LOW', 'DRAFT',
      v_pr_ecg, NULL,
      'Software release v4.2 shipped; manual not refreshed',
      'Re-author IFU sections 4.3-4.7 + safety symbols glossary. Print run ~2000 copies.',
      'No production impact; doc-only release.',
      'Sanjana Pillai', NULL, NULL, NULL,
      CURRENT_DATE + 45
    ),
    (
      '00000000-0000-0000-0000-000000fe4006', v_org,
      'ECN-2026-006',
      'Replace inrush limiter on PSU input',
      'Vendor end-of-life on existing NTC thermistor; identify drop-in replacement.',
      'MATERIAL', 'HIGH', 'PENDING_REVIEW',
      v_pr_ecg, v_bm_ecg3,
      'Vendor EOL on B57364S0103M000',
      'Switch to TDK B57364S0153M000 (15 ohm). Validate inrush profile with bench tests.',
      'Bench testing 2 weeks; component cost neutral; supply lead time +1 week.',
      'Vikram Reddy', NULL, NULL, NULL,
      CURRENT_DATE + 21
    ),
    (
      '00000000-0000-0000-0000-000000fe4007', v_org,
      'ECN-2026-007',
      'Spirometer mouthpiece switch to bio-compatible TPE',
      'Customer hospital request for non-PVC mouthpiece due to procurement policy.',
      'MATERIAL', 'MEDIUM', 'REJECTED',
      v_pr_spir, v_bm_spir1,
      'Customer procurement policy on PVC-free consumables',
      'Replace MOUTHPIECE-PVC-A with TPE alternative; validate ISO 10993 biocompatibility.',
      'Validation cost ₹4 lakh; cost +₹18/unit; lead time 8 weeks.',
      'Priya Krishnan', 'Sanjana Pillai',
      now() - interval '30 days', NULL,
      NULL
    ),
    (
      '00000000-0000-0000-0000-000000fe4008', v_org,
      'ECN-2026-008',
      'Switch ECG v2 (legacy) to retire-only mode',
      'BOM v2 superseded by v3 in Jan 2026. No further production runs to be planned.',
      'PROCESS', 'LOW', 'IMPLEMENTED',
      v_pr_ecg, v_bm_ecg2,
      'Supersession of ECG BOM v2',
      'Block work-order creation against bom v2 (status already SUPERSEDED). Update planning notes.',
      'No active production impact; field service still consumes legacy spares.',
      'Anand Iyer', 'Sanjana Pillai',
      now() - interval '120 days', now() - interval '110 days',
      CURRENT_DATE - 110
    ),
    (
      '00000000-0000-0000-0000-000000fe4009', v_org,
      'ECN-2026-009',
      'Add humidity sensor to climatic chamber (CHM-001)',
      'Reliability lab needs humidity logging for 85/85 stress tests.',
      'DESIGN', 'MEDIUM', 'CANCELLED',
      NULL, NULL,
      'New 85/85 stress test program for ECG variants',
      'Retrofit Honeywell HIH-4030 + serial logger to existing chamber.',
      'Capex ₹65k; chamber out of service for 4 days.',
      'Vikram Reddy', NULL, NULL, NULL,
      NULL
    ),
    (
      '00000000-0000-0000-0000-000000fe4010', v_org,
      'ECN-2026-010',
      'Tighten ECG output stage assembly torque spec',
      'NCR-2026-0014 root cause analysis: solder mask defect linked to over-torque on M3 fasteners.',
      'PROCESS', 'CRITICAL', 'PENDING_REVIEW',
      v_pr_ecg, v_bm_ecg3,
      'NCR-2026-0014 / CAPA-2026-001 — assembly torque',
      'Update assembly SOP-ECG-V3 torque spec from 0.6 N·m to 0.45 N·m. Train all 3 lines.',
      'Operator training 1 day per line; no material impact.',
      'Priya Krishnan', NULL, NULL, NULL,
      CURRENT_DATE + 10
    )
  ON CONFLICT (id) DO NOTHING;

END $$;
