/**
 * QC reports — date-windowed inspection counts + cycle time + cert rollup.
 *
 * Single read endpoint backing /qc/reports. Four queries, one trip:
 *   - inspections: counts by status, scoped by created_at
 *   - byKind: pass/fail split per inspection kind
 *   - cycleTime: avg/p50/p90 hours for completed inspections
 *   - certs: cert issuance count + top products certified
 *
 * Pure read — reuses qc_inspections + qc_certs as-is.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type { QcReports, QcReportsQuery } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface InspectionsRow {
  total: string;
  draft: string;
  in_progress: string;
  passed: string;
  failed: string;
}

interface KindRow {
  kind: "IQC" | "SUB_QC" | "FINAL_QC";
  total: string;
  passed: string;
  failed: string;
}

interface CycleTimeRow {
  completed_count: string;
  avg_hours: string | null;
  p50_hours: string | null;
  p90_hours: string | null;
}

interface CertRow {
  issued: string;
}

interface TopCertProductRow {
  product_id: string | null;
  product_name: string;
  cert_count: string;
}

const DEFAULT_WINDOW_DAYS = 90;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

function rate(passed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((passed / total) * 1000) / 10;
}

export class QcReportsService {
  constructor(private readonly pool: pg.Pool) {}

  async summary(
    req: FastifyRequest,
    q: QcReportsQuery,
  ): Promise<QcReports> {
    const def = defaultRange();
    const from = q.from ?? def.from;
    const to = q.to ?? def.to;

    return withRequest(req, this.pool, async (client) => {
      const params = [from, to];

      const inspectionsSql = `
        SELECT
          COUNT(*)::bigint                                            AS total,
          COUNT(*) FILTER (WHERE status = 'DRAFT')::bigint            AS draft,
          COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::bigint      AS in_progress,
          COUNT(*) FILTER (WHERE status = 'PASSED')::bigint           AS passed,
          COUNT(*) FILTER (WHERE status = 'FAILED')::bigint           AS failed
          FROM qc_inspections
         WHERE deleted_at IS NULL
           AND created_at >= $1::date
           AND created_at <  ($2::date + interval '1 day')
      `;
      const byKindSql = `
        SELECT
          kind,
          COUNT(*)::bigint                                  AS total,
          COUNT(*) FILTER (WHERE status = 'PASSED')::bigint AS passed,
          COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed
          FROM qc_inspections
         WHERE deleted_at IS NULL
           AND created_at >= $1::date
           AND created_at <  ($2::date + interval '1 day')
         GROUP BY kind
      `;
      const cycleTimeSql = `
        WITH durations AS (
          SELECT EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0 AS hours
            FROM qc_inspections
           WHERE deleted_at IS NULL
             AND status IN ('PASSED', 'FAILED')
             AND started_at IS NOT NULL
             AND completed_at IS NOT NULL
             AND completed_at >= started_at
             AND created_at >= $1::date
             AND created_at <  ($2::date + interval '1 day')
        )
        SELECT
          COUNT(*)::bigint                                        AS completed_count,
          AVG(hours)::numeric(10,2)::text                         AS avg_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours)
            ::numeric(10,2)::text                                  AS p50_hours,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY hours)
            ::numeric(10,2)::text                                  AS p90_hours
          FROM durations
      `;
      const certsCountSql = `
        SELECT COUNT(*)::bigint AS issued
          FROM qc_certs
         WHERE deleted_at IS NULL
           AND issued_at >= $1::date
           AND issued_at <  ($2::date + interval '1 day')
      `;
      const topCertProductsSql = `
        SELECT
          product_id,
          COALESCE(product_name, 'Unknown') AS product_name,
          COUNT(*)::bigint                  AS cert_count
          FROM qc_certs
         WHERE deleted_at IS NULL
           AND issued_at >= $1::date
           AND issued_at <  ($2::date + interval '1 day')
         GROUP BY product_id, product_name
         ORDER BY cert_count DESC
         LIMIT 10
      `;

      const [iRes, kRes, cRes, certRes, topRes] = await Promise.all([
        client.query<InspectionsRow>(inspectionsSql, params),
        client.query<KindRow>(byKindSql, params),
        client.query<CycleTimeRow>(cycleTimeSql, params),
        client.query<CertRow>(certsCountSql, params),
        client.query<TopCertProductRow>(topCertProductsSql, params),
      ]);

      const i = iRes.rows[0]!;
      const totalIns = Number(i.total);
      const passedIns = Number(i.passed);

      const kindMap: Record<
        "IQC" | "SUB_QC" | "FINAL_QC",
        { total: number; passed: number; failed: number; passRatePct: number }
      > = {
        IQC: { total: 0, passed: 0, failed: 0, passRatePct: 0 },
        SUB_QC: { total: 0, passed: 0, failed: 0, passRatePct: 0 },
        FINAL_QC: { total: 0, passed: 0, failed: 0, passRatePct: 0 },
      };
      for (const r of kRes.rows) {
        const total = Number(r.total);
        const passed = Number(r.passed);
        const failed = Number(r.failed);
        kindMap[r.kind] = {
          total,
          passed,
          failed,
          passRatePct: rate(passed, total),
        };
      }

      const c = cRes.rows[0]!;
      const certCount = certRes.rows[0]!;

      return {
        from,
        to,
        inspections: {
          total: totalIns,
          draft: Number(i.draft),
          inProgress: Number(i.in_progress),
          passed: passedIns,
          failed: Number(i.failed),
          passRatePct: rate(passedIns, totalIns),
        },
        byKind: {
          iqc: kindMap.IQC,
          subQc: kindMap.SUB_QC,
          finalQc: kindMap.FINAL_QC,
        },
        cycleTime: {
          completedCount: Number(c.completed_count),
          avgHours: c.avg_hours === null ? null : Number(c.avg_hours),
          p50Hours: c.p50_hours === null ? null : Number(c.p50_hours),
          p90Hours: c.p90_hours === null ? null : Number(c.p90_hours),
        },
        certs: {
          issued: Number(certCount.issued),
          topProducts: topRes.rows.map((r) => ({
            productId: r.product_id,
            productName: r.product_name,
            certCount: Number(r.cert_count),
          })),
        },
      };
    });
  }
}
