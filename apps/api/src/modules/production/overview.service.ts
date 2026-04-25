/**
 * Production overview — dashboard KPI payload for /production/overview.
 *
 * Three counts from the `work_orders` table in one round-trip:
 *   - totalWorkOrders : every non-deleted WO
 *   - activeWip       : status IN ('MATERIAL_CHECK','IN_PROGRESS','QC_HOLD','REWORK')
 *   - completedToday  : status='COMPLETED' AND completed_at::date = current_date
 *
 * The remaining fields (`oee`, `scrapRate`, `machineUtilization`) come back
 * `null` because the backing tables (`oee_records`, `scrap_entries`,
 * `machine_utilization`) do not exist in init SQL. `notImplemented[]`
 * surfaces this honestly to the UI — no fake zeroes.
 *
 * RLS enforced via withRequest → app.current_org GUC. No org_id in WHERE.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type { ProductionOverview } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface OverviewRow {
  total: string;
  active_wip: string;
  completed_today: string;
}

const ACTIVE_WIP_STATUSES = [
  "MATERIAL_CHECK",
  "IN_PROGRESS",
  "QC_HOLD",
  "REWORK",
] as const;

export class ProductionOverviewService {
  constructor(private readonly pool: pg.Pool) {}

  async get(req: FastifyRequest): Promise<ProductionOverview> {
    return withRequest(req, this.pool, async (client) => {
      const sql = `
        SELECT
          COUNT(*)::bigint                                                    AS total,
          COUNT(*) FILTER (WHERE status = ANY($1::text[]))::bigint            AS active_wip,
          COUNT(*) FILTER (
            WHERE status = 'COMPLETED'
              AND completed_at IS NOT NULL
              AND completed_at::date = current_date
          )::bigint                                                           AS completed_today
          FROM work_orders
         WHERE deleted_at IS NULL
      `;
      const res = await client.query<OverviewRow>(sql, [
        Array.from(ACTIVE_WIP_STATUSES),
      ]);
      const r = res.rows[0]!;

      return {
        totalWorkOrders: Number(r.total),
        activeWip: Number(r.active_wip),
        completedToday: Number(r.completed_today),
        oee: null,
        scrapRate: null,
        machineUtilization: null,
        notImplemented: ["oee", "scrapRate", "machineUtilization"],
      };
    });
  }
}
