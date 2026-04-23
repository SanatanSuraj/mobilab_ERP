/**
 * GRNs service. Orchestrates:
 *   - Draft CRUD for header + lines.
 *   - POSTING a draft GRN — the atomic write that commits inventory:
 *       1. Validate each grn_line references the same po as the header.
 *       2. Validate accepted qty (quantity - qcRejectedQty) > 0 per line.
 *       3. Insert stock_ledger rows (txn_type = 'GRN_RECEIPT') — the
 *          stock_summary trigger updates on-hand automatically.
 *       4. Bump po_lines.received_qty for each touched po_line.
 *       5. Recompute PO header status:
 *            sum(received_qty) == sum(quantity)  → 'RECEIVED'
 *            sum(received_qty) >  0 (&& < full)   → 'PARTIALLY_RECEIVED'
 *       6. Mark GRN header status = POSTED + stamp posted_by/posted_at.
 *     Everything runs inside the single `withRequest` client, so a
 *     failed write rolls the whole thing back.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateGrn,
  CreateGrnLine,
  Grn,
  GrnLine,
  GrnListQuerySchema,
  GrnWithLines,
  PostGrn,
  UpdateGrn,
  UpdateGrnLine,
} from "@instigenie/contracts";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { enqueueOutbox } from "@instigenie/db";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { grnsRepo } from "./grns.repository.js";
import { purchaseOrdersRepo } from "./purchase-orders.repository.js";
import { nextProcurementNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";
import { stockRepo } from "../inventory/stock.repository.js";
import type { PoolClient } from "pg";

type GrnListQuery = z.infer<typeof GrnListQuerySchema>;

const GRN_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  grnNumber: "grn_number",
  receivedDate: "received_date",
  status: "status",
};

function qty(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export class GrnsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: GrnListQuery
  ): Promise<ReturnType<typeof paginated<Grn>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, GRN_SORTS, "createdAt");
      const { data, total } = await grnsRepo.list(
        client,
        {
          status: query.status,
          poId: query.poId,
          vendorId: query.vendorId,
          warehouseId: query.warehouseId,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<GrnWithLines> {
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, id);
      if (!header) throw new NotFoundError("grn");
      const lines = await grnsRepo.listLines(client, id);
      return { ...header, lines };
    });
  }

  async create(req: FastifyRequest, input: CreateGrn): Promise<GrnWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // Cross-check the PO exists and is in a status that can receive.
      const po = await purchaseOrdersRepo.getById(client, input.poId);
      if (!po) throw new NotFoundError("purchase order");
      if (po.vendorId !== input.vendorId) {
        throw new ValidationError(
          `vendor ${input.vendorId} does not match PO vendor ${po.vendorId}`
        );
      }
      if (!["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(po.status)) {
        throw new StateTransitionError(
          `cannot receive against PO in status ${po.status}`
        );
      }

      const grnNumber =
        input.grnNumber ?? (await nextProcurementNumber(client, user.orgId, "GRN"));
      const header = await grnsRepo.createHeader(
        client,
        user.orgId,
        grnNumber,
        user.id,
        {
          poId: input.poId,
          vendorId: input.vendorId,
          warehouseId: input.warehouseId,
          receivedDate: input.receivedDate,
          vehicleNumber: input.vehicleNumber,
          invoiceNumber: input.invoiceNumber,
          invoiceDate: input.invoiceDate,
          receivedBy: input.receivedBy,
          notes: input.notes,
        }
      );

      const lines: GrnLine[] = [];
      let lineNo = 1;
      for (const line of input.lines ?? []) {
        // Validate the po_line belongs to the same PO.
        const poLine = await purchaseOrdersRepo.getLineById(
          client,
          line.poLineId
        );
        if (!poLine || poLine.poId !== input.poId) {
          throw new ValidationError(
            `po_line_id ${line.poLineId} does not belong to PO ${input.poId}`
          );
        }
        const created = await grnsRepo.addLine(client, user.orgId, header.id, {
          ...line,
          lineNo: line.lineNo ?? lineNo++,
        });
        lines.push(created);
      }
      return { ...header, lines };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateGrn
  ): Promise<Grn> {
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, id);
      if (!header) throw new NotFoundError("grn");
      if (header.status === "POSTED") {
        throw new StateTransitionError("cannot edit a posted GRN");
      }
      const result = await grnsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("grn");
      if (result === "version_conflict") {
        throw new ConflictError("grn was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, id);
      if (!header) throw new NotFoundError("grn");
      if (header.status === "POSTED") {
        throw new StateTransitionError(
          "cannot delete a posted GRN (reverse via a reversal entry instead)"
        );
      }
      const ok = await grnsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("grn");
    });
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(req: FastifyRequest, grnId: string): Promise<GrnLine[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, grnId);
      if (!header) throw new NotFoundError("grn");
      return grnsRepo.listLines(client, grnId);
    });
  }

  async addLine(
    req: FastifyRequest,
    grnId: string,
    input: CreateGrnLine
  ): Promise<GrnLine> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, grnId);
      if (!header) throw new NotFoundError("grn");
      if (header.status === "POSTED") {
        throw new StateTransitionError("cannot add lines to a posted GRN");
      }
      const poLine = await purchaseOrdersRepo.getLineById(client, input.poLineId);
      if (!poLine || poLine.poId !== header.poId) {
        throw new ValidationError(
          `po_line_id ${input.poLineId} does not belong to PO ${header.poId}`
        );
      }
      const line = await grnsRepo.addLine(client, user.orgId, grnId, input);
      await grnsRepo.touchHeader(client, grnId);
      return line;
    });
  }

  async updateLine(
    req: FastifyRequest,
    grnId: string,
    lineId: string,
    input: UpdateGrnLine
  ): Promise<GrnLine> {
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, grnId);
      if (!header) throw new NotFoundError("grn");
      if (header.status === "POSTED") {
        throw new StateTransitionError("cannot edit lines on a posted GRN");
      }
      const line = await grnsRepo.getLineById(client, lineId);
      if (!line || line.grnId !== grnId) {
        throw new NotFoundError("grn line");
      }
      const updated = await grnsRepo.updateLine(client, lineId, input);
      if (!updated) throw new NotFoundError("grn line");
      await grnsRepo.touchHeader(client, grnId);
      return updated;
    });
  }

  async deleteLine(
    req: FastifyRequest,
    grnId: string,
    lineId: string
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, grnId);
      if (!header) throw new NotFoundError("grn");
      if (header.status === "POSTED") {
        throw new StateTransitionError(
          "cannot delete lines from a posted GRN"
        );
      }
      const line = await grnsRepo.getLineById(client, lineId);
      if (!line || line.grnId !== grnId) {
        throw new NotFoundError("grn line");
      }
      const ok = await grnsRepo.deleteLine(client, lineId);
      if (!ok) throw new NotFoundError("grn line");
      await grnsRepo.touchHeader(client, grnId);
    });
  }

  // ── Posting ────────────────────────────────────────────────────────────────

  /**
   * Posts a DRAFT GRN atomically. See file header for the full flow.
   */
  async post(
    req: FastifyRequest,
    grnId: string,
    input: PostGrn
  ): Promise<GrnWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await grnsRepo.getById(client, grnId);
      if (!header) throw new NotFoundError("grn");
      if (header.status !== "DRAFT") {
        throw new StateTransitionError(
          `cannot post GRN in status ${header.status}`
        );
      }
      if (header.version !== input.expectedVersion) {
        throw new ConflictError("grn was modified by someone else");
      }

      const lines = await grnsRepo.listLines(client, grnId);
      if (lines.length === 0) {
        throw new ValidationError("GRN has no lines to post");
      }

      const po = await purchaseOrdersRepo.getById(client, header.poId);
      if (!po) throw new NotFoundError("purchase order");

      // 1. Per-line validation + ledger insert + po_line bump.
      for (const line of lines) {
        const accepted = qty(line.quantity) - qty(line.qcRejectedQty);
        if (accepted <= 0) {
          throw new ValidationError(
            `line ${line.lineNo}: accepted quantity must be positive`
          );
        }
        await stockRepo.postLedgerEntry(client, user.orgId, user.id, {
          itemId: line.itemId,
          warehouseId: header.warehouseId,
          quantity: accepted.toFixed(3),
          uom: line.uom as never, // DB CHECK enforces, service validated UoM at line-add
          txnType: "GRN_RECEIPT",
          refDocType: "GRN",
          refDocId: grnId,
          refLineId: line.id,
          batchNo: line.batchNo ?? undefined,
          serialNo: line.serialNo ?? undefined,
          reason: undefined,
          unitCost: line.unitCost,
        });
        await purchaseOrdersRepo.incrementReceivedQty(
          client,
          line.poLineId,
          accepted.toFixed(3)
        );
      }

      // 2. Recompute PO status from po_lines totals.
      await recomputePoReceivedStatus(client, po.id);

      // 3. Mark GRN as posted.
      const posted = await grnsRepo.markPosted(client, grnId, user.id);
      if (!posted) {
        throw new ConflictError("GRN state changed during posting");
      }

      const freshLines = await grnsRepo.listLines(client, grnId);

      // Track 1 emit #8 (automate.md): grn.posted — signals downstream that
      // material has physically arrived and stock_ledger has the IN rows.
      // Consumers (Phase 2): qc_inward scheduler, Track 2 F3 GRN accounting
      // (stock_ledger already written here; F3 adds the vendor_ledger side).
      // idempotencyKey has no `v` suffix because markPosted is a one-way
      // DRAFT → POSTED transition — re-running it is blocked by the status
      // guard above, so one event per grnId is sufficient.
      await enqueueOutbox(client, {
        aggregateType: "grn",
        aggregateId: grnId,
        eventType: "grn.posted",
        payload: {
          orgId: user.orgId,
          grnId,
          grnNumber: posted.grnNumber,
          poId: posted.poId ?? null,
          vendorId: po.vendorId ?? null,
          lines: freshLines.map((ln) => ({
            itemId: ln.itemId,
            quantity: ln.quantity,
            uom: ln.uom,
            warehouseId: posted.warehouseId,
          })),
          actorId: user.id,
        },
        idempotencyKey: `grn.posted:${grnId}`,
      });

      return { ...posted, lines: freshLines };
    });
  }
}

/**
 * Sum received_qty vs quantity across all po_lines, set the PO status:
 *   all received  → RECEIVED
 *   partial       → PARTIALLY_RECEIVED
 *   none yet      → leaves status alone (SENT / APPROVED / etc.)
 */
async function recomputePoReceivedStatus(
  client: PoolClient,
  poId: string
): Promise<void> {
  const { rows } = await client.query<{ total_qty: string; total_recv: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS total_qty,
            COALESCE(SUM(received_qty), 0)::text AS total_recv
       FROM po_lines
      WHERE po_id = $1`,
    [poId]
  );
  const tq = qty(rows[0]!.total_qty);
  const tr = qty(rows[0]!.total_recv);
  if (tq <= 0) return;
  // NUMERIC round-trip: treat within 0.001 as equal.
  if (tr + 0.001 >= tq) {
    await purchaseOrdersRepo.setStatus(client, poId, "RECEIVED");
  } else if (tr > 0) {
    await purchaseOrdersRepo.setStatus(client, poId, "PARTIALLY_RECEIVED");
  }
}
