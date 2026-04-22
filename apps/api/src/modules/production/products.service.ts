/**
 * Products service. Pure orchestrator.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateProduct,
  Product,
  ProductListQuerySchema,
  UpdateProduct,
} from "@instigenie/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { productsRepo } from "./products.repository.js";
import { requireUser } from "../../context/request-context.js";

type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

const PRODUCT_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  productCode: "product_code",
  name: "name",
  family: "family",
  standardCycleDays: "standard_cycle_days",
};

export class ProductsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: ProductListQuery
  ): Promise<ReturnType<typeof paginated<Product>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, PRODUCT_SORTS, "createdAt");
      const { data, total } = await productsRepo.list(
        client,
        {
          family: query.family,
          isActive: query.isActive,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Product> {
    return withRequest(req, this.pool, async (client) => {
      const row = await productsRepo.getById(client, id);
      if (!row) throw new NotFoundError("product");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateProduct): Promise<Product> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const existing = await productsRepo.getByCode(client, input.productCode);
      if (existing) {
        throw new ConflictError(
          `product code "${input.productCode}" already exists`
        );
      }
      return productsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateProduct
  ): Promise<Product> {
    return withRequest(req, this.pool, async (client) => {
      const result = await productsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("product");
      if (result === "version_conflict") {
        throw new ConflictError("product was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await productsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("product");
    });
  }
}
