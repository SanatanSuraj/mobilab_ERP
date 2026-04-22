-- Inventory module triggers.
--
--   1. Bump updated_at on every UPDATE on masters.
--   2. Bump `version` on warehouses + items for optimistic concurrency.
--   3. Append audit rows on INSERT/UPDATE/DELETE on masters.
--   4. stock_ledger is append-only: audit INSERT only.
--   5. tg_stock_summary_from_ledger — the core projection trigger. On
--      every INSERT into stock_ledger, UPSERT the matching
--      stock_summary row so readers never scan the ledger.

-- ── stock summary projection ────────────────────────────────────────────────
-- Fires AFTER INSERT on stock_ledger. Maintains (item_id, warehouse_id)
-- running balance in stock_summary. Phase 3 will extend this to react
-- to reservation events; for now the formula is simply
--   on_hand := on_hand + NEW.quantity
--   available := on_hand - reserved
-- The trigger runs inside the same transaction as the ledger insert, so
-- a failed INSERT rolls back the summary update too.
CREATE OR REPLACE FUNCTION public.tg_stock_summary_from_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO stock_summary (
    org_id, item_id, warehouse_id,
    on_hand, reserved, available, last_movement_at, updated_at
  )
  VALUES (
    NEW.org_id, NEW.item_id, NEW.warehouse_id,
    NEW.quantity, 0, NEW.quantity, NEW.posted_at, now()
  )
  ON CONFLICT (org_id, item_id, warehouse_id) DO UPDATE
  SET on_hand          = stock_summary.on_hand + EXCLUDED.on_hand,
      available        = (stock_summary.on_hand + EXCLUDED.on_hand) - stock_summary.reserved,
      last_movement_at = EXCLUDED.last_movement_at,
      updated_at       = now();
  RETURN NEW;
END;
$$;

-- ── warehouses ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS warehouses_updated_at ON warehouses;
CREATE TRIGGER warehouses_updated_at
BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS warehouses_version ON warehouses;
CREATE TRIGGER warehouses_version
BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS warehouses_audit ON warehouses;
CREATE TRIGGER warehouses_audit
AFTER INSERT OR UPDATE OR DELETE ON warehouses
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── items ──────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS items_updated_at ON items;
CREATE TRIGGER items_updated_at
BEFORE UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS items_version ON items;
CREATE TRIGGER items_version
BEFORE UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_version();

DROP TRIGGER IF EXISTS items_audit ON items;
CREATE TRIGGER items_audit
AFTER INSERT OR UPDATE OR DELETE ON items
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── item_warehouse_bindings ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS item_warehouse_bindings_updated_at ON item_warehouse_bindings;
CREATE TRIGGER item_warehouse_bindings_updated_at
BEFORE UPDATE ON item_warehouse_bindings
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS item_warehouse_bindings_audit ON item_warehouse_bindings;
CREATE TRIGGER item_warehouse_bindings_audit
AFTER INSERT OR UPDATE OR DELETE ON item_warehouse_bindings
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── stock_ledger (append-only) ─────────────────────────────────────────────
-- Audit INSERT only (no UPDATE/DELETE — those shouldn't happen).
DROP TRIGGER IF EXISTS stock_ledger_audit ON stock_ledger;
CREATE TRIGGER stock_ledger_audit
AFTER INSERT ON stock_ledger
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- The projection trigger — fires BEFORE the audit trigger on the same
-- row; pg_trigger ordering is alphabetical so `aa_` prefix ensures it.
DROP TRIGGER IF EXISTS aa_stock_ledger_project ON stock_ledger;
CREATE TRIGGER aa_stock_ledger_project
AFTER INSERT ON stock_ledger
FOR EACH ROW EXECUTE FUNCTION public.tg_stock_summary_from_ledger();

-- ── stock_summary ──────────────────────────────────────────────────────────
-- The summary is maintained by the trigger above, so updated_at is set
-- inline in the UPSERT. We still want audit logging for forensics
-- because a divergence between ledger and summary is a Very Bad Day.
DROP TRIGGER IF EXISTS stock_summary_audit ON stock_summary;
CREATE TRIGGER stock_summary_audit
AFTER INSERT OR UPDATE OR DELETE ON stock_summary
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();

-- ── stock_reservations (Phase 3) ───────────────────────────────────────────
-- Writes go through reserve/release/consume stored functions which set
-- updated_at inline, so we audit only — no updated_at trigger needed.
DROP TRIGGER IF EXISTS stock_reservations_audit ON stock_reservations;
CREATE TRIGGER stock_reservations_audit
AFTER INSERT OR UPDATE OR DELETE ON stock_reservations
FOR EACH ROW EXECUTE FUNCTION audit.tg_log();
