/**
 * Inspection templates service. Orchestrates header + parameter CRUD.
 *
 * Templates are edit-only when `isActive = false` or still DRAFT in the
 * admin UI sense. Phase 2 does not enforce a formal state machine — admins
 * can freely edit templates. Phase 3 adds approval workflow.
 *
 * Parameter CRUD bumps the header's version via touchHeader() + the
 * tg_bump_version trigger on the header UPDATE.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateInspectionParameter,
  CreateInspectionTemplate,
  InspectionParameter,
  InspectionTemplate,
  InspectionTemplateListQuerySchema,
  InspectionTemplateWithParameters,
  UpdateInspectionParameter,
  UpdateInspectionTemplate,
} from "@instigenie/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { templatesRepo } from "./templates.repository.js";
import { requireUser } from "../../context/request-context.js";

type InspectionTemplateListQuery = z.infer<
  typeof InspectionTemplateListQuerySchema
>;

const TEMPLATE_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  code: "code",
  name: "name",
  kind: "kind",
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export class InspectionTemplatesService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: InspectionTemplateListQuery,
  ): Promise<ReturnType<typeof paginated<InspectionTemplate>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, TEMPLATE_SORTS, "createdAt");
      const { data, total } = await templatesRepo.list(
        client,
        {
          kind: query.kind,
          productFamily: query.productFamily,
          itemId: query.itemId,
          productId: query.productId,
          wipStageTemplateId: query.wipStageTemplateId,
          isActive: query.isActive,
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
  ): Promise<InspectionTemplateWithParameters> {
    return withRequest(req, this.pool, async (client) => {
      const header = await templatesRepo.getById(client, id);
      if (!header) throw new NotFoundError("inspection template");
      const parameters = await templatesRepo.listParameters(client, id);
      return { ...header, parameters };
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateInspectionTemplate,
  ): Promise<InspectionTemplateWithParameters> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // Duplicate code?
      const dup = await templatesRepo.getByCode(client, input.code);
      if (dup) {
        throw new ConflictError(
          `inspection template code "${input.code}" already exists`,
        );
      }

      let header: InspectionTemplate;
      try {
        header = await templatesRepo.createHeader(
          client,
          user.orgId,
          user.id,
          {
            code: input.code,
            name: input.name,
            kind: input.kind,
            productFamily: input.productFamily,
            wipStageTemplateId: input.wipStageTemplateId,
            itemId: input.itemId,
            productId: input.productId,
            description: input.description,
            samplingPlan: input.samplingPlan,
            isActive: input.isActive,
          },
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            `inspection template code "${input.code}" already exists`,
          );
        }
        throw err;
      }

      const parameters: InspectionParameter[] = [];
      let seq = 1;
      for (const param of input.parameters ?? []) {
        const created = await templatesRepo.addParameter(
          client,
          user.orgId,
          header.id,
          {
            ...param,
            sequenceNumber: param.sequenceNumber ?? seq++,
          },
        );
        parameters.push(created);
      }
      if ((input.parameters ?? []).length > 0) {
        await templatesRepo.touchHeader(client, header.id);
      }
      const fresh = await templatesRepo.getById(client, header.id);
      return { ...(fresh ?? header), parameters };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateInspectionTemplate,
  ): Promise<InspectionTemplate> {
    return withRequest(req, this.pool, async (client) => {
      try {
        const result = await templatesRepo.updateWithVersion(client, id, input);
        if (result === null) throw new NotFoundError("inspection template");
        if (result === "version_conflict") {
          throw new ConflictError(
            "inspection template was modified by someone else",
          );
        }
        return result;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            `inspection template code already exists`,
          );
        }
        throw err;
      }
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await templatesRepo.getById(client, id);
      if (!cur) throw new NotFoundError("inspection template");
      const ok = await templatesRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("inspection template");
    });
  }

  // ── Parameters ─────────────────────────────────────────────────────────────

  async listParameters(
    req: FastifyRequest,
    templateId: string,
  ): Promise<InspectionParameter[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await templatesRepo.getById(client, templateId);
      if (!header) throw new NotFoundError("inspection template");
      return templatesRepo.listParameters(client, templateId);
    });
  }

  async addParameter(
    req: FastifyRequest,
    templateId: string,
    input: CreateInspectionParameter,
  ): Promise<InspectionParameter> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await templatesRepo.getById(client, templateId);
      if (!header) throw new NotFoundError("inspection template");
      const param = await templatesRepo.addParameter(
        client,
        user.orgId,
        templateId,
        input,
      );
      await templatesRepo.touchHeader(client, templateId);
      return param;
    });
  }

  async updateParameter(
    req: FastifyRequest,
    templateId: string,
    parameterId: string,
    input: UpdateInspectionParameter,
  ): Promise<InspectionParameter> {
    return withRequest(req, this.pool, async (client) => {
      const header = await templatesRepo.getById(client, templateId);
      if (!header) throw new NotFoundError("inspection template");
      const existing = await templatesRepo.getParameterById(client, parameterId);
      if (!existing || existing.templateId !== templateId) {
        throw new NotFoundError("inspection parameter");
      }
      const updated = await templatesRepo.updateParameter(
        client,
        parameterId,
        input,
      );
      if (!updated) throw new NotFoundError("inspection parameter");
      await templatesRepo.touchHeader(client, templateId);
      return updated;
    });
  }

  async deleteParameter(
    req: FastifyRequest,
    templateId: string,
    parameterId: string,
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const header = await templatesRepo.getById(client, templateId);
      if (!header) throw new NotFoundError("inspection template");
      const existing = await templatesRepo.getParameterById(client, parameterId);
      if (!existing || existing.templateId !== templateId) {
        throw new NotFoundError("inspection parameter");
      }
      const ok = await templatesRepo.deleteParameter(client, parameterId);
      if (!ok) throw new NotFoundError("inspection parameter");
      await templatesRepo.touchHeader(client, templateId);
    });
  }
}
