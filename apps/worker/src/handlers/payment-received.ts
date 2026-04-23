/**
 * payment.received handler — automate.md Track 1 Phase 2.
 *
 *   payment.received → finance.observeSettlement   (shell, see below)
 *
 * ─── Why this handler is a deliberate near-no-op ──────────────────────
 *
 * The original plan (automate.md Part C Phase 2) listed two handlers:
 *
 *   finance.applyToCustomerLedger  — append a PAYMENT row per allocation
 *   finance.maybeSettleInvoice     — flip invoice status to PAID when
 *                                    amount_paid >= grand_total
 *
 * Both have blockers against being implemented as designed:
 *
 *  1. applyToCustomerLedger would double-book.
 *     apps/api/src/modules/finance/payments.service.ts already calls
 *     `customerLedgerRepo.append(...)` / `vendorLedgerRepo.append(...)`
 *     inside the same transaction that creates the payment — AND bumps
 *     each applied invoice's `amount_paid`. By the time this handler
 *     fires the ledger rows are already there. Re-appending from the
 *     outbox worker would either:
 *       (a) error out on the append-only running-balance sequence, or
 *       (b) worse, silently write a second PAYMENT row and permanently
 *           shift the running balance.
 *     The right split is event-bus over sync-then-publish: the service
 *     remains authoritative for the DB writes; the outbox just announces
 *     "this happened" so other consumers (dashboards, reporting lakes,
 *     external GL push) can react. We honour that here by not mutating.
 *
 *  2. maybeSettleInvoice has no state to transition to.
 *     The `sales_invoices.status` CHECK allows only DRAFT / POSTED /
 *     CANCELLED. There's no PAID (or SETTLED, or CLOSED) value today.
 *     See ops/sql/init/07-finance.sql:62. Introducing PAID requires a
 *     migration + RLS re-check + a review of reports that GROUP BY
 *     status — that's Track 2 finance work, not Track 1. Until then we
 *     can OBSERVE settlement (amount_paid >= grand_total) but not ACT
 *     on it.
 *
 * ─── What this handler DOES do ────────────────────────────────────────
 *
 * For each invoice id on `payload.appliedInvoiceIds`:
 *   - read `amount_paid`, `grand_total`, `status`
 *   - emit a structured log line tagged with whether the invoice is now
 *     fully settled (READ-ONLY — no writes).
 *
 * That gives ops a searchable trail of "which invoices reached zero
 * outstanding when" without waiting for the schema change. When Track 2
 * adds the PAID status + migration this handler body becomes the
 * natural place to flip it.
 *
 * Idempotency: handler is read-only, so repeat-runs are harmless. The
 * outbox.handler_runs slot still guards against it, but there's no
 * correctness dependency.
 */

import type { EventHandler, PaymentReceivedPayload } from "./types.js";

interface InvoiceSettlementRow {
  id: string;
  invoice_number: string;
  status: string;
  amount_paid: string;
  grand_total: string;
}

export const observeSettlement: EventHandler<PaymentReceivedPayload> = async (
  client,
  payload,
  ctx,
) => {
  // Nothing to observe if the payment carried no invoice allocations
  // (a pure on-account deposit). The outbox row still exists for any
  // other consumer — we just have nothing to say.
  const invoiceIds = payload.appliedInvoiceIds ?? [];
  if (invoiceIds.length === 0) {
    ctx.log.info(
      {
        outboxId: ctx.outboxId,
        paymentId: payload.paymentId,
        paymentNumber: payload.paymentNumber,
        amount: payload.amount,
      },
      "payment.received: no applied invoices; on-account deposit observed",
    );
    return;
  }

  // Read-only peek at each settled invoice. `payload.amount` is signed:
  // positive receipts credit the customer ledger (sales invoices),
  // negative payouts debit the vendor ledger (purchase invoices). We
  // currently inspect sales_invoices only because AR visibility is the
  // Phase 1 need; AP maybeSettle follows the same pattern if Track 2
  // adds it.
  const signedAmount = Number(payload.amount);
  const isInbound = signedAmount >= 0;
  if (!isInbound) {
    ctx.log.info(
      {
        outboxId: ctx.outboxId,
        paymentId: payload.paymentId,
        paymentNumber: payload.paymentNumber,
        amount: payload.amount,
        appliedInvoiceCount: invoiceIds.length,
      },
      "payment.received: outbound payout observed; AP settlement observer is Track 2",
    );
    return;
  }

  const { rows } = await client.query<InvoiceSettlementRow>(
    `SELECT id, invoice_number, status, amount_paid, grand_total
       FROM sales_invoices
      WHERE org_id = $1
        AND id = ANY($2::uuid[])
        AND deleted_at IS NULL`,
    [payload.orgId, invoiceIds],
  );

  let fullySettled = 0;
  let partiallyPaid = 0;
  let notFound = 0;
  const settledInvoices: Array<{
    id: string;
    invoiceNumber: string;
    status: string;
    amountPaid: string;
    grandTotal: string;
  }> = [];

  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.id);
    const paid = Number(row.amount_paid);
    const total = Number(row.grand_total);
    // Guard: grand_total = 0 invoices shouldn't exist in practice (CHECK
    // allows 0 but the service refuses to POST them). Treat as "paid"
    // trivially to avoid a divide-by-zero/false-negative.
    const isSettled = total > 0 ? paid + 1e-4 >= total : true;
    if (isSettled) {
      fullySettled += 1;
      settledInvoices.push({
        id: row.id,
        invoiceNumber: row.invoice_number,
        status: row.status,
        amountPaid: row.amount_paid,
        grandTotal: row.grand_total,
      });
    } else {
      partiallyPaid += 1;
    }
  }
  for (const id of invoiceIds) {
    if (!seen.has(id)) notFound += 1;
  }

  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      paymentId: payload.paymentId,
      paymentNumber: payload.paymentNumber,
      amount: payload.amount,
      appliedInvoiceCount: invoiceIds.length,
      fullySettled,
      partiallyPaid,
      notFound,
      // Shallow list of the settled invoices — useful for live ops search
      // ("which invoices cleared on payment PAY-2026-0042?"). When Track 2
      // adds status=PAID this is where the flip call will go.
      settledInvoices,
    },
    "handler payment.received → finance.observeSettlement (read-only; status flip deferred to Track 2)",
  );
};
