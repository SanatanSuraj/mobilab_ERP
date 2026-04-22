-- Notification dispatch DLQ. ARCHITECTURE.md §3.6 (Phase 3).
--
-- Every dispatch attempt goes through a channel-specific transport:
--   IN_APP    → notifications row insert (LISTEN/NOTIFY wakes the SSE feed)
--   EMAIL     → SMTP / ESP transport (injected)
--   WHATSAPP  → @instigenie/api/external WhatsAppClient (which has its own
--               email fallback + manual_entry_queue safety net)
--
-- When any of those throws or returns a "couldn't deliver" signal, the
-- dispatcher parks a row here so ops can triage without losing the event.
-- Distinct from `manual_entry_queue` (§3.4) — that table holds raw API
-- payloads for direct re-send. This one holds rendered channel output plus
-- the originating event context, so it's the right audit trail for "this
-- user never got notified".
--
-- Status machine:
--   PENDING — just enqueued; next DLQ drain can retry
--   RETRIED — redispatched; stays for audit
--   ABANDONED — out of retry budget
--
-- RLS + triggers live in rls/12-notification-dispatch-dlq-rls.sql and
-- triggers/13-notification-dispatch-dlq.sql.

CREATE TABLE IF NOT EXISTS notification_dispatch_dlq (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The event that spawned this attempt ("work_order.created",
  -- "invoice.sent", …).  Free-text to match notification_templates.event_type.
  event_type         text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  channel            text NOT NULL
                       CHECK (channel IN ('IN_APP', 'EMAIL', 'WHATSAPP')),

  -- Optional pointers. recipient_user_id is the inbox target for in-app and
  -- the addressing key for templated email — NULL when the dispatcher was
  -- told to fan out to an external contact.  template_id captures lineage.
  recipient_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  template_id        uuid REFERENCES notification_templates(id) ON DELETE SET NULL,

  -- Rendered output we tried to send.
  subject            text,
  body               text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  -- Channel-specific extras (e.g. "to" email address, waba template args,
  -- tenant-supplied referenceType/referenceId).
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,

  last_error         text,
  attempts           integer NOT NULL DEFAULT 1,

  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'RETRIED', 'ABANDONED')),
  resolved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        timestamptz,
  resolution_notes   text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_dlq_pending
  ON notification_dispatch_dlq (org_id, channel, created_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_dlq_event
  ON notification_dispatch_dlq (org_id, event_type);

COMMENT ON TABLE notification_dispatch_dlq IS
  'Phase-3 DLQ for notification dispatch attempts that failed at the channel transport. One row per (event, channel, recipient).';
