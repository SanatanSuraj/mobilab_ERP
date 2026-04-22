-- External-API fallback queue. ARCHITECTURE.md §3.4 (Phase 3).
--
-- Several outbound integrations (NIC e-way bill, GSTN e-invoice, WhatsApp
-- Business) sit behind circuit breakers. When a breaker is OPEN or the
-- downstream is otherwise degraded past its retry budget, callers can't
-- just "drop the call" — the underlying business request (ship goods,
-- send an OTP) still exists.
--
-- `manual_entry_queue` is the fallback parking lot. A worker later drains
-- the queue — either by retrying once the breaker heals, or by flagging
-- the row for manual ops intervention (NIC EWB is the explicit "manual
-- entry" spec call-out).
--
-- Status machine:
--   PENDING     — just enqueued; next drain will retry
--   RESOLVED    — retry succeeded or ops keyed the entry in manually
--   ABANDONED   — past retry budget; stays for audit
--
-- source is the short tag of the originating client ("nic_ewb", "gstn",
-- "whatsapp") so a single table can hold entries from all three fallbacks.
-- reference_type / reference_id let us trace back to the originating
-- domain row (e.g. the sales_invoice whose e-way bill couldn't be cut).
--
-- RLS / triggers live in rls/11-external-apis-rls.sql and
-- triggers/12-external-apis.sql.

CREATE TABLE IF NOT EXISTS manual_entry_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  source             text NOT NULL,                           -- 'nic_ewb' | 'gstn' | 'whatsapp'
  reference_type     text,                                    -- e.g. 'sales_invoice'
  reference_id       uuid,                                    -- FK to the originating row

  payload            jsonb NOT NULL,                          -- the call we couldn't make
  last_error         text,                                    -- last breaker/transport error
  attempts           integer NOT NULL DEFAULT 0,

  status             text NOT NULL DEFAULT 'PENDING',
  enqueued_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        timestamptz,
  resolution_notes   text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manual_entry_queue_source_check
    CHECK (source IN ('nic_ewb', 'gstn', 'whatsapp')),
  CONSTRAINT manual_entry_queue_status_check
    CHECK (status IN ('PENDING', 'RESOLVED', 'ABANDONED'))
);

CREATE INDEX IF NOT EXISTS idx_manual_entry_queue_pending
  ON manual_entry_queue (org_id, source, created_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_manual_entry_queue_reference
  ON manual_entry_queue (org_id, reference_type, reference_id);

COMMENT ON TABLE manual_entry_queue IS
  'Phase-3 fallback queue for NIC EWB / GSTN / WhatsApp calls that could not be delivered because their circuit breaker was open or the call failed past the retry budget.';
