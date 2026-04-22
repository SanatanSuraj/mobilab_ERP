/**
 * Leads service — slightly more logic than the CRUD pair because leads have
 * dedup + conversion flows.
 *
 *   create()        runs findDuplicate() under the same txn, sets
 *                   is_duplicate + duplicate_of_lead_id, and writes an
 *                   initial activity (type=NOTE).
 *   addActivity()   appends to lead_activities + bumps last_activity_at.
 *                   If the activity type is CONTACTED-equivalent we also
 *                   flip the lead's status NEW → CONTACTED.
 *   markLost()      sets status=LOST + lost_reason + audit activity.
 *   convert()       creates an account (if company not already one) +
 *                   a deal, then marks the lead CONVERTED. All in one txn.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  AddLeadActivity,
  ConvertLead,
  CreateLead,
  Deal,
  Lead,
  LeadActivity,
  LeadListQuerySchema,
  MarkLeadLost,
  UpdateLead,
} from "@instigenie/contracts";
import { z } from "zod";
import { NotFoundError, StateTransitionError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { leadsRepo } from "./leads.repository.js";
import { dealsRepo } from "./deals.repository.js";
import { accountsRepo } from "./accounts.repository.js";
import { requireUser } from "../../context/request-context.js";

type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

const LEAD_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
  estimatedValue: "estimated_value",
  lastActivityAt: "last_activity_at",
};

export class LeadsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: LeadListQuery
  ): Promise<ReturnType<typeof paginated<Lead>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, LEAD_SORTS, "createdAt");
      const { data, total } = await leadsRepo.list(
        client,
        {
          status: query.status,
          assignedTo: query.assignedTo,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Lead> {
    return withRequest(req, this.pool, async (client) => {
      const row = await leadsRepo.getById(client, id);
      if (!row) throw new NotFoundError("lead");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateLead): Promise<Lead> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const dup = await leadsRepo.findDuplicate(client, input.email, input.phone);
      const dedup = dup
        ? { isDuplicate: true, duplicateOfLeadId: dup.id }
        : { isDuplicate: false, duplicateOfLeadId: null };
      const lead = await leadsRepo.create(client, user.orgId, input, dedup);
      // Initial activity so the UI shows something in the timeline.
      await leadsRepo.insertActivity(client, {
        orgId: user.orgId,
        leadId: lead.id,
        type: "NOTE",
        content: `Lead created from ${input.source ?? "unknown source"}.`,
        actorId: user.id,
      });
      return lead;
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateLead
  ): Promise<Lead> {
    return withRequest(req, this.pool, async (client) => {
      const row = await leadsRepo.update(client, id, input);
      if (!row) throw new NotFoundError("lead");
      return row;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await leadsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("lead");
    });
  }

  // ─── Activity feed ────────────────────────────────────────────────────────

  async listActivities(
    req: FastifyRequest,
    leadId: string
  ): Promise<LeadActivity[]> {
    return withRequest(req, this.pool, async (client) => {
      // Existence check via getById so we get a 404 not an empty array
      // when the lead is missing / belongs to another org.
      const lead = await leadsRepo.getById(client, leadId);
      if (!lead) throw new NotFoundError("lead");
      return leadsRepo.listActivities(client, leadId);
    });
  }

  async addActivity(
    req: FastifyRequest,
    leadId: string,
    input: AddLeadActivity
  ): Promise<LeadActivity> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const lead = await leadsRepo.getById(client, leadId);
      if (!lead) throw new NotFoundError("lead");
      const act = await leadsRepo.insertActivity(client, {
        orgId: user.orgId,
        leadId,
        type: input.type,
        content: input.content,
        actorId: user.id,
      });
      // First outreach auto-advances NEW → CONTACTED.
      if (
        lead.status === "NEW" &&
        (input.type === "CALL" ||
          input.type === "EMAIL" ||
          input.type === "WHATSAPP" ||
          input.type === "MEETING")
      ) {
        await leadsRepo.setStatus(client, leadId, "CONTACTED");
      }
      return act;
    });
  }

  // ─── State transitions ────────────────────────────────────────────────────

  async markLost(
    req: FastifyRequest,
    id: string,
    input: MarkLeadLost
  ): Promise<Lead> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await leadsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("lead");
      if (cur.status === "CONVERTED" || cur.status === "LOST") {
        throw new StateTransitionError(
          `lead in terminal status ${cur.status}`
        );
      }
      const updated = await leadsRepo.markLost(client, id, input.reason);
      if (!updated) throw new NotFoundError("lead");
      await leadsRepo.insertActivity(client, {
        orgId: user.orgId,
        leadId: id,
        type: "STATUS_CHANGE",
        content: `Marked LOST: ${input.reason}`,
        actorId: user.id,
      });
      return updated;
    });
  }

  /**
   * Convert lead → deal (+ optional account). All three writes happen in the
   * same txn, so a failure anywhere rolls back to NEW/QUALIFIED.
   */
  async convert(
    req: FastifyRequest,
    id: string,
    input: ConvertLead
  ): Promise<{ lead: Lead; deal: Deal; accountId: string | null }> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await leadsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("lead");
      if (cur.status === "CONVERTED" || cur.status === "LOST") {
        throw new StateTransitionError(
          `lead in terminal status ${cur.status}`
        );
      }

      // Create account if one doesn't already look right (we don't dedup on
      // name here because that's the repo's uniqueness concern — if the
      // partial unique index fires, we surface the underlying error).
      const account = await accountsRepo.create(client, user.orgId, {
        name: cur.company,
        country: "IN",
        healthScore: 50,
        isKeyAccount: false,
        ownerId: cur.assignedTo ?? undefined,
      });

      const deal = await dealsRepo.create(client, user.orgId, {
        title: input.dealTitle,
        accountId: account.id,
        company: cur.company,
        contactName: cur.name,
        stage: input.dealStage ?? "DISCOVERY",
        value: input.dealValue,
        probability: 30,
        assignedTo: cur.assignedTo ?? undefined,
        expectedClose: input.expectedClose,
        leadId: cur.id,
      });

      const updated = await leadsRepo.markConverted(
        client,
        id,
        account.id,
        deal.id
      );
      if (!updated) throw new NotFoundError("lead");

      await leadsRepo.insertActivity(client, {
        orgId: user.orgId,
        leadId: id,
        type: "STATUS_CHANGE",
        content: `Converted to deal ${deal.dealNumber}.`,
        actorId: user.id,
      });

      return { lead: updated, deal, accountId: account.id };
    });
  }
}
