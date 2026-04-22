/**
 * Items service. Pure orchestrator.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateItem,
  Item,
  ItemListQuerySchema,
  UpdateItem,
} from "@instigenie/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { itemsRepo } from "./items.repository.js";
import { requireUser } from "../../context/request-context.js";

type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

const ITEM_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  sku: "sku",
  name: "name",
  category: "category",
  unitCost: "unit_cost",
};

export class ItemsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: ItemListQuery
  ): Promise<ReturnType<typeof paginated<Item>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, ITEM_SORTS, "createdAt");
      const { data, total } = await itemsRepo.list(
        client,
        {
          category: query.category,
          uom: query.uom,
          isActive: query.isActive,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Item> {
    return withRequest(req, this.pool, async (client) => {
      const row = await itemsRepo.getById(client, id);
      if (!row) throw new NotFoundError("item");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateItem): Promise<Item> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return itemsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateItem
  ): Promise<Item> {
    return withRequest(req, this.pool, async (client) => {
      const result = await itemsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("item");
      if (result === "version_conflict") {
        throw new ConflictError("item was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await itemsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("item");
    });
  }
}
