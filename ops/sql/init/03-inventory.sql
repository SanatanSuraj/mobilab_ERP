-- Inventory module tables. ARCHITECTURE.md §13.3.
--
-- Scope (Phase 2): items, warehouses, item_warehouse_binding,
-- stock_ledger (append-only) and stock_summary (trigger-maintained).
-- Batches, serials, stock adjustments, transfers and stock reservation
-- are Phase 3 — this file keeps the shape narrow but the ledger schema
-- already carries batch_no / serial_no columns so later phases only add
-- tables, not migrate existing rows.
--
-- Ledger architecture (§3.2):
--   * `stock_ledger` is the source of truth. Every movement writes one
--     row with a signed `quantity`. Positive = receipt, negative = issue.
--     Rows are never updated or deleted in normal operation; corrections
--     are made by posting an opposite entry with a REVERSAL txn_type.
--   * `stock_summary` is a projection: (item_id, warehouse_id) → on_hand.
--     It's maintained by the trigger tg_stock_summary_from_ledger() so
--     readers never scan the ledger. When Phase 3 adds reservations it
--     plugs into the same projection.
--
-- Naming conventions — ARCHITECTURE.md §4 (same as 02-crm.sql):
--   * Plural snake_case table names.
--   * Every tenant-scoped table carries `org_id uuid NOT NULL`.
--   * Quantities are NUMERIC(18,3) (three decimals to cover reels of
--     labels measured in metres). Money-style masters (unit_cost) are
--     NUMERIC(18,2). Both round-trip as strings.
--   * Every mutable table carries created_at + updated_at timestamptz.
--   * Soft-delete via deleted_at on masters. Ledger is append-only.

-- ─────────────────────────────────────────────────────────────────────────────
-- Warehouses — physical storage locations. WH-001, WH-002, ...
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code          text NOT NULL,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'PRIMARY'
                  CHECK (kind IN ('PRIMARY', 'SECONDARY', 'QUARANTINE', 'SCRAP', 'VIRTUAL')),
  address       text,
  city          text,
  state         text,
  country       text NOT NULL DEFAULT 'IN',
  postal_code   text,
  -- The default warehouse auto-receives GRNs and auto-issues to work
  -- orders when no location is specified. Exactly one per org.
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  manager_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS warehouses_org_idx ON warehouses (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_code_org_unique
  ON warehouses (org_id, lower(code)) WHERE deleted_at IS NULL;
-- At most one default warehouse per org.
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_single_default
  ON warehouses (org_id) WHERE is_default = true AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Items — the SKU master. Raw materials, sub-assemblies, finished goods,
-- consumables. Categorisation drives production BOM validation and the
-- stock-summary UI's grouping.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sku             text NOT NULL,
  name            text NOT NULL,
  description     text,
  category        text NOT NULL DEFAULT 'RAW_MATERIAL'
                    CHECK (category IN (
                      'RAW_MATERIAL', 'SUB_ASSEMBLY', 'FINISHED_GOOD',
                      'CONSUMABLE', 'PACKAGING', 'SPARE_PART', 'TOOL'
                    )),
  uom             text NOT NULL DEFAULT 'EA'
                    CHECK (uom IN (
                      'EA', 'BOX', 'PAIR', 'SET', 'ROLL',
                      'KG', 'G', 'MG',
                      'L', 'ML',
                      'M', 'CM', 'MM'
                    )),
  hsn_code        text,                    -- India GST classifier
  -- Standard cost for accounting / BOM rollup. Actual inbound cost comes
  -- from GRN lines (Phase 2 procurement).
  unit_cost       numeric(18, 2) NOT NULL DEFAULT 0,
  -- Optional default warehouse; when set, new stock lands here unless a
  -- caller specifies otherwise.
  default_warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  -- Whether we want serial-number tracking per unit. Finished medical
  -- devices (MCC) → true; consumables (gloves) → false. Enforced at the
  -- ledger level in Phase 3.
  is_serialised   boolean NOT NULL DEFAULT false,
  -- Same idea but batch-level for chemistry and reagents.
  is_batched      boolean NOT NULL DEFAULT false,
  shelf_life_days integer,                 -- null = non-perishable
  is_active       boolean NOT NULL DEFAULT true,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS items_org_idx ON items (org_id);
CREATE INDEX IF NOT EXISTS items_category_idx
  ON items (org_id, category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS items_active_idx
  ON items (org_id, is_active) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS items_sku_org_unique
  ON items (org_id, lower(sku)) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- item_warehouse_binding — which items are stocked at which warehouses,
-- plus reorder thresholds. A row here is the operational statement
-- "we keep this item at this warehouse"; the reorder_level drives the
-- low-stock report.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS item_warehouse_bindings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  reorder_level   numeric(18, 3) NOT NULL DEFAULT 0,
  reorder_qty     numeric(18, 3) NOT NULL DEFAULT 0,
  max_level       numeric(18, 3),
  bin_location    text,   -- "A-12-3" style rack label
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_warehouse_bindings_org_idx
  ON item_warehouse_bindings (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS item_warehouse_bindings_unique
  ON item_warehouse_bindings (org_id, item_id, warehouse_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- stock_ledger — append-only transaction log.
--
-- Every stock movement in the system writes exactly one row here with a
-- signed `quantity`. The `txn_type` tells you *why* it moved; the
-- `ref_doc_*` pair points back to the originating document (GRN, WO,
-- adjustment, transfer, ...). Callers never update or delete rows — to
-- correct a mistake, post a REVERSAL entry with the opposite sign.
--
-- The trigger tg_stock_summary_from_ledger() fires AFTER INSERT and
-- UPSERTs the stock_summary projection so readers stay on a tiny table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  -- Signed. Positive = receipt, negative = issue. Three decimals to
  -- cover reel stock measured in metres.
  quantity        numeric(18, 3) NOT NULL CHECK (quantity <> 0),
  uom             text NOT NULL,
  txn_type        text NOT NULL
                    CHECK (txn_type IN (
                      'OPENING_BALANCE',
                      'GRN_RECEIPT',       -- procurement receipt
                      'WO_ISSUE',          -- issued to a work order
                      'WO_RETURN',         -- returned from a work order
                      'WO_OUTPUT',         -- finished goods out of a WO
                      'ADJUSTMENT',        -- stock count correction
                      'TRANSFER_OUT',
                      'TRANSFER_IN',
                      'SCRAP',
                      'RTV_OUT',           -- return-to-vendor
                      'CUSTOMER_ISSUE',    -- sales delivery
                      'CUSTOMER_RETURN',
                      'REVERSAL'
                    )),
  ref_doc_type    text,                    -- 'GRN' | 'WO' | 'ADJUSTMENT' | 'TRANSFER' | 'SI' | ...
  ref_doc_id      uuid,
  ref_line_id     uuid,                    -- line within the ref doc, when applicable
  batch_no        text,
  serial_no       text,
  reason          text,                    -- free text for audit
  -- `unit_cost` snapshots the moving-average/standard cost at posting
  -- time so valuation reports don't need to recompute history.
  unit_cost       numeric(18, 2),
  posted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  posted_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_ledger_org_idx ON stock_ledger (org_id);
CREATE INDEX IF NOT EXISTS stock_ledger_item_wh_idx
  ON stock_ledger (org_id, item_id, warehouse_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_posted_idx
  ON stock_ledger (org_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS stock_ledger_ref_idx
  ON stock_ledger (org_id, ref_doc_type, ref_doc_id);
CREATE INDEX IF NOT EXISTS stock_ledger_txn_idx
  ON stock_ledger (org_id, txn_type, posted_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- stock_summary — projection from stock_ledger. One row per
-- (item_id, warehouse_id) with current on-hand. `reserved` and
-- `available` are zero in Phase 2 but the columns exist so Phase 3's
-- reservation logic slots in without a migration.
--
-- This table is ONLY written by the trigger tg_stock_summary_from_ledger
-- (see triggers/05-inventory.sql). Services must treat it as read-only;
-- to move stock, INSERT into stock_ledger and the summary updates itself.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_summary (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  item_id         uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  on_hand         numeric(18, 3) NOT NULL DEFAULT 0,
  reserved        numeric(18, 3) NOT NULL DEFAULT 0,  -- Phase 3
  available       numeric(18, 3) NOT NULL DEFAULT 0,  -- on_hand - reserved
  last_movement_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_summary_org_idx ON stock_summary (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS stock_summary_item_wh_unique
  ON stock_summary (org_id, item_id, warehouse_id);
-- For the "low stock" dashboard: anything where on_hand <= reorder_level.
CREATE INDEX IF NOT EXISTS stock_summary_lowstock_idx
  ON stock_summary (org_id, on_hand);

-- ─────────────────────────────────────────────────────────────────────────────
-- stock_reservations — Phase 3 concurrency-safe reservations.
-- ARCHITECTURE.md §3.2.
--
-- One row per outstanding reservation. Callers INSERT via the stored
-- function reserve_stock_atomic() which locks the summary row with
-- FOR UPDATE NOWAIT, checks `available >= qty`, and updates the
-- summary's reserved/available counters in the same transaction.
--
-- Status transitions are linear and one-way:
--     ACTIVE ──(release)──▶ RELEASED
--     ACTIVE ──(consume)──▶ CONSUMED  (also writes a WO_ISSUE ledger row)
--
-- `consumed_ledger_id` points at the ledger row created by the consume
-- call — gives us the audit trail linking back from the issued stock
-- to the reservation that authorised it.
--
-- IMPORTANT: this table is NOT written directly by services. Go through
-- reserve_stock_atomic / release_stock_reservation / consume_stock_reservation.
-- Direct INSERTs would skip the summary-counter update and silently
-- diverge stock_summary.reserved from the sum of ACTIVE rows here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_reservations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  item_id            uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id       uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  -- Always positive; the summary update adds this to reserved and
  -- subtracts from available.
  quantity           numeric(18, 3) NOT NULL CHECK (quantity > 0),
  uom                text NOT NULL,
  status             text NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED')),
  -- What document asked for the reservation. 'WO' for work orders,
  -- 'SO' for sales orders, 'MRP' for planning holds, 'MANUAL' for
  -- operator-driven holds. Free text to stay forward-compatible.
  ref_doc_type       text NOT NULL,
  ref_doc_id         uuid NOT NULL,
  ref_line_id        uuid,
  reserved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reserved_at        timestamptz NOT NULL DEFAULT now(),
  released_at        timestamptz,
  released_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  consumed_at        timestamptz,
  consumed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  consumed_ledger_id uuid REFERENCES stock_ledger(id) ON DELETE SET NULL,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_reservations_org_idx
  ON stock_reservations (org_id);
-- Partial index: the "live holds for this doc" query is the common
-- lookup for release_by_ref.
CREATE INDEX IF NOT EXISTS stock_reservations_active_ref_idx
  ON stock_reservations (org_id, ref_doc_type, ref_doc_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS stock_reservations_active_item_wh_idx
  ON stock_reservations (org_id, item_id, warehouse_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS stock_reservations_status_idx
  ON stock_reservations (org_id, status, reserved_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Reservation stored functions.
--
-- Custom SQLSTATE codes (class 'UR' = Unreservable, user-defined):
--   UR001 — insufficient stock (available < requested qty)
--   UR002 — reservation not ACTIVE (already released or consumed)
--
-- Built-in codes callers should know about:
--   55P03 — lock_not_available: FOR UPDATE NOWAIT hit a contended row.
--           The TS wrapper retries with jittered exponential backoff.
--   40P01 — deadlock_detected: cycle in the wait-for graph. Same retry
--           path; canonical lock ordering in mrpReserveAll makes this
--           nearly impossible in practice.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reserve_stock_atomic(
  p_org_id       uuid,
  p_item_id      uuid,
  p_warehouse_id uuid,
  p_qty          numeric,
  p_uom          text,
  p_ref_doc_type text,
  p_ref_doc_id   uuid,
  p_ref_line_id  uuid,
  p_reserved_by  uuid
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_available  numeric;
  v_summary_id uuid;
  v_res_id     uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'reserve qty must be > 0 (got %)', p_qty
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- Make sure the summary row exists before we try to lock it. This is
  -- a no-op if stock has ever moved for this (item, warehouse); for a
  -- fresh item it primes the row at zero so the lock can target it.
  INSERT INTO stock_summary (
    org_id, item_id, warehouse_id, on_hand, reserved, available
  ) VALUES (
    p_org_id, p_item_id, p_warehouse_id, 0, 0, 0
  )
  ON CONFLICT (org_id, item_id, warehouse_id) DO NOTHING;

  -- Lock the summary row. NOWAIT: if another session holds it we fail
  -- fast with SQLSTATE 55P03 and let the caller retry. Parking here
  -- would burn connections and obscure latency.
  SELECT id, available
    INTO v_summary_id, v_available
    FROM stock_summary
   WHERE org_id = p_org_id
     AND item_id = p_item_id
     AND warehouse_id = p_warehouse_id
   FOR UPDATE NOWAIT;

  IF v_available < p_qty THEN
    RAISE EXCEPTION 'insufficient stock: available=%, requested=%',
                    v_available, p_qty
      USING ERRCODE = 'UR001',
            HINT    = format('item=%s wh=%s', p_item_id, p_warehouse_id);
  END IF;

  INSERT INTO stock_reservations (
    org_id, item_id, warehouse_id, quantity, uom, status,
    ref_doc_type, ref_doc_id, ref_line_id, reserved_by
  ) VALUES (
    p_org_id, p_item_id, p_warehouse_id, p_qty, p_uom, 'ACTIVE',
    p_ref_doc_type, p_ref_doc_id, p_ref_line_id, p_reserved_by
  ) RETURNING id INTO v_res_id;

  UPDATE stock_summary
     SET reserved   = reserved  + p_qty,
         available  = available - p_qty,
         updated_at = now()
   WHERE id = v_summary_id;

  RETURN v_res_id;
END $$;

CREATE OR REPLACE FUNCTION public.release_stock_reservation(
  p_reservation_id uuid,
  p_released_by    uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_res stock_reservations%ROWTYPE;
BEGIN
  -- Lock the reservation row first — cheap, and eliminates the window
  -- where two releasers see it ACTIVE and both try to decrement.
  SELECT * INTO v_res
    FROM stock_reservations
   WHERE id = p_reservation_id
   FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found: %', p_reservation_id
      USING ERRCODE = 'P0002';  -- no_data_found (pg convention)
  END IF;

  IF v_res.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation % is %; cannot release',
                    p_reservation_id, v_res.status
      USING ERRCODE = 'UR002';
  END IF;

  -- Lock the summary row. NOWAIT for the same reason as reserve.
  PERFORM 1 FROM stock_summary
   WHERE org_id = v_res.org_id
     AND item_id = v_res.item_id
     AND warehouse_id = v_res.warehouse_id
   FOR UPDATE NOWAIT;

  UPDATE stock_reservations
     SET status      = 'RELEASED',
         released_at = now(),
         released_by = p_released_by,
         updated_at  = now()
   WHERE id = p_reservation_id;

  UPDATE stock_summary
     SET reserved   = reserved  - v_res.quantity,
         available  = available + v_res.quantity,
         updated_at = now()
   WHERE org_id = v_res.org_id
     AND item_id = v_res.item_id
     AND warehouse_id = v_res.warehouse_id;
END $$;

CREATE OR REPLACE FUNCTION public.consume_stock_reservation(
  p_reservation_id uuid,
  p_consumed_by    uuid,
  p_batch_no       text DEFAULT NULL,
  p_serial_no      text DEFAULT NULL,
  p_unit_cost      numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_res       stock_reservations%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  SELECT * INTO v_res
    FROM stock_reservations
   WHERE id = p_reservation_id
   FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found: %', p_reservation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_res.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation % is %; cannot consume',
                    p_reservation_id, v_res.status
      USING ERRCODE = 'UR002';
  END IF;

  PERFORM 1 FROM stock_summary
   WHERE org_id = v_res.org_id
     AND item_id = v_res.item_id
     AND warehouse_id = v_res.warehouse_id
   FOR UPDATE NOWAIT;

  -- Post the issue ledger row. The tg_stock_summary_from_ledger trigger
  -- fires AFTER INSERT and decrements on_hand + recomputes available.
  -- We then adjust `reserved` (the trigger doesn't touch it) and add
  -- the consumed quantity back to `available` — the reservation no
  -- longer holds that quantity now that real stock has moved.
  INSERT INTO stock_ledger (
    org_id, item_id, warehouse_id, quantity, uom, txn_type,
    ref_doc_type, ref_doc_id, ref_line_id,
    batch_no, serial_no, unit_cost, posted_by, reason
  ) VALUES (
    v_res.org_id, v_res.item_id, v_res.warehouse_id,
    -v_res.quantity, v_res.uom, 'WO_ISSUE',
    v_res.ref_doc_type, v_res.ref_doc_id, v_res.ref_line_id,
    p_batch_no, p_serial_no, p_unit_cost, p_consumed_by,
    'consumed from reservation ' || p_reservation_id::text
  ) RETURNING id INTO v_ledger_id;

  -- Trigger has already reduced on_hand by v_res.quantity and
  -- recomputed available = (new on_hand) - reserved. That dropped
  -- available by v_res.quantity erroneously (the reservation was
  -- already holding it). Add it back and release the reserved slot.
  UPDATE stock_summary
     SET reserved   = reserved  - v_res.quantity,
         available  = available + v_res.quantity,
         updated_at = now()
   WHERE org_id = v_res.org_id
     AND item_id = v_res.item_id
     AND warehouse_id = v_res.warehouse_id;

  UPDATE stock_reservations
     SET status             = 'CONSUMED',
         consumed_at        = now(),
         consumed_by        = p_consumed_by,
         consumed_ledger_id = v_ledger_id,
         updated_at         = now()
   WHERE id = p_reservation_id;

  RETURN v_ledger_id;
END $$;

-- Bulk release by ref doc. Used when a work order is cancelled — release
-- every ACTIVE hold tagged with that ref. Sorts by id so two concurrent
-- cancels acquire reservation locks in the same order → no deadlock.
CREATE OR REPLACE FUNCTION public.release_stock_reservations_by_ref(
  p_org_id       uuid,
  p_ref_doc_type text,
  p_ref_doc_id   uuid,
  p_released_by  uuid
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  r_id  uuid;
  n_rel integer := 0;
BEGIN
  FOR r_id IN
    SELECT id FROM stock_reservations
     WHERE org_id = p_org_id
       AND ref_doc_type = p_ref_doc_type
       AND ref_doc_id = p_ref_doc_id
       AND status = 'ACTIVE'
     ORDER BY id
  LOOP
    PERFORM public.release_stock_reservation(r_id, p_released_by);
    n_rel := n_rel + 1;
  END LOOP;
  RETURN n_rel;
END $$;
