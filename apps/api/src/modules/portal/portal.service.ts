/**
 * Portal service. ARCHITECTURE.md §3.7 (Phase 3).
 *
 * One service for the whole portal surface because the endpoints are thin
 * read wrappers + one write (create-ticket + add-comment). Each public
 * method is a Fastify handler body — takes the request, returns the wire
 * shape.
 *
 * Every mutating call runs inside withPortalRequest, which:
 *   1. Sets app.current_org + app.current_user + app.current_portal_customer
 *   2. Wraps the body in BEGIN/COMMIT so RLS policies see the full picture
 *
 * Reads use the same wrapper — the portal RLS restrictive policies apply
 * to SELECT too.
 */

import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@instigenie/errors";
import type {
  AddPortalTicketComment,
  CreatePortalTicket,
  InvoiceStatus,
  PortalInvoiceListQuery,
  PortalOrderListQuery,
  PortalSummary,
  PortalTicketListQuery,
  SalesOrder,
  SalesOrderStatus,
  Ticket,
  TicketComment,
  TicketStatus,
} from "@instigenie/contracts";
import { withOrg } from "@instigenie/db";
import { requireUser } from "../../context/request-context.js";
import { planPagination } from "../shared/pagination.js";
import { withPortalRequest } from "./with-portal-request.js";
import { portalRepo, type PortalInvoiceSummary } from "./portal.repository.js";

export interface PortalServiceDeps {
  pool: Pool;
}

/**
 * preHandler hook that resolves the portal user's customer link (from
 * `account_portal_users`) and stamps it onto the request as
 * `portalCustomerId`. Registered once on every /portal/* route (after
 * guardPortal, before any service method).
 *
 * If the portal user has no pivot row — e.g. their CUSTOMER role was
 * granted but the link-creation step was skipped — we fail with 401.
 * That's better than 404 because it prevents an attacker from probing
 * which customer ids exist (though the tenant-isolation RLS would
 * already block a cross-org probe).
 */
export function createPortalCustomerHook(pool: Pool) {
  return async function portalCustomerHook(
    req: FastifyRequest,
  ): Promise<void> {
    const user = requireUser(req);
    if (user.audience !== "instigenie-portal") {
      // Defense in depth: this hook should only run behind guardPortal.
      // If a misconfiguration routes an internal token here, refuse rather
      // than silently bind it to a customer.
      throw new UnauthorizedError("expected portal audience");
    }
    const pivot = await withOrg(pool, user.orgId, (client) =>
      portalRepo.findPivot(client, user.id),
    );
    if (!pivot) {
      throw new UnauthorizedError("portal user has no customer link");
    }
    req.portalCustomerId = pivot.accountId;
  };
}

/**
 * Full audience-block preHandler. Register at the top of non-/portal
 * routes. Rejects with 403 if a portal token is presented on a surface
 * it shouldn't reach.
 *
 * This is the inverse of guardPortal — guardPortal accepts ONLY portal
 * tokens; this hook REJECTS portal tokens. Internal routes get both
 * guardInternal (which accepts only internal tokens) AND this hook, so
 * the order is: guardInternal passes an internal token → hook no-ops.
 * A portal token hits guardInternal first and fails on audience, so
 * this hook is actually a belt-and-braces check — we'll keep it because
 * it's cheap and documents the intent.
 */
export async function blockPortalTokensFromInternalRoutes(
  req: FastifyRequest,
): Promise<void> {
  if (req.user?.audience === "instigenie-portal") {
    throw new UnauthorizedError("portal tokens cannot access internal routes");
  }
}

export class PortalService {
  constructor(private readonly deps: PortalServiceDeps) {}

  // ─── /portal/me ─────────────────────────────────────────────────────────

  async summary(req: FastifyRequest): Promise<PortalSummary> {
    const user = requireUser(req);
    const customerId = req.portalCustomerId;
    if (!customerId) throw new UnauthorizedError("no portal link");

    // The customer's display name lives on accounts — we read it once
    // here for the landing page. Queries in withPortalRequest are bound
    // by the restrictive RLS policy to this customer's own rows, so the
    // accounts SELECT below fetches exactly the single linked row.
    return withPortalRequest(req, this.deps.pool, async (client) => {
      const { rows } = await client.query<{ name: string; email: string }>(
        `SELECT a.name, u.email
           FROM accounts a
           JOIN users u ON u.id = $1
          WHERE a.id = $2`,
        [user.id, customerId],
      );
      const meta = rows[0];
      if (!meta) throw new UnauthorizedError("portal link stale");

      const counts = await portalRepo.summaryCounts(client);

      return {
        user: {
          id: user.id,
          email: meta.email,
          // Portal UI: the account display name for "logged in as X on
          // behalf of $company". The caller's own display name lives on
          // users.name but we don't want to widen the query in this path.
          name: meta.email,
        },
        customer: {
          id: customerId,
          name: meta.name,
        },
        counts,
      };
    });
  }

  // ─── /portal/orders ─────────────────────────────────────────────────────

  async listOrders(
    req: FastifyRequest,
    query: PortalOrderListQuery,
  ): Promise<{ data: SalesOrder[]; total: number; page: number; limit: number }> {
    const plan = planPagination(
      query,
      { createdAt: "created_at", orderNumber: "order_number" },
      "createdAt",
    );
    return withPortalRequest(req, this.deps.pool, async (client) => {
      const filter: { status?: SalesOrderStatus } = {};
      if (query.status) filter.status = query.status;
      const { data, total } = await portalRepo.listOrders(client, filter, plan);
      return { data, total, page: plan.page, limit: plan.limit };
    });
  }

  async getOrder(req: FastifyRequest, id: string): Promise<SalesOrder> {
    return withPortalRequest(req, this.deps.pool, async (client) => {
      const row = await portalRepo.getOrderById(client, id);
      if (!row) throw new NotFoundError("order");
      return row;
    });
  }

  // ─── /portal/invoices ───────────────────────────────────────────────────

  async listInvoices(
    req: FastifyRequest,
    query: PortalInvoiceListQuery,
  ): Promise<{
    data: PortalInvoiceSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const plan = planPagination(
      query,
      { createdAt: "created_at", invoiceDate: "invoice_date" },
      "createdAt",
    );
    return withPortalRequest(req, this.deps.pool, async (client) => {
      const filter: { status?: InvoiceStatus } = {};
      if (query.status) filter.status = query.status;
      const { data, total } = await portalRepo.listInvoices(client, filter, plan);
      return { data, total, page: plan.page, limit: plan.limit };
    });
  }

  async getInvoice(
    req: FastifyRequest,
    id: string,
  ): Promise<PortalInvoiceSummary> {
    return withPortalRequest(req, this.deps.pool, async (client) => {
      const row = await portalRepo.getInvoiceById(client, id);
      if (!row) throw new NotFoundError("invoice");
      return row;
    });
  }

  // ─── /portal/tickets ────────────────────────────────────────────────────

  async listTickets(
    req: FastifyRequest,
    query: PortalTicketListQuery,
  ): Promise<{ data: Ticket[]; total: number; page: number; limit: number }> {
    const plan = planPagination(
      query,
      { createdAt: "created_at", ticketNumber: "ticket_number" },
      "createdAt",
    );
    return withPortalRequest(req, this.deps.pool, async (client) => {
      const filter: { status?: TicketStatus } = {};
      if (query.status) filter.status = query.status;
      const { data, total } = await portalRepo.listTickets(
        client,
        filter,
        plan,
      );
      return { data, total, page: plan.page, limit: plan.limit };
    });
  }

  async getTicket(
    req: FastifyRequest,
    id: string,
  ): Promise<{ ticket: Ticket; comments: TicketComment[] }> {
    return withPortalRequest(req, this.deps.pool, async (client) => {
      const ticket = await portalRepo.getTicketById(client, id);
      if (!ticket) throw new NotFoundError("ticket");
      const comments = await portalRepo.listCustomerComments(client, id);
      return { ticket, comments };
    });
  }

  async createTicket(
    req: FastifyRequest,
    input: CreatePortalTicket,
  ): Promise<Ticket> {
    const user = requireUser(req);
    const customerId = req.portalCustomerId;
    if (!customerId) throw new UnauthorizedError("no portal link");

    return withPortalRequest(req, this.deps.pool, async (client) => {
      // If contactId is supplied, verify it belongs to this customer.
      // The RLS tenant predicate already limits to the current org, but
      // it doesn't fence contacts to this account — that's a CRM-side
      // fence we enforce here in the service to keep portal users
      // honest.
      if (input.contactId) {
        const { rows } = await client.query<{ account_id: string | null }>(
          `SELECT account_id FROM contacts WHERE id = $1`,
          [input.contactId],
        );
        const contact = rows[0];
        if (!contact || contact.account_id !== customerId) {
          throw new ValidationError(
            "contactId does not belong to your account",
          );
        }
      }

      return portalRepo.createTicket(client, {
        orgId: user.orgId,
        accountId: customerId,
        contactId: input.contactId ?? null,
        subject: input.subject,
        description: input.description,
        category: input.category,
        priority: input.priority,
        productCode: input.productCode ?? null,
      });
    });
  }

  async addCustomerComment(
    req: FastifyRequest,
    ticketId: string,
    input: AddPortalTicketComment,
  ): Promise<TicketComment> {
    const user = requireUser(req);

    return withPortalRequest(req, this.deps.pool, async (client) => {
      // Confirm the ticket is visible to us (RLS already does this, but
      // this gives us a clean 404 rather than a silent no-op).
      const ticket = await portalRepo.getTicketById(client, ticketId);
      if (!ticket) throw new NotFoundError("ticket");
      return portalRepo.addCustomerComment(client, {
        orgId: user.orgId,
        ticketId,
        actorId: user.id,
        content: input.content,
      });
    });
  }
}
