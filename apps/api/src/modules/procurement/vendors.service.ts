/**
 * Vendors service. Pure orchestrator.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateVendor,
  UpdateVendor,
  Vendor,
  VendorListQuerySchema,
} from "@mobilab/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@mobilab/errors";
import { paginated } from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { vendorsRepo } from "./vendors.repository.js";
import { requireUser } from "../../context/request-context.js";

type VendorListQuery = z.infer<typeof VendorListQuerySchema>;

const VENDOR_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  code: "code",
  name: "name",
  vendorType: "vendor_type",
  creditLimit: "credit_limit",
};

export class VendorsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: VendorListQuery
  ): Promise<ReturnType<typeof paginated<Vendor>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, VENDOR_SORTS, "createdAt");
      const { data, total } = await vendorsRepo.list(
        client,
        {
          vendorType: query.vendorType,
          isActive: query.isActive,
          isMsme: query.isMsme,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Vendor> {
    return withRequest(req, this.pool, async (client) => {
      const row = await vendorsRepo.getById(client, id);
      if (!row) throw new NotFoundError("vendor");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateVendor): Promise<Vendor> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return vendorsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateVendor
  ): Promise<Vendor> {
    return withRequest(req, this.pool, async (client) => {
      const result = await vendorsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("vendor");
      if (result === "version_conflict") {
        throw new ConflictError("vendor was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await vendorsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("vendor");
    });
  }
}
