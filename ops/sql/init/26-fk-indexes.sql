-- 26-fk-indexes.sql — backfill missing indexes on foreign-key columns.
--
-- Postgres does NOT auto-create indexes on FK columns (only on the
-- PRIMARY KEY side of the relationship). Without these, every JOIN
-- through them and every `WHERE fk_col = ?` does a sequential scan,
-- which is fine on 100 rows and catastrophic on 100k.
--
-- All statements use `CREATE INDEX IF NOT EXISTS` so the file is
-- idempotent: safe to re-run, safe to ship to dev/staging/prod.
-- For production deploys against a populated database where you can't
-- afford a write lock, swap `CREATE INDEX` for `CREATE INDEX CONCURRENTLY`
-- (must run as standalone statements outside any transaction).
--
-- Generated 2026-05-02 from a join of information_schema.table_constraints
-- against pg_index — anything where an FK column lacked a covering index
-- (column itself or as the leading column of a composite). Re-run that
-- audit query before adding more indexes here.

CREATE INDEX IF NOT EXISTS approval_chain_definitions_created_by_idx ON public.approval_chain_definitions (created_by);
CREATE INDEX IF NOT EXISTS approval_requests_chain_def_id_idx ON public.approval_requests (chain_def_id);
CREATE INDEX IF NOT EXISTS approval_requests_completed_by_idx ON public.approval_requests (completed_by);
CREATE INDEX IF NOT EXISTS bom_versions_approved_by_idx ON public.bom_versions (approved_by);
CREATE INDEX IF NOT EXISTS bom_versions_created_by_idx ON public.bom_versions (created_by);
CREATE INDEX IF NOT EXISTS customer_ledger_recorded_by_idx ON public.customer_ledger (recorded_by);
CREATE INDEX IF NOT EXISTS deals_contact_id_idx ON public.deals (contact_id);
CREATE INDEX IF NOT EXISTS deals_discount_approved_by_idx ON public.deals (discount_approved_by);
CREATE INDEX IF NOT EXISTS deals_lead_id_idx ON public.deals (lead_id);
CREATE INDEX IF NOT EXISTS engineering_change_notices_affected_bom_id_idx ON public.engineering_change_notices (affected_bom_id);
CREATE INDEX IF NOT EXISTS grn_lines_item_id_idx ON public.grn_lines (item_id);
CREATE INDEX IF NOT EXISTS grn_lines_po_line_id_idx ON public.grn_lines (po_line_id);
CREATE INDEX IF NOT EXISTS grns_posted_by_idx ON public.grns (posted_by);
CREATE INDEX IF NOT EXISTS grns_received_by_idx ON public.grns (received_by);
CREATE INDEX IF NOT EXISTS grns_vendor_id_idx ON public.grns (vendor_id);
CREATE INDEX IF NOT EXISTS grns_warehouse_id_idx ON public.grns (warehouse_id);
CREATE INDEX IF NOT EXISTS indent_lines_item_id_idx ON public.indent_lines (item_id);
CREATE INDEX IF NOT EXISTS indents_approved_by_idx ON public.indents (approved_by);
CREATE INDEX IF NOT EXISTS indents_requested_by_idx ON public.indents (requested_by);
CREATE INDEX IF NOT EXISTS inspection_templates_created_by_idx ON public.inspection_templates (created_by);
CREATE INDEX IF NOT EXISTS items_default_warehouse_id_idx ON public.items (default_warehouse_id);
CREATE INDEX IF NOT EXISTS lead_activities_actor_id_idx ON public.lead_activities (actor_id);
CREATE INDEX IF NOT EXISTS leads_converted_to_account_id_idx ON public.leads (converted_to_account_id);
CREATE INDEX IF NOT EXISTS leads_converted_to_deal_id_idx ON public.leads (converted_to_deal_id);
CREATE INDEX IF NOT EXISTS leads_duplicate_of_lead_id_idx ON public.leads (duplicate_of_lead_id);
CREATE INDEX IF NOT EXISTS manual_entry_queue_enqueued_by_idx ON public.manual_entry_queue (enqueued_by);
CREATE INDEX IF NOT EXISTS manual_entry_queue_resolved_by_idx ON public.manual_entry_queue (resolved_by);
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS notification_dispatch_dlq_recipient_user_id_idx ON public.notification_dispatch_dlq (recipient_user_id);
CREATE INDEX IF NOT EXISTS notification_dispatch_dlq_resolved_by_idx ON public.notification_dispatch_dlq (resolved_by);
CREATE INDEX IF NOT EXISTS notification_dispatch_dlq_template_id_idx ON public.notification_dispatch_dlq (template_id);
CREATE INDEX IF NOT EXISTS notification_templates_created_by_idx ON public.notification_templates (created_by);
CREATE INDEX IF NOT EXISTS notifications_template_id_idx ON public.notifications (template_id);
CREATE INDEX IF NOT EXISTS payments_recorded_by_idx ON public.payments (recorded_by);
CREATE INDEX IF NOT EXISTS payments_voided_by_idx ON public.payments (voided_by);
CREATE INDEX IF NOT EXISTS pdf_render_dlq_resolved_by_idx ON public.pdf_render_dlq (resolved_by);
CREATE INDEX IF NOT EXISTS po_lines_indent_line_id_idx ON public.po_lines (indent_line_id);
CREATE INDEX IF NOT EXISTS po_lines_item_id_idx ON public.po_lines (item_id);
CREATE INDEX IF NOT EXISTS products_active_bom_id_idx ON public.products (active_bom_id);
CREATE INDEX IF NOT EXISTS purchase_invoice_lines_grn_line_id_idx ON public.purchase_invoice_lines (grn_line_id);
CREATE INDEX IF NOT EXISTS purchase_invoice_lines_item_id_idx ON public.purchase_invoice_lines (item_id);
CREATE INDEX IF NOT EXISTS purchase_invoices_cancelled_by_idx ON public.purchase_invoices (cancelled_by);
CREATE INDEX IF NOT EXISTS purchase_invoices_created_by_idx ON public.purchase_invoices (created_by);
CREATE INDEX IF NOT EXISTS purchase_invoices_grn_id_idx ON public.purchase_invoices (grn_id);
CREATE INDEX IF NOT EXISTS purchase_invoices_posted_by_idx ON public.purchase_invoices (posted_by);
CREATE INDEX IF NOT EXISTS purchase_orders_approved_by_idx ON public.purchase_orders (approved_by);
CREATE INDEX IF NOT EXISTS purchase_orders_created_by_idx ON public.purchase_orders (created_by);
CREATE INDEX IF NOT EXISTS purchase_orders_delivery_warehouse_id_idx ON public.purchase_orders (delivery_warehouse_id);
CREATE INDEX IF NOT EXISTS purchase_orders_indent_id_idx ON public.purchase_orders (indent_id);
CREATE INDEX IF NOT EXISTS qc_certs_product_id_idx ON public.qc_certs (product_id);
CREATE INDEX IF NOT EXISTS qc_certs_signed_by_idx ON public.qc_certs (signed_by);
CREATE INDEX IF NOT EXISTS qc_findings_parameter_id_idx ON public.qc_findings (parameter_id);
CREATE INDEX IF NOT EXISTS qc_inspections_created_by_idx ON public.qc_inspections (created_by);
CREATE INDEX IF NOT EXISTS qc_inspections_item_id_idx ON public.qc_inspections (item_id);
CREATE INDEX IF NOT EXISTS qc_inspections_product_id_idx ON public.qc_inspections (product_id);
CREATE INDEX IF NOT EXISTS qc_inspections_template_id_idx ON public.qc_inspections (template_id);
CREATE INDEX IF NOT EXISTS quotations_approved_by_idx ON public.quotations (approved_by);
CREATE INDEX IF NOT EXISTS quotations_contact_id_idx ON public.quotations (contact_id);
CREATE INDEX IF NOT EXISTS quotations_converted_to_order_id_idx ON public.quotations (converted_to_order_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_org_id_idx ON public.refresh_tokens (org_id);
CREATE INDEX IF NOT EXISTS sales_invoice_lines_item_id_idx ON public.sales_invoice_lines (item_id);
CREATE INDEX IF NOT EXISTS sales_invoice_lines_product_id_idx ON public.sales_invoice_lines (product_id);
CREATE INDEX IF NOT EXISTS sales_invoices_cancelled_by_idx ON public.sales_invoices (cancelled_by);
CREATE INDEX IF NOT EXISTS sales_invoices_created_by_idx ON public.sales_invoices (created_by);
CREATE INDEX IF NOT EXISTS sales_invoices_posted_by_idx ON public.sales_invoices (posted_by);
CREATE INDEX IF NOT EXISTS sales_orders_contact_id_idx ON public.sales_orders (contact_id);
CREATE INDEX IF NOT EXISTS sales_orders_finance_approved_by_idx ON public.sales_orders (finance_approved_by);
CREATE INDEX IF NOT EXISTS stock_ledger_posted_by_idx ON public.stock_ledger (posted_by);
CREATE INDEX IF NOT EXISTS stock_reservations_consumed_by_idx ON public.stock_reservations (consumed_by);
CREATE INDEX IF NOT EXISTS stock_reservations_consumed_ledger_id_idx ON public.stock_reservations (consumed_ledger_id);
CREATE INDEX IF NOT EXISTS stock_reservations_released_by_idx ON public.stock_reservations (released_by);
CREATE INDEX IF NOT EXISTS stock_reservations_reserved_by_idx ON public.stock_reservations (reserved_by);
CREATE INDEX IF NOT EXISTS subscriptions_plan_id_idx ON public.subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS ticket_comments_actor_id_idx ON public.ticket_comments (actor_id);
CREATE INDEX IF NOT EXISTS tickets_contact_id_idx ON public.tickets (contact_id);
CREATE INDEX IF NOT EXISTS user_invitations_invited_by_idx ON public.user_invitations (invited_by);
CREATE INDEX IF NOT EXISTS user_invitations_role_id_idx ON public.user_invitations (role_id);
CREATE INDEX IF NOT EXISTS vendor_ledger_recorded_by_idx ON public.vendor_ledger (recorded_by);
CREATE INDEX IF NOT EXISTS warehouses_manager_id_idx ON public.warehouses (manager_id);
CREATE INDEX IF NOT EXISTS wip_stages_assigned_to_idx ON public.wip_stages (assigned_to);
CREATE INDEX IF NOT EXISTS wip_stages_template_id_idx ON public.wip_stages (template_id);
CREATE INDEX IF NOT EXISTS work_orders_assigned_to_idx ON public.work_orders (assigned_to);
CREATE INDEX IF NOT EXISTS work_orders_bom_id_idx ON public.work_orders (bom_id);
CREATE INDEX IF NOT EXISTS work_orders_created_by_idx ON public.work_orders (created_by);
CREATE INDEX IF NOT EXISTS workflow_transitions_actor_role_idx ON public.workflow_transitions (actor_role);
CREATE INDEX IF NOT EXISTS workflow_transitions_step_id_idx ON public.workflow_transitions (step_id);

