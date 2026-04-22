/**
 * Purchase invoices service. Orchestrates the same DRAFT → POSTED → CANCELLED
 * lifecycle as sales-invoices.service, but for vendor bills.
 *
 * On POST, appends a BILL row to vendor_ledger (debit = grandTotal from the
 * company's POV — vendor is owed money).
 * On CANCEL of a POSTED bill with an outstanding balance, appends a
 * reversing CREDIT (ADJUSTMENT) to vendor_ledger.
 *
 * Auto-numbering: PI-YYYY-NNNN via nextFinanceNumber(kind="PI").
 */

import type pg from "pg";
import type { PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import {
  paginated,
  type CancelPurchaseInvoice,
  type CreatePurchaseInvoice,
  type CreatePurchaseInvoiceLine,
  type PostPurchaseInvoice,
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceListQuerySchema,
  type PurchaseInvoiceWithLines,
  type UpdatePurchaseInvoice,
  type UpdatePurchaseInvoiceLine,
} from "@instigenie/contracts";
import { m, moneyToPg, ZERO } from "@instigenie/money";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { purchaseInvoicesRepo } from "./purchase-invoices.repository.js";
import { vendorLedgerRepo } from "./vendor-ledger.repository.js";
import { nextFinanceNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";

type PurchaseInvoiceListQuery = z.infer<typeof PurchaseInvoiceListQuerySchema>;

const INVOICE_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  invoiceNumber: "invoice_number",
  invoiceDate: "invoice_date",
  dueDate: "due_date",
  status: "status",
  matchStatus: "match_status",
  grandTotal: "grand_total",
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

// ─── Money helpers (same shape as sales) ─────────────────────────────────────

interface LineComputed {
  lineSubtotal: string;
  lineTax: string;
  lineTotal: string;
  lineDiscount: string;
}

function computeLineTotals(input: {
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  taxRatePercent?: string;
}): LineComputed {
  const qty = m(input.quantity);
  const price = m(input.unitPrice);
  const discPct = m(input.discountPercent ?? "0");
  const taxPct = m(input.taxRatePercent ?? "0");

  const gross = qty.times(price);
  const lineDiscount = gross.times(discPct).dividedBy(100);
  const lineSubtotal = gross.minus(lineDiscount);
  const lineTax = lineSubtotal.times(taxPct).dividedBy(100);
  const lineTotal = lineSubtotal.plus(lineTax);

  return {
    lineSubtotal: moneyToPg(lineSubtotal),
    lineTax: moneyToPg(lineTax),
    lineTotal: moneyToPg(lineTotal),
    lineDiscount: moneyToPg(lineDiscount),
  };
}

function mergeLinePatch(
  existing: PurchaseInvoiceLine,
  patch: UpdatePurchaseInvoiceLine,
): {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxRatePercent: string;
} {
  return {
    quantity: patch.quantity ?? existing.quantity,
    unitPrice: patch.unitPrice ?? existing.unitPrice,
    discountPercent:
      patch.discountPercent ?? existing.discountPercent ?? "0",
    taxRatePercent:
      patch.taxRatePercent ?? existing.taxRatePercent ?? "0",
  };
}

interface HeaderTotals {
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
}

async function recomputeAndPersistHeaderTotals(
  client: PoolClient,
  invoiceId: string,
): Promise<HeaderTotals> {
  const lines = await purchaseInvoicesRepo.listLines(client, invoiceId);
  let subtotal = ZERO;
  let taxTotal = ZERO;
  let discountTotal = ZERO;
  let grandTotal = ZERO;
  for (const ln of lines) {
    const lineDiscount = m(ln.quantity)
      .times(m(ln.unitPrice))
      .times(m(ln.discountPercent ?? "0"))
      .dividedBy(100);
    subtotal = subtotal.plus(m(ln.lineSubtotal));
    taxTotal = taxTotal.plus(m(ln.lineTax));
    discountTotal = discountTotal.plus(lineDiscount);
    grandTotal = grandTotal.plus(m(ln.lineTotal));
  }
  const totals: HeaderTotals = {
    subtotal: moneyToPg(subtotal),
    taxTotal: moneyToPg(taxTotal),
    discountTotal: moneyToPg(discountTotal),
    grandTotal: moneyToPg(grandTotal),
  };
  await purchaseInvoicesRepo.updateTotals(client, invoiceId, totals);
  return totals;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PurchaseInvoicesService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: PurchaseInvoiceListQuery,
  ): Promise<ReturnType<typeof paginated<PurchaseInvoice>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, INVOICE_SORTS, "createdAt");
      const { data, total } = await purchaseInvoicesRepo.list(
        client,
        {
          status: query.status,
          matchStatus: query.matchStatus,
          vendorId: query.vendorId,
          purchaseOrderId: query.purchaseOrderId,
          grnId: query.grnId,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(
    req: FastifyRequest,
    id: string,
  ): Promise<PurchaseInvoiceWithLines> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseInvoicesRepo.getById(client, id);
      if (!header) throw new NotFoundError("purchase invoice");
      const lines = await purchaseInvoicesRepo.listLines(client, id);
      return { ...header, lines };
    });
  }

  async create(
    req: FastifyRequest,
    input: CreatePurchaseInvoice,
  ): Promise<PurchaseInvoiceWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const invoiceNumber =
        input.invoiceNumber ??
        (await nextFinanceNumber(client, user.orgId, "PI"));

      let header: PurchaseInvoice;
      try {
        header = await purchaseInvoicesRepo.createHeader(
          client,
          user.orgId,
          user.id,
          { ...input, invoiceNumber },
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            `invoice_number "${invoiceNumber}" is already in use`,
          );
        }
        throw err;
      }

      for (const ln of input.lines ?? []) {
        const computed = computeLineTotals(ln);
        await purchaseInvoicesRepo.addLine(
          client,
          user.orgId,
          header.id,
          ln,
          {
            lineSubtotal: computed.lineSubtotal,
            lineTax: computed.lineTax,
            lineTotal: computed.lineTotal,
          },
        );
      }

      await recomputeAndPersistHeaderTotals(client, header.id);
      await purchaseInvoicesRepo.touchHeader(client, header.id);
      const refreshed = await purchaseInvoicesRepo.getById(client, header.id);
      const lines = await purchaseInvoicesRepo.listLines(client, header.id);
      return { ...refreshed!, lines };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdatePurchaseInvoice,
  ): Promise<PurchaseInvoice> {
    return withRequest(req, this.pool, async (client) => {
      const result = await purchaseInvoicesRepo.updateWithVersion(
        client,
        id,
        input,
      );
      if (result === null) throw new NotFoundError("purchase invoice");
      if (result === "version_conflict") {
        throw new ConflictError("purchase invoice was modified by someone else");
      }
      if (result === "not_draft") {
        throw new ConflictError(
          "purchase invoice is no longer DRAFT and cannot be edited",
        );
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await purchaseInvoicesRepo.getById(client, id);
      if (!cur) throw new NotFoundError("purchase invoice");
      if (cur.status !== "DRAFT") {
        throw new ConflictError(
          `cannot delete a ${cur.status} invoice; only DRAFT may be deleted`,
        );
      }
      const ok = await purchaseInvoicesRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("purchase invoice");
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async post(
    req: FastifyRequest,
    id: string,
    input: PostPurchaseInvoice,
  ): Promise<PurchaseInvoiceWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await purchaseInvoicesRepo.getById(client, id);
      if (!cur) throw new NotFoundError("purchase invoice");
      if (cur.status !== "DRAFT") {
        throw new ConflictError(
          `cannot post invoice in status ${cur.status}; must be DRAFT`,
        );
      }
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("purchase invoice was modified by someone else");
      }

      const lines = await purchaseInvoicesRepo.listLines(client, id);
      if (lines.length === 0) {
        throw new ConflictError("cannot post an invoice with no lines");
      }

      const totals = await recomputeAndPersistHeaderTotals(client, id);
      if (m(totals.grandTotal).lte(ZERO)) {
        throw new ConflictError(
          "cannot post an invoice with non-positive grandTotal",
        );
      }

      const posted = await purchaseInvoicesRepo.markPosted(
        client,
        id,
        user.id,
        input.postedAt ?? null,
      );
      if (!posted) {
        throw new ConflictError(
          "purchase invoice is no longer DRAFT and cannot be posted",
        );
      }

      if (posted.vendorId) {
        await vendorLedgerRepo.append(client, user.orgId, user.id, {
          vendorId: posted.vendorId,
          entryDate: posted.invoiceDate,
          entryType: "BILL",
          debit: posted.grandTotal,
          credit: "0",
          currency: posted.currency,
          referenceType: "PURCHASE_INVOICE",
          referenceId: posted.id,
          referenceNumber: posted.invoiceNumber,
          description: `Vendor bill ${posted.invoiceNumber}`,
        });
      }

      const refreshedLines = await purchaseInvoicesRepo.listLines(client, id);
      return { ...posted, lines: refreshedLines };
    });
  }

  async cancel(
    req: FastifyRequest,
    id: string,
    input: CancelPurchaseInvoice,
  ): Promise<PurchaseInvoice> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await purchaseInvoicesRepo.getById(client, id);
      if (!cur) throw new NotFoundError("purchase invoice");
      if (cur.status === "CANCELLED") {
        throw new ConflictError("purchase invoice is already cancelled");
      }
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("purchase invoice was modified by someone else");
      }

      const wasPosted = cur.status === "POSTED";
      const cancelled = await purchaseInvoicesRepo.markCancelled(
        client,
        id,
        user.id,
      );
      if (!cancelled) throw new NotFoundError("purchase invoice");

      if (wasPosted && cancelled.vendorId) {
        const outstanding = m(cancelled.grandTotal).minus(
          m(cancelled.amountPaid),
        );
        if (outstanding.gt(ZERO)) {
          await vendorLedgerRepo.append(client, user.orgId, user.id, {
            vendorId: cancelled.vendorId,
            entryDate: new Date().toISOString().slice(0, 10),
            entryType: "ADJUSTMENT",
            debit: "0",
            credit: moneyToPg(outstanding),
            currency: cancelled.currency,
            referenceType: "PURCHASE_INVOICE",
            referenceId: cancelled.id,
            referenceNumber: cancelled.invoiceNumber,
            description:
              input.reason ??
              `Cancelled bill ${cancelled.invoiceNumber}`,
          });
        }
      }

      return cancelled;
    });
  }

  // ── Lines CRUD ───────────────────────────────────────────────────────────

  async listLines(
    req: FastifyRequest,
    invoiceId: string,
  ): Promise<PurchaseInvoiceLine[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("purchase invoice");
      return purchaseInvoicesRepo.listLines(client, invoiceId);
    });
  }

  async addLine(
    req: FastifyRequest,
    invoiceId: string,
    input: CreatePurchaseInvoiceLine,
  ): Promise<PurchaseInvoiceLine> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("purchase invoice");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot add lines to ${header.status} invoice; must be DRAFT`,
        );
      }
      const computed = computeLineTotals(input);
      const line = await purchaseInvoicesRepo.addLine(
        client,
        user.orgId,
        invoiceId,
        input,
        {
          lineSubtotal: computed.lineSubtotal,
          lineTax: computed.lineTax,
          lineTotal: computed.lineTotal,
        },
      );
      await recomputeAndPersistHeaderTotals(client, invoiceId);
      await purchaseInvoicesRepo.touchHeader(client, invoiceId);
      return line;
    });
  }

  async updateLine(
    req: FastifyRequest,
    invoiceId: string,
    lineId: string,
    input: UpdatePurchaseInvoiceLine,
  ): Promise<PurchaseInvoiceLine> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("purchase invoice");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot update lines on ${header.status} invoice; must be DRAFT`,
        );
      }
      const existing = await purchaseInvoicesRepo.getLineById(client, lineId);
      if (!existing || existing.invoiceId !== invoiceId) {
        throw new NotFoundError("purchase invoice line");
      }
      const needsRecompute =
        input.quantity !== undefined ||
        input.unitPrice !== undefined ||
        input.discountPercent !== undefined ||
        input.taxRatePercent !== undefined;
      const computed = needsRecompute
        ? computeLineTotals(mergeLinePatch(existing, input))
        : null;
      const updated = await purchaseInvoicesRepo.updateLine(
        client,
        lineId,
        input,
        computed
          ? {
              lineSubtotal: computed.lineSubtotal,
              lineTax: computed.lineTax,
              lineTotal: computed.lineTotal,
            }
          : null,
      );
      if (!updated) throw new NotFoundError("purchase invoice line");
      if (needsRecompute) {
        await recomputeAndPersistHeaderTotals(client, invoiceId);
      }
      await purchaseInvoicesRepo.touchHeader(client, invoiceId);
      return updated;
    });
  }

  async deleteLine(
    req: FastifyRequest,
    invoiceId: string,
    lineId: string,
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("purchase invoice");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot delete lines on ${header.status} invoice; must be DRAFT`,
        );
      }
      const existing = await purchaseInvoicesRepo.getLineById(client, lineId);
      if (!existing || existing.invoiceId !== invoiceId) {
        throw new NotFoundError("purchase invoice line");
      }
      const ok = await purchaseInvoicesRepo.deleteLine(client, lineId);
      if (!ok) throw new NotFoundError("purchase invoice line");
      await recomputeAndPersistHeaderTotals(client, invoiceId);
      await purchaseInvoicesRepo.touchHeader(client, invoiceId);
    });
  }
}
