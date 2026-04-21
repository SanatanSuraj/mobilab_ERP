/**
 * Warehouses service. Pure orchestrator; no Fastify types except the
 * FastifyRequest passthrough for withRequest().
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateWarehouse,
  UpdateWarehouse,
  Warehouse,
  WarehouseListQuerySchema,
} from "@mobilab/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@mobilab/errors";
import { paginated } from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { warehousesRepo } from "./warehouses.repository.js";
import { requireUser } from "../../context/request-context.js";

type WarehouseListQuery = z.infer<typeof WarehouseListQuerySchema>;

const WAREHOUSE_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  code: "code",
  name: "name",
  kind: "kind",
};

export class WarehousesService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: WarehouseListQuery
  ): Promise<ReturnType<typeof paginated<Warehouse>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, WAREHOUSE_SORTS, "createdAt");
      const { data, total } = await warehousesRepo.list(
        client,
        {
          kind: query.kind,
          isActive: query.isActive,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Warehouse> {
    return withRequest(req, this.pool, async (client) => {
      const row = await warehousesRepo.getById(client, id);
      if (!row) throw new NotFoundError("warehouse");
      return row;
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateWarehouse
  ): Promise<Warehouse> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return warehousesRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateWarehouse
  ): Promise<Warehouse> {
    return withRequest(req, this.pool, async (client) => {
      const result = await warehousesRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("warehouse");
      if (result === "version_conflict") {
        throw new ConflictError("warehouse was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await warehousesRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("warehouse");
    });
  }
}
