/**
 * Device instances service (Phase 5 Mobicase slice).
 * Read-only orchestrator — writes arrive when the Mobicase WO lifecycle lands.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  DeviceInstance,
  DeviceInstanceListQuerySchema,
} from "@instigenie/contracts";
import { z } from "zod";
import { NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { deviceInstancesRepo } from "./device-instances.repository.js";

type DeviceInstanceListQuery = z.infer<typeof DeviceInstanceListQuerySchema>;

const DEVICE_INSTANCE_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  deviceCode: "device_code",
  productCode: "product_code",
  status: "status",
  workOrderRef: "work_order_ref",
  assignedLine: "assigned_line",
};

export class DeviceInstancesService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: DeviceInstanceListQuery
  ): Promise<ReturnType<typeof paginated<DeviceInstance>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(
        query,
        DEVICE_INSTANCE_SORTS,
        "createdAt"
      );
      const { data, total } = await deviceInstancesRepo.list(
        client,
        {
          productCode: query.productCode,
          status: query.status,
          workOrderRef: query.workOrderRef,
          assignedLine: query.assignedLine,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<DeviceInstance> {
    return withRequest(req, this.pool, async (client) => {
      const row = await deviceInstancesRepo.getById(client, id);
      if (!row) throw new NotFoundError("device_instance");
      return row;
    });
  }
}
