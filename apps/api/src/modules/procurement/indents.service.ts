/**
 * Indents service. Orchestrates header + line CRUD, auto-generates
 * IND-YYYY-NNNN numbers, and keeps line mutations touching header.version.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateIndent,
  CreateIndentLine,
  Indent,
  IndentLine,
  IndentListQuerySchema,
  IndentWithLines,
  UpdateIndent,
  UpdateIndentLine,
} from "@mobilab/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@mobilab/errors";
import { paginated } from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { indentsRepo } from "./indents.repository.js";
import { nextProcurementNumber } from "./numbering.js";
import { requireUser } from "../../context/request-context.js";

type IndentListQuery = z.infer<typeof IndentListQuerySchema>;

const INDENT_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  indentNumber: "indent_number",
  status: "status",
  priority: "priority",
  requiredBy: "required_by",
};

export class IndentsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: IndentListQuery
  ): Promise<ReturnType<typeof paginated<Indent>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, INDENT_SORTS, "createdAt");
      const { data, total } = await indentsRepo.list(
        client,
        {
          status: query.status,
          priority: query.priority,
          department: query.department,
          requestedBy: query.requestedBy,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<IndentWithLines> {
    return withRequest(req, this.pool, async (client) => {
      const header = await indentsRepo.getById(client, id);
      if (!header) throw new NotFoundError("indent");
      const lines = await indentsRepo.listLines(client, id);
      return { ...header, lines };
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateIndent
  ): Promise<IndentWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const indentNumber =
        input.indentNumber ?? (await nextProcurementNumber(client, user.orgId, "INDENT"));
      const requestedBy = input.requestedBy ?? user.id;
      const header = await indentsRepo.createHeader(
        client,
        user.orgId,
        indentNumber,
        requestedBy,
        input
      );
      const lines: IndentLine[] = [];
      let lineNo = 1;
      for (const line of input.lines ?? []) {
        const created = await indentsRepo.addLine(
          client,
          user.orgId,
          header.id,
          { ...line, lineNo: line.lineNo ?? lineNo++ }
        );
        lines.push(created);
      }
      return { ...header, lines };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateIndent
  ): Promise<Indent> {
    return withRequest(req, this.pool, async (client) => {
      const result = await indentsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("indent");
      if (result === "version_conflict") {
        throw new ConflictError("indent was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await indentsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("indent");
    });
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(
    req: FastifyRequest,
    indentId: string
  ): Promise<IndentLine[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await indentsRepo.getById(client, indentId);
      if (!header) throw new NotFoundError("indent");
      return indentsRepo.listLines(client, indentId);
    });
  }

  async addLine(
    req: FastifyRequest,
    indentId: string,
    input: CreateIndentLine
  ): Promise<IndentLine> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await indentsRepo.getById(client, indentId);
      if (!header) throw new NotFoundError("indent");
      const line = await indentsRepo.addLine(
        client,
        user.orgId,
        indentId,
        input
      );
      await indentsRepo.touchHeader(client, indentId);
      return line;
    });
  }

  async updateLine(
    req: FastifyRequest,
    indentId: string,
    lineId: string,
    input: UpdateIndentLine
  ): Promise<IndentLine> {
    return withRequest(req, this.pool, async (client) => {
      const line = await indentsRepo.getLineById(client, lineId);
      if (!line || line.indentId !== indentId) {
        throw new NotFoundError("indent line");
      }
      const updated = await indentsRepo.updateLine(client, lineId, input);
      if (!updated) throw new NotFoundError("indent line");
      await indentsRepo.touchHeader(client, indentId);
      return updated;
    });
  }

  async deleteLine(
    req: FastifyRequest,
    indentId: string,
    lineId: string
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const line = await indentsRepo.getLineById(client, lineId);
      if (!line || line.indentId !== indentId) {
        throw new NotFoundError("indent line");
      }
      const ok = await indentsRepo.deleteLine(client, lineId);
      if (!ok) throw new NotFoundError("indent line");
      await indentsRepo.touchHeader(client, indentId);
    });
  }
}
