/**
 * Contacts service — thin orchestrator, same shape as accounts.service.ts.
 *
 * An account owns its contacts; deleting the account cascades via FK
 * ON DELETE RESTRICT (we keep contacts around if the account still has
 * references elsewhere). For soft-delete we flip deleted_at.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  Contact,
  ContactListQuerySchema,
  CreateContact,
  UpdateContact,
} from "@mobilab/contracts";
import { z } from "zod";
import { NotFoundError } from "@mobilab/errors";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { contactsRepo } from "./contacts.repository.js";
import { requireUser } from "../../context/request-context.js";
import { paginated } from "@mobilab/contracts";

type ContactListQuery = z.infer<typeof ContactListQuerySchema>;

const CONTACT_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  lastName: "last_name",
  firstName: "first_name",
};

export class ContactsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: ContactListQuery
  ): Promise<ReturnType<typeof paginated<Contact>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, CONTACT_SORTS, "createdAt");
      const { data, total } = await contactsRepo.list(
        client,
        { accountId: query.accountId, search: query.search },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Contact> {
    return withRequest(req, this.pool, async (client) => {
      const row = await contactsRepo.getById(client, id);
      if (!row) throw new NotFoundError("contact");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateContact): Promise<Contact> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return contactsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateContact
  ): Promise<Contact> {
    return withRequest(req, this.pool, async (client) => {
      const row = await contactsRepo.update(client, id, input);
      if (!row) throw new NotFoundError("contact");
      return row;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await contactsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("contact");
    });
  }
}
