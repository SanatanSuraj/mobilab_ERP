/**
 * ECN service.
 *
 * Drives the engineering_change_notices table. The list/getById half
 * powers the read-only register; create/update/transition implement the
 * Phase-6 draft → review → approve/reject → implemented workflow.
 *
 * Status transitions are enforced here (not in the repo) so the state
 * machine is auditable in one place. The repo blindly stamps approved_at /
 * implemented_at when the new status warrants — only valid moves get
 * through this service.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateEcn,
  EcnListQuerySchema,
  EcnStatus,
  EcnTransition,
  EngineeringChangeNotice,
  UpdateEcn,
} from "@instigenie/contracts";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { requireUser } from "../../context/request-context.js";
import { ecnsRepo } from "./ecns.repository.js";
import { nextProductionNumber } from "./numbering.js";

type EcnListQuery = z.infer<typeof EcnListQuerySchema>;

const ECN_SORTS: Record<string, string> = {
  createdAt: "e.created_at",
  updatedAt: "e.updated_at",
  ecnNumber: "e.ecn_number",
  status: "e.status",
  severity: "e.severity",
  changeType: "e.change_type",
  targetImplementationDate: "e.target_implementation_date",
};

/**
 * Adjacency list of allowed ECN status moves. Anything not in the
 * destination set throws StateTransitionError. Keep this in lockstep with
 * the workflow doc-string in CreateEcnSchema / EcnTransitionSchema.
 */
const ALLOWED_TRANSITIONS: Record<EcnStatus, ReadonlySet<EcnStatus>> = {
  DRAFT: new Set<EcnStatus>(["PENDING_REVIEW", "CANCELLED"]),
  PENDING_REVIEW: new Set<EcnStatus>(["APPROVED", "REJECTED", "CANCELLED"]),
  APPROVED: new Set<EcnStatus>(["IMPLEMENTED", "CANCELLED"]),
  REJECTED: new Set<EcnStatus>(),
  IMPLEMENTED: new Set<EcnStatus>(),
  CANCELLED: new Set<EcnStatus>(),
};

export class EcnsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: EcnListQuery,
  ): Promise<ReturnType<typeof paginated<EngineeringChangeNotice>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, ECN_SORTS, "createdAt");
      const { data, total } = await ecnsRepo.list(
        client,
        {
          status: query.status,
          severity: query.severity,
          changeType: query.changeType,
          affectedProductId: query.affectedProductId,
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
  ): Promise<EngineeringChangeNotice> {
    return withRequest(req, this.pool, async (client) => {
      const row = await ecnsRepo.getById(client, id);
      if (!row) throw new NotFoundError("ecn");
      return row;
    });
  }

  async create(
    req: FastifyRequest,
    body: CreateEcn,
  ): Promise<EngineeringChangeNotice> {
    return withRequest(req, this.pool, async (client) => {
      const user = requireUser(req);

      // Either honor an explicit ecn_number (uniqueness enforced via DB
      // unique index) or mint one from production_number_sequences.
      let ecnNumber = body.ecnNumber;
      if (ecnNumber) {
        const existing = await ecnsRepo.findByNumber(
          client,
          user.orgId,
          ecnNumber,
        );
        if (existing) {
          throw new ConflictError(
            `ECN number "${ecnNumber}" is already in use.`,
          );
        }
      } else {
        ecnNumber = await nextProductionNumber(client, user.orgId, "ECN");
      }

      return ecnsRepo.create(client, user.orgId, ecnNumber, body);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    body: UpdateEcn,
  ): Promise<EngineeringChangeNotice> {
    return withRequest(req, this.pool, async (client) => {
      const current = await ecnsRepo.getById(client, id);
      if (!current) throw new NotFoundError("ecn");

      // Lock down terminal states. Once an ECN is IMPLEMENTED / REJECTED /
      // CANCELLED its body is the historical record — edits would silently
      // rewrite history. Force a new ECN instead.
      if (
        current.status === "IMPLEMENTED" ||
        current.status === "REJECTED" ||
        current.status === "CANCELLED"
      ) {
        throw new ConflictError(
          `Cannot edit ECN in terminal status ${current.status}. Raise a new ECN.`,
        );
      }

      const updated = await ecnsRepo.update(client, id, body);
      if (!updated) throw new NotFoundError("ecn");
      return updated;
    });
  }

  /**
   * Move an ECN through its workflow. Enforces both the adjacency table
   * and per-target-state shape rules (e.g. APPROVED requires approvedBy).
   */
  async transition(
    req: FastifyRequest,
    id: string,
    body: EcnTransition,
  ): Promise<EngineeringChangeNotice> {
    return withRequest(req, this.pool, async (client) => {
      const current = await ecnsRepo.getById(client, id);
      if (!current) throw new NotFoundError("ecn");

      const allowed = ALLOWED_TRANSITIONS[current.status];
      if (!allowed.has(body.toStatus)) {
        throw new StateTransitionError(
          `Cannot transition ECN from ${current.status} to ${body.toStatus}.`,
        );
      }

      if (body.toStatus === "APPROVED" && !body.approvedBy?.trim()) {
        throw new ValidationError(
          "approvedBy is required when approving an ECN.",
        );
      }

      const next = await ecnsRepo.transition(
        client,
        id,
        body.toStatus,
        body.toStatus === "APPROVED" ? body.approvedBy!.trim() : null,
      );
      if (!next) throw new NotFoundError("ecn");
      return next;
    });
  }
}
