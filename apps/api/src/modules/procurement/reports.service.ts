/**
 * Procurement reports — date-windowed PO throughput + delivery + vendor spend.
 *
 * Single read endpoint backing /procurement/reports. Three queries, one trip:
 *   - poThroughput: counts + total spend by status, scoped by order_date
 *   - delivery: GRN posting cadence + on-time-delivery vs expected_date
 *   - topVendors: by spend in window
 *
 * Pure read — reuses purchase_orders, grns, vendors as-is.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  ProcurementOverview,
  ProcurementReports,
  ProcurementReportsQuery,
} from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface PoThroughputRow {
  total: string;
  draft: string;
  pending_approval: string;
  approved: string;
  sent: string;
  partially_received: string;
  received: string;
  cancelled: string;
  total_spend: string | null;
  received_spend: string | null;
}

interface DeliveryRow {
  grns_posted: string;
  on_time: string;
  late: string;
  avg_lead_days: string | null;
}

interface TopVendorRow {
  vendor_id: string;
  vendor_name: string;
  vendor_code: string;
  po_count: string;
  total_spend: string;
}

const DEFAULT_WINDOW_DAYS = 90;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

interface OverviewRow {
  total_pos: string;
  pending_pos: string;
  total_grns: string;
  pending_indents: string;
}

export class ProcurementReportsService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Top-of-funnel counts for the procurement dashboard. No date window —
   * these are the live "what's open right now?" numbers, complementary
   * to `summary()` which is a date-windowed throughput report.
   *
   *   - totalPOs       all POs (excluding soft-deleted)
   *   - pendingPOs     PENDING_APPROVAL (waiting on approver)
   *   - totalGRNs      all GRNs (excluding soft-deleted)
   *   - pendingIndents SUBMITTED + APPROVED but not yet CONVERTED
   */
  async overview(req: FastifyRequest): Promise<ProcurementOverview> {
    return withRequest(req, this.pool, async (client) => {
      const sql = `
        SELECT
          (SELECT COUNT(*)::bigint
             FROM purchase_orders
            WHERE deleted_at IS NULL)                           AS total_pos,
          (SELECT COUNT(*)::bigint
             FROM purchase_orders
            WHERE deleted_at IS NULL
              AND status = 'PENDING_APPROVAL')                  AS pending_pos,
          (SELECT COUNT(*)::bigint
             FROM grns
            WHERE deleted_at IS NULL)                           AS total_grns,
          (SELECT COUNT(*)::bigint
             FROM indents
            WHERE deleted_at IS NULL
              AND status IN ('SUBMITTED', 'APPROVED'))          AS pending_indents
      `;
      const res = await client.query<OverviewRow>(sql);
      const row = res.rows[0]!;
      return {
        totalPOs: Number(row.total_pos),
        pendingPOs: Number(row.pending_pos),
        totalGRNs: Number(row.total_grns),
        pendingIndents: Number(row.pending_indents),
      };
    });
  }

  async summary(
    req: FastifyRequest,
    q: ProcurementReportsQuery,
  ): Promise<ProcurementReports> {
    const def = defaultRange();
    const from = q.from ?? def.from;
    const to = q.to ?? def.to;

    return withRequest(req, this.pool, async (client) => {
      const params = [from, to];

      const poSql = `
        SELECT
          COUNT(*)::bigint                                             AS total,
          COUNT(*) FILTER (WHERE status = 'DRAFT')::bigint             AS draft,
          COUNT(*) FILTER (WHERE status = 'PENDING_APPROVAL')::bigint  AS pending_approval,
          COUNT(*) FILTER (WHERE status = 'APPROVED')::bigint          AS approved,
          COUNT(*) FILTER (WHERE status = 'SENT')::bigint              AS sent,
          COUNT(*) FILTER (WHERE status = 'PARTIALLY_RECEIVED')::bigint AS partially_received,
          COUNT(*) FILTER (WHERE status = 'RECEIVED')::bigint          AS received,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint         AS cancelled,
          COALESCE(SUM(grand_total), 0)::numeric(18,2)::text           AS total_spend,
          COALESCE(SUM(grand_total) FILTER (
            WHERE status IN ('RECEIVED', 'PARTIALLY_RECEIVED')
          ), 0)::numeric(18,2)::text                                    AS received_spend
          FROM purchase_orders
         WHERE deleted_at IS NULL
           AND order_date >= $1::date
           AND order_date <  ($2::date + interval '1 day')
      `;
      const deliverySql = `
        SELECT
          COUNT(*)::bigint                                             AS grns_posted,
          COUNT(*) FILTER (
            WHERE po.expected_date IS NULL OR g.received_date <= po.expected_date
          )::bigint                                                    AS on_time,
          COUNT(*) FILTER (
            WHERE po.expected_date IS NOT NULL AND g.received_date > po.expected_date
          )::bigint                                                    AS late,
          AVG(EXTRACT(DAY FROM (g.received_date::timestamp - po.order_date::timestamp)))
            ::numeric(10,2)::text                                       AS avg_lead_days
          FROM grns g
          JOIN purchase_orders po ON po.id = g.po_id
         WHERE g.deleted_at IS NULL
           AND g.status = 'POSTED'
           AND g.received_date >= $1::date
           AND g.received_date <  ($2::date + interval '1 day')
      `;
      const topVendorsSql = `
        SELECT
          v.id                                                AS vendor_id,
          v.name                                              AS vendor_name,
          v.code                                              AS vendor_code,
          COUNT(po.id)::bigint                                AS po_count,
          COALESCE(SUM(po.grand_total), 0)::numeric(18,2)::text AS total_spend
          FROM purchase_orders po
          JOIN vendors v ON v.id = po.vendor_id
         WHERE po.deleted_at IS NULL
           AND po.order_date >= $1::date
           AND po.order_date <  ($2::date + interval '1 day')
         GROUP BY v.id, v.name, v.code
         ORDER BY total_spend DESC
         LIMIT 10
      `;

      const [poRes, dRes, tRes] = await Promise.all([
        client.query<PoThroughputRow>(poSql, params),
        client.query<DeliveryRow>(deliverySql, params),
        client.query<TopVendorRow>(topVendorsSql, params),
      ]);

      const po = poRes.rows[0]!;
      const d = dRes.rows[0]!;
      const grnsPosted = Number(d.grns_posted);
      const onTime = Number(d.on_time);

      return {
        from,
        to,
        poThroughput: {
          total: Number(po.total),
          draft: Number(po.draft),
          pendingApproval: Number(po.pending_approval),
          approved: Number(po.approved),
          sent: Number(po.sent),
          partiallyReceived: Number(po.partially_received),
          received: Number(po.received),
          cancelled: Number(po.cancelled),
          totalSpend: po.total_spend ?? "0.00",
          receivedSpend: po.received_spend ?? "0.00",
        },
        delivery: {
          grnsPosted,
          onTimePct:
            grnsPosted > 0
              ? Math.round((onTime / grnsPosted) * 1000) / 10
              : 0,
          avgLeadDays:
            d.avg_lead_days === null ? null : Number(d.avg_lead_days),
          lateGrns: Number(d.late),
        },
        topVendors: tRes.rows.map((r) => ({
          vendorId: r.vendor_id,
          vendorName: r.vendor_name,
          vendorCode: r.vendor_code,
          poCount: Number(r.po_count),
          totalSpend: r.total_spend,
        })),
      };
    });
  }
}
