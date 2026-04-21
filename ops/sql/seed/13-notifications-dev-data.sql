-- Dev-only Notifications seed. ARCHITECTURE.md §13.7.
--
-- Provides a browsable dataset for the /notifications page:
--   * 3 IN_APP notification templates (work_order.created, invoice.sent,
--     ticket.created)
--   * 1 EMAIL template (invoice.sent) so the admin UI shows a multi-channel
--     template listing
--   * ~6 notifications delivered to the dev admin user (mix of read / unread,
--     different severities, cross-module events)
--
-- Rules (same as 12-finance-dev-data.sql):
--   * Stable deterministic UUIDs, idempotent re-run.
--   * References the dev admin user from 03-dev-org-users.sql.
--   * RLS context is set via set_config('app.current_org', ...).
--
-- UUID fixture conventions (ff7xx–ff8xx namespace — Notifications module):
--   ff7xx — notification_templates
--   ff8xx — notifications (inbox rows)

DO $$
DECLARE
  v_org        uuid := '00000000-0000-0000-0000-00000000a001';

  -- Users (from 03-dev-org-users.sql)
  v_admin      uuid := '00000000-0000-0000-0000-00000000b001';

  -- Templates
  v_tpl_wo     uuid := '00000000-0000-0000-0000-000000ff0701';
  v_tpl_inv    uuid := '00000000-0000-0000-0000-000000ff0702';
  v_tpl_inv_em uuid := '00000000-0000-0000-0000-000000ff0703';
  v_tpl_tkt    uuid := '00000000-0000-0000-0000-000000ff0704';

  -- Notifications (inbox rows)
  v_n1         uuid := '00000000-0000-0000-0000-000000ff0801';
  v_n2         uuid := '00000000-0000-0000-0000-000000ff0802';
  v_n3         uuid := '00000000-0000-0000-0000-000000ff0803';
  v_n4         uuid := '00000000-0000-0000-0000-000000ff0804';
  v_n5         uuid := '00000000-0000-0000-0000-000000ff0805';
  v_n6         uuid := '00000000-0000-0000-0000-000000ff0806';
BEGIN
  PERFORM set_config('app.current_org', v_org::text, true);

  -- Sanity: skip silently if dev org isn't seeded (test envs that don't run 03)
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org) THEN
    RAISE NOTICE 'dev org not seeded; skipping notifications dev data';
    RETURN;
  END IF;

  -- ── Templates ────────────────────────────────────────────────────────────
  INSERT INTO notification_templates (
    id, org_id, event_type, channel, name, description,
    subject_template, body_template, default_severity, is_active, created_by
  ) VALUES
    (v_tpl_wo, v_org, 'work_order.created', 'IN_APP',
     'Work Order Created',
     'Fires when a new work order is released to the floor.',
     NULL,
     'Work order {{workOrderNumber}} for {{productName}} has been released. Quantity: {{quantity}}.',
     'INFO', true, v_admin),
    (v_tpl_inv, v_org, 'invoice.sent', 'IN_APP',
     'Invoice Sent',
     'In-app ping when a sales invoice is posted to a customer.',
     NULL,
     'Invoice {{invoiceNumber}} for {{customerName}} ({{grandTotal}}) was posted.',
     'SUCCESS', true, v_admin),
    (v_tpl_inv_em, v_org, 'invoice.sent', 'EMAIL',
     'Invoice Sent (Email)',
     'Email version of invoice.sent — Phase 3 will dispatch this.',
     'Invoice {{invoiceNumber}} from Mobilab',
     'Hi {{customerName}},\n\nYour invoice {{invoiceNumber}} totalling {{grandTotal}} is ready. Please find it attached.\n\nThanks,\nMobilab',
     'INFO', true, v_admin),
    (v_tpl_tkt, v_org, 'ticket.created', 'IN_APP',
     'Support Ticket Created',
     'Alerts support staff when a new customer ticket is opened.',
     NULL,
     'New ticket "{{ticketSubject}}" opened by {{customerName}}. Priority: {{priority}}.',
     'WARNING', true, v_admin)
  ON CONFLICT (id) DO NOTHING;

  -- ── Notifications (inbox) ────────────────────────────────────────────────
  -- Mix of severities + read states so the UI has something to filter.
  INSERT INTO notifications (
    id, org_id, user_id, event_type, severity, title, body, link_url,
    reference_type, reference_id, template_id, is_read, read_at, created_at
  ) VALUES
    (v_n1, v_org, v_admin, 'work_order.created', 'INFO',
     'Work order WO-2026-0001 released',
     'Work order WO-2026-0001 for "Cardio-Pro V2" has been released. Quantity: 50.',
     '/production/work-orders', 'work_order', NULL, v_tpl_wo,
     false, NULL, now() - interval '2 hours'),
    (v_n2, v_org, v_admin, 'invoice.sent', 'SUCCESS',
     'Invoice SI-2026-0001 posted',
     'Invoice SI-2026-0001 for Apollo Hospitals (₹52,000) was posted.',
     '/finance/sales-invoices', 'sales_invoice', NULL, v_tpl_inv,
     false, NULL, now() - interval '3 hours'),
    (v_n3, v_org, v_admin, 'ticket.created', 'WARNING',
     'New support ticket: Calibration issue',
     'New ticket "Calibration drift on device #4711" opened by Fortis Healthcare. Priority: HIGH.',
     '/crm/tickets', 'ticket', NULL, v_tpl_tkt,
     false, NULL, now() - interval '30 minutes'),
    (v_n4, v_org, v_admin, 'batch.expiry_alert', 'ERROR',
     'Batch nearing expiry',
     'Batch RAW-NFC-TAG-2026/Q1 expires in 14 days. 120 units remaining.',
     '/inventory/batches', 'batch', NULL, NULL,
     true, now() - interval '1 day', now() - interval '2 days'),
    (v_n5, v_org, v_admin, 'approval.requested', 'CRITICAL',
     'Approval required: Purchase Order PO-2026-0005',
     'Finance approval required for PO-2026-0005 (₹1.2L). Requested by Ravi from Procurement.',
     '/procurement/purchase-orders', 'purchase_order', NULL, NULL,
     false, NULL, now() - interval '15 minutes'),
    (v_n6, v_org, v_admin, 'reorder.triggered', 'INFO',
     'Reorder triggered: NFC reader module',
     'Stock for "NFC reader module" fell below reorder point (30 units). Draft PO created.',
     '/procurement/indents', 'item', NULL, NULL,
     true, now() - interval '2 days', now() - interval '3 days')
  ON CONFLICT (id) DO NOTHING;

END $$;
