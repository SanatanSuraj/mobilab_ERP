/**
 * Notification templates service. Header-only CRUD; the unique constraint
 * on (org_id, event_type, channel) becomes a ConflictError at the service
 * boundary.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateNotificationTemplate,
  NotificationTemplate,
  NotificationTemplateListQuerySchema,
  UpdateNotificationTemplate,
} from "@instigenie/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { notificationTemplatesRepo } from "./templates.repository.js";
import { requireUser } from "../../context/request-context.js";

type NotificationTemplateListQuery = z.infer<
  typeof NotificationTemplateListQuerySchema
>;

const TEMPLATE_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
  eventType: "event_type",
  channel: "channel",
};

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export class NotificationTemplatesService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: NotificationTemplateListQuery,
  ): Promise<ReturnType<typeof paginated<NotificationTemplate>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, TEMPLATE_SORTS, "createdAt");
      const { data, total } = await notificationTemplatesRepo.list(
        client,
        {
          eventType: query.eventType,
          channel: query.channel,
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
  ): Promise<NotificationTemplate> {
    return withRequest(req, this.pool, async (client) => {
      const row = await notificationTemplatesRepo.getById(client, id);
      if (!row) throw new NotFoundError("notification template");
      return row;
    });
  }

  async create(
    req: FastifyRequest,
    input: CreateNotificationTemplate,
  ): Promise<NotificationTemplate> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      try {
        return await notificationTemplatesRepo.create(
          client,
          user.orgId,
          user.id,
          input,
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            `a template already exists for event "${input.eventType}" on channel ${input.channel}`,
          );
        }
        throw err;
      }
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateNotificationTemplate,
  ): Promise<NotificationTemplate> {
    return withRequest(req, this.pool, async (client) => {
      try {
        const result = await notificationTemplatesRepo.updateWithVersion(
          client,
          id,
          input,
        );
        if (result === null) throw new NotFoundError("notification template");
        if (result === "version_conflict") {
          throw new ConflictError("notification template was updated by another request");
        }
        return result;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError(
            "a template already exists for this (event, channel) — change one or deactivate the other",
          );
        }
        throw err;
      }
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await notificationTemplatesRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("notification template");
    });
  }
}
