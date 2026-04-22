/**
 * BOMs service. Orchestrates header + line CRUD and the activate() workflow.
 *
 * activate() is the interesting case: promoting BOM X to ACTIVE must (1) set
 * any prior ACTIVE for the same product to SUPERSEDED and (2) flip the
 * denormalised `products.active_bom_id` pointer — all in the same request
 * transaction so a readers of either side sees a consistent snapshot.
 *
 * The DB-level partial unique index `bom_versions_one_active_per_product`
 * will throw `23505 unique_violation` if two concurrent writers try to
 * promote different BOMs to ACTIVE on the same product — we catch that
 * and map to ConflictError.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  ActivateBom,
  BomLine,
  BomListQuerySchema,
  BomVersion,
  BomVersionWithLines,
  CreateBomLine,
  CreateBomVersion,
  UpdateBomLine,
  UpdateBomVersion,
} from "@instigenie/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { bomsRepo } from "./boms.repository.js";
import { productsRepo } from "./products.repository.js";
import { requireUser } from "../../context/request-context.js";

type BomListQuery = z.infer<typeof BomListQuerySchema>;

const BOM_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  versionLabel: "version_label",
  status: "status",
  totalStdCost: "total_std_cost",
  effectiveFrom: "effective_from",
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export class BomsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: BomListQuery
  ): Promise<ReturnType<typeof paginated<BomVersion>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, BOM_SORTS, "createdAt");
      const { data, total } = await bomsRepo.list(
        client,
        {
          productId: query.productId,
          status: query.status,
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
  ): Promise<BomVersionWithLines> {
    return withRequest(req, this.pool, async (client) => {
      const header = await bomsRepo.getById(client, id);
      if (!header) throw new NotFoundError("bom");
      const lines = await bomsRepo.listLines(client, id);
      return { ...header, lines };
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateBomVersion
  ): Promise<BomVersionWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // Ensure target product exists + in-scope.
      const product = await productsRepo.getById(client, input.productId);
      if (!product) throw new NotFoundError("product");

      // Duplicate label?
      const dup = await bomsRepo.getByProductAndLabel(
        client,
        input.productId,
        input.versionLabel
      );
      if (dup) {
        throw new ConflictError(
          `bom version "${input.versionLabel}" already exists on this product`
        );
      }

      const header = await bomsRepo.createHeader(client, user.orgId, user.id, {
        productId: input.productId,
        versionLabel: input.versionLabel,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        ecnRef: input.ecnRef,
        notes: input.notes,
      });
      const lines: BomLine[] = [];
      let lineNo = 1;
      for (const line of input.lines ?? []) {
        const created = await bomsRepo.addLine(client, user.orgId, header.id, {
          ...line,
          lineNo: line.lineNo ?? lineNo++,
        });
        lines.push(created);
      }
      if ((input.lines ?? []).length > 0) {
        await bomsRepo.recomputeTotals(client, header.id);
      }
      const fresh = await bomsRepo.getById(client, header.id);
      return { ...(fresh ?? header), lines };
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateBomVersion
  ): Promise<BomVersion> {
    return withRequest(req, this.pool, async (client) => {
      const result = await bomsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("bom");
      if (result === "version_conflict") {
        throw new ConflictError("bom was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await bomsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("bom");
      if (cur.status === "ACTIVE") {
        throw new ConflictError(
          "cannot soft-delete an ACTIVE bom; supersede it first"
        );
      }
      const ok = await bomsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("bom");
    });
  }

  /**
   * Promote a DRAFT BOM to ACTIVE. Atomic against:
   *   1. prior ACTIVE for the same product → SUPERSEDED
   *   2. products.active_bom_id → this BOM
   *   3. expectedVersion mismatch
   */
  async activate(
    req: FastifyRequest,
    id: string,
    input: ActivateBom
  ): Promise<BomVersionWithLines> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await bomsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("bom");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("bom was modified by someone else");
      }
      if (cur.status === "ACTIVE") {
        // Already active — no-op, return the current snapshot.
        const lines = await bomsRepo.listLines(client, id);
        return { ...cur, lines };
      }
      if (cur.status !== "DRAFT") {
        throw new ConflictError(
          `cannot activate bom in status ${cur.status}; must be DRAFT`
        );
      }

      // 1. Supersede the prior ACTIVE for this product, if any.
      const prior = await bomsRepo.getActiveForProduct(client, cur.productId);
      if (prior && prior.id !== id) {
        await bomsRepo.setStatus(client, prior.id, "SUPERSEDED");
      }

      // 2. Flip status + recompute totals.
      try {
        await bomsRepo.setStatus(client, id, "ACTIVE", user.id);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            "another ACTIVE bom already exists for this product"
          );
        }
        throw err;
      }
      if (input.effectiveFrom) {
        await bomsRepo.updateWithVersion(client, id, {
          effectiveFrom: input.effectiveFrom,
          expectedVersion: cur.version + 1,
        });
      }
      await bomsRepo.recomputeTotals(client, id);

      // 3. Flip denormalised product pointer.
      await productsRepo.setActiveBomId(client, cur.productId, id);

      const fresh = await bomsRepo.getById(client, id);
      const lines = await bomsRepo.listLines(client, id);
      return { ...(fresh ?? cur), lines };
    });
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  async listLines(req: FastifyRequest, bomId: string): Promise<BomLine[]> {
    return withRequest(req, this.pool, async (client) => {
      const header = await bomsRepo.getById(client, bomId);
      if (!header) throw new NotFoundError("bom");
      return bomsRepo.listLines(client, bomId);
    });
  }

  async addLine(
    req: FastifyRequest,
    bomId: string,
    input: CreateBomLine
  ): Promise<BomLine> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const header = await bomsRepo.getById(client, bomId);
      if (!header) throw new NotFoundError("bom");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot add lines to bom in status ${header.status}; must be DRAFT`
        );
      }
      const line = await bomsRepo.addLine(client, user.orgId, bomId, input);
      await bomsRepo.recomputeTotals(client, bomId);
      await bomsRepo.touchHeader(client, bomId);
      return line;
    });
  }

  async updateLine(
    req: FastifyRequest,
    bomId: string,
    lineId: string,
    input: UpdateBomLine
  ): Promise<BomLine> {
    return withRequest(req, this.pool, async (client) => {
      const header = await bomsRepo.getById(client, bomId);
      if (!header) throw new NotFoundError("bom");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot edit lines on bom in status ${header.status}; must be DRAFT`
        );
      }
      const line = await bomsRepo.getLineById(client, lineId);
      if (!line || line.bomId !== bomId) {
        throw new NotFoundError("bom line");
      }
      const updated = await bomsRepo.updateLine(client, lineId, input);
      if (!updated) throw new NotFoundError("bom line");
      await bomsRepo.recomputeTotals(client, bomId);
      await bomsRepo.touchHeader(client, bomId);
      return updated;
    });
  }

  async deleteLine(
    req: FastifyRequest,
    bomId: string,
    lineId: string
  ): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const header = await bomsRepo.getById(client, bomId);
      if (!header) throw new NotFoundError("bom");
      if (header.status !== "DRAFT") {
        throw new ConflictError(
          `cannot delete lines from bom in status ${header.status}; must be DRAFT`
        );
      }
      const line = await bomsRepo.getLineById(client, lineId);
      if (!line || line.bomId !== bomId) {
        throw new NotFoundError("bom line");
      }
      const ok = await bomsRepo.deleteLine(client, lineId);
      if (!ok) throw new NotFoundError("bom line");
      await bomsRepo.recomputeTotals(client, bomId);
      await bomsRepo.touchHeader(client, bomId);
    });
  }
}
