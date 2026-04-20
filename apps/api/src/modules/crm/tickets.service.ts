/**
 * Tickets service.
 *
 * Valid status transitions (§13.1.4):
 *   OPEN              → IN_PROGRESS | WAITING_CUSTOMER | CLOSED
 *   IN_PROGRESS       → WAITING_CUSTOMER | RESOLVED | OPEN
 *   WAITING_CUSTOMER  → IN_PROGRESS | RESOLVED | CLOSED
 *   RESOLVED          → CLOSED | IN_PROGRESS
 *   CLOSED            → (terminal)
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  AddTicketComment,
  CreateTicket,
  Ticket,
  TicketComment,
  TicketListQuerySchema,
  TicketStatus,
  TransitionTicketStatus,
  UpdateTicket,
} from "@mobilab/contracts";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
} from "@mobilab/errors";
import { paginated } from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { ticketsRepo } from "./tickets.repository.js";
import { requireUser } from "../../context/request-context.js";

type TicketListQuery = z.infer<typeof TicketListQuerySchema>;

const TICKET_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  ticketNumber: "ticket_number",
  priority: "priority",
  slaDeadline: "sla_deadline",
};

const ALLOWED_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_CUSTOMER", "CLOSED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED", "OPEN"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

export class TicketsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: TicketListQuery
  ): Promise<ReturnType<typeof paginated<Ticket>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, TICKET_SORTS, "createdAt");
      const { data, total } = await ticketsRepo.list(
        client,
        {
          status: query.status,
          priority: query.priority,
          assignedTo: query.assignedTo,
          accountId: query.accountId,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Ticket> {
    return withRequest(req, this.pool, async (client) => {
      const row = await ticketsRepo.getById(client, id);
      if (!row) throw new NotFoundError("ticket");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateTicket): Promise<Ticket> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return ticketsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateTicket
  ): Promise<Ticket> {
    return withRequest(req, this.pool, async (client) => {
      const result = await ticketsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("ticket");
      if (result === "version_conflict") {
        throw new ConflictError("ticket was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await ticketsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("ticket");
    });
  }

  async transitionStatus(
    req: FastifyRequest,
    id: string,
    input: TransitionTicketStatus
  ): Promise<Ticket> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await ticketsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("ticket");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("ticket was modified by someone else");
      }
      const allowed = ALLOWED_STATUS_TRANSITIONS[cur.status];
      if (!allowed.includes(input.status)) {
        throw new StateTransitionError(
          `cannot transition ticket from ${cur.status} to ${input.status}`
        );
      }
      const result = await ticketsRepo.transitionStatus(client, id, {
        status: input.status,
        expectedVersion: input.expectedVersion,
      });
      if (result === null) throw new NotFoundError("ticket");
      if (result === "version_conflict") {
        throw new ConflictError("ticket was modified by someone else");
      }
      return result;
    });
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async listComments(
    req: FastifyRequest,
    ticketId: string
  ): Promise<TicketComment[]> {
    return withRequest(req, this.pool, async (client) => {
      const t = await ticketsRepo.getById(client, ticketId);
      if (!t) throw new NotFoundError("ticket");
      return ticketsRepo.listComments(client, ticketId);
    });
  }

  async addComment(
    req: FastifyRequest,
    ticketId: string,
    input: AddTicketComment
  ): Promise<TicketComment> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const t = await ticketsRepo.getById(client, ticketId);
      if (!t) throw new NotFoundError("ticket");
      return ticketsRepo.addComment(client, {
        orgId: user.orgId,
        ticketId,
        actorId: user.id,
        input,
      });
    });
  }
}
