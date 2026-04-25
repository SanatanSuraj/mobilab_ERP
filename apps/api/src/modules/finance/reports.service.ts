/**
 * Finance reports — date-windowed P&L + ageing + top customers.
 *
 * Single read endpoint backing /finance/reports. Four queries, one trip:
 *   - pnl: revenue/expenses on POSTED invoices in window (by posted_at)
 *   - arAgeing / apAgeing: current outstanding by due_date bucket
 *   - topCustomers: by invoiced amount in window
 *
 * Pure read. Reuses sales_invoices + purchase_invoices + payments as-is.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  FinanceReports,
  FinanceReportsQuery,
} from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";

interface PnlRow {
  revenue: string | null;
  expenses: string | null;
  payments_in: string | null;
  payments_out: string | null;
}

interface AgeingRow {
  current: string | null;
  d1_30: string | null;
  d31_60: string | null;
  d61_90: string | null;
  d90_plus: string | null;
  total: string | null;
}

interface TopCustomerRow {
  customer_id: string | null;
  customer_name: string;
  invoice_count: string;
  invoiced_total: string;
  paid_total: string;
}

const DEFAULT_WINDOW_DAYS = 90;

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - DEFAULT_WINDOW_DAYS);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

function safe(s: string | null): string {
  return s ?? "0.00";
}

export class FinanceReportsService {
  constructor(private readonly pool: pg.Pool) {}

  async summary(
    req: FastifyRequest,
    q: FinanceReportsQuery,
  ): Promise<FinanceReports> {
    const def = defaultRange();
    const from = q.from ?? def.from;
    const to = q.to ?? def.to;

    return withRequest(req, this.pool, async (client) => {
      const params = [from, to];

      const pnlSql = `
        WITH revenue AS (
          SELECT COALESCE(SUM(grand_total), 0)::numeric(18,2)::text AS amount
            FROM sales_invoices
           WHERE deleted_at IS NULL
             AND status = 'POSTED'
             AND posted_at >= $1::date
             AND posted_at <  ($2::date + interval '1 day')
        ),
        expenses AS (
          SELECT COALESCE(SUM(grand_total), 0)::numeric(18,2)::text AS amount
            FROM purchase_invoices
           WHERE deleted_at IS NULL
             AND status = 'POSTED'
             AND posted_at >= $1::date
             AND posted_at <  ($2::date + interval '1 day')
        ),
        cash_in AS (
          SELECT COALESCE(SUM(amount), 0)::numeric(18,2)::text AS amount
            FROM payments
           WHERE deleted_at IS NULL
             AND status = 'RECORDED'
             AND payment_type = 'CUSTOMER_RECEIPT'
             AND payment_date >= $1::date
             AND payment_date <  ($2::date + interval '1 day')
        ),
        cash_out AS (
          SELECT COALESCE(SUM(amount), 0)::numeric(18,2)::text AS amount
            FROM payments
           WHERE deleted_at IS NULL
             AND status = 'RECORDED'
             AND payment_type = 'VENDOR_PAYMENT'
             AND payment_date >= $1::date
             AND payment_date <  ($2::date + interval '1 day')
        )
        SELECT
          (SELECT amount FROM revenue)  AS revenue,
          (SELECT amount FROM expenses) AS expenses,
          (SELECT amount FROM cash_in)  AS payments_in,
          (SELECT amount FROM cash_out) AS payments_out
      `;
      const arAgeingSql = ageingSql("sales_invoices");
      const apAgeingSql = ageingSql("purchase_invoices");
      const topCustomersSql = `
        SELECT
          si.customer_id,
          COALESCE(si.customer_name, 'Unknown')                  AS customer_name,
          COUNT(*)::bigint                                       AS invoice_count,
          COALESCE(SUM(si.grand_total), 0)::numeric(18,2)::text  AS invoiced_total,
          COALESCE(SUM(si.amount_paid), 0)::numeric(18,2)::text  AS paid_total
          FROM sales_invoices si
         WHERE si.deleted_at IS NULL
           AND si.status = 'POSTED'
           AND si.posted_at >= $1::date
           AND si.posted_at <  ($2::date + interval '1 day')
         GROUP BY si.customer_id, si.customer_name
         ORDER BY invoiced_total DESC
         LIMIT 10
      `;

      const [pnlRes, arRes, apRes, topRes] = await Promise.all([
        client.query<PnlRow>(pnlSql, params),
        client.query<AgeingRow>(arAgeingSql),
        client.query<AgeingRow>(apAgeingSql),
        client.query<TopCustomerRow>(topCustomersSql, params),
      ]);

      const pnl = pnlRes.rows[0]!;
      const revenueNum = Number(pnl.revenue ?? "0");
      const expensesNum = Number(pnl.expenses ?? "0");
      const grossProfit = (revenueNum - expensesNum).toFixed(2);
      const grossMarginPct =
        revenueNum > 0
          ? Math.round(((revenueNum - expensesNum) / revenueNum) * 1000) / 10
          : 0;
      const cashIn = Number(pnl.payments_in ?? "0");
      const cashOut = Number(pnl.payments_out ?? "0");
      const cashFlow = (cashIn - cashOut).toFixed(2);

      const ar = arRes.rows[0]!;
      const ap = apRes.rows[0]!;

      return {
        from,
        to,
        pnl: {
          revenue: safe(pnl.revenue),
          expenses: safe(pnl.expenses),
          grossProfit,
          grossMarginPct,
          paymentsIn: safe(pnl.payments_in),
          paymentsOut: safe(pnl.payments_out),
          cashFlow,
        },
        arAgeing: {
          current: safe(ar.current),
          days1to30: safe(ar.d1_30),
          days31to60: safe(ar.d31_60),
          days61to90: safe(ar.d61_90),
          days90Plus: safe(ar.d90_plus),
          total: safe(ar.total),
        },
        apAgeing: {
          current: safe(ap.current),
          days1to30: safe(ap.d1_30),
          days31to60: safe(ap.d31_60),
          days61to90: safe(ap.d61_90),
          days90Plus: safe(ap.d90_plus),
          total: safe(ap.total),
        },
        topCustomers: topRes.rows.map((r) => ({
          customerId: r.customer_id,
          customerName: r.customer_name,
          invoiceCount: Number(r.invoice_count),
          invoicedTotal: r.invoiced_total,
          paidTotal: r.paid_total,
        })),
      };
    });
  }
}

function ageingSql(table: "sales_invoices" | "purchase_invoices"): string {
  return `
    SELECT
      COALESCE(SUM(
        CASE WHEN due_date IS NULL OR current_date <= due_date
             THEN grand_total - amount_paid ELSE 0 END
      ), 0)::numeric(18,2)::text AS current,
      COALESCE(SUM(
        CASE WHEN due_date IS NOT NULL
                  AND current_date - due_date BETWEEN 1 AND 30
             THEN grand_total - amount_paid ELSE 0 END
      ), 0)::numeric(18,2)::text AS d1_30,
      COALESCE(SUM(
        CASE WHEN due_date IS NOT NULL
                  AND current_date - due_date BETWEEN 31 AND 60
             THEN grand_total - amount_paid ELSE 0 END
      ), 0)::numeric(18,2)::text AS d31_60,
      COALESCE(SUM(
        CASE WHEN due_date IS NOT NULL
                  AND current_date - due_date BETWEEN 61 AND 90
             THEN grand_total - amount_paid ELSE 0 END
      ), 0)::numeric(18,2)::text AS d61_90,
      COALESCE(SUM(
        CASE WHEN due_date IS NOT NULL
                  AND current_date - due_date > 90
             THEN grand_total - amount_paid ELSE 0 END
      ), 0)::numeric(18,2)::text AS d90_plus,
      COALESCE(SUM(grand_total - amount_paid), 0)::numeric(18,2)::text AS total
      FROM ${table}
     WHERE deleted_at IS NULL
       AND status = 'POSTED'
       AND grand_total > amount_paid
  `;
}
