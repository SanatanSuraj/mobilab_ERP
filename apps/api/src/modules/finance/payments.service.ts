/**
 * Payments service. Polymorphic — handles CUSTOMER_RECEIPT (money IN, settles
 * sales_invoices) and VENDOR_PAYMENT (money OUT, settles purchase_invoices).
 *
 * Create flow (transactional under a single client connection):
 *   1. Validate allocations — each applied_to entry must reference an
 *      existing POSTED invoice whose status isn't CANCELLED and whose
 *      remaining balance can absorb amountApplied.
 *   2. Validate payment_type ↔ counterparty alignment:
 *        CUSTOMER_RECEIPT → customerId required, invoice_type=SALES_INVOICE
 *        VENDOR_PAYMENT   → vendorId required,   invoice_type=PURCHASE_INVOICE
 *   3. Validate total allocations ≤ payment.amount (unallocated = "on account").
 *   4. Insert the payment row.
 *   5. For each allocation:
 *        - bump target invoice.amount_paid
 *        - append customer_ledger (credit) OR vendor_ledger (debit)
 *   6. If there's an "on-account" remainder, append a single ledger row
 *      referencing the payment itself (no invoice).
 *
 * Void flow:
 *   1. Payment must be RECORDED.
 *   2. Flip to VOIDED.
 *   3. For every original allocation, append reversing ledger row +
 *      decrement target invoice.amount_paid.
 *
 * Auto-numbering: PAY-YYYY-NNNN via nextFinanceNumber(kind="PAY").
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import {
  paginated,
  type CreatePayment,
  type Payment,
  type PaymentAppliedInvoice,
  type PaymentListQuerySchema,
  type VoidPayment,
} from "@instigenie/contracts";
import { m, moneyToPg, ZERO } from "@instigenie/money";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { paymentsRepo } from "./payments.repository.js";
import { salesInvoicesRepo } from "./sales-invoices.repository.js";
import { purchaseInvoicesRepo } from "./purchase-invoices.repository.js";
import { customerLedgerRepo } from "./customer-ledger.repository.js";
import { vendorLedgerRepo } from "./vendor-ledger.repository.js";
import { nextFinanceNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";

type PaymentListQuery = z.infer<typeof PaymentListQuerySchema>;

const PAYMENT_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  paymentNumber: "payment_number",
  paymentDate: "payment_date",
  amount: "amount",
  status: "status",
  paymentType: "payment_type",
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export class PaymentsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: PaymentListQuery,
  ): Promise<ReturnType<typeof paginated<Payment>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, PAYMENT_SORTS, "paymentDate");
      const { data, total } = await paymentsRepo.list(
        client,
        {
          paymentType: query.paymentType,
          status: query.status,
          customerId: query.customerId,
          vendorId: query.vendorId,
          mode: query.mode,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Payment> {
    return withRequest(req, this.pool, async (client) => {
      const payment = await paymentsRepo.getById(client, id);
      if (!payment) throw new NotFoundError("payment");
      return payment;
    });
  }

  /**
   * Record a payment + apply it to N invoices. Single-connection transaction.
   * Fails fast on any allocation error — nothing persists partially.
   */
  async create(req: FastifyRequest, input: CreatePayment): Promise<Payment> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // 1. Validate type ↔ counterparty alignment (zod .refine() also catches
      //    this, but we re-check to produce a clearer 409 than a zod 400).
      if (input.paymentType === "CUSTOMER_RECEIPT" && !input.customerId) {
        throw new ConflictError(
          "customerId is required for CUSTOMER_RECEIPT payments",
        );
      }
      if (input.paymentType === "VENDOR_PAYMENT" && !input.vendorId) {
        throw new ConflictError(
          "vendorId is required for VENDOR_PAYMENT payments",
        );
      }

      // 2. Validate applied_to invoice types match payment type
      const expectedInvoiceType =
        input.paymentType === "CUSTOMER_RECEIPT"
          ? "SALES_INVOICE"
          : "PURCHASE_INVOICE";
      for (const alloc of input.appliedTo ?? []) {
        if (alloc.invoiceType !== expectedInvoiceType) {
          throw new ConflictError(
            `allocation ${alloc.invoiceId} has invoiceType=${alloc.invoiceType} but payment is ${input.paymentType}`,
          );
        }
        if (m(alloc.amountApplied).lte(ZERO)) {
          throw new ConflictError(
            `allocation ${alloc.invoiceId} has non-positive amountApplied`,
          );
        }
      }

      // 3. Validate total allocations ≤ payment amount
      const paymentAmount = m(input.amount);
      if (paymentAmount.lte(ZERO)) {
        throw new ConflictError("payment amount must be positive");
      }
      let allocated = ZERO;
      for (const a of input.appliedTo ?? []) {
        allocated = allocated.plus(m(a.amountApplied));
      }
      if (allocated.gt(paymentAmount)) {
        throw new ConflictError(
          `total allocations (${moneyToPg(allocated)}) exceed payment amount (${moneyToPg(paymentAmount)})`,
        );
      }

      // 4. Validate each invoice exists, is POSTED, and has enough remaining
      //    balance. Collect their snapshot info for ledger descriptions.
      interface InvoiceSnapshot {
        id: string;
        number: string;
        amountApplied: string;
        currency: string;
      }
      const salesInvoiceSnapshots: InvoiceSnapshot[] = [];
      const purchaseInvoiceSnapshots: InvoiceSnapshot[] = [];

      for (const a of input.appliedTo ?? []) {
        if (a.invoiceType === "SALES_INVOICE") {
          const inv = await salesInvoicesRepo.getById(client, a.invoiceId);
          if (!inv) {
            throw new NotFoundError(`sales invoice ${a.invoiceId}`);
          }
          if (inv.status !== "POSTED") {
            throw new ConflictError(
              `sales invoice ${inv.invoiceNumber} is ${inv.status}, can only apply to POSTED`,
            );
          }
          const remaining = m(inv.grandTotal).minus(m(inv.amountPaid));
          if (m(a.amountApplied).gt(remaining)) {
            throw new ConflictError(
              `allocation ${moneyToPg(m(a.amountApplied))} exceeds remaining balance ${moneyToPg(remaining)} on invoice ${inv.invoiceNumber}`,
            );
          }
          salesInvoiceSnapshots.push({
            id: inv.id,
            number: inv.invoiceNumber,
            amountApplied: a.amountApplied,
            currency: inv.currency,
          });
        } else {
          const inv = await purchaseInvoicesRepo.getById(client, a.invoiceId);
          if (!inv) {
            throw new NotFoundError(`purchase invoice ${a.invoiceId}`);
          }
          if (inv.status !== "POSTED") {
            throw new ConflictError(
              `purchase invoice ${inv.invoiceNumber} is ${inv.status}, can only apply to POSTED`,
            );
          }
          const remaining = m(inv.grandTotal).minus(m(inv.amountPaid));
          if (m(a.amountApplied).gt(remaining)) {
            throw new ConflictError(
              `allocation ${moneyToPg(m(a.amountApplied))} exceeds remaining balance ${moneyToPg(remaining)} on bill ${inv.invoiceNumber}`,
            );
          }
          purchaseInvoiceSnapshots.push({
            id: inv.id,
            number: inv.invoiceNumber,
            amountApplied: a.amountApplied,
            currency: inv.currency,
          });
        }
      }

      // 5. Create the payment row.
      const paymentNumber =
        input.paymentNumber ??
        (await nextFinanceNumber(client, user.orgId, "PAY"));

      let payment: Payment;
      try {
        payment = await paymentsRepo.create(client, user.orgId, user.id, {
          ...input,
          paymentNumber,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            `payment_number "${paymentNumber}" is already in use`,
          );
        }
        throw err;
      }

      // 6. Apply allocations: bump invoice.amount_paid + append ledger row.
      const currency = input.currency ?? "INR";
      const paymentDate = input.paymentDate ?? payment.paymentDate;

      if (input.paymentType === "CUSTOMER_RECEIPT" && input.customerId) {
        for (const snap of salesInvoiceSnapshots) {
          await salesInvoicesRepo.applyPayment(
            client,
            snap.id,
            snap.amountApplied,
          );
          await customerLedgerRepo.append(client, user.orgId, user.id, {
            customerId: input.customerId,
            entryDate: paymentDate,
            entryType: "PAYMENT",
            debit: "0",
            credit: snap.amountApplied,
            currency: snap.currency,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            referenceNumber: payment.paymentNumber,
            description: `Payment ${payment.paymentNumber} applied to invoice ${snap.number}`,
          });
        }
        // On-account remainder → single ledger row against the payment itself.
        const onAccount = paymentAmount.minus(allocated);
        if (onAccount.gt(ZERO)) {
          await customerLedgerRepo.append(client, user.orgId, user.id, {
            customerId: input.customerId,
            entryDate: paymentDate,
            entryType: "PAYMENT",
            debit: "0",
            credit: moneyToPg(onAccount),
            currency,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            referenceNumber: payment.paymentNumber,
            description: `Payment ${payment.paymentNumber} (on account)`,
          });
        }
      } else if (input.paymentType === "VENDOR_PAYMENT" && input.vendorId) {
        for (const snap of purchaseInvoiceSnapshots) {
          await purchaseInvoicesRepo.applyPayment(
            client,
            snap.id,
            snap.amountApplied,
          );
          // Company pays vendor → debit from the ledger's POV (reduces AP).
          await vendorLedgerRepo.append(client, user.orgId, user.id, {
            vendorId: input.vendorId,
            entryDate: paymentDate,
            entryType: "PAYMENT",
            debit: snap.amountApplied,
            credit: "0",
            currency: snap.currency,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            referenceNumber: payment.paymentNumber,
            description: `Payment ${payment.paymentNumber} applied to bill ${snap.number}`,
          });
        }
        const onAccount = paymentAmount.minus(allocated);
        if (onAccount.gt(ZERO)) {
          await vendorLedgerRepo.append(client, user.orgId, user.id, {
            vendorId: input.vendorId,
            entryDate: paymentDate,
            entryType: "PAYMENT",
            debit: moneyToPg(onAccount),
            credit: "0",
            currency,
            referenceType: "PAYMENT",
            referenceId: payment.id,
            referenceNumber: payment.paymentNumber,
            description: `Payment ${payment.paymentNumber} (on account)`,
          });
        }
      }

      // Refresh to pick up any updates (amount_paid rollups don't affect
      // payment row, but getById returns a consistent view).
      const refreshed = await paymentsRepo.getById(client, payment.id);
      return refreshed!;
    });
  }

  /**
   * Void a payment. Reverses every allocation:
   *   - decrements target invoice.amount_paid by the applied amount
   *   - appends an ADJUSTMENT ledger row with swapped debit/credit
   * The original payment row is flipped to VOIDED; its applied_to JSONB stays
   * intact as a historical record.
   */
  async void(
    req: FastifyRequest,
    id: string,
    input: VoidPayment,
  ): Promise<Payment> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await paymentsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("payment");
      if (cur.status !== "RECORDED") {
        throw new ConflictError(
          `cannot void payment in status ${cur.status}; must be RECORDED`,
        );
      }

      // 1. Flip status first — if this races with another void, the second
      //    caller gets null and we bail before any reversal.
      const voided = await paymentsRepo.markVoided(
        client,
        id,
        user.id,
        input.reason,
      );
      if (!voided) {
        throw new ConflictError("payment is no longer RECORDED");
      }

      // 2. Reverse every allocation.
      const paymentAmount = m(cur.amount);
      let allocated = ZERO;
      const appliedTo: PaymentAppliedInvoice[] = Array.isArray(cur.appliedTo)
        ? cur.appliedTo
        : [];
      for (const alloc of appliedTo) {
        allocated = allocated.plus(m(alloc.amountApplied));
        const negStr = moneyToPg(m(alloc.amountApplied).negated());

        if (alloc.invoiceType === "SALES_INVOICE") {
          // Decrement amount_paid (via negative apply).
          await salesInvoicesRepo.applyPayment(
            client,
            alloc.invoiceId,
            negStr,
          );
          if (cur.customerId) {
            // Reversal: originally credited → now debit back (ADJUSTMENT).
            await customerLedgerRepo.append(client, cur.orgId, user.id, {
              customerId: cur.customerId,
              entryDate: new Date().toISOString().slice(0, 10),
              entryType: "ADJUSTMENT",
              debit: alloc.amountApplied,
              credit: "0",
              currency: cur.currency,
              referenceType: "PAYMENT",
              referenceId: cur.id,
              referenceNumber: cur.paymentNumber,
              description: `Voided payment ${cur.paymentNumber}: ${input.reason}`,
            });
          }
        } else {
          await purchaseInvoicesRepo.applyPayment(
            client,
            alloc.invoiceId,
            negStr,
          );
          if (cur.vendorId) {
            await vendorLedgerRepo.append(client, cur.orgId, user.id, {
              vendorId: cur.vendorId,
              entryDate: new Date().toISOString().slice(0, 10),
              entryType: "ADJUSTMENT",
              debit: "0",
              credit: alloc.amountApplied,
              currency: cur.currency,
              referenceType: "PAYMENT",
              referenceId: cur.id,
              referenceNumber: cur.paymentNumber,
              description: `Voided payment ${cur.paymentNumber}: ${input.reason}`,
            });
          }
        }
      }

      // 3. Reverse on-account remainder (if any).
      const onAccount = paymentAmount.minus(allocated);
      if (onAccount.gt(ZERO)) {
        if (cur.paymentType === "CUSTOMER_RECEIPT" && cur.customerId) {
          await customerLedgerRepo.append(client, cur.orgId, user.id, {
            customerId: cur.customerId,
            entryDate: new Date().toISOString().slice(0, 10),
            entryType: "ADJUSTMENT",
            debit: moneyToPg(onAccount),
            credit: "0",
            currency: cur.currency,
            referenceType: "PAYMENT",
            referenceId: cur.id,
            referenceNumber: cur.paymentNumber,
            description: `Voided on-account payment ${cur.paymentNumber}: ${input.reason}`,
          });
        } else if (cur.paymentType === "VENDOR_PAYMENT" && cur.vendorId) {
          await vendorLedgerRepo.append(client, cur.orgId, user.id, {
            vendorId: cur.vendorId,
            entryDate: new Date().toISOString().slice(0, 10),
            entryType: "ADJUSTMENT",
            debit: "0",
            credit: moneyToPg(onAccount),
            currency: cur.currency,
            referenceType: "PAYMENT",
            referenceId: cur.id,
            referenceNumber: cur.paymentNumber,
            description: `Voided on-account payment ${cur.paymentNumber}: ${input.reason}`,
          });
        }
      }

      return voided;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await paymentsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("payment");
      if (cur.status !== "VOIDED") {
        throw new ConflictError(
          "only VOIDED payments may be soft-deleted; void it first",
        );
      }
      const ok = await paymentsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("payment");
    });
  }
}
