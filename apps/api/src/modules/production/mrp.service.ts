/**
 * MRP — Material Requirements Planning aggregation.
 *
 * Read-only roll-up driven entirely by SQL: every non-completed WO contributes
 * `bom_lines.qty_per_unit * wo.quantity` to the required column for each
 * component item. We then subtract on-hand stock (summed across warehouses)
 * and open-PO incoming quantity to compute the shortage that buyers act on.
 *
 * No new tables — the aggregation reads work_orders, bom_lines, items,
 * stock_summary, purchase_orders, po_lines and projects a single MrpRow per
 * component. Sorted shortage-DESC so the highest-pain items float to the top.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type { MrpRow } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface MrpRawRow {
  item_id: string;
  sku: string;
  name: string;
  uom: string;
  category: string;
  required_qty: string;
  on_hand: string;
  reserved: string;
  available: string;
  on_order: string;
  shortage: string;
  wo_count: string;
}

const MRP_SQL = `
  WITH open_wos AS (
    SELECT id, bom_id, quantity
      FROM work_orders
     WHERE deleted_at IS NULL
       AND status NOT IN ('COMPLETED', 'CANCELLED')
  ),
  required AS (
    SELECT
      bl.component_item_id     AS item_id,
      SUM(bl.qty_per_unit * wo.quantity)::numeric(18,3) AS required_qty,
      COUNT(DISTINCT wo.id)    AS wo_count
      FROM open_wos wo
      JOIN bom_lines bl ON bl.bom_id = wo.bom_id
     GROUP BY bl.component_item_id
  ),
  stock AS (
    SELECT
      item_id,
      COALESCE(SUM(on_hand), 0)::numeric(18,3)   AS on_hand,
      COALESCE(SUM(reserved), 0)::numeric(18,3)  AS reserved,
      COALESCE(SUM(available), 0)::numeric(18,3) AS available
      FROM stock_summary
     GROUP BY item_id
  ),
  on_order AS (
    SELECT
      pl.item_id,
      COALESCE(
        SUM(GREATEST(pl.quantity - COALESCE(pl.received_qty, 0), 0)),
        0
      )::numeric(18,3) AS on_order
      FROM po_lines pl
      JOIN purchase_orders po ON po.id = pl.po_id
     WHERE po.deleted_at IS NULL
       AND po.status IN ('APPROVED', 'SENT', 'PARTIALLY_RECEIVED')
     GROUP BY pl.item_id
  )
  SELECT
    i.id                         AS item_id,
    i.sku, i.name, i.uom, i.category,
    COALESCE(r.required_qty, 0)::numeric(18,3) AS required_qty,
    COALESCE(s.on_hand, 0)::numeric(18,3)      AS on_hand,
    COALESCE(s.reserved, 0)::numeric(18,3)     AS reserved,
    COALESCE(s.available, 0)::numeric(18,3)    AS available,
    COALESCE(oo.on_order, 0)::numeric(18,3)    AS on_order,
    GREATEST(
      COALESCE(r.required_qty, 0)
      - COALESCE(s.available, 0)
      - COALESCE(oo.on_order, 0),
      0
    )::numeric(18,3)                           AS shortage,
    COALESCE(r.wo_count, 0)                    AS wo_count
    FROM required r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN stock s    ON s.item_id  = r.item_id
    LEFT JOIN on_order oo ON oo.item_id = r.item_id
   WHERE i.deleted_at IS NULL
   ORDER BY shortage DESC, required_qty DESC
   LIMIT 500
`;

export class MrpService {
  constructor(private readonly pool: pg.Pool) {}

  async list(req: FastifyRequest): Promise<MrpRow[]> {
    return withRequest(req, this.pool, async (client) => {
      const { rows } = await client.query<MrpRawRow>(MRP_SQL);
      return rows.map((r) => ({
        itemId: r.item_id,
        sku: r.sku,
        name: r.name,
        uom: r.uom,
        category: r.category,
        requiredQty: r.required_qty,
        onHand: r.on_hand,
        reserved: r.reserved,
        available: r.available,
        onOrder: r.on_order,
        shortage: r.shortage,
        woCount: Number(r.wo_count),
      }));
    });
  }
}
