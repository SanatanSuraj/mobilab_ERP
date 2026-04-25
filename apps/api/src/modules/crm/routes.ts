/**
 * CRM routes. Mounted at /crm/*. Each endpoint has three preHandlers:
 *
 *   1. authGuard               — verifies bearer + audience, populates req.user
 *   2. requireFeature(...)     — Sprint 1C. 402 if the tenant's plan doesn't
 *                                include the module. Runs before permission so
 *                                the client hears "upgrade" rather than
 *                                "ask for a role".
 *   3. requirePermission(p)    — one of the accounts/contacts/leads/deals/tickets
 *                                perms declared in @instigenie/contracts/permissions
 *
 * Request/response schemas are validated with zod at the boundary. Zod
 * failures bubble to the registerProblemHandler() as ValidationError.
 *
 * Writes happen inside withRequest() which sets both RLS and audit GUCs.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AccountListQuerySchema,
  AddLeadActivitySchema,
  AddTicketCommentSchema,
  BulkCreateLeadsSchema,
  ContactListQuerySchema,
  ConvertLeadSchema,
  ConvertQuotationSchema,
  CreateAccountSchema,
  CreateContactSchema,
  CreateDealSchema,
  CreateLeadSchema,
  CreateQuotationSchema,
  CreateSalesOrderSchema,
  CreateTicketSchema,
  CrmReportsQuerySchema,
  DealListQuerySchema,
  FinanceApproveSalesOrderSchema,
  LeadListQuerySchema,
  MarkLeadLostSchema,
  QuotationListQuerySchema,
  SalesOrderListQuerySchema,
  SubmitDealDiscountForApprovalSchema,
  TicketListQuerySchema,
  TransitionDealStageSchema,
  TransitionQuotationStatusSchema,
  TransitionSalesOrderStatusSchema,
  TransitionTicketStatusSchema,
  UpdateAccountSchema,
  UpdateContactSchema,
  UpdateDealSchema,
  UpdateLeadSchema,
  UpdateQuotationSchema,
  UpdateSalesOrderSchema,
  UpdateTicketSchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { RequireFeature } from "../quotas/guard.js";
import type { AccountsService } from "./accounts.service.js";
import type { ContactsService } from "./contacts.service.js";
import type { LeadsService } from "./leads.service.js";
import type { DealsService } from "./deals.service.js";
import type { DealApprovalsService } from "./deal-approvals.service.js";
import type { TicketsService } from "./tickets.service.js";
import type { QuotationsService } from "./quotations.service.js";
import type { SalesOrdersService } from "./sales-orders.service.js";
import type { CrmReportsService } from "./reports.service.js";

export interface RegisterCrmRoutesOptions {
  accounts: AccountsService;
  contacts: ContactsService;
  leads: LeadsService;
  deals: DealsService;
  dealApprovals: DealApprovalsService;
  tickets: TicketsService;
  quotations: QuotationsService;
  salesOrders: SalesOrdersService;
  reports: CrmReportsService;
  guardInternal: AuthGuardOptions;
  /**
   * Sprint 1C — feature-flag preHandler factory. Every CRM endpoint gates
   * on `module.crm`; future module routes (inventory, manufacturing, ...)
   * will stamp their own feature keys.
   */
  requireFeature: RequireFeature;
}

const IdParamSchema = z.object({ id: z.string().uuid() });

export async function registerCrmRoutes(
  app: FastifyInstance,
  opts: RegisterCrmRoutesOptions
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  // One module gate for the entire /crm/* subtree.
  const requireCrmModule = opts.requireFeature("module.crm");

  // ─── Accounts ─────────────────────────────────────────────────────────────

  app.get(
    "/crm/accounts",
    { preHandler: [authGuard, requireCrmModule, requirePermission("accounts:read")] },
    async (req, reply) => {
      const query = AccountListQuerySchema.parse(req.query);
      const result = await opts.accounts.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/accounts/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("accounts:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.accounts.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/accounts",
    { preHandler: [authGuard, requireCrmModule, requirePermission("accounts:create")] },
    async (req, reply) => {
      const body = CreateAccountSchema.parse(req.body);
      const result = await opts.accounts.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/crm/accounts/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("accounts:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateAccountSchema.parse(req.body);
      const result = await opts.accounts.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/crm/accounts/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("accounts:delete")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.accounts.remove(req, id);
      return reply.code(204).send();
    }
  );

  // ─── Contacts ─────────────────────────────────────────────────────────────

  app.get(
    "/crm/contacts",
    { preHandler: [authGuard, requireCrmModule, requirePermission("contacts:read")] },
    async (req, reply) => {
      const query = ContactListQuerySchema.parse(req.query);
      const result = await opts.contacts.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/contacts/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("contacts:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.contacts.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/contacts",
    { preHandler: [authGuard, requireCrmModule, requirePermission("contacts:create")] },
    async (req, reply) => {
      const body = CreateContactSchema.parse(req.body);
      const result = await opts.contacts.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/crm/contacts/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("contacts:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateContactSchema.parse(req.body);
      const result = await opts.contacts.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/crm/contacts/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("contacts:delete")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.contacts.remove(req, id);
      return reply.code(204).send();
    }
  );

  // ─── Leads ────────────────────────────────────────────────────────────────

  app.get(
    "/crm/leads",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:read")] },
    async (req, reply) => {
      const query = LeadListQuerySchema.parse(req.query);
      const result = await opts.leads.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/leads/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.leads.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/leads",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:create")] },
    async (req, reply) => {
      const body = CreateLeadSchema.parse(req.body);
      const result = await opts.leads.create(req, body);
      return reply.code(201).send(result);
    }
  );

  // Bulk import. Returns 200 (not 201) because a partial-success response
  // isn't a clean "resource created" — the body carries per-row statuses
  // so the client can reconcile. Zod enforces the 500-row soft cap; larger
  // batches should be chunked client-side.
  app.post(
    "/crm/leads/bulk",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:create")] },
    async (req, reply) => {
      const body = BulkCreateLeadsSchema.parse(req.body);
      const result = await opts.leads.bulkCreate(req, body);
      return reply.send(result);
    }
  );

  app.patch(
    "/crm/leads/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateLeadSchema.parse(req.body);
      const result = await opts.leads.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/crm/leads/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:delete")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.leads.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.get(
    "/crm/leads/:id/activities",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.leads.listActivities(req, id);
      return reply.send({ data: result });
    }
  );

  app.post(
    "/crm/leads/:id/activities",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = AddLeadActivitySchema.parse(req.body);
      const result = await opts.leads.addActivity(req, id, body);
      return reply.code(201).send(result);
    }
  );

  app.post(
    "/crm/leads/:id/lose",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = MarkLeadLostSchema.parse(req.body);
      const result = await opts.leads.markLost(req, id, body);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/leads/:id/convert",
    { preHandler: [authGuard, requireCrmModule, requirePermission("leads:convert")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = ConvertLeadSchema.parse(req.body);
      const result = await opts.leads.convert(req, id, body);
      return reply.code(201).send(result);
    }
  );

  // ─── CRM reports (date-windowed pipeline / win-loss / lead funnel) ───────

  app.get(
    "/crm/reports",
    {
      preHandler: [
        authGuard,
        requireCrmModule,
        requirePermission("deals:read"),
      ],
    },
    async (req, reply) => {
      const query = CrmReportsQuerySchema.parse(req.query);
      return reply.send(await opts.reports.summary(req, query));
    }
  );

  // ─── Deals ────────────────────────────────────────────────────────────────

  app.get(
    "/crm/deals",
    { preHandler: [authGuard, requireCrmModule, requirePermission("deals:read")] },
    async (req, reply) => {
      const query = DealListQuerySchema.parse(req.query);
      const result = await opts.deals.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/deals/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("deals:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.deals.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/deals",
    { preHandler: [authGuard, requireCrmModule, requirePermission("deals:create")] },
    async (req, reply) => {
      const body = CreateDealSchema.parse(req.body);
      const result = await opts.deals.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/crm/deals/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("deals:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateDealSchema.parse(req.body);
      const result = await opts.deals.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/crm/deals/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("deals:delete")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.deals.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.post(
    "/crm/deals/:id/transition",
    { preHandler: [authGuard, requireCrmModule, requirePermission("deals:transition")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = TransitionDealStageSchema.parse(req.body);
      const result = await opts.deals.transitionStage(req, id, body);
      return reply.send(result);
    }
  );

  // Header-level discount > 15% routes through the central approvals
  // engine. The decision arrives via POST /approvals/:id/act, which the
  // dispatcher routes back to DealApprovalsService.applyDecisionFromApprovals
  // (registered in the bootstrap) — no separate decide endpoint here.
  app.post(
    "/crm/deals/:id/submit-discount-for-approval",
    { preHandler: [authGuard, requireCrmModule, requirePermission("deals:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = SubmitDealDiscountForApprovalSchema.parse(req.body);
      const result = await opts.dealApprovals.submitForApproval(req, id, body);
      return reply.send(result);
    }
  );

  // ─── Tickets ──────────────────────────────────────────────────────────────

  app.get(
    "/crm/tickets",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:read")] },
    async (req, reply) => {
      const query = TicketListQuerySchema.parse(req.query);
      const result = await opts.tickets.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/tickets/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.tickets.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/tickets",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:create")] },
    async (req, reply) => {
      const body = CreateTicketSchema.parse(req.body);
      const result = await opts.tickets.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/crm/tickets/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateTicketSchema.parse(req.body);
      const result = await opts.tickets.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/crm/tickets/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:delete")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.tickets.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.post(
    "/crm/tickets/:id/transition",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:transition")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = TransitionTicketStatusSchema.parse(req.body);
      const result = await opts.tickets.transitionStatus(req, id, body);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/tickets/:id/comments",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.tickets.listComments(req, id);
      return reply.send({ data: result });
    }
  );

  app.post(
    "/crm/tickets/:id/comments",
    { preHandler: [authGuard, requireCrmModule, requirePermission("tickets:comment")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = AddTicketCommentSchema.parse(req.body);
      const result = await opts.tickets.addComment(req, id, body);
      return reply.code(201).send(result);
    }
  );

  // ─── Quotations ───────────────────────────────────────────────────────────
  //
  // Transitions + approvals have dedicated permissions; generic status
  // transitions go through the shared /transition endpoint, the gated
  // `quotations:approve` flow goes through /approve, and promotion to a
  // SalesOrder is gated behind `quotations:convert_to_so`.

  app.get(
    "/crm/quotations",
    { preHandler: [authGuard, requireCrmModule, requirePermission("quotations:read")] },
    async (req, reply) => {
      const query = QuotationListQuerySchema.parse(req.query);
      const result = await opts.quotations.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/quotations/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("quotations:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.quotations.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/quotations",
    { preHandler: [authGuard, requireCrmModule, requirePermission("quotations:create")] },
    async (req, reply) => {
      const body = CreateQuotationSchema.parse(req.body);
      const result = await opts.quotations.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/crm/quotations/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("quotations:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateQuotationSchema.parse(req.body);
      const result = await opts.quotations.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/crm/quotations/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("quotations:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.quotations.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.post(
    "/crm/quotations/:id/transition",
    { preHandler: [authGuard, requireCrmModule, requirePermission("quotations:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = TransitionQuotationStatusSchema.parse(req.body);
      const result = await opts.quotations.transitionStatus(req, id, body);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/quotations/:id/convert",
    { preHandler: [authGuard, requireCrmModule, requirePermission("quotations:convert_to_so")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = ConvertQuotationSchema.parse(req.body);
      const result = await opts.quotations.convertToSalesOrder(req, id, body);
      return reply.code(201).send(result);
    }
  );

  // ─── Sales Orders ─────────────────────────────────────────────────────────
  //
  // Fulfillment-side of CRM. Status transitions are gated on
  // `sales_orders:update`. Finance approval has its own dedicated
  // permission (`sales_orders:approve_finance`) since it's orthogonal to
  // the fulfillment graph.

  app.get(
    "/crm/sales-orders",
    { preHandler: [authGuard, requireCrmModule, requirePermission("sales_orders:read")] },
    async (req, reply) => {
      const query = SalesOrderListQuerySchema.parse(req.query);
      const result = await opts.salesOrders.list(req, query);
      return reply.send(result);
    }
  );

  app.get(
    "/crm/sales-orders/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("sales_orders:read")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const result = await opts.salesOrders.getById(req, id);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/sales-orders",
    { preHandler: [authGuard, requireCrmModule, requirePermission("sales_orders:create")] },
    async (req, reply) => {
      const body = CreateSalesOrderSchema.parse(req.body);
      const result = await opts.salesOrders.create(req, body);
      return reply.code(201).send(result);
    }
  );

  app.patch(
    "/crm/sales-orders/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("sales_orders:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateSalesOrderSchema.parse(req.body);
      const result = await opts.salesOrders.update(req, id, body);
      return reply.send(result);
    }
  );

  app.delete(
    "/crm/sales-orders/:id",
    { preHandler: [authGuard, requireCrmModule, requirePermission("sales_orders:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.salesOrders.remove(req, id);
      return reply.code(204).send();
    }
  );

  app.post(
    "/crm/sales-orders/:id/transition",
    { preHandler: [authGuard, requireCrmModule, requirePermission("sales_orders:update")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = TransitionSalesOrderStatusSchema.parse(req.body);
      const result = await opts.salesOrders.transitionStatus(req, id, body);
      return reply.send(result);
    }
  );

  app.post(
    "/crm/sales-orders/:id/finance-approve",
    { preHandler: [authGuard, requireCrmModule, requirePermission("sales_orders:approve_finance")] },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = FinanceApproveSalesOrderSchema.parse(req.body);
      const result = await opts.salesOrders.financeApprove(req, id, body);
      return reply.send(result);
    }
  );
}
