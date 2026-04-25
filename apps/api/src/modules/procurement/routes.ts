/**
 * Procurement routes. Mounted at /procurement/*.
 *
 * Scope: vendors, indents (+lines), purchase_orders (+lines), grns (+lines).
 *
 * Permission strategy (reuses the existing catalog):
 *   - GET /procurement/**                 → purchase_orders:read
 *   - POST/PATCH/DELETE on masters/POs    → purchase_orders:update
 *     (or :create for POSTing a new header)
 *   - POST /procurement/grns/:id/post     → inventory:receive
 *     (posting writes to stock_ledger)
 *
 * The module gate is `module.procurement` (tenant plan flag).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CreateGrnLineSchema,
  CreateGrnSchema,
  CreateIndentLineSchema,
  CreateIndentSchema,
  CreatePoLineSchema,
  CreatePurchaseOrderSchema,
  CreateVendorSchema,
  GrnListQuerySchema,
  IndentListQuerySchema,
  PostGrnSchema,
  ProcurementReportsQuerySchema,
  PurchaseOrderListQuerySchema,
  UpdateGrnLineSchema,
  UpdateGrnSchema,
  UpdateIndentLineSchema,
  UpdateIndentSchema,
  UpdatePoLineSchema,
  UpdatePurchaseOrderSchema,
  UpdateVendorSchema,
  VendorListQuerySchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { RequireFeature } from "../quotas/guard.js";
import type { VendorsService } from "./vendors.service.js";
import type { IndentsService } from "./indents.service.js";
import type { PurchaseOrdersService } from "./purchase-orders.service.js";
import type { GrnsService } from "./grns.service.js";
import type { ProcurementReportsService } from "./reports.service.js";

export interface RegisterProcurementRoutesOptions {
  vendors: VendorsService;
  indents: IndentsService;
  purchaseOrders: PurchaseOrdersService;
  grns: GrnsService;
  reports: ProcurementReportsService;
  guardInternal: AuthGuardOptions;
  requireFeature: RequireFeature;
}

const IdParamSchema = z.object({ id: z.string().uuid() });
const HeaderLineParamSchema = z.object({
  id: z.string().uuid(),
  lineId: z.string().uuid(),
});

export async function registerProcurementRoutes(
  app: FastifyInstance,
  opts: RegisterProcurementRoutesOptions
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  const requireModule = opts.requireFeature("module.procurement");

  const read = [authGuard, requireModule, requirePermission("purchase_orders:read")];
  const write = [authGuard, requireModule, requirePermission("purchase_orders:update")];
  const create = [authGuard, requireModule, requirePermission("purchase_orders:create")];
  const receive = [authGuard, requireModule, requirePermission("inventory:receive")];

  // ─── Vendors ──────────────────────────────────────────────────────────────

  app.get(
    "/procurement/vendors",
    { preHandler: read },
    async (req, reply) => {
      const query = VendorListQuerySchema.parse(req.query);
      return reply.send(await opts.vendors.list(req, query));
    }
  );

  app.get(
    "/procurement/vendors/:id",
    { preHandler: read },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.vendors.getById(req, id));
    }
  );

  app.post(
    "/procurement/vendors",
    { preHandler: create },
    async (req, reply) => {
      const body = CreateVendorSchema.parse(req.body);
      return reply.code(201).send(await opts.vendors.create(req, body));
    }
  );

  app.patch(
    "/procurement/vendors/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateVendorSchema.parse(req.body);
      return reply.send(await opts.vendors.update(req, id, body));
    }
  );

  app.delete(
    "/procurement/vendors/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.vendors.remove(req, id);
      return reply.code(204).send();
    }
  );

  // ─── Indents ──────────────────────────────────────────────────────────────

  app.get(
    "/procurement/indents",
    { preHandler: read },
    async (req, reply) => {
      const query = IndentListQuerySchema.parse(req.query);
      return reply.send(await opts.indents.list(req, query));
    }
  );

  app.get(
    "/procurement/indents/:id",
    { preHandler: read },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.indents.getById(req, id));
    }
  );

  app.post(
    "/procurement/indents",
    { preHandler: create },
    async (req, reply) => {
      const body = CreateIndentSchema.parse(req.body);
      return reply.code(201).send(await opts.indents.create(req, body));
    }
  );

  app.patch(
    "/procurement/indents/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateIndentSchema.parse(req.body);
      return reply.send(await opts.indents.update(req, id, body));
    }
  );

  app.delete(
    "/procurement/indents/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.indents.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.get(
    "/procurement/indents/:id/lines",
    { preHandler: read },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send({ data: await opts.indents.listLines(req, id) });
    }
  );

  app.post(
    "/procurement/indents/:id/lines",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = CreateIndentLineSchema.parse(req.body);
      return reply.code(201).send(await opts.indents.addLine(req, id, body));
    }
  );

  app.patch(
    "/procurement/indents/:id/lines/:lineId",
    { preHandler: write },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      const body = UpdateIndentLineSchema.parse(req.body);
      return reply.send(await opts.indents.updateLine(req, id, lineId, body));
    }
  );

  app.delete(
    "/procurement/indents/:id/lines/:lineId",
    { preHandler: write },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      await opts.indents.deleteLine(req, id, lineId);
      return reply.code(204).send();
    }
  );

  // ─── Purchase Orders ──────────────────────────────────────────────────────

  app.get(
    "/procurement/purchase-orders",
    { preHandler: read },
    async (req, reply) => {
      const query = PurchaseOrderListQuerySchema.parse(req.query);
      return reply.send(await opts.purchaseOrders.list(req, query));
    }
  );

  app.get(
    "/procurement/purchase-orders/:id",
    { preHandler: read },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.purchaseOrders.getById(req, id));
    }
  );

  app.post(
    "/procurement/purchase-orders",
    { preHandler: create },
    async (req, reply) => {
      const body = CreatePurchaseOrderSchema.parse(req.body);
      return reply.code(201).send(await opts.purchaseOrders.create(req, body));
    }
  );

  app.patch(
    "/procurement/purchase-orders/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdatePurchaseOrderSchema.parse(req.body);
      return reply.send(await opts.purchaseOrders.update(req, id, body));
    }
  );

  app.delete(
    "/procurement/purchase-orders/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.purchaseOrders.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.get(
    "/procurement/purchase-orders/:id/lines",
    { preHandler: read },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send({ data: await opts.purchaseOrders.listLines(req, id) });
    }
  );

  app.post(
    "/procurement/purchase-orders/:id/lines",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = CreatePoLineSchema.parse(req.body);
      return reply
        .code(201)
        .send(await opts.purchaseOrders.addLine(req, id, body));
    }
  );

  app.patch(
    "/procurement/purchase-orders/:id/lines/:lineId",
    { preHandler: write },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      const body = UpdatePoLineSchema.parse(req.body);
      return reply.send(
        await opts.purchaseOrders.updateLine(req, id, lineId, body)
      );
    }
  );

  app.delete(
    "/procurement/purchase-orders/:id/lines/:lineId",
    { preHandler: write },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      await opts.purchaseOrders.deleteLine(req, id, lineId);
      return reply.code(204).send();
    }
  );

  // ─── GRNs ─────────────────────────────────────────────────────────────────

  app.get("/procurement/grns", { preHandler: read }, async (req, reply) => {
    const query = GrnListQuerySchema.parse(req.query);
    return reply.send(await opts.grns.list(req, query));
  });

  app.get(
    "/procurement/grns/:id",
    { preHandler: read },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.grns.getById(req, id));
    }
  );

  app.post(
    "/procurement/grns",
    { preHandler: create },
    async (req, reply) => {
      const body = CreateGrnSchema.parse(req.body);
      return reply.code(201).send(await opts.grns.create(req, body));
    }
  );

  app.patch(
    "/procurement/grns/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateGrnSchema.parse(req.body);
      return reply.send(await opts.grns.update(req, id, body));
    }
  );

  app.delete(
    "/procurement/grns/:id",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.grns.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.get(
    "/procurement/grns/:id/lines",
    { preHandler: read },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send({ data: await opts.grns.listLines(req, id) });
    }
  );

  app.post(
    "/procurement/grns/:id/lines",
    { preHandler: write },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = CreateGrnLineSchema.parse(req.body);
      return reply.code(201).send(await opts.grns.addLine(req, id, body));
    }
  );

  app.patch(
    "/procurement/grns/:id/lines/:lineId",
    { preHandler: write },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      const body = UpdateGrnLineSchema.parse(req.body);
      return reply.send(await opts.grns.updateLine(req, id, lineId, body));
    }
  );

  app.delete(
    "/procurement/grns/:id/lines/:lineId",
    { preHandler: write },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      await opts.grns.deleteLine(req, id, lineId);
      return reply.code(204).send();
    }
  );

  // Post a draft GRN — writes stock_ledger + bumps PO received_qty.
  app.post(
    "/procurement/grns/:id/post",
    { preHandler: receive },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = PostGrnSchema.parse(req.body);
      return reply.send(await opts.grns.post(req, id, body));
    }
  );

  // ─── Procurement reports ──────────────────────────────────────────────────
  // Date-window PO throughput / GRN delivery / vendor spend roll-up. `from`/
  // `to` optional — service defaults to last 90 days when absent.

  app.get(
    "/procurement/reports",
    { preHandler: read },
    async (req, reply) => {
      const query = ProcurementReportsQuerySchema.parse(req.query);
      return reply.send(await opts.reports.summary(req, query));
    }
  );
}
