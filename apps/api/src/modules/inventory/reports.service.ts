/**
 * Inventory reports — current valuation + date-windowed movement.
 *
 * Single read endpoint backing /inventory/reports. Three queries, one trip:
 *   - valuation: current on-hand × items.unit_cost across active items (no
 *     date filter — always "right now")
 *   - movement: stock_ledger txn aggregation in window (by posted_at)
 *   - topMovers: items with highest absolute movement volume in window
 *
 * Pure read — reuses items, stock_summary, stock_ledger.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  InventoryReports,
  InventoryReportsQuery,
} from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface ValuationRow {
  active_items: string;
  on_hand_qty: string | null;
  on_hand_value: string | null;
  reserved_value: string | null;
  available_value: string | null;
  low_stock_items: string;
}

interface MovementRow {
  receipts: string | null;
  issues: string | null;
  adjustments: string | null;
  transfers: string | null;
  scrap: string | null;
  total_txns: string;
}

interface TopMoverRow {
  item_id: string;
  sku: string;
  name: string;
  category: string;
  moved_qty: string;
  txn_count: string;
}

const DEFAULT_WINDOW_DAYS = 90;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export class InventoryReportsService {
  constructor(private readonly pool: pg.Pool) {}

  async summary(
    req: FastifyRequest,
    q: InventoryReportsQuery,
  ): Promise<InventoryReports> {
    const def = defaultRange();
    const from = q.from ?? def.from;
    const to = q.to ?? def.to;

    return withRequest(req, this.pool, async (client) => {
      const valuationSql = `
        WITH item_values AS (
          SELECT
            i.id,
            i.is_active,
            i.unit_cost,
            COALESCE(SUM(ss.on_hand), 0)   AS on_hand,
            COALESCE(SUM(ss.reserved), 0)  AS reserved,
            COALESCE(SUM(ss.available), 0) AS available
            FROM items i
            LEFT JOIN stock_summary ss ON ss.item_id = i.id
           WHERE i.deleted_at IS NULL
           GROUP BY i.id, i.is_active, i.unit_cost
        )
        SELECT
          COUNT(*) FILTER (WHERE is_active)::bigint                 AS active_items,
          COALESCE(SUM(on_hand) FILTER (WHERE is_active), 0)
            ::numeric(18,3)::text                                   AS on_hand_qty,
          COALESCE(SUM(on_hand   * unit_cost) FILTER (WHERE is_active), 0)
            ::numeric(18,2)::text                                   AS on_hand_value,
          COALESCE(SUM(reserved  * unit_cost) FILTER (WHERE is_active), 0)
            ::numeric(18,2)::text                                   AS reserved_value,
          COALESCE(SUM(available * unit_cost) FILTER (WHERE is_active), 0)
            ::numeric(18,2)::text                                   AS available_value,
          COUNT(*) FILTER (WHERE is_active AND on_hand <= 0)::bigint AS low_stock_items
          FROM item_values
      `;
      const movementSql = `
        SELECT
          COALESCE(SUM(ABS(quantity))
            FILTER (WHERE txn_type IN ('GRN_RECEIPT', 'WO_OUTPUT', 'CUSTOMER_RETURN', 'TRANSFER_IN')), 0)
            ::numeric(18,3)::text AS receipts,
          COALESCE(SUM(ABS(quantity))
            FILTER (WHERE txn_type IN ('WO_ISSUE', 'CUSTOMER_ISSUE', 'TRANSFER_OUT')), 0)
            ::numeric(18,3)::text AS issues,
          COALESCE(SUM(ABS(quantity))
            FILTER (WHERE txn_type IN ('ADJUSTMENT', 'OPENING_BALANCE')), 0)
            ::numeric(18,3)::text AS adjustments,
          COALESCE(SUM(ABS(quantity))
            FILTER (WHERE txn_type IN ('TRANSFER_OUT', 'TRANSFER_IN')), 0)
            ::numeric(18,3)::text AS transfers,
          COALESCE(SUM(ABS(quantity))
            FILTER (WHERE txn_type = 'SCRAP'), 0)
            ::numeric(18,3)::text AS scrap,
          COUNT(*)::bigint AS total_txns
          FROM stock_ledger
         WHERE posted_at >= $1::date
           AND posted_at <  ($2::date + interval '1 day')
      `;
      const topMoversSql = `
        SELECT
          i.id            AS item_id,
          i.sku,
          i.name,
          i.category,
          COALESCE(SUM(ABS(sl.quantity)), 0)::numeric(18,3)::text AS moved_qty,
          COUNT(*)::bigint                                         AS txn_count
          FROM stock_ledger sl
          JOIN items i ON i.id = sl.item_id
         WHERE sl.posted_at >= $1::date
           AND sl.posted_at <  ($2::date + interval '1 day')
           AND i.deleted_at IS NULL
         GROUP BY i.id, i.sku, i.name, i.category
         ORDER BY moved_qty DESC
         LIMIT 10
      `;

      const [vRes, mRes, tRes] = await Promise.all([
        client.query<ValuationRow>(valuationSql),
        client.query<MovementRow>(movementSql, [from, to]),
        client.query<TopMoverRow>(topMoversSql, [from, to]),
      ]);

      const v = vRes.rows[0]!;
      const m = mRes.rows[0]!;

      return {
        from,
        to,
        valuation: {
          activeItems: Number(v.active_items),
          onHandQty: v.on_hand_qty ?? "0.000",
          onHandValue: v.on_hand_value ?? "0.00",
          reservedValue: v.reserved_value ?? "0.00",
          availableValue: v.available_value ?? "0.00",
          lowStockItems: Number(v.low_stock_items),
        },
        movement: {
          receipts: m.receipts ?? "0.000",
          issues: m.issues ?? "0.000",
          adjustments: m.adjustments ?? "0.000",
          transfers: m.transfers ?? "0.000",
          scrap: m.scrap ?? "0.000",
          totalTxns: Number(m.total_txns),
        },
        topMovers: tRes.rows.map((r) => ({
          itemId: r.item_id,
          sku: r.sku,
          name: r.name,
          category: r.category,
          movedQty: r.moved_qty,
          txnCount: Number(r.txn_count),
        })),
      };
    });
  }
}
