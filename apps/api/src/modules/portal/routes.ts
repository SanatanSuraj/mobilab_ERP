/**
 * Portal routes. Mounted at /portal/*. ARCHITECTURE.md §3.7 (Phase 3).
 *
 * Every endpoint has three preHandlers:
 *   1. guardPortal       — accepts only audience=instigenie-portal tokens
 *   2. portalCustomerHook — loads account_portal_users pivot into
 *                          req.portalCustomerId; 401 if no link
 *   3. portalRateLimit   — per-user 60 rpm cap
 *
 * Write endpoints additionally sit inside withPortalRequest (invoked by
 * the service layer) which binds all three GUCs: current_org,
 * current_user, current_portal_customer. RLS enforces the customer
 * isolation; the service enforces contact-belongs-to-customer checks.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  AddPortalTicketCommentSchema,
  CreatePortalTicketSchema,
  PortalInvoiceListQuerySchema,
  PortalOrderListQuerySchema,
  PortalTicketListQuerySchema,
} from "@instigenie/contracts";
import { createAuthGuard } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { PortalService } from "./portal.service.js";
import { createPortalCustomerHook } from "./portal.service.js";

export interface RegisterPortalRoutesOptions {
  service: PortalService;
  guardPortal: AuthGuardOptions;
  /** Pool used by the customer-hook to resolve the portal pivot row. */
  pool: Pool;
  /**
   * @fastify/rate-limit per-route config (60/min/user). Applied via
   * `config.rateLimit` on every portal route — plugin v10's
   * `app.rateLimit(...)` preHandler is a no-op marker, the documented
   * per-route API is `config.rateLimit`. See apps/api/src/index.ts for
   * the keyGenerator that prefers req.user.id and falls back to req.ip.
   */
  portalRateLimit: Record<string, unknown>;
}

const IdParamSchema = z.object({ id: z.string().uuid() });

export async function registerPortalRoutes(
  app: FastifyInstance,
  opts: RegisterPortalRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardPortal);
  const customerHook = createPortalCustomerHook(opts.pool);

  // The rate limiter is applied per-route via `config.rateLimit`, NOT as
  // a preHandler — the plugin's preHandler form is a no-op marker in v10.
  const pre = [authGuard, customerHook];
  const routeOpts = {
    preHandler: pre,
    config: { rateLimit: opts.portalRateLimit },
  };

  // ─── Landing page ─────────────────────────────────────────────────────

  app.get("/portal/me", routeOpts, async (req, reply) => {
    const result = await opts.service.summary(req);
    return reply.send(result);
  });

  // ─── Orders (read-only) ───────────────────────────────────────────────

  app.get("/portal/orders", routeOpts, async (req, reply) => {
    const query = PortalOrderListQuerySchema.parse(req.query);
    const result = await opts.service.listOrders(req, query);
    return reply.send(result);
  });

  app.get("/portal/orders/:id", routeOpts, async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const result = await opts.service.getOrder(req, id);
    return reply.send(result);
  });

  // ─── Invoices (read-only) ─────────────────────────────────────────────

  app.get("/portal/invoices", routeOpts, async (req, reply) => {
    const query = PortalInvoiceListQuerySchema.parse(req.query);
    const result = await opts.service.listInvoices(req, query);
    return reply.send(result);
  });

  app.get("/portal/invoices/:id", routeOpts, async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const result = await opts.service.getInvoice(req, id);
    return reply.send(result);
  });

  // ─── Tickets (read + write) ───────────────────────────────────────────

  app.get("/portal/tickets", routeOpts, async (req, reply) => {
    const query = PortalTicketListQuerySchema.parse(req.query);
    const result = await opts.service.listTickets(req, query);
    return reply.send(result);
  });

  app.get("/portal/tickets/:id", routeOpts, async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const result = await opts.service.getTicket(req, id);
    return reply.send(result);
  });

  app.post("/portal/tickets", routeOpts, async (req, reply) => {
    const body = CreatePortalTicketSchema.parse(req.body);
    const result = await opts.service.createTicket(req, body);
    return reply.code(201).send(result);
  });

  app.post(
    "/portal/tickets/:id/comments",
    routeOpts,
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = AddPortalTicketCommentSchema.parse(req.body);
      const result = await opts.service.addCustomerComment(req, id, body);
      return reply.code(201).send(result);
    },
  );
}
