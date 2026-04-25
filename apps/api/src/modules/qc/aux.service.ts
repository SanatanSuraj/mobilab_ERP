/**
 * QC auxiliary services — qc_equipment + qc_capa_actions.
 *
 * Read-only Phase-5 surfaces. Mirrors the device-instances service pattern:
 * `withRequest` for the RLS-scoped client, `planPagination` for sort/limit,
 * and `paginated()` for the response envelope.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  QcEquipment,
  QcEquipmentListQuerySchema,
  QcCapaAction,
  QcCapaActionListQuerySchema,
} from "@instigenie/contracts";
import { z } from "zod";
import { NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { qcEquipmentRepo, qcCapaRepo } from "./aux.repository.js";

type QcEquipmentListQuery = z.infer<typeof QcEquipmentListQuerySchema>;
type QcCapaActionListQuery = z.infer<typeof QcCapaActionListQuerySchema>;

const QC_EQUIPMENT_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  assetCode: "asset_code",
  name: "name",
  status: "status",
  nextDueAt: "next_due_at",
};

const QC_CAPA_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  capaNumber: "capa_number",
  severity: "severity",
  status: "status",
  dueDate: "due_date",
};

export class QcEquipmentService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: QcEquipmentListQuery,
  ): Promise<ReturnType<typeof paginated<QcEquipment>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, QC_EQUIPMENT_SORTS, "createdAt");
      const { data, total } = await qcEquipmentRepo.list(
        client,
        {
          category: query.category,
          status: query.status,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<QcEquipment> {
    return withRequest(req, this.pool, async (client) => {
      const row = await qcEquipmentRepo.getById(client, id);
      if (!row) throw new NotFoundError("qc_equipment");
      return row;
    });
  }
}

export class QcCapaService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: QcCapaActionListQuery,
  ): Promise<ReturnType<typeof paginated<QcCapaAction>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, QC_CAPA_SORTS, "createdAt");
      const { data, total } = await qcCapaRepo.list(
        client,
        {
          status: query.status,
          severity: query.severity,
          sourceType: query.sourceType,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<QcCapaAction> {
    return withRequest(req, this.pool, async (client) => {
      const row = await qcCapaRepo.getById(client, id);
      if (!row) throw new NotFoundError("qc_capa_action");
      return row;
    });
  }
}
