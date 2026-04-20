/**
 * Deals service.
 *
 * Key behaviors:
 *   - create()             generates DEAL-YYYY-NNNN via repo (atomic UPSERT).
 *   - update()             optimistic-lock (expectedVersion). 409 on conflict.
 *   - transitionStage()    validates the stage graph (§13.1.3) then applies.
 *                          CLOSED_LOST requires a lostReason.
 *
 * Valid stage transitions:
 *   DISCOVERY   → PROPOSAL | CLOSED_LOST
 *   PROPOSAL    → NEGOTIATION | CLOSED_LOST | DISCOVERY
 *   NEGOTIATION → CLOSED_WON | CLOSED_LOST | PROPOSAL
 *   CLOSED_*    → (terminal)
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateDeal,
  Deal,
  DealListQuerySchema,
  DealStage,
  TransitionDealStage,
  UpdateDeal,
} from "@mobilab/contracts";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@mobilab/errors";
import { paginated } from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { dealsRepo } from "./deals.repository.js";
import { requireUser } from "../../context/request-context.js";

type DealListQuery = z.infer<typeof DealListQuerySchema>;

const DEAL_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  dealNumber: "deal_number",
  value: "value",
  expectedClose: "expected_close",
};

const ALLOWED_STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  DISCOVERY: ["PROPOSAL", "CLOSED_LOST"],
  PROPOSAL: ["NEGOTIATION", "CLOSED_LOST", "DISCOVERY"],
  NEGOTIATION: ["CLOSED_WON", "CLOSED_LOST", "PROPOSAL"],
  CLOSED_WON: [],
  CLOSED_LOST: [],
};

export class DealsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: DealListQuery
  ): Promise<ReturnType<typeof paginated<Deal>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, DEAL_SORTS, "createdAt");
      const { data, total } = await dealsRepo.list(
        client,
        {
          stage: query.stage,
          assignedTo: query.assignedTo,
          accountId: query.accountId,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Deal> {
    return withRequest(req, this.pool, async (client) => {
      const row = await dealsRepo.getById(client, id);
      if (!row) throw new NotFoundError("deal");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateDeal): Promise<Deal> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return dealsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateDeal
  ): Promise<Deal> {
    return withRequest(req, this.pool, async (client) => {
      const result = await dealsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("deal");
      if (result === "version_conflict") {
        throw new ConflictError("deal was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await dealsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("deal");
    });
  }

  async transitionStage(
    req: FastifyRequest,
    id: string,
    input: TransitionDealStage
  ): Promise<Deal> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await dealsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("deal");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("deal was modified by someone else");
      }
      const allowed = ALLOWED_STAGE_TRANSITIONS[cur.stage];
      if (!allowed.includes(input.stage)) {
        throw new StateTransitionError(
          `cannot transition deal from ${cur.stage} to ${input.stage}`
        );
      }
      if (input.stage === "CLOSED_LOST" && !input.lostReason) {
        throw new ValidationError("lostReason is required for CLOSED_LOST");
      }
      const result = await dealsRepo.transitionStage(client, id, {
        stage: input.stage,
        expectedVersion: input.expectedVersion,
        lostReason: input.lostReason ?? null,
      });
      if (result === null) throw new NotFoundError("deal");
      if (result === "version_conflict") {
        throw new ConflictError("deal was modified by someone else");
      }
      return result;
    });
  }
}
