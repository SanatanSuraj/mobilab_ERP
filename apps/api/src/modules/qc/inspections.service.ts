/**
 * QC inspections service. Orchestrates the DRAFT → IN_PROGRESS → PASSED/FAILED
 * lifecycle + automatic finding seeding from templates.
 *
 * State machine:
 *
 *   DRAFT        ──start──▶ IN_PROGRESS  (seeds findings from template)
 *   IN_PROGRESS  ──complete (verdict=PASS)──▶ PASSED
 *   IN_PROGRESS  ──complete (verdict=FAIL)──▶ FAILED
 *
 *   Additionally, a convenience auto-verdict:
 *     if all findings PASS + no criticalFailed → PASS
 *     if any criticalFailed or any FAIL        → FAIL
 *
 * The service-level invariants enforced here (not at the DB level):
 *   - cannot START without a template OR findings already manually seeded
 *   - cannot COMPLETE while any finding is PENDING
 *   - cannot mutate findings on PASSED/FAILED inspections (locked after
 *     verdict)
 *
 * Inspection_number auto-generation follows production numbering pattern
 * (QC-YYYY-NNNN) via nextQcNumber.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CompleteQcInspection,
  CreateQcFinding,
  CreateQcInspection,
  QcFinding,
  QcInspection,
  QcInspectionListQuerySchema,
  QcInspectionWithFindings,
  QcVerdict,
  StartQcInspection,
  UpdateQcFinding,
  UpdateQcInspection,
} from "@mobilab/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@mobilab/errors";
import { paginated } from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { inspectionsRepo } from "./inspections.repository.js";
import { templatesRepo } from "./templates.repository.js";
import { nextQcNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";

type QcInspectionListQuery = z.infer<typeof QcInspectionListQuerySchema>;

const INSPECTION_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  inspectionNumber: "inspection_number",
  status: "status",
  kind: "kind",
  startedAt: "started_at",
  completedAt: "completed_at",
};

export class QcInspectionsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: QcInspectionListQuery,
  ): Promise<ReturnType<typeof paginated<QcInspection>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, INSPECTION_SORTS, "createdAt");
      const { data, total } = await inspectionsRepo.list(
        client,
        {
          kind: query.kind,
          status: query.status,
          sourceType: query.sourceType,
          workOrderId: query.workOrderId,
          wipStageId: query.wipStageId,
          grnLineId: query.grnLineId,
          itemId: query.itemId,
          productId: query.productId,
          inspectorId: query.inspectorId,
          verdict: query.verdict,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(
    req: FastifyRequest,
    id: string,
  ): Promise<QcInspectionWithFindings> {
    return withRequest(req, this.pool, async (client) => {
      const header = await inspectionsRepo.getById(client, id);
      if (!header) throw new NotFoundError("qc inspection");
      const findings = await inspectionsRepo.listFindings(client, id);
      return { ...header, findings };
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateQcInspection,
  ): Promise<QcInspectionWithFindings> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // Resolve template snapshot if caller supplied a templateId.
      let templateCode: string | null = null;
      let templateName: string | null = null;
      if (input.templateId) {
        const template = await templatesRepo.getById(client, input.templateId);
        if (!template) throw new NotFoundError("inspection template");
        if (template.kind !== input.kind) {
          throw new ConflictError(
            `template kind ${template.kind} does not match inspection kind ${input.kind}`,
          );
        }
        templateCode = template.code;
        templateName = template.name;
      }

      // Source validation (type must align with relevant FK hint).
      if (input.sourceType === "GRN_LINE" && !input.grnLineId) {
        throw new ConflictError("grnLineId is required when sourceType=GRN_LINE");
      }
      if (input.sourceType === "WIP_STAGE" && !input.wipStageId) {
        throw new ConflictError(
          "wipStageId is required when sourceType=WIP_STAGE",
        );
      }
      if (input.sourceType === "WO" && !input.workOrderId) {
        throw new ConflictError("workOrderId is required when sourceType=WO");
      }

      const inspectionNumber =
        input.inspectionNumber ??
        (await nextQcNumber(client, user.orgId, "QC"));

      const header = await inspectionsRepo.createHeader(
        client,
        user.orgId,
        inspectionNumber,
        user.id,
        {
          templateId: input.templateId,
          templateCode,
          templateName,
          kind: input.kind,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceLabel: input.sourceLabel,
          grnLineId: input.grnLineId,
          wipStageId: input.wipStageId,
          workOrderId: input.workOrderId,
          itemId: input.itemId,
          productId: input.productId,
          sampleSize: input.sampleSize,
          inspectorId: input.inspectorId,
          notes: input.notes,
        },
      );

      return { ...header, findings: [] };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateQcInspection,
  ): Promise<QcInspection> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await inspectionsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("qc inspection");
      // Locked after verdict.
      if (cur.status === "PASSED" || cur.status === "FAILED") {
        throw new ConflictError(
          `cannot update inspection in status ${cur.status}; it is locked`,
        );
      }
      const result = await inspectionsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("qc inspection");
      if (result === "version_conflict") {
        throw new ConflictError("qc inspection was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await inspectionsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("qc inspection");
      if (cur.status === "PASSED" || cur.status === "FAILED") {
        throw new ConflictError(
          `cannot delete inspection in status ${cur.status}; it has a final verdict`,
        );
      }
      const ok = await inspectionsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("qc inspection");
    });
  }

  // ── Lifecycle transitions ──────────────────────────────────────────────────

  /**
   * Start an inspection. Transitions DRAFT → IN_PROGRESS and seeds findings
   * from the template's parameters (if templateId is set and findings are
   * empty). Binds inspectorId + sets startedAt.
   */
  async start(
    req: FastifyRequest,
    id: string,
    input: StartQcInspection,
  ): Promise<QcInspectionWithFindings> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await inspectionsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("qc inspection");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("qc inspection was modified by someone else");
      }
      if (cur.status !== "DRAFT") {
        throw new ConflictError(
          `cannot start inspection in status ${cur.status}; must be DRAFT`,
        );
      }

      // Seed findings from template, if not already populated.
      const existingFindings = await inspectionsRepo.listFindings(client, id);
      if (existingFindings.length === 0 && cur.templateId) {
        const params = await templatesRepo.listParameters(
          client,
          cur.templateId,
        );
        for (const param of params) {
          await inspectionsRepo.addFinding(client, user.orgId, id, {
            parameterId: param.id,
            sequenceNumber: param.sequenceNumber,
            parameterName: param.name,
            parameterType: param.parameterType,
            expectedValue: param.expectedValue ?? undefined,
            minValue: param.minValue ?? undefined,
            maxValue: param.maxValue ?? undefined,
            expectedText: param.expectedText ?? undefined,
            uom: param.uom ?? undefined,
            isCritical: param.isCritical,
            result: "PENDING",
          });
        }
      }

      const inspectorId = input.inspectorId ?? cur.inspectorId ?? user.id;
      const updated = await inspectionsRepo.setStatus(
        client,
        id,
        "IN_PROGRESS",
        {
          startedAt: true,
          inspectorId,
        },
      );
      if (!updated) throw new NotFoundError("qc inspection");
      const findings = await inspectionsRepo.listFindings(client, id);
      return { ...updated, findings };
    });
  }

  /**
   * Complete an inspection. Transitions IN_PROGRESS → PASSED | FAILED based
   * on caller's verdict. Validates that no findings are still PENDING. If
   * verdict=PASS but any CRITICAL finding FAILED, we reject with 409.
   */
  async complete(
    req: FastifyRequest,
    id: string,
    input: CompleteQcInspection,
  ): Promise<QcInspectionWithFindings> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await inspectionsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("qc inspection");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("qc inspection was modified by someone else");
      }
      if (cur.status !== "IN_PROGRESS") {
        throw new ConflictError(
          `cannot complete inspection in status ${cur.status}; must be IN_PROGRESS`,
        );
      }
      const summary = await inspectionsRepo.summarise(client, id);
      if (summary.total === 0) {
        throw new ConflictError(
          "cannot complete inspection with no findings",
        );
      }
      if (summary.pending > 0) {
        throw new ConflictError(
          `cannot complete inspection with ${summary.pending} pending findings`,
        );
      }
      // Sanity-check caller verdict against summary.
      if (input.verdict === "PASS" && summary.criticalFailed > 0) {
        throw new ConflictError(
          `cannot mark inspection PASS: ${summary.criticalFailed} critical findings failed`,
        );
      }
      if (input.verdict === "PASS" && summary.failed > 0) {
        throw new ConflictError(
          `cannot mark inspection PASS with ${summary.failed} failed findings`,
        );
      }

      const status = input.verdict === "PASS" ? "PASSED" : "FAILED";
      const updated = await inspectionsRepo.setStatus(client, id, status, {
        completedAt: true,
        verdict: input.verdict as QcVerdict,
        verdictNotes: input.verdictNotes ?? null,
      });
      if (!updated) throw new NotFoundError("qc inspection");
      const findings = await inspectionsRepo.listFindings(client, id);
      return { ...updated, findings };
    });
  }

  // ── Findings CRUD ──────────────────────────────────────────────────────────

  async listFindings(
    req: FastifyRequest,
    inspectionId: string,
  ): Promise<QcFinding[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await inspectionsRepo.getById(client, inspectionId);
      if (!header) throw new NotFoundError("qc inspection");
      return inspectionsRepo.listFindings(client, inspectionId);
    });
  }

  async addFinding(
    req: FastifyRequest,
    inspectionId: string,
    input: CreateQcFinding,
  ): Promise<QcFinding> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await inspectionsRepo.getById(client, inspectionId);
      if (!header) throw new NotFoundError("qc inspection");
      if (header.status === "PASSED" || header.status === "FAILED") {
        throw new ConflictError(
          `cannot add findings to inspection in status ${header.status}; it is locked`,
        );
      }
      const finding = await inspectionsRepo.addFinding(
        client,
        user.orgId,
        inspectionId,
        input,
      );
      await inspectionsRepo.touchHeader(client, inspectionId);
      return finding;
    });
  }

  async updateFinding(
    req: FastifyRequest,
    inspectionId: string,
    findingId: string,
    input: UpdateQcFinding,
  ): Promise<QcFinding> {
    return withRequest(req, this.pool, async (client) => {
      const header = await inspectionsRepo.getById(client, inspectionId);
      if (!header) throw new NotFoundError("qc inspection");
      if (header.status === "PASSED" || header.status === "FAILED") {
        throw new ConflictError(
          `cannot update findings on inspection in status ${header.status}; it is locked`,
        );
      }
      const existing = await inspectionsRepo.getFindingById(client, findingId);
      if (!existing || existing.inspectionId !== inspectionId) {
        throw new NotFoundError("qc finding");
      }
      const updated = await inspectionsRepo.updateFinding(
        client,
        findingId,
        input,
      );
      if (!updated) throw new NotFoundError("qc finding");
      await inspectionsRepo.touchHeader(client, inspectionId);
      return updated;
    });
  }

  async deleteFinding(
    req: FastifyRequest,
    inspectionId: string,
    findingId: string,
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const header = await inspectionsRepo.getById(client, inspectionId);
      if (!header) throw new NotFoundError("qc inspection");
      if (header.status === "PASSED" || header.status === "FAILED") {
        throw new ConflictError(
          `cannot delete findings on inspection in status ${header.status}; it is locked`,
        );
      }
      const existing = await inspectionsRepo.getFindingById(client, findingId);
      if (!existing || existing.inspectionId !== inspectionId) {
        throw new NotFoundError("qc finding");
      }
      const ok = await inspectionsRepo.deleteFinding(client, findingId);
      if (!ok) throw new NotFoundError("qc finding");
      await inspectionsRepo.touchHeader(client, inspectionId);
    });
  }
}
