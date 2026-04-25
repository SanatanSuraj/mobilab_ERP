/**
 * CRM reports — date-windowed pipeline / win-loss / lead funnel rollup.
 *
 * Single read endpoint backing /crm/reports. Four queries, one trip:
 *   - pipeline: deals opened in window, bucketed by stage
 *   - winLoss: deals that closed (closed_at) in window
 *   - leads:   leads created in window, by terminal status
 *   - topDeals: 10 highest-value deals opened in window
 *
 * Pure read — no new tables. Reuses deals + leads as-is.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type { CrmReports, CrmReportsQuery } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface PipelineRow {
  discovery: string;
  proposal: string;
  negotiation: string;
  closed_won: string;
  closed_lost: string;
  weighted_value: string | null;
  total_value: string | null;
}

interface WinLossRow {
  won: string;
  lost: string;
  won_value: string | null;
  lost_value: string | null;
}

interface LeadFunnelRow {
  total: string;
  new_count: string;
  contacted: string;
  qualified: string;
  converted: string;
  lost: string;
}

interface TopDealRow {
  id: string;
  deal_number: string;
  title: string;
  company: string;
  stage: string;
  value: string;
  probability: number;
}

const DEFAULT_WINDOW_DAYS = 90;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export class CrmReportsService {
  constructor(private readonly pool: pg.Pool) {}

  async summary(
    req: FastifyRequest,
    q: CrmReportsQuery,
  ): Promise<CrmReports> {
    const def = defaultRange();
    const from = q.from ?? def.from;
    const to = q.to ?? def.to;

    return withRequest(req, this.pool, async (client) => {
      const params = [from, to];

      const pipelineSql = `
        SELECT
          COUNT(*) FILTER (WHERE stage = 'DISCOVERY')::bigint    AS discovery,
          COUNT(*) FILTER (WHERE stage = 'PROPOSAL')::bigint     AS proposal,
          COUNT(*) FILTER (WHERE stage = 'NEGOTIATION')::bigint  AS negotiation,
          COUNT(*) FILTER (WHERE stage = 'CLOSED_WON')::bigint   AS closed_won,
          COUNT(*) FILTER (WHERE stage = 'CLOSED_LOST')::bigint  AS closed_lost,
          COALESCE(SUM(
            CASE WHEN stage <> 'CLOSED_LOST'
                 THEN value * probability / 100.0 ELSE 0 END
          ), 0)::numeric(18,2)::text                             AS weighted_value,
          COALESCE(SUM(value), 0)::numeric(18,2)::text           AS total_value
          FROM deals
         WHERE deleted_at IS NULL
           AND created_at >= $1::date
           AND created_at <  ($2::date + interval '1 day')
      `;
      const winLossSql = `
        SELECT
          COUNT(*) FILTER (WHERE stage = 'CLOSED_WON')::bigint              AS won,
          COUNT(*) FILTER (WHERE stage = 'CLOSED_LOST')::bigint             AS lost,
          COALESCE(SUM(value) FILTER (WHERE stage = 'CLOSED_WON'), 0)
            ::numeric(18,2)::text                                           AS won_value,
          COALESCE(SUM(value) FILTER (WHERE stage = 'CLOSED_LOST'), 0)
            ::numeric(18,2)::text                                           AS lost_value
          FROM deals
         WHERE deleted_at IS NULL
           AND closed_at IS NOT NULL
           AND closed_at >= $1::date
           AND closed_at <  ($2::date + interval '1 day')
      `;
      const leadsSql = `
        SELECT
          COUNT(*)::bigint                                            AS total,
          COUNT(*) FILTER (WHERE status = 'NEW')::bigint              AS new_count,
          COUNT(*) FILTER (WHERE status = 'CONTACTED')::bigint        AS contacted,
          COUNT(*) FILTER (WHERE status = 'QUALIFIED')::bigint        AS qualified,
          COUNT(*) FILTER (WHERE status = 'CONVERTED')::bigint        AS converted,
          COUNT(*) FILTER (WHERE status = 'LOST')::bigint             AS lost
          FROM leads
         WHERE deleted_at IS NULL
           AND created_at >= $1::date
           AND created_at <  ($2::date + interval '1 day')
      `;
      const topDealsSql = `
        SELECT id, deal_number, title, company, stage,
               value::text AS value, probability
          FROM deals
         WHERE deleted_at IS NULL
           AND created_at >= $1::date
           AND created_at <  ($2::date + interval '1 day')
         ORDER BY value DESC
         LIMIT 10
      `;

      const [pRes, wRes, lRes, tRes] = await Promise.all([
        client.query<PipelineRow>(pipelineSql, params),
        client.query<WinLossRow>(winLossSql, params),
        client.query<LeadFunnelRow>(leadsSql, params),
        client.query<TopDealRow>(topDealsSql, params),
      ]);

      const p = pRes.rows[0]!;
      const w = wRes.rows[0]!;
      const l = lRes.rows[0]!;

      const won = Number(w.won);
      const lost = Number(w.lost);
      const totalClosed = won + lost;
      const wonValueNum = Number(w.won_value ?? "0");
      const totalLeads = Number(l.total);
      const convertedLeads = Number(l.converted);

      return {
        from,
        to,
        pipeline: {
          discovery: Number(p.discovery),
          proposal: Number(p.proposal),
          negotiation: Number(p.negotiation),
          closedWon: Number(p.closed_won),
          closedLost: Number(p.closed_lost),
          weightedValue: p.weighted_value ?? "0.00",
          totalValue: p.total_value ?? "0.00",
        },
        winLoss: {
          won,
          lost,
          wonValue: w.won_value ?? "0.00",
          lostValue: w.lost_value ?? "0.00",
          winRatePct:
            totalClosed > 0
              ? Math.round((won / totalClosed) * 1000) / 10
              : 0,
          avgDealSizeWon:
            won > 0
              ? (wonValueNum / won).toFixed(2)
              : "0.00",
        },
        leads: {
          total: totalLeads,
          new: Number(l.new_count),
          contacted: Number(l.contacted),
          qualified: Number(l.qualified),
          converted: convertedLeads,
          lost: Number(l.lost),
          conversionRatePct:
            totalLeads > 0
              ? Math.round((convertedLeads / totalLeads) * 1000) / 10
              : 0,
        },
        topDeals: tRes.rows.map((r) => ({
          id: r.id,
          dealNumber: r.deal_number,
          title: r.title,
          company: r.company,
          stage: r.stage,
          value: r.value,
          probability: r.probability,
        })),
      };
    });
  }
}
