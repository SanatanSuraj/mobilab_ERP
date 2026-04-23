-- Phase 4 §4.1 — PDF render idempotency ledger + dead-letter queue.
--
-- The `pdf-render` BullMQ queue is at-least-once: BullMQ retries on
-- transient failure, the outbox dispatcher may re-enqueue the same row
-- after a restart, a human may re-fire a specific event. Rendering a
-- PDF is expensive (CPU + network upload to MinIO) and should happen
-- AT MOST ONCE per target entity; the idempotency ledger below makes
-- that invariant enforceable without relying on BullMQ's own jobId
-- dedupe (which is best-effort and evicted on completion).
--
-- Schema pair:
--   pdf_render_runs    — "I claimed (cert_id, doc_type) and rendered it"
--   pdf_render_dlq     — "attempts exhausted — human intervention needed"
--
-- The processor pattern mirrors the §3.1 outbox.handler_runs design:
-- INSERT ... ON CONFLICT DO NOTHING the claim row, then do the work,
-- then UPDATE the claim's status / object_key. If the claim returns 0
-- rows a prior run already completed — the worker exits quietly.

CREATE TABLE IF NOT EXISTS pdf_render_runs (
  -- (doc_type, doc_id) is the composite claim key so one table serves
  -- every document type (QC cert in 4.1a, PO / SI / DC / GRN later).
  doc_type       text NOT NULL
                   CHECK (doc_type IN (
                     'qc_cert',
                     'purchase_order',
                     'sales_invoice',
                     'delivery_challan',
                     'grn'
                   )),
  doc_id         uuid NOT NULL,
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'RENDERING'
                   CHECK (status IN ('RENDERING', 'COMPLETED', 'FAILED')),
  object_key     text,
  object_etag    text,
  byte_size      integer,
  attempts       integer NOT NULL DEFAULT 1,
  last_error     text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  PRIMARY KEY (doc_type, doc_id)
);

CREATE INDEX IF NOT EXISTS pdf_render_runs_org_idx
  ON pdf_render_runs (org_id, doc_type, completed_at DESC)
  WHERE status = 'COMPLETED';

CREATE INDEX IF NOT EXISTS pdf_render_runs_failed_idx
  ON pdf_render_runs (status, started_at DESC)
  WHERE status = 'FAILED';

COMMENT ON TABLE pdf_render_runs IS
  'Phase-4 §4.1 idempotency ledger: one row per (doc_type, doc_id) that has entered the render pipeline. Processor INSERTs ON CONFLICT DO NOTHING on claim, UPDATEs status+object_key on finish. Presence of COMPLETED row short-circuits re-renders.';

-- Dead-letter queue: a row lands here after a BullMQ job exhausts its
-- retry budget. Ops triage: fix the root cause, then either UPDATE
-- `resolved_at` + manually re-enqueue, or leave for audit.
CREATE TABLE IF NOT EXISTS pdf_render_dlq (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type       text NOT NULL,
  doc_id         uuid NOT NULL,
  payload        jsonb NOT NULL,      -- the BullMQ job payload verbatim
  attempts       integer NOT NULL,
  last_error     text NOT NULL,
  failed_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes text
);

CREATE INDEX IF NOT EXISTS pdf_render_dlq_unresolved_idx
  ON pdf_render_dlq (org_id, failed_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS pdf_render_dlq_doc_idx
  ON pdf_render_dlq (org_id, doc_type, doc_id);

COMMENT ON TABLE pdf_render_dlq IS
  'Phase-4 §4.1 dead-letter: BullMQ retry-budget exhaustion parks the job here for ops triage. One row per terminal failure; `resolved_at` when ops takes action.';
