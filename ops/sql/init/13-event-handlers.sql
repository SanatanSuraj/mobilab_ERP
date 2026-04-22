-- Phase 3 §3.1 — Event handler execution ledger.
--
-- Every row in outbox.events is dispatched to zero-or-more named handlers
-- (the §3.1 catalogue: `deal.won` → production.createWorkOrder +
-- procurement.createMrpIndent, etc.).  The worker is at-least-once —
-- BullMQ retries on failure, listen-notify can re-emit after a restart,
-- a human can re-enqueue a specific event.  So each handler MUST be
-- idempotent.
--
-- `outbox.handler_runs` is the idempotency ledger: one row per
-- (outbox_id, handler_name) pair that has COMPLETED.  The worker's
-- dispatch processor does an INSERT ... ON CONFLICT DO NOTHING inside
-- the same transaction as the handler's domain writes.  If the INSERT
-- returns 0 rows, the handler already ran — skip.  If it returns 1 row
-- and the transaction commits, both the handler's side effects AND the
-- ledger row land together.  If the handler throws, the whole txn
-- rolls back including the ledger row, so a retry re-acquires cleanly.
--
-- No org_id column: the outbox itself is a cross-tenant infrastructure
-- table (see ops/sql/init/01-schemas.sql for the pattern).  The
-- handlers' domain writes are tenant-scoped via `withOrg(orgId)` in
-- the handler body.

CREATE TABLE IF NOT EXISTS outbox.handler_runs (
  outbox_id     uuid NOT NULL REFERENCES outbox.events(id) ON DELETE CASCADE,
  handler_name  text NOT NULL CHECK (length(handler_name) BETWEEN 1 AND 200),
  -- `COMPLETED` is the only state we ever write: we use the row's
  -- presence as the idempotency slot.  `FAILED` is reserved for a
  -- future use-case where the processor wants to record
  -- poison-pill state without rolling back (Phase 4 DLQ plumbing
  -- may use it).
  status        text NOT NULL DEFAULT 'COMPLETED'
                  CHECK (status IN ('COMPLETED', 'FAILED')),
  last_error    text,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outbox_id, handler_name)
);

CREATE INDEX IF NOT EXISTS outbox_handler_runs_handler_idx
  ON outbox.handler_runs (handler_name, completed_at DESC);

COMMENT ON TABLE outbox.handler_runs IS
  'Phase-3 §3.1 idempotency ledger: one row per (outbox_id, handler_name) that has completed. Used by apps/worker outbox-dispatch to guarantee at-most-once effects despite at-least-once delivery.';
