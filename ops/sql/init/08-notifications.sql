-- Notifications module tables. ARCHITECTURE.md §13.7.
--
-- Phase 2 scope: "templates + log (record-only; dispatch is Phase 3)".
--
-- Two tables:
--   notification_templates — org-scoped library keyed by (event_type, channel).
--     Templates hold mustache-style subject/body rendered at dispatch time.
--     Channels tracked even though Phase 2 only fires IN_APP — writing the
--     EMAIL / WHATSAPP rows now means Phase 3 dispatch is a pure consumer
--     swap, not a schema migration.
--   notifications — the record-only in-app feed. One row per (user, event).
--     Severity + title + body + optional link are materialised at emit time
--     so reads don't need to re-render templates. `is_read` / `read_at`
--     tracked per-row (not per-(user, template)) for a true inbox UX.
--
-- Explicitly OUT of scope for Phase 2 (Phase 3+):
--   * Any kind of dispatch (email, SSE push, WhatsApp)
--   * Subscription / preference UI
--   * Template rendering at write time (Phase 2 callers pass title/body
--     directly; the template_id is recorded for lineage only)
--
-- Conventions match 07-finance.sql — plural snake_case tables, org_id NOT
-- NULL on every tenant-scoped row, version + tg_bump_version on the mutable
-- header (templates), updated_at bumped by trigger on every UPDATE.

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_templates — tenant-scoped template library.
-- Unique on (org_id, event_type, channel) so one template owns each
-- (event, channel) slot. Re-using the same event_type string across modules
-- (e.g. "work_order.created", "invoice.sent") so the event bus → template
-- lookup is a straight O(1) dictionary in Phase 3.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- Routing key — matches the dot-prefixed event name produced by the
  -- source module (§6 event bus table). text rather than enum so new events
  -- don't need a migration; service-layer validation keeps shape.
  event_type        text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  -- Which channel this template renders for. IN_APP is the only one Phase 2
  -- actually materialises from; EMAIL/WHATSAPP rows are drafts for Phase 3.
  channel           text NOT NULL DEFAULT 'IN_APP'
                      CHECK (channel IN ('IN_APP', 'EMAIL', 'WHATSAPP')),
  -- Human-friendly label for the admin UI.
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description       text,
  -- Rendering: subject is NULL-allowed because IN_APP feed items don't have a
  -- subject line distinct from the title. Body is mustache-style (`{{var}}`)
  -- and dispatched as-is — rendering engine is Phase 3.
  subject_template  text,
  body_template     text NOT NULL CHECK (length(body_template) BETWEEN 1 AND 4000),
  -- Default severity for notifications spawned from this template. Service
  -- layer may override per emit; this is the "if unspecified" default.
  default_severity  text NOT NULL DEFAULT 'INFO'
                      CHECK (default_severity IN ('INFO','SUCCESS','WARNING','ERROR','CRITICAL')),
  is_active         boolean NOT NULL DEFAULT true,
  version           integer NOT NULL DEFAULT 1,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS notification_templates_org_idx
  ON notification_templates (org_id);
-- One template per (event, channel, org). Partial-unique on deleted_at IS NULL
-- so a soft-deleted row can be replaced.
CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_event_channel_unique
  ON notification_templates (org_id, event_type, channel)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_templates_event_idx
  ON notification_templates (org_id, event_type);
CREATE INDEX IF NOT EXISTS notification_templates_active_idx
  ON notification_templates (org_id, is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- notifications — per-user in-app feed (record-only in Phase 2).
--
-- Every row is already "rendered" — no lazy template evaluation. If the
-- template ever changes, existing rows keep their materialised copy so the
-- audit trail of what the user saw stays intact.
--
-- `reference_type` + `reference_id` let the UI deep-link back to the
-- triggering entity (e.g. work_orders/:id). Free-text reference_type so new
-- entities can be added without a migration; app-layer allowlist TBD.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- Recipient user. CASCADE: a user deletion (rare) scrubs their inbox.
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Denormalized event name for filtering ("ticket.created", "invoice.sent")
  event_type        text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  severity          text NOT NULL DEFAULT 'INFO'
                      CHECK (severity IN ('INFO','SUCCESS','WARNING','ERROR','CRITICAL')),
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body              text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  -- Deep-link into the app. Optional; summary-only notifications skip it.
  link_url          text,
  -- Polymorphic pointer to the triggering entity. Not an FK — it may point
  -- across module boundaries (and those tables use different PK types in
  -- theory). Service layer validates shape.
  reference_type    text,
  reference_id      uuid,
  -- Lineage: which template produced this row. NULL when the notification
  -- was emitted ad-hoc without a template (e.g. via /notifications admin POST).
  template_id       uuid REFERENCES notification_templates(id) ON DELETE SET NULL,
  is_read           boolean NOT NULL DEFAULT false,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_org_idx ON notifications (org_id);
-- Feed read pattern: "unread notifications for this user, newest first".
-- Partial index on is_read = false keeps the hot path tight.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE is_read = false AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_event_idx
  ON notifications (org_id, event_type);
CREATE INDEX IF NOT EXISTS notifications_reference_idx
  ON notifications (org_id, reference_type, reference_id)
  WHERE reference_type IS NOT NULL;
