/**
 * Inventory routes. Mounted at /inventory/*.
 *
 * Every endpoint carries three preHandlers:
 *   1. authGuard               — verifies bearer + audience, populates req.user
 *   2. requireFeature(...)     — 402 if tenant plan lacks module.inventory
 *   3. requirePermission(p)    — one of inventory:read | inventory:adjust |
 *                                inventory:receive | inventory:issue |
 *                                inventory:transfer
 *
 * Permission map (aligned with existing ROLE_PERMISSIONS in
 * @instigenie/contracts/permissions):
 *
 *   GET  /inventory/**                   → inventory:read
 *   POST/PATCH/DELETE masters/bindings   → inventory:adjust
 *   POST /inventory/stock/entries        → dynamic preHandler that picks
 *                                          adjust|receive|issue|transfer
 *                                          based on the body's txn_type
 *
 * The dynamic preHandler reads the request body to decide which
 * permission to require. It must run AFTER the auth guard (so req.user
 * exists) and AFTER requireFeature (so 402 beats 403 when the tenant
 * isn't on the inventory plan).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  BulkReserveStockRequestSchema,
  ConsumeReservationRequestSchema,
  CreateItemSchema,
  CreateWarehouseSchema,
  ItemListQuerySchema,
  ItemWarehouseBindingListQuerySchema,
  PostStockLedgerEntrySchema,
  ReserveStockRequestSchema,
  StockLedgerListQuerySchema,
  StockReservationListQuerySchema,
  StockSummaryListQuerySchema,
  UpdateItemSchema,
  UpdateWarehouseSchema,
  UpsertItemWarehouseBindingSchema,
  WarehouseListQuerySchema,
  type Permission,
  type StockTxnType,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { RequireFeature } from "../quotas/guard.js";
import type { ItemsService } from "./items.service.js";
import type { WarehousesService } from "./warehouses.service.js";
import type { StockService } from "./stock.service.js";
import type { ReservationsService } from "./reservations.service.js";
import { UnauthorizedError } from "@instigenie/errors";
import { requireUser } from "../../context/request-context.js";

export interface RegisterInventoryRoutesOptions {
  items: ItemsService;
  warehouses: WarehousesService;
  stock: StockService;
  reservations: ReservationsService;
  guardInternal: AuthGuardOptions;
  requireFeature: RequireFeature;
}

const RefPathSchema = z.object({
  refDocType: z.string().trim().min(1).max(32),
  refDocId: z.string().uuid(),
});

const IdParamSchema = z.object({ id: z.string().uuid() });

const ItemWarehousePathSchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
});

/**
 * Which permission does a given txn_type require? Matches the semantic
 * categories in packages/contracts/src/permissions.ts.
 */
const PERMISSION_BY_TXN_TYPE: Record<StockTxnType, Permission> = {
  OPENING_BALANCE: "inventory:adjust",
  GRN_RECEIPT: "inventory:receive",
  WO_ISSUE: "inventory:issue",
  WO_RETURN: "inventory:receive",
  WO_OUTPUT: "inventory:receive",
  ADJUSTMENT: "inventory:adjust",
  TRANSFER_OUT: "inventory:transfer",
  TRANSFER_IN: "inventory:transfer",
  SCRAP: "inventory:adjust",
  RTV_OUT: "inventory:issue",
  CUSTOMER_ISSUE: "inventory:issue",
  CUSTOMER_RETURN: "inventory:receive",
  REVERSAL: "inventory:adjust",
};

/**
 * Dynamic preHandler: inspects the body's txn_type and asserts the
 * matching permission. If the body is malformed we pass through — the
 * zod parse in the handler will produce the proper ValidationError.
 */
function requireStockTxnPermission() {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as Partial<{ txnType: string }>;
    const txn = body.txnType as StockTxnType | undefined;
    if (!txn || !(txn in PERMISSION_BY_TXN_TYPE)) {
      // Unknown/missing — let the zod parse surface a 400.
      return;
    }
    const perm = PERMISSION_BY_TXN_TYPE[txn];
    if (!user.permissions.has(perm)) {
      throw new UnauthorizedError(`missing permission: ${perm}`);
    }
  };
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  opts: RegisterInventoryRoutesOptions
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  const requireInventoryModule = opts.requireFeature("module.inventory");

  // ─── Warehouses ───────────────────────────────────────────────────────────

  app.get(
    "/inventory/warehouses",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const query = WarehouseListQuerySchema.parse(req.query);
      const result = await opts.warehouses.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/inventory/warehouses/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.warehouses.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/inventory/warehouses",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const body = CreateWarehouseSchema.parse(req.body);
      const result = await opts.warehouses.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/inventory/warehouses/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateWarehouseSchema.parse(req.body);
      const result = await opts.warehouses.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/inventory/warehouses/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.warehouses.remove(req, id);
      return reply.code(204).send();
    }
  );

  // ─── Items ────────────────────────────────────────────────────────────────

  app.get(
    "/inventory/items",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const query = ItemListQuerySchema.parse(req.query);
      const result = await opts.items.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/inventory/items/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.items.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/inventory/items",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const body = CreateItemSchema.parse(req.body);
      const result = await opts.items.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/inventory/items/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateItemSchema.parse(req.body);
      const result = await opts.items.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/inventory/items/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.items.remove(req, id);
      return reply.code(204).send();
    }
  );

  // ─── Item / Warehouse bindings ────────────────────────────────────────────

  app.get(
    "/inventory/bindings",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const query = ItemWarehouseBindingListQuerySchema.parse(req.query);
      const result = await opts.stock.listBindings(req, query);
      return reply.send(result);
    }
  );

  app.post(
    "/inventory/bindings",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const body = UpsertItemWarehouseBindingSchema.parse(req.body);
      const result = await opts.stock.upsertBinding(req, body);
      // UPSERT — 200 (create or update) since the client doesn't care
      // which happened.
      return reply.send(result);
    }
  );

  app.delete(
    "/inventory/bindings/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:adjust"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.stock.deleteBinding(req, id);
      return reply.code(204).send();
    }
  );

  // ─── Stock ledger + summary ───────────────────────────────────────────────

  app.get(
    "/inventory/stock/ledger",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const query = StockLedgerListQuerySchema.parse(req.query);
      const result = await opts.stock.listLedger(req, query);
      return reply.send(result);
    }
  );

  app.post(
    "/inventory/stock/ledger",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requireStockTxnPermission(),
      ],
    },
    async (req, reply) => {
      const body = PostStockLedgerEntrySchema.parse(req.body);
      const result = await opts.stock.postEntry(req, body);
      return reply.code(201).send(result);
    }
  );

  app.get(
    "/inventory/stock/summary",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const query = StockSummaryListQuerySchema.parse(req.query);
      const result = await opts.stock.listSummary(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/inventory/stock/summary/:itemId/:warehouseId",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const { itemId, warehouseId } = ItemWarehousePathSchema.parse(req.params);
      const result = await opts.stock.getSummaryForItemAtWarehouse(
        req,
        itemId,
        warehouseId
      );
      return reply.send(result);
    }
  );

  // ─── Stock reservations (Phase 3) ─────────────────────────────────────────
  //
  // Read: inventory:read. Create/release: inventory:issue (holding stock
  // is functionally "planning to issue"). Consume: inventory:issue
  // (actually issues via a WO_ISSUE ledger row).

  app.get(
    "/inventory/reservations",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const query = StockReservationListQuerySchema.parse(req.query);
      const result = await opts.reservations.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/inventory/reservations/:id",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:read"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.reservations.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/inventory/reservations",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:issue"),
      ],
    },
    async (req, reply) => {
      const body = ReserveStockRequestSchema.parse(req.body);
      const result = await opts.reservations.reserve(req, body);
      return reply.code(201).send(result);
    }
  );

  // Bulk / MRP reserve-all. Canonical-ordered, all-or-nothing.
  app.post(
    "/inventory/reservations/bulk",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:issue"),
      ],
    },
    async (req, reply) => {
      const body = BulkReserveStockRequestSchema.parse(req.body);
      const result = await opts.reservations.mrpReserveAll(req, body);
      return reply.code(201).send({ data: result });
    }
  );

  app.post(
    "/inventory/reservations/:id/release",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:issue"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.reservations.release(req, id);
      return reply.code(204).send();
    }
  );

  // Bulk release by ref doc. Idempotent — returns a count of rows released.
  app.post(
    "/inventory/reservations/by-ref/:refDocType/:refDocId/release",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:issue"),
      ],
    },
    async (req, reply) => {
      const { refDocType, refDocId } = RefPathSchema.parse(req.params);
      const released = await opts.reservations.releaseByRef(
        req,
        refDocType,
        refDocId
      );
      return reply.send({ released });
    }
  );

  app.post(
    "/inventory/reservations/:id/consume",
    {
      preHandler: [
        authGuard,
        requireInventoryModule,
        requirePermission("inventory:issue"),
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = ConsumeReservationRequestSchema.parse(req.body ?? {});
      const result = await opts.reservations.consume(req, id, body);
      return reply.code(201).send(result);
    }
  );
}
