/**
 * Purchase orders service. Orchestrates header + line CRUD, auto-
 * generates PO-YYYY-NNNN numbers, and recomputes header totals on any
 * line mutation so header.grand_total stays in lockstep.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreatePoLine,
  CreatePurchaseOrder,
  PoLine,
  PurchaseOrder,
  PurchaseOrderListQuerySchema,
  PurchaseOrderWithLines,
  UpdatePoLine,
  UpdatePurchaseOrder,
} from "@instigenie/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { enqueueOutbox } from "@instigenie/db";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { purchaseOrdersRepo } from "./purchase-orders.repository.js";
import { nextProcurementNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";

type PoListQuery = z.infer<typeof PurchaseOrderListQuerySchema>;

const PO_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  poNumber: "po_number",
  orderDate: "order_date",
  expectedDate: "expected_date",
  status: "status",
  grandTotal: "grand_total",
};

export class PurchaseOrdersService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: PoListQuery
  ): Promise<ReturnType<typeof paginated<PurchaseOrder>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, PO_SORTS, "createdAt");
      const { data, total } = await purchaseOrdersRepo.list(
        client,
        {
          status: query.status,
          vendorId: query.vendorId,
          indentId: query.indentId,
          deliveryWarehouseId: query.deliveryWarehouseId,
          from: query.from,
          to: query.to,
          minTotal: query.minTotal,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(
    req: FastifyRequest,
    id: string
  ): Promise<PurchaseOrderWithLines> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, id);
      if (!header) throw new NotFoundError("purchase order");
      const lines = await purchaseOrdersRepo.listLines(client, id);
      return { ...header, lines };
    });
  }

  async create(
    req: FastifyRequest,
    input: CreatePurchaseOrder
  ): Promise<PurchaseOrderWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const poNumber =
        input.poNumber ?? (await nextProcurementNumber(client, user.orgId, "PO"));
      const header = await purchaseOrdersRepo.createHeader(
        client,
        user.orgId,
        poNumber,
        user.id,
        {
          indentId: input.indentId,
          vendorId: input.vendorId,
          currency: input.currency,
          orderDate: input.orderDate,
          expectedDate: input.expectedDate,
          deliveryWarehouseId: input.deliveryWarehouseId,
          billingAddress: input.billingAddress,
          shippingAddress: input.shippingAddress,
          paymentTermsDays: input.paymentTermsDays,
          notes: input.notes,
        }
      );
      const lines: PoLine[] = [];
      let lineNo = 1;
      for (const line of input.lines ?? []) {
        const created = await purchaseOrdersRepo.addLine(
          client,
          user.orgId,
          header.id,
          { ...line, lineNo: line.lineNo ?? lineNo++ }
        );
        lines.push(created);
      }
      if ((input.lines ?? []).length > 0) {
        await purchaseOrdersRepo.recomputeHeaderTotals(client, header.id);
      }
      const fresh = await purchaseOrdersRepo.getById(client, header.id);
      const finalHeader = fresh ?? header;

      // Track 1 emit #7 (automate.md). No separate issue step exists today —
      // PO create *is* the issuance. If a DRAFT/ISSUED split lands later,
      // move this emit to that transition. The payload carries grand_total so
      // Track 2 F2 (vendor advance posting) can compute advance % without a
      // second read. Line snapshot is optional — handlers that need full line
      // detail should join po_lines on poId.
      await enqueueOutbox(client, {
        aggregateType: "purchase_order",
        aggregateId: finalHeader.id,
        eventType: "po.issued",
        payload: {
          orgId: user.orgId,
          poId: finalHeader.id,
          poNumber: finalHeader.poNumber,
          vendorId: finalHeader.vendorId,
          totalValue: finalHeader.grandTotal,
          currency: finalHeader.currency,
          lines: lines.map((ln) => ({
            itemId: ln.itemId,
            quantity: ln.quantity,
            uom: ln.uom,
            unitPrice: ln.unitPrice,
          })),
          actorId: user.id,
        },
        idempotencyKey: `po.issued:${finalHeader.id}`,
      });

      return { ...finalHeader, lines };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdatePurchaseOrder
  ): Promise<PurchaseOrder> {
    return withRequest(req, this.pool, async (client) => {
      const result = await purchaseOrdersRepo.updateWithVersion(
        client,
        id,
        input
      );
      if (result === null) throw new NotFoundError("purchase order");
      if (result === "version_conflict") {
        throw new ConflictError("purchase order was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await purchaseOrdersRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("purchase order");
    });
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(req: FastifyRequest, poId: string): Promise<PoLine[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, poId);
      if (!header) throw new NotFoundError("purchase order");
      return purchaseOrdersRepo.listLines(client, poId);
    });
  }

  async addLine(
    req: FastifyRequest,
    poId: string,
    input: CreatePoLine
  ): Promise<PoLine> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await purchaseOrdersRepo.getById(client, poId);
      if (!header) throw new NotFoundError("purchase order");
      const line = await purchaseOrdersRepo.addLine(
        client,
        user.orgId,
        poId,
        input
      );
      await purchaseOrdersRepo.recomputeHeaderTotals(client, poId);
      await purchaseOrdersRepo.touchHeader(client, poId);
      return line;
    });
  }

  async updateLine(
    req: FastifyRequest,
    poId: string,
    lineId: string,
    input: UpdatePoLine
  ): Promise<PoLine> {
    return withRequest(req, this.pool, async (client) => {
      const line = await purchaseOrdersRepo.getLineById(client, lineId);
      if (!line || line.poId !== poId) {
        throw new NotFoundError("po line");
      }
      const updated = await purchaseOrdersRepo.updateLine(
        client,
        lineId,
        input
      );
      if (!updated) throw new NotFoundError("po line");
      await purchaseOrdersRepo.recomputeHeaderTotals(client, poId);
      await purchaseOrdersRepo.touchHeader(client, poId);
      return updated;
    });
  }

  async deleteLine(
    req: FastifyRequest,
    poId: string,
    lineId: string
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const line = await purchaseOrdersRepo.getLineById(client, lineId);
      if (!line || line.poId !== poId) {
        throw new NotFoundError("po line");
      }
      const ok = await purchaseOrdersRepo.deleteLine(client, lineId);
      if (!ok) throw new NotFoundError("po line");
      await purchaseOrdersRepo.recomputeHeaderTotals(client, poId);
      await purchaseOrdersRepo.touchHeader(client, poId);
    });
  }
}
