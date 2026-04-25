/**
 * Production reports — date-windowed throughput / cycle-time / yield rollup.
 *
 * Single read endpoint backing /production/reports. Four queries, one trip:
 *   - throughput: WO totals by status in window (created_at)
 *   - cycle time: avg/p50/p90 of (completed_at - started_at) for COMPLETED WOs
 *   - QC: pass/fail/rework counters across wip_stages (completed_at)
 *   - top products: by completed-WO count in window
 *
 * Pure read — no new tables. Reuses work_orders + wip_stages + products.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  ProductionReports,
  ProductionReportsQuery,
} from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface ThroughputRow {
  total: string;
  completed: string;
  in_progress: string;
  qc_hold: string;
  rework: string;
  cancelled: string;
}

interface CycleRow {
  completed_count: string;
  avg_hours: string | null;
  p50_hours: string | null;
  p90_hours: string | null;
}

interface QcRow {
  total_qc_stages: string;
  passed: string;
  failed: string;
  rework_loops: string;
}

interface TopProductRow {
  product_id: string;
  product_code: string;
  name: string;
  completed: string;
  total_qty: string;
}

const DEFAULT_WINDOW_DAYS = 90;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export class ReportsService {
  constructor(private readonly pool: pg.Pool) {}

  async summary(
    req: FastifyRequest,
    q: ProductionReportsQuery,
  ): Promise<ProductionReports> {
    const def = defaultRange();
    const from = q.from ?? def.from;
    const to = q.to ?? def.to;

    return withRequest(req, this.pool, async (client) => {
      const params = [from, to];

      const throughputSql = `
        SELECT
          COUNT(*)::bigint                                            AS total,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint        AS completed,
          COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint      AS in_progress,
          COUNT(*) FILTER (WHERE status = 'QC_HOLD')::bigint          AS qc_hold,
          COUNT(*) FILTER (WHERE status = 'REWORK')::bigint           AS rework,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint        AS cancelled
          FROM work_orders
         WHERE deleted_at IS NULL
           AND created_at >= $1::date
           AND created_at <  ($2::date + interval '1 day')
      `;
      const cycleSql = `
        WITH durations AS (
          SELECT EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0 AS hours
            FROM work_orders
           WHERE deleted_at IS NULL
             AND status = 'COMPLETED'
             AND started_at IS NOT NULL
             AND completed_at IS NOT NULL
             AND completed_at >= $1::date
             AND completed_at <  ($2::date + interval '1 day')
        )
        SELECT
          COUNT(*)::bigint                                                       AS completed_count,
          AVG(hours)::numeric(10,2)                                              AS avg_hours,
          (PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY hours))::numeric(10,2)   AS p50_hours,
          (PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY hours))::numeric(10,2)   AS p90_hours
          FROM durations
      `;
      const qcSql = `
        SELECT
          COUNT(*) FILTER (WHERE requires_qc_signoff)::bigint                       AS total_qc_stages,
          COUNT(*) FILTER (WHERE qc_result = 'PASS')::bigint                        AS passed,
          COUNT(*) FILTER (WHERE qc_result = 'FAIL')::bigint                        AS failed,
          COALESCE(SUM(rework_count) FILTER (WHERE rework_count > 0), 0)::bigint    AS rework_loops
          FROM wip_stages
         WHERE completed_at >= $1::date
           AND completed_at <  ($2::date + interval '1 day')
      `;
      const topProductsSql = `
        SELECT
          p.id            AS product_id,
          p.product_code,
          p.name,
          COUNT(wo.id)::bigint                            AS completed,
          COALESCE(SUM(wo.quantity), 0)::numeric(18,3)    AS total_qty
          FROM work_orders wo
          JOIN products p ON p.id = wo.product_id
         WHERE wo.deleted_at IS NULL
           AND wo.status = 'COMPLETED'
           AND wo.completed_at >= $1::date
           AND wo.completed_at <  ($2::date + interval '1 day')
         GROUP BY p.id, p.product_code, p.name
         ORDER BY completed DESC, total_qty DESC
         LIMIT 5
      `;

      const [throughputRes, cycleRes, qcRes, topRes] = await Promise.all([
        client.query<ThroughputRow>(throughputSql, params),
        client.query<CycleRow>(cycleSql, params),
        client.query<QcRow>(qcSql, params),
        client.query<TopProductRow>(topProductsSql, params),
      ]);

      const tp = throughputRes.rows[0]!;
      const total = Number(tp.total);
      const completed = Number(tp.completed);
      const cy = cycleRes.rows[0]!;
      const qc = qcRes.rows[0]!;
      const totalQc = Number(qc.total_qc_stages);
      const passed = Number(qc.passed);
      const failed = Number(qc.failed);

      return {
        from,
        to,
        throughput: {
          total,
          completed,
          inProgress: Number(tp.in_progress),
          qcHold: Number(tp.qc_hold),
          rework: Number(tp.rework),
          cancelled: Number(tp.cancelled),
          completionRatePct:
            total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
        },
        cycleTime: {
          completedCount: Number(cy.completed_count),
          avgHours: cy.avg_hours === null ? null : Number(cy.avg_hours),
          p50Hours: cy.p50_hours === null ? null : Number(cy.p50_hours),
          p90Hours: cy.p90_hours === null ? null : Number(cy.p90_hours),
        },
        qc: {
          totalQcStages: totalQc,
          passed,
          failed,
          reworkLoops: Number(qc.rework_loops),
          passRatePct:
            passed + failed > 0
              ? Math.round((passed / (passed + failed)) * 1000) / 10
              : 0,
        },
        topProducts: topRes.rows.map((r) => ({
          productId: r.product_id,
          productCode: r.product_code,
          name: r.name,
          completed: Number(r.completed),
          totalQty: r.total_qty,
        })),
      };
    });
  }
}
