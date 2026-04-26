/**
 * Sales invoices service. Orchestrates DRAFT → AWAITING_APPROVAL → POSTED →
 * CANCELLED lifecycle, money computation, and customer_ledger append on post.
 *
 * Lifecycle:
 *   DRAFT             ──submit-for-posting──▶ AWAITING_APPROVAL
 *   AWAITING_APPROVAL ──finaliser APPROVE──▶  POSTED
 *                     ──finaliser REJECT──▶   DRAFT     (re-edit + resubmit)
 *   DRAFT|POSTED      ──cancel──▶            CANCELLED  (POSTED reverses AR)
 *
 * Invariants (service-enforced, not DB-enforced):
 *   - invoice header + lines are mutable only while status = DRAFT
 *   - submit-for-posting requires ≥1 line with grandTotal > 0
 *   - customer_ledger is append-only — we NEVER UPDATE / DELETE a row
 *   - Totals recomputation is explicit and consistent: on every line mutation
 *     we recompute the header's subtotal / taxTotal / discountTotal /
 *     grandTotal and persist via repo.updateTotals.
 *
 * Money math:
 *   - Each line:
 *       gross        = qty * unitPrice
 *       lineDiscount = gross * discountPercent / 100
 *       lineSubtotal = gross - lineDiscount
 *       lineTax      = lineSubtotal * taxRatePercent / 100
 *       lineTotal    = lineSubtotal + lineTax
 *   - Header aggregates line_* fields.
 *   - All math via @instigenie/money (decimal.js). NEVER Number().
 *
 * Auto-numbering: SI-YYYY-NNNN via nextFinanceNumber(kind="SI").
 *
 * §9.5 — invoice issue is a critical action requiring e-signature. The
 * password re-entry now happens at the approval chain's terminal step
 * (`requiresESignature: true` on the seed chain), not here. The
 * resulting HMAC arrives via the finaliser context and the finaliser
 * stamps it onto `signature_hash` along with the same `actedAt` the
 * hash was bound to.
 */

import type pg from "pg";
import type { PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import {
  paginated,
  type CancelSalesInvoice,
  type CreateSalesInvoice,
  type CreateSalesInvoiceLine,
  type SalesInvoice,
  type SalesInvoiceLine,
  type SalesInvoiceListQuerySchema,
  type SalesInvoiceWithLines,
  type SubmitSalesInvoiceForPosting,
  type UpdateSalesInvoice,
  type UpdateSalesInvoiceLine,
} from "@instigenie/contracts";
import { m, moneyToPg, ZERO } from "@instigenie/money";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { salesInvoicesRepo } from "./sales-invoices.repository.js";
import { customerLedgerRepo } from "./customer-ledger.repository.js";
import { nextFinanceNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";
import type {
  ApprovalsService,
  ApprovalFinaliserContext,
  ApprovalCancelFinaliserContext,
} from "../approvals/approvals.service.js";

type SalesInvoiceListQuery = z.infer<typeof SalesInvoiceListQuerySchema>;

const INVOICE_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  invoiceNumber: "invoice_number",
  invoiceDate: "invoice_date",
  dueDate: "due_date",
  status: "status",
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

// ─── Money helpers ───────────────────────────────────────────────────────────

interface LineComputed {
  lineSubtotal: string;
  lineTax: string;
  lineTotal: string;
  lineDiscount: string;
}

/**
 * Compute per-line totals from raw inputs. All math is decimal.js.
 *
 * Formula:
 *   gross        = qty * unitPrice
 *   lineDiscount = gross * discountPercent / 100
 *   lineSubtotal = gross - lineDiscount
 *   lineTax      = lineSubtotal * taxRatePercent / 100
 *   lineTotal    = lineSubtotal + lineTax
 */
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

/** Merge an UpdateSalesInvoiceLine patch onto the existing DB row so we can
 * recompute totals consistently (service supplies the merged inputs to
 * computeLineTotals). */
function mergeLinePatch(
  existing: SalesInvoiceLine,
  patch: UpdateSalesInvoiceLine,
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

/** Sum all current lines into the header's 4 aggregate totals. */
async function recomputeAndPersistHeaderTotals(
  client: PoolClient,
  invoiceId: string,
): Promise<HeaderTotals> {
  const lines = await salesInvoicesRepo.listLines(client, invoiceId);
  let subtotal = ZERO;
  let taxTotal = ZERO;
  let discountTotal = ZERO;
  let grandTotal = ZERO;
  for (const ln of lines) {
    // Discount must be derived from raw inputs — the DB doesn't store it.
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
  await salesInvoicesRepo.updateTotals(client, invoiceId, totals);
  return totals;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export interface SalesInvoicesServiceDeps {
  pool: pg.Pool;
  /**
   * Required to dispatch into `/approvals/*` on submit-for-posting.
   * Optional in the deps shape so a bare-pool fallback still compiles,
   * but absent at runtime any submit-for-posting call fails closed
   * rather than silently flipping the row to AWAITING_APPROVAL without
   * a backing approval_request.
   */
  approvals?: ApprovalsService;
}

function isSalesInvoicesServiceDeps(
  x: SalesInvoicesServiceDeps | pg.Pool,
): x is SalesInvoicesServiceDeps {
  return typeof x === "object" && x !== null && "pool" in x;
}

export class SalesInvoicesService {
  private readonly pool: pg.Pool;
  private readonly approvals: ApprovalsService | null;

  // Two accepted shapes so existing Phase 2 tests that pre-date the
  // approvals wiring and construct `new SalesInvoicesService(pool)` still
  // work. When the bare-pool form is used, submit-for-posting fails
  // closed.
  constructor(poolOrDeps: pg.Pool | SalesInvoicesServiceDeps) {
    if (isSalesInvoicesServiceDeps(poolOrDeps)) {
      this.pool = poolOrDeps.pool;
      this.approvals = poolOrDeps.approvals ?? null;
    } else {
      this.pool = poolOrDeps;
      this.approvals = null;
    }
  }

  async list(
    req: FastifyRequest,
    query: SalesInvoiceListQuery,
  ): Promise<ReturnType<typeof paginated<SalesInvoice>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, INVOICE_SORTS, "createdAt");
      const { data, total } = await salesInvoicesRepo.list(
        client,
        {
          status: query.status,
          customerId: query.customerId,
          workOrderId: query.workOrderId,
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
  ): Promise<SalesInvoiceWithLines> {
    return withRequest(req, this.pool, async (client) => {
      const header = await salesInvoicesRepo.getById(client, id);
      if (!header) throw new NotFoundError("sales invoice");
      const lines = await salesInvoicesRepo.listLines(client, id);
      return { ...header, lines };
    });
  }

  /**
   * Create a DRAFT invoice, optionally with initial lines. Auto-generates
   * SI-YYYY-NNNN if not supplied. Totals are recomputed from lines (even
   * if lines is empty — the header persists zeroed).
   */
  async create(
    req: FastifyRequest,
    input: CreateSalesInvoice,
  ): Promise<SalesInvoiceWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const invoiceNumber =
        input.invoiceNumber ??
        (await nextFinanceNumber(client, user.orgId, "SI"));

      let header: SalesInvoice;
      try {
        header = await salesInvoicesRepo.createHeader(
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

      // Seed lines (if any).
      for (const ln of input.lines ?? []) {
        const computed = computeLineTotals(ln);
        await salesInvoicesRepo.addLine(
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
      await salesInvoicesRepo.touchHeader(client, header.id);
      const refreshed = await salesInvoicesRepo.getById(client, header.id);
      const lines = await salesInvoicesRepo.listLines(client, header.id);
      return { ...refreshed!, lines };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateSalesInvoice,
  ): Promise<SalesInvoice> {
    return withRequest(req, this.pool, async (client) => {
      const result = await salesInvoicesRepo.updateWithVersion(
        client,
        id,
        input,
      );
      if (result === null) throw new NotFoundError("sales invoice");
      if (result === "version_conflict") {
        throw new ConflictError("sales invoice was modified by someone else");
      }
      if (result === "not_draft") {
        throw new ConflictError(
          "sales invoice is no longer DRAFT and cannot be edited",
        );
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await salesInvoicesRepo.getById(client, id);
      if (!cur) throw new NotFoundError("sales invoice");
      if (cur.status !== "DRAFT") {
        throw new ConflictError(
          `cannot delete a ${cur.status} invoice; only DRAFT may be deleted`,
        );
      }
      const ok = await salesInvoicesRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("sales invoice");
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Submit a DRAFT invoice for posting. Opens an `invoice` approval_request
   * (chain band looked up by grandTotal) and flips status DRAFT →
   * AWAITING_APPROVAL inside the same transaction. The terminal approver
   * supplies password + reason at `/approvals/:id/act`; the resulting
   * HMAC + actedAt arrive via the finaliser context and the finaliser
   * (`applyDecisionFromApprovals`) stamps them onto the invoice row.
   *
   * Validation runs before the approval request is opened — an empty
   * invoice or one with grandTotal ≤ 0 is rejected without leaving any
   * approvals state behind.
   */
  async submitForPosting(
    req: FastifyRequest,
    id: string,
    input: SubmitSalesInvoiceForPosting,
  ): Promise<SalesInvoiceWithLines> {
    if (!this.approvals) {
      throw new ValidationError(
        "approvals service is not wired — submit-for-posting is unavailable",
      );
    }
    const approvals = this.approvals;
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await salesInvoicesRepo.getById(client, id);
      if (!cur) throw new NotFoundError("sales invoice");
      if (cur.status !== "DRAFT") {
        throw new ConflictError(
          `cannot submit invoice for posting in status ${cur.status}; must be DRAFT`,
        );
      }
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("sales invoice was modified by someone else");
      }

      const lines = await salesInvoicesRepo.listLines(client, id);
      if (lines.length === 0) {
        throw new ConflictError("cannot post an invoice with no lines");
      }

      // Recompute totals so the chain-band lookup uses an authoritative
      // grandTotal even if a stale header total slipped through. NOTE:
      // this UPDATE fires the `tg_bump_version` trigger which bumps the
      // row's version, so the OCC handle the caller passed in is no
      // longer valid for any subsequent UPDATE in this transaction. We
      // re-read the row to pick up the bumped version before the flip.
      const totals = await recomputeAndPersistHeaderTotals(client, id);
      if (m(totals.grandTotal).lte(ZERO)) {
        throw new ConflictError(
          "cannot post an invoice with non-positive grandTotal",
        );
      }
      const afterRecompute = await salesInvoicesRepo.getById(client, id);
      if (!afterRecompute) {
        throw new NotFoundError("sales invoice");
      }

      // Open the approval_request first. createRequestForEntity throws on
      // duplicate-pending or chain-not-found; both abort BEFORE the status
      // flip so a failure leaves the row in DRAFT.
      await approvals.createRequestForEntity(client, user, {
        entityType: "invoice",
        entityId: id,
        amount: totals.grandTotal,
        currency: cur.currency,
        notes: input.notes,
      });

      const flipped = await salesInvoicesRepo.markAwaitingApproval(
        client,
        id,
        afterRecompute.version,
      );
      if (flipped === null) throw new NotFoundError("sales invoice");
      if (flipped === "version_conflict") {
        throw new ConflictError("sales invoice was modified by someone else");
      }
      if (flipped === "not_draft") {
        throw new ConflictError(
          "sales invoice is no longer DRAFT and cannot be submitted",
        );
      }

      const refreshedLines = await salesInvoicesRepo.listLines(client, id);
      return { ...flipped, lines: refreshedLines };
    });
  }

  /**
   * Finaliser invoked by `ApprovalsService.act()` once an `invoice`
   * approval_request reaches APPROVED or REJECTED. Runs inside the
   * caller's transaction.
   *
   *   APPROVE  → recompute totals (defence in depth — lines may have
   *              been edited via /lines while AWAITING_APPROVAL was
   *              technically locked from header edits but lines are
   *              not strictly frozen by the service today), markPosted
   *              with ctx.actedAt + ctx.eSignatureHash, append the
   *              INVOICE row to customer_ledger.
   *
   *   REJECT   → revertToDraft so the user can edit + resubmit.
   *
   * The HMAC arrived from approvals — we never recompute it here. We do
   * stamp ctx.actedAt onto posted_at so an auditor reproducing the hash
   * binds against the same timestamp the approvals layer used.
   */
  async applyDecisionFromApprovals(
    client: PoolClient,
    ctx: ApprovalFinaliserContext,
  ): Promise<void> {
    const { request, finalStatus, actor, actedAt, eSignatureHash } = ctx;
    const cur = await salesInvoicesRepo.getById(client, request.entityId);
    if (!cur) {
      throw new NotFoundError("sales invoice");
    }
    if (cur.status !== "AWAITING_APPROVAL") {
      throw new StateTransitionError(
        `cannot ${finalStatus.toLowerCase()} an invoice in status ${cur.status}; expected AWAITING_APPROVAL`,
      );
    }

    if (finalStatus === "REJECTED") {
      const reverted = await salesInvoicesRepo.revertToDraft(
        client,
        request.entityId,
      );
      if (!reverted) {
        throw new ConflictError(
          "invoice is no longer AWAITING_APPROVAL and cannot be reverted",
        );
      }
      return;
    }

    // APPROVED — recompute totals, stamp posted_at + signature_hash,
    // append the AR ledger row. All in the same caller transaction.
    const totals = await recomputeAndPersistHeaderTotals(
      client,
      request.entityId,
    );
    if (m(totals.grandTotal).lte(ZERO)) {
      throw new ConflictError(
        "cannot post an invoice with non-positive grandTotal",
      );
    }
    const posted = await salesInvoicesRepo.markPosted(
      client,
      request.entityId,
      actor.id,
      actedAt,
      eSignatureHash,
    );
    if (!posted) {
      throw new ConflictError(
        "invoice is no longer AWAITING_APPROVAL and cannot be posted",
      );
    }
    if (posted.customerId) {
      await customerLedgerRepo.append(client, actor.orgId, actor.id, {
        customerId: posted.customerId,
        entryDate: posted.invoiceDate,
        entryType: "INVOICE",
        debit: posted.grandTotal,
        credit: "0",
        currency: posted.currency,
        referenceType: "SALES_INVOICE",
        referenceId: posted.id,
        referenceNumber: posted.invoiceNumber,
        description: `Sales invoice ${posted.invoiceNumber}`,
      });
    }
  }

  /**
   * Cancel-finaliser. Called by `ApprovalsService.cancelRequest()` when
   * the user cancels a PENDING approval for a sales invoice. Mirrors the
   * REJECT path of {@link applyDecisionFromApprovals} — reverts
   * AWAITING_APPROVAL → DRAFT so the invoice is editable + resubmittable.
   *
   * The {@link cancel} method below explicitly forces the user through
   * this path when the invoice is AWAITING_APPROVAL — this is the
   * "approvals.cancelRequest first, then revertToDraft" hand-off it
   * promises in its error message.
   */
  async applyCancelFromApprovals(
    client: PoolClient,
    ctx: ApprovalCancelFinaliserContext,
  ): Promise<void> {
    const { request } = ctx;
    const cur = await salesInvoicesRepo.getById(client, request.entityId);
    if (!cur) {
      throw new NotFoundError("sales invoice");
    }
    if (cur.status !== "AWAITING_APPROVAL") {
      // Invoice already advanced past AWAITING_APPROVAL (concurrent
      // post or independent state change). Approvals.cancelRequest's
      // PENDING-status guard should have rejected the cancel before we
      // got here; if execution reached this branch we no-op rather
      // than corrupt the invoice.
      return;
    }
    const reverted = await salesInvoicesRepo.revertToDraft(
      client,
      request.entityId,
    );
    if (!reverted) {
      throw new ConflictError(
        "invoice is no longer AWAITING_APPROVAL and cannot be reverted",
      );
    }
  }

  /**
   * Cancel an invoice. DRAFT → just flip status. POSTED → flip status AND
   * append a reversing CREDIT row to customer_ledger so AR stays consistent.
   * CANCELLED is terminal (409).
   */
  async cancel(
    req: FastifyRequest,
    id: string,
    input: CancelSalesInvoice,
  ): Promise<SalesInvoice> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await salesInvoicesRepo.getById(client, id);
      if (!cur) throw new NotFoundError("sales invoice");
      if (cur.status === "CANCELLED") {
        throw new ConflictError("sales invoice is already cancelled");
      }
      if (cur.status === "AWAITING_APPROVAL") {
        // Cancelling while a request is pending would orphan the
        // approval_request. Force the user through approvals.cancelRequest
        // first; that revertToDraft path leaves the invoice editable +
        // cancellable.
        throw new ConflictError(
          "cannot cancel an invoice that is awaiting approval — cancel the approval request first",
        );
      }
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("sales invoice was modified by someone else");
      }

      const wasPosted = cur.status === "POSTED";
      const cancelled = await salesInvoicesRepo.markCancelled(
        client,
        id,
        user.id,
      );
      if (!cancelled) throw new NotFoundError("sales invoice");

      // Reverse the AR impact on posted invoices.
      if (wasPosted && cancelled.customerId) {
        const outstanding = m(cancelled.grandTotal).minus(
          m(cancelled.amountPaid),
        );
        // Only reverse the *unpaid* portion; paid amounts are a separate
        // refund process (out of Phase 2 scope).
        if (outstanding.gt(ZERO)) {
          await customerLedgerRepo.append(client, user.orgId, user.id, {
            customerId: cancelled.customerId,
            entryDate: new Date().toISOString().slice(0, 10),
            entryType: "ADJUSTMENT",
            debit: "0",
            credit: moneyToPg(outstanding),
            currency: cancelled.currency,
            referenceType: "SALES_INVOICE",
            referenceId: cancelled.id,
            referenceNumber: cancelled.invoiceNumber,
            description:
              input.reason ??
              `Cancelled invoice ${cancelled.invoiceNumber}`,
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
  ): Promise<SalesInvoiceLine[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await salesInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("sales invoice");
      return salesInvoicesRepo.listLines(client, invoiceId);
    });
  }

  async addLine(
    req: FastifyRequest,
    invoiceId: string,
    input: CreateSalesInvoiceLine,
  ): Promise<SalesInvoiceLine> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await salesInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("sales invoice");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot add lines to ${header.status} invoice; must be DRAFT`,
        );
      }
      const computed = computeLineTotals(input);
      const line = await salesInvoicesRepo.addLine(
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
      await salesInvoicesRepo.touchHeader(client, invoiceId);
      return line;
    });
  }

  async updateLine(
    req: FastifyRequest,
    invoiceId: string,
    lineId: string,
    input: UpdateSalesInvoiceLine,
  ): Promise<SalesInvoiceLine> {
    return withRequest(req, this.pool, async (client) => {
      const header = await salesInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("sales invoice");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot update lines on ${header.status} invoice; must be DRAFT`,
        );
      }
      const existing = await salesInvoicesRepo.getLineById(client, lineId);
      if (!existing || existing.invoiceId !== invoiceId) {
        throw new NotFoundError("sales invoice line");
      }
      // Only recompute if any of the money-driving fields changed.
      const needsRecompute =
        input.quantity !== undefined ||
        input.unitPrice !== undefined ||
        input.discountPercent !== undefined ||
        input.taxRatePercent !== undefined;
      const computed = needsRecompute
        ? computeLineTotals(mergeLinePatch(existing, input))
        : null;
      const updated = await salesInvoicesRepo.updateLine(
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
      if (!updated) throw new NotFoundError("sales invoice line");
      if (needsRecompute) {
        await recomputeAndPersistHeaderTotals(client, invoiceId);
      }
      await salesInvoicesRepo.touchHeader(client, invoiceId);
      return updated;
    });
  }

  async deleteLine(
    req: FastifyRequest,
    invoiceId: string,
    lineId: string,
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const header = await salesInvoicesRepo.getById(client, invoiceId);
      if (!header) throw new NotFoundError("sales invoice");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot delete lines on ${header.status} invoice; must be DRAFT`,
        );
      }
      const existing = await salesInvoicesRepo.getLineById(client, lineId);
      if (!existing || existing.invoiceId !== invoiceId) {
        throw new NotFoundError("sales invoice line");
      }
      const ok = await salesInvoicesRepo.deleteLine(client, lineId);
      if (!ok) throw new NotFoundError("sales invoice line");
      await recomputeAndPersistHeaderTotals(client, invoiceId);
      await salesInvoicesRepo.touchHeader(client, invoiceId);
    });
  }
}
