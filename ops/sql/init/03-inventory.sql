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
