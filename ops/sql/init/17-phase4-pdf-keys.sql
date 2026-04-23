-- Phase 4 §4.1 — extend every document entity that participates in the
-- pdf-render pipeline with a `pdf_minio_key` column. Mirrors qc_certs.
--
-- Doc types covered (matches pdf_render_runs.doc_type CHECK):
--   sales_invoice    → sales_invoices.pdf_minio_key
--   purchase_order   → purchase_orders.pdf_minio_key
--   delivery_challan → sales_orders.pdf_minio_key     (DC is an SO view)
--   grn              → grns.pdf_minio_key
--
-- Idempotent via IF NOT EXISTS — safe on re-apply. Non-breaking: column
-- is nullable and null-by-default, so existing rows + existing INSERTs
-- continue to work unchanged. The processor stamps this value only
-- after the corresponding pdf_render_runs row flips to COMPLETED.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS pdf_minio_key text;
COMMENT ON COLUMN sales_invoices.pdf_minio_key IS
  'Phase-4 §4.1: MinIO/S3 object key for the rendered invoice PDF. NULL until pdf-render worker completes.';

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS pdf_minio_key text;
COMMENT ON COLUMN purchase_orders.pdf_minio_key IS
  'Phase-4 §4.1: MinIO/S3 object key for the rendered PO PDF. NULL until pdf-render worker completes.';

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS pdf_minio_key text;
COMMENT ON COLUMN sales_orders.pdf_minio_key IS
  'Phase-4 §4.1: MinIO/S3 object key for the rendered Delivery Challan PDF. DC is a shipment view of the sales order, so the key lives on sales_orders. NULL until pdf-render worker completes.';

ALTER TABLE grns
  ADD COLUMN IF NOT EXISTS pdf_minio_key text;
COMMENT ON COLUMN grns.pdf_minio_key IS
  'Phase-4 §4.1: MinIO/S3 object key for the rendered GRN PDF. NULL until pdf-render worker completes.';
