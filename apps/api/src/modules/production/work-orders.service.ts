/**
 * Work orders service. Orchestrates WO lifecycle + WIP-stage transitions.
 *
 * create() copies the relevant wip_stage_templates into per-WO wip_stages rows
 * so subsequent template edits don't mutate in-flight WOs. Optionally auto-
 * generates PID-YYYY-NNNN + device serials when has_serial_tracking is on.
 *
 * advanceStage() is the state-machine workhorse:
 *
 *   PENDING   ──START──▶ IN_PROGRESS
 *   IN_PROG   ──COMPLETE (no QC req)──▶ COMPLETED          → next stage → IN_PROGRESS
 *   IN_PROG   ──COMPLETE (QC req)──▶ QC_HOLD
 *   QC_HOLD   ──QC_PASS──▶ COMPLETED                        → next stage → IN_PROGRESS
 *   QC_HOLD   ──QC_FAIL──▶ REWORK (++rework_count)
 *   REWORK    ──REWORK_DONE──▶ IN_PROGRESS                  (loops back for another QC attempt)
 *
 * When the *final* stage transitions to COMPLETED the WO itself flips to
 * COMPLETED; likewise IN_PROGRESS/QC_HOLD/REWORK on any stage bubbles up
 * to the WO header so the kanban shows the correct colour.
 */

import type pg from "pg";
import type { PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import type {
  AdvanceWipStage,
  CreateWorkOrder,
  UpdateWorkOrder,
  WipStage,
  WipStageTemplate,
  WorkOrder,
  WorkOrderListQuerySchema,
  WorkOrderWithStages,
} from "@mobilab/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@mobilab/errors";
import { paginated } from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { workOrdersRepo } from "./work-orders.repository.js";
import { bomsRepo } from "./boms.repository.js";
import { productsRepo } from "./products.repository.js";
import { nextProductionNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";

type WorkOrderListQuery = z.infer<typeof WorkOrderListQuerySchema>;

const WO_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  pid: "pid",
  status: "status",
  priority: "priority",
  targetDate: "target_date",
  startedAt: "started_at",
  completedAt: "completed_at",
};

function generateDeviceSerials(
  productCode: string,
  quantity: number,
  year: number = new Date().getUTCFullYear()
): string[] {
  const result: string[] = [];
  for (let i = 1; i <= quantity; i++) {
    result.push(`${productCode}-${year}-${String(i).padStart(4, "0")}`);
  }
  return result;
}

export class WorkOrdersService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: WorkOrderListQuery
  ): Promise<ReturnType<typeof paginated<WorkOrder>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, WO_SORTS, "createdAt");
      const { data, total } = await workOrdersRepo.list(
        client,
        {
          status: query.status,
          priority: query.priority,
          productId: query.productId,
          assignedTo: query.assignedTo,
          dealId: query.dealId,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(
    req: FastifyRequest,
    id: string
  ): Promise<WorkOrderWithStages> {
    return withRequest(req, this.pool, async (client) => {
      const header = await workOrdersRepo.getById(client, id);
      if (!header) throw new NotFoundError("work order");
      const stages = await workOrdersRepo.listStages(client, id);
      return { ...header, stages };
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateWorkOrder
  ): Promise<WorkOrderWithStages> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // Ensure product exists.
      const product = await productsRepo.getById(client, input.productId);
      if (!product) throw new NotFoundError("product");
      if (!product.isActive) {
        throw new ConflictError(
          `cannot create work order for inactive product ${product.productCode}`
        );
      }

      // Resolve BOM — either the caller's explicit bomId or product.activeBomId.
      const bomId = input.bomId ?? product.activeBomId;
      if (!bomId) {
        throw new ConflictError(
          `product ${product.productCode} has no ACTIVE bom; cannot create work order`
        );
      }
      const bom = await bomsRepo.getById(client, bomId);
      if (!bom) throw new NotFoundError("bom");
      if (bom.productId !== input.productId) {
        throw new ConflictError(
          "bom does not belong to this product"
        );
      }
      if (bom.status !== "ACTIVE" && bom.status !== "DRAFT") {
        throw new ConflictError(
          `cannot create work order against bom in status ${bom.status}`
        );
      }

      const pid =
        input.pid ?? (await nextProductionNumber(client, user.orgId, "WO"));

      // Device serials — generated upfront for serialised products unless the
      // caller provided explicit IDs. We intentionally do NOT enforce uniqueness
      // on the text[] column; Phase 3 moves this to a dedicated table with a
      // proper unique index.
      let deviceSerials: string[] = input.deviceSerials ?? [];
      if (
        deviceSerials.length === 0 &&
        product.hasSerialTracking &&
        Number(input.quantity) > 0
      ) {
        deviceSerials = generateDeviceSerials(
          product.productCode,
          Math.round(Number(input.quantity))
        );
      }
      if (
        input.deviceSerials !== undefined &&
        product.hasSerialTracking &&
        input.deviceSerials.length > 0 &&
        input.deviceSerials.length !== Math.round(Number(input.quantity))
      ) {
        throw new ConflictError(
          `deviceSerials length (${input.deviceSerials.length}) must equal quantity (${Math.round(Number(input.quantity))})`
        );
      }

      const header = await workOrdersRepo.createHeader(
        client,
        user.orgId,
        pid,
        user.id,
        product.id,
        bom.id,
        bom.versionLabel,
        {
          quantity: input.quantity,
          priority: input.priority ?? "NORMAL",
          targetDate: input.targetDate,
          dealId: input.dealId,
          assignedTo: input.assignedTo,
          lotNumber: input.lotNumber,
          deviceSerials,
          notes: input.notes,
        }
      );

      // Copy wip_stage_templates for this product family into wip_stages.
      const templates = await workOrdersRepo.listTemplates(
        client,
        product.family
      );
      const stages: WipStage[] = [];
      for (const template of templates) {
        const stage = await workOrdersRepo.createStage(
          client,
          user.orgId,
          header.id,
          template,
          "PENDING"
        );
        stages.push(stage);
      }
      if (stages.length === 0) {
        throw new ConflictError(
          `no wip_stage_templates configured for product family ${product.family}`
        );
      }

      const fresh = await workOrdersRepo.getById(client, header.id);
      return { ...(fresh ?? header), stages };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateWorkOrder
  ): Promise<WorkOrder> {
    return withRequest(req, this.pool, async (client) => {
      const result = await workOrdersRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("work order");
      if (result === "version_conflict") {
        throw new ConflictError("work order was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await workOrdersRepo.getById(client, id);
      if (!cur) throw new NotFoundError("work order");
      if (cur.status === "IN_PROGRESS" || cur.status === "QC_HOLD") {
        throw new ConflictError(
          `cannot delete work order in ${cur.status}; cancel it first`
        );
      }
      const ok = await workOrdersRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("work order");
    });
  }

  // ── Stages ─────────────────────────────────────────────────────────────────

  async listStages(req: FastifyRequest, woId: string): Promise<WipStage[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await workOrdersRepo.getById(client, woId);
      if (!header) throw new NotFoundError("work order");
      return workOrdersRepo.listStages(client, woId);
    });
  }

  /**
   * State-machine for WIP stages. See the header comment for the diagram.
   */
  async advanceStage(
    req: FastifyRequest,
    woId: string,
    stageId: string,
    input: AdvanceWipStage
  ): Promise<WorkOrderWithStages> {
    return withRequest(req, this.pool, async (client) => {
      const header = await workOrdersRepo.getById(client, woId);
      if (!header) throw new NotFoundError("work order");
      if (header.status === "COMPLETED" || header.status === "CANCELLED") {
        throw new ConflictError(
          `cannot advance stages on a ${header.status} work order`
        );
      }
      const stage = await workOrdersRepo.getStageById(client, stageId);
      if (!stage || stage.woId !== woId) {
        throw new NotFoundError("wip stage");
      }

      const allStages = await workOrdersRepo.listStages(client, woId);
      const idx = allStages.findIndex((s) => s.id === stageId);

      const commonUpdate = {
        assignedTo: input.assignedTo,
        notes: input.notes,
      };

      switch (input.action) {
        case "START": {
          if (stage.status !== "PENDING") {
            throw new ConflictError(
              `cannot START stage in status ${stage.status}; must be PENDING`
            );
          }
          // Enforce sequential ordering — only the next-pending stage may start.
          const firstPending = allStages.findIndex((s) => s.status === "PENDING");
          if (firstPending !== idx) {
            throw new ConflictError(
              "earlier stages must be completed before starting this one"
            );
          }
          await workOrdersRepo.updateStageFields(client, stageId, {
            status: "IN_PROGRESS",
            startedAt: "now",
            ...commonUpdate,
          });
          if (header.status === "PLANNED" || header.status === "MATERIAL_CHECK") {
            await workOrdersRepo.setStatus(client, woId, "IN_PROGRESS", {
              startedAt: true,
            });
          } else {
            await workOrdersRepo.setStatus(client, woId, "IN_PROGRESS");
          }
          await workOrdersRepo.setCurrentStageIndex(client, woId, idx);
          break;
        }
        case "COMPLETE": {
          if (stage.status !== "IN_PROGRESS" && stage.status !== "REWORK") {
            throw new ConflictError(
              `cannot COMPLETE stage in status ${stage.status}; must be IN_PROGRESS or REWORK`
            );
          }
          if (stage.requiresQcSignoff) {
            await workOrdersRepo.updateStageFields(client, stageId, {
              status: "QC_HOLD",
              ...commonUpdate,
            });
            await workOrdersRepo.setStatus(client, woId, "QC_HOLD");
          } else {
            await workOrdersRepo.updateStageFields(client, stageId, {
              status: "COMPLETED",
              completedAt: "now",
              qcResult: null,
              ...commonUpdate,
            });
            await this.maybeAdvanceToNextStage(client, woId, allStages, idx);
          }
          break;
        }
        case "QC_PASS": {
          if (stage.status !== "QC_HOLD") {
            throw new ConflictError(
              `cannot QC_PASS stage in status ${stage.status}; must be QC_HOLD`
            );
          }
          await workOrdersRepo.updateStageFields(client, stageId, {
            status: "COMPLETED",
            completedAt: "now",
            qcResult: "PASS",
            qcNotes: input.qcNotes ?? stage.qcNotes,
            ...commonUpdate,
          });
          await this.maybeAdvanceToNextStage(client, woId, allStages, idx);
          break;
        }
        case "QC_FAIL": {
          if (stage.status !== "QC_HOLD") {
            throw new ConflictError(
              `cannot QC_FAIL stage in status ${stage.status}; must be QC_HOLD`
            );
          }
          await workOrdersRepo.updateStageFields(client, stageId, {
            status: "REWORK",
            qcResult: "FAIL",
            qcNotes: input.qcNotes ?? stage.qcNotes,
            reworkCount: stage.reworkCount + 1,
            ...commonUpdate,
          });
          await workOrdersRepo.incrementReworkCount(client, woId);
          await workOrdersRepo.setStatus(client, woId, "REWORK");
          break;
        }
        case "REWORK_DONE": {
          if (stage.status !== "REWORK") {
            throw new ConflictError(
              `cannot REWORK_DONE stage in status ${stage.status}; must be REWORK`
            );
          }
          await workOrdersRepo.updateStageFields(client, stageId, {
            status: "IN_PROGRESS",
            startedAt: "now",
            ...commonUpdate,
          });
          await workOrdersRepo.setStatus(client, woId, "IN_PROGRESS");
          break;
        }
      }

      const fresh = await workOrdersRepo.getById(client, woId);
      const freshStages = await workOrdersRepo.listStages(client, woId);
      return { ...(fresh ?? header), stages: freshStages };
    });
  }

  /**
   * After a stage completes, move the next PENDING stage to IN_PROGRESS
   * (if any), or flip the WO to COMPLETED if this was the last stage.
   */
  private async maybeAdvanceToNextStage(
    client: PoolClient,
    woId: string,
    allStages: WipStage[],
    completedIdx: number
  ): Promise<void> {
    const nextIdx = completedIdx + 1;
    if (nextIdx >= allStages.length) {
      // Last stage — WO is complete.
      await workOrdersRepo.setCurrentStageIndex(client, woId, completedIdx);
      await workOrdersRepo.setStatus(client, woId, "COMPLETED", {
        completedAt: true,
      });
      return;
    }
    const nextStage = allStages[nextIdx]!;
    if (nextStage.status === "PENDING") {
      await workOrdersRepo.updateStageFields(client, nextStage.id, {
        status: "IN_PROGRESS",
        startedAt: "now",
      });
    }
    await workOrdersRepo.setCurrentStageIndex(client, woId, nextIdx);
    await workOrdersRepo.setStatus(client, woId, "IN_PROGRESS");
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates(
    req: FastifyRequest,
    productFamily?: WipStageTemplate["productFamily"]
  ): Promise<WipStageTemplate[]> {
    return withRequest(req, this.pool, async (client) => {
      return workOrdersRepo.listTemplates(client, productFamily);
    });
  }
}
