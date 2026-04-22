/**
 * Accounts service. Pure orchestrator — no Fastify types.
 *
 * Every mutating call goes through withRequest() which sets the RLS GUC
 * `app.current_org` and the audit GUC `app.current_user`. List/get go
 * through it too so the audit trigger can attribute reads if we ever
 * decide to log them (today it's INSERT/UPDATE/DELETE only).
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  Account,
  AccountListQuerySchema,
  CreateAccount,
  UpdateAccount,
} from "@instigenie/contracts";
import { z } from "zod";
import { NotFoundError } from "@instigenie/errors";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { accountsRepo } from "./accounts.repository.js";
import { requireUser } from "../../context/request-context.js";
import { paginated } from "@instigenie/contracts";

type AccountListQuery = z.infer<typeof AccountListQuerySchema>;

const ACCOUNT_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
  healthScore: "health_score",
};

export class AccountsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: AccountListQuery
  ): Promise<ReturnType<typeof paginated<Account>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, ACCOUNT_SORTS, "createdAt");
      const { data, total } = await accountsRepo.list(
        client,
        {
          search: query.search,
          industry: query.industry,
          ownerId: query.ownerId,
          isKeyAccount: query.isKeyAccount,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Account> {
    return withRequest(req, this.pool, async (client) => {
      const row = await accountsRepo.getById(client, id);
      if (!row) throw new NotFoundError("account");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateAccount): Promise<Account> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return accountsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateAccount
  ): Promise<Account> {
    return withRequest(req, this.pool, async (client) => {
      const row = await accountsRepo.update(client, id, input);
      if (!row) throw new NotFoundError("account");
      return row;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await accountsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("account");
    });
  }
}
