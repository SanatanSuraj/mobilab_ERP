/**
 * Finance overview service.
 *
 * Computes a flat KPI payload for /finance/overview at query time from base
 * tables. Phase 3 will migrate to a materialised view refreshed on
 * invoice/payment events.
 *
 * Aggregations:
 *   - AR outstanding    = Σ(grandTotal − amountPaid) where sales_invoices.status = POSTED
 *   - AR overdue 30/60/90 = same, bucketed by current_date − due_date
 *   - AP outstanding    = Σ(...)  where purchase_invoices.status = POSTED
 *   - MTD revenue       = Σ(grandTotal) POSTED sales this month (posted_at >= month start)
 *   - MTD expenses      = Σ(grandTotal) POSTED purchase this month
 *   - Counts            = per-status invoice counts + RECORDED payment count
 *
 * Everything is scoped by RLS (app.current_org) transparently; no explicit
 * org_id filtering needed at the query level.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type { FinanceOverview } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { m, moneyToPg, ZERO } from "@instigenie/money";

interface ArApRow {
  outstanding: string | null;
  overdue30: string | null;
  overdue60: string | null;
  overdue90: string | null;
}

interface MtdRow {
  total: string | null;
}

interface CountRow {
  draft: string;
  posted: string;
  cancelled: string;
}

interface PaymentCountRow {
  recorded: string;
}

export class FinanceOverviewService {
  constructor(private readonly pool: pg.Pool) {}

  async get(req: FastifyRequest): Promise<FinanceOverview> {
    return withRequest(req, this.pool, async (client) => {
      // AR: outstanding = grand_total - amount_paid on POSTED sales invoices.
      // Overdue buckets use due_date vs current_date.
      const [arRes] = await Promise.all([
        client.query<ArApRow>(
          `SELECT
             COALESCE(SUM(grand_total - amount_paid), 0)::text AS outstanding,
             COALESCE(SUM(
               CASE
                 WHEN due_date IS NOT NULL AND current_date - due_date > 30
                 THEN grand_total - amount_paid ELSE 0
               END
             ), 0)::text AS overdue30,
             COALESCE(SUM(
               CASE
                 WHEN due_date IS NOT NULL AND current_date - due_date > 60
                 THEN grand_total - amount_paid ELSE 0
               END
             ), 0)::text AS overdue60,
             COALESCE(SUM(
               CASE
                 WHEN due_date IS NOT NULL AND current_date - due_date > 90
                 THEN grand_total - amount_paid ELSE 0
               END
             ), 0)::text AS overdue90
           FROM sales_invoices
           WHERE status = 'POSTED' AND deleted_at IS NULL`,
        ),
      ]);

      const apRes = await client.query<ArApRow>(
        `SELECT
           COALESCE(SUM(grand_total - amount_paid), 0)::text AS outstanding,
           COALESCE(SUM(
             CASE
               WHEN due_date IS NOT NULL AND current_date - due_date > 30
               THEN grand_total - amount_paid ELSE 0
             END
           ), 0)::text AS overdue30,
           COALESCE(SUM(
             CASE
               WHEN due_date IS NOT NULL AND current_date - due_date > 60
               THEN grand_total - amount_paid ELSE 0
             END
           ), 0)::text AS overdue60,
           COALESCE(SUM(
             CASE
               WHEN due_date IS NOT NULL AND current_date - due_date > 90
               THEN grand_total - amount_paid ELSE 0
             END
           ), 0)::text AS overdue90
         FROM purchase_invoices
         WHERE status = 'POSTED' AND deleted_at IS NULL`,
      );

      const [mtdRevRes, mtdExpRes] = await Promise.all([
        client.query<MtdRow>(
          `SELECT COALESCE(SUM(grand_total), 0)::text AS total
             FROM sales_invoices
            WHERE status = 'POSTED'
              AND deleted_at IS NULL
              AND posted_at >= date_trunc('month', current_date)`,
        ),
        client.query<MtdRow>(
          `SELECT COALESCE(SUM(grand_total), 0)::text AS total
             FROM purchase_invoices
            WHERE status = 'POSTED'
              AND deleted_at IS NULL
              AND posted_at >= date_trunc('month', current_date)`,
        ),
      ]);

      const [siCountRes, piCountRes, payCountRes] = await Promise.all([
        client.query<CountRow>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'DRAFT')::text     AS draft,
             COUNT(*) FILTER (WHERE status = 'POSTED')::text    AS posted,
             COUNT(*) FILTER (WHERE status = 'CANCELLED')::text AS cancelled
           FROM sales_invoices
           WHERE deleted_at IS NULL`,
        ),
        client.query<CountRow>(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'DRAFT')::text     AS draft,
             COUNT(*) FILTER (WHERE status = 'POSTED')::text    AS posted,
             COUNT(*) FILTER (WHERE status = 'CANCELLED')::text AS cancelled
           FROM purchase_invoices
           WHERE deleted_at IS NULL`,
        ),
        client.query<PaymentCountRow>(
          `SELECT COUNT(*)::text AS recorded
             FROM payments
            WHERE status = 'RECORDED' AND deleted_at IS NULL`,
        ),
      ]);

      const ar = arRes.rows[0]!;
      const ap = apRes.rows[0]!;
      const mtdRev = mtdRevRes.rows[0]!;
      const mtdExp = mtdExpRes.rows[0]!;
      const si = siCountRes.rows[0]!;
      const pi = piCountRes.rows[0]!;
      const pay = payCountRes.rows[0]!;

      // Normalise NUMERIC strings through Decimal → clean toFixed() so we
      // don't leak "0" or "0.0" inconsistencies into the wire format.
      const toStr = (v: string | null): string =>
        v === null ? "0" : moneyToPg(m(v).lt(ZERO) ? ZERO : m(v));

      return {
        arOutstanding: toStr(ar.outstanding),
        arOverdue30: toStr(ar.overdue30),
        arOverdue60: toStr(ar.overdue60),
        arOverdue90: toStr(ar.overdue90),
        apOutstanding: toStr(ap.outstanding),
        apOverdue30: toStr(ap.overdue30),
        apOverdue60: toStr(ap.overdue60),
        apOverdue90: toStr(ap.overdue90),
        mtdRevenue: toStr(mtdRev.total),
        mtdExpenses: toStr(mtdExp.total),
        draftSalesInvoices: Number(si.draft),
        postedSalesInvoices: Number(si.posted),
        draftPurchaseInvoices: Number(pi.draft),
        postedPurchaseInvoices: Number(pi.posted),
        recordedPayments: Number(pay.recorded),
        currency: "INR",
      };
    });
  }
}
