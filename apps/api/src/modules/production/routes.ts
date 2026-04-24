/**
 * Production routes. Mounted at /production/*.
 *
 * Scope: products, bom_versions (+lines), work_orders (+wip_stages),
 *        wip_stage_templates (read-only).
 *
 * Permission strategy:
 *   - GET /production/products/**      → products:read
 *   - POST/PATCH/DELETE /products/**   → products:create / products:update / products:delete
 *   - GET /production/boms/**          → bom:read
 *   - POST/PATCH/DELETE /boms/**       → bom:edit
 *   - POST /production/boms/:id/activate → bom:activate
 *   - GET /production/work-orders/**   → work_orders:read
 *   - POST/PATCH/DELETE /work-orders/**→ work_orders:create / work_orders:update
 *   - POST /production/work-orders/:id/stages/:stageId/advance → wip_stages:advance
 *   - GET /production/wip-stage-templates → work_orders:read
 *
 * The module gate is `module.manufacturing` (tenant plan flag).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ActivateBomSchema,
  AdvanceWipStageSchema,
  BomListQuerySchema,
  CreateBomLineSchema,
  CreateBomVersionSchema,
  CreateProductSchema,
  CreateWorkOrderSchema,
  DeviceInstanceListQuerySchema,
  ProductFamilySchema,
  ProductListQuerySchema,
  UpdateBomLineSchema,
  UpdateBomVersionSchema,
  UpdateProductSchema,
  UpdateWorkOrderSchema,
  WorkOrderListQuerySchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { RequireFeature } from "../quotas/guard.js";
import type { ProductsService } from "./products.service.js";
import type { BomsService } from "./boms.service.js";
import type { WorkOrdersService } from "./work-orders.service.js";
import type { DeviceInstancesService } from "./device-instances.service.js";

export interface RegisterProductionRoutesOptions {
  products: ProductsService;
  boms: BomsService;
  workOrders: WorkOrdersService;
  deviceInstances: DeviceInstancesService;
  guardInternal: AuthGuardOptions;
  requireFeature: RequireFeature;
}

const IdParamSchema = z.object({ id: z.string().uuid() });
const HeaderLineParamSchema = z.object({
  id: z.string().uuid(),
  lineId: z.string().uuid(),
});
const HeaderStageParamSchema = z.object({
  id: z.string().uuid(),
  stageId: z.string().uuid(),
});

export async function registerProductionRoutes(
  app: FastifyInstance,
  opts: RegisterProductionRoutesOptions
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  const requireModule = opts.requireFeature("module.manufacturing");

  // Products
  const productsRead = [
    authGuard,
    requireModule,
    requirePermission("products:read"),
  ];
  const productsCreate = [
    authGuard,
    requireModule,
    requirePermission("products:create"),
  ];
  const productsUpdate = [
    authGuard,
    requireModule,
    requirePermission("products:update"),
  ];
  const productsDelete = [
    authGuard,
    requireModule,
    requirePermission("products:delete"),
  ];

  // BOMs
  const bomRead = [authGuard, requireModule, requirePermission("bom:read")];
  const bomEdit = [authGuard, requireModule, requirePermission("bom:edit")];
  const bomActivate = [
    authGuard,
    requireModule,
    requirePermission("bom:activate"),
  ];
  const bomSupersede = [
    authGuard,
    requireModule,
    requirePermission("bom:supersede"),
  ];

  // Work orders
  const woRead = [
    authGuard,
    requireModule,
    requirePermission("work_orders:read"),
  ];
  const woCreate = [
    authGuard,
    requireModule,
    requirePermission("work_orders:create"),
  ];
  const woUpdate = [
    authGuard,
    requireModule,
    requirePermission("work_orders:update"),
  ];
  const wipAdvance = [
    authGuard,
    requireModule,
    requirePermission("wip_stages:advance"),
  ];

  // ─── Products ─────────────────────────────────────────────────────────────

  app.get(
    "/production/products",
    { preHandler: productsRead },
    async (req, reply) => {
      const query = ProductListQuerySchema.parse(req.query);
      return reply.send(await opts.products.list(req, query));
    }
  );

  app.get(
    "/production/products/:id",
    { preHandler: productsRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.products.getById(req, id));
    }
  );

  app.post(
    "/production/products",
    { preHandler: productsCreate },
    async (req, reply) => {
      const body = CreateProductSchema.parse(req.body);
      return reply.code(201).send(await opts.products.create(req, body));
    }
  );

  app.patch(
    "/production/products/:id",
    { preHandler: productsUpdate },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateProductSchema.parse(req.body);
      return reply.send(await opts.products.update(req, id, body));
    }
  );

  app.delete(
    "/production/products/:id",
    { preHandler: productsDelete },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.products.remove(req, id);
      return reply.code(204).send();
    }
  );

  // ─── BOMs ─────────────────────────────────────────────────────────────────

  app.get(
    "/production/boms",
    { preHandler: bomRead },
    async (req, reply) => {
      const query = BomListQuerySchema.parse(req.query);
      return reply.send(await opts.boms.list(req, query));
    }
  );

  app.get(
    "/production/boms/:id",
    { preHandler: bomRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.boms.getById(req, id));
    }
  );

  app.post(
    "/production/boms",
    { preHandler: bomEdit },
    async (req, reply) => {
      const body = CreateBomVersionSchema.parse(req.body);
      return reply.code(201).send(await opts.boms.create(req, body));
    }
  );

  app.patch(
    "/production/boms/:id",
    { preHandler: bomEdit },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateBomVersionSchema.parse(req.body);
      return reply.send(await opts.boms.update(req, id, body));
    }
  );

  app.delete(
    "/production/boms/:id",
    { preHandler: bomSupersede },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.boms.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.post(
    "/production/boms/:id/activate",
    { preHandler: bomActivate },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = ActivateBomSchema.parse(req.body);
      return reply.send(await opts.boms.activate(req, id, body));
    }
  );

  app.get(
    "/production/boms/:id/lines",
    { preHandler: bomRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send({ data: await opts.boms.listLines(req, id) });
    }
  );

  app.post(
    "/production/boms/:id/lines",
    { preHandler: bomEdit },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = CreateBomLineSchema.parse(req.body);
      return reply.code(201).send(await opts.boms.addLine(req, id, body));
    }
  );

  app.patch(
    "/production/boms/:id/lines/:lineId",
    { preHandler: bomEdit },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      const body = UpdateBomLineSchema.parse(req.body);
      return reply.send(await opts.boms.updateLine(req, id, lineId, body));
    }
  );

  app.delete(
    "/production/boms/:id/lines/:lineId",
    { preHandler: bomEdit },
    async (req, reply) => {
      const { id, lineId } = HeaderLineParamSchema.parse(req.params);
      await opts.boms.deleteLine(req, id, lineId);
      return reply.code(204).send();
    }
  );

  // ─── Work Orders ──────────────────────────────────────────────────────────

  app.get(
    "/production/work-orders",
    { preHandler: woRead },
    async (req, reply) => {
      const query = WorkOrderListQuerySchema.parse(req.query);
      return reply.send(await opts.workOrders.list(req, query));
    }
  );

  app.get(
    "/production/work-orders/:id",
    { preHandler: woRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.workOrders.getById(req, id));
    }
  );

  app.post(
    "/production/work-orders",
    { preHandler: woCreate },
    async (req, reply) => {
      const body = CreateWorkOrderSchema.parse(req.body);
      return reply.code(201).send(await opts.workOrders.create(req, body));
    }
  );

  app.patch(
    "/production/work-orders/:id",
    { preHandler: woUpdate },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateWorkOrderSchema.parse(req.body);
      return reply.send(await opts.workOrders.update(req, id, body));
    }
  );

  app.delete(
    "/production/work-orders/:id",
    { preHandler: woUpdate },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.workOrders.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.get(
    "/production/work-orders/:id/stages",
    { preHandler: woRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send({ data: await opts.workOrders.listStages(req, id) });
    }
  );

  app.post(
    "/production/work-orders/:id/stages/:stageId/advance",
    { preHandler: wipAdvance },
    async (req, reply) => {
      const { id, stageId } = HeaderStageParamSchema.parse(req.params);
      const body = AdvanceWipStageSchema.parse(req.body);
      return reply.send(
        await opts.workOrders.advanceStage(req, id, stageId, body)
      );
    }
  );

  // ─── WIP Stage Templates ──────────────────────────────────────────────────

  const TemplateListQuerySchema = z.object({
    productFamily: ProductFamilySchema.optional(),
  });

  app.get(
    "/production/wip-stage-templates",
    { preHandler: woRead },
    async (req, reply) => {
      const query = TemplateListQuerySchema.parse(req.query);
      return reply.send({
        data: await opts.workOrders.listTemplates(req, query.productFamily),
      });
    }
  );

  // ─── Device Instances (Phase 5 Mobicase slice) ────────────────────────────
  // Reuses the work_orders:read permission — the mfg/device-ids UI sits in
  // the same production-floor workflow as the work-orders page.

  app.get(
    "/production/device-instances",
    { preHandler: woRead },
    async (req, reply) => {
      const query = DeviceInstanceListQuerySchema.parse(req.query);
      return reply.send(await opts.deviceInstances.list(req, query));
    }
  );

  app.get(
    "/production/device-instances/:id",
    { preHandler: woRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.deviceInstances.getById(req, id));
    }
  );
}
