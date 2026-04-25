/**
 * E-way bills service (Phase 5).
 * Read-only orchestrator. Same shape as DeviceInstancesService.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type { EwayBill, EwayBillListQuerySchema } from "@instigenie/contracts";
import { z } from "zod";
import { NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { ewayBillsRepo } from "./eway-bills.repository.js";

type EwayBillListQuery = z.infer<typeof EwayBillListQuerySchema>;

const EWB_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  generatedAt: "generated_at",
  ewbNumber: "ewb_number",
  invoiceNumber: "invoice_number",
  status: "status",
  invoiceValue: "invoice_value",
};

export class EwayBillsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: EwayBillListQuery,
  ): Promise<ReturnType<typeof paginated<EwayBill>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, EWB_SORTS, "generatedAt");
      const { data, total } = await ewayBillsRepo.list(
        client,
        {
          status: query.status,
          transportMode: query.transportMode,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<EwayBill> {
    return withRequest(req, this.pool, async (client) => {
      const row = await ewayBillsRepo.getById(client, id);
      if (!row) throw new NotFoundError("eway_bill");
      return row;
    });
  }
}
