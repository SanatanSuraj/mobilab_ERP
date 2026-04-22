/**
 * Notifications service. Inbox for the authenticated user + admin-create
 * ("dispatch") for ops / internal workflow emitters.
 *
 * Scope (Phase 2):
 *   - listMine()         — paginated inbox for current user
 *   - listAll()          — admin view across users (requires admin_read)
 *   - getForCurrent()    — read one (enforces ownership)
 *   - create()           — emit one notification (requires dispatch perm)
 *   - markRead()         — batch flip to read
 *   - markAllRead()      — flip every unread for current user
 *   - removeForCurrent() — soft-delete one from own inbox
 *   - unreadCount()      — header bell aggregate
 *
 * The hook into the event bus (§6) that fires notifications from domain
 * events is explicitly Phase 3 — not in this service.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateNotification,
  Notification,
  NotificationListQuerySchema,
  NotificationUnreadCount,
} from "@instigenie/contracts";
import { z } from "zod";
import { ForbiddenError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { notificationsRepo } from "./notifications.repository.js";
import { requireUser } from "../../context/request-context.js";

type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

const NOTIFICATION_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  readAt: "read_at",
  severity: "severity",
};

export class NotificationsService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * List notifications for the authenticated user — always user-scoped.
   */
  async listMine(
    req: FastifyRequest,
    query: NotificationListQuery,
  ): Promise<ReturnType<typeof paginated<Notification>>> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, NOTIFICATION_SORTS, "createdAt");
      const { data, total } = await notificationsRepo.list(
        client,
        {
          userId: user.id,
          isRead: query.isRead,
          severity: query.severity,
          eventType: query.eventType,
          referenceType: query.referenceType,
          referenceId: query.referenceId,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  /**
   * Admin-style list across all users in the org. Caller must have
   * notifications:admin_read — route layer enforces the permission.
   */
  async listAll(
    req: FastifyRequest,
    query: NotificationListQuery & { userId?: string },
  ): Promise<ReturnType<typeof paginated<Notification>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, NOTIFICATION_SORTS, "createdAt");
      const { data, total } = await notificationsRepo.list(
        client,
        {
          userId: query.userId,
          isRead: query.isRead,
          severity: query.severity,
          eventType: query.eventType,
          referenceType: query.referenceType,
          referenceId: query.referenceId,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getForCurrent(
    req: FastifyRequest,
    id: string,
  ): Promise<Notification> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const row = await notificationsRepo.getById(client, id);
      if (!row) throw new NotFoundError("notification");
      if (row.userId !== user.id) {
        // Don't leak existence — pretend it's a 404 unless admin_read holds.
        if (!user.permissions.has("notifications:admin_read")) {
          throw new NotFoundError("notification");
        }
      }
      return row;
    });
  }

  /**
   * Emit a notification to a given user. Caller must hold the dispatch
   * permission — route layer enforces. Phase 2 wire-up: the UI uses this
   * for ad-hoc "send note to teammate" actions. Phase 3 wires the event
   * bus as the primary caller.
   */
  async create(
    req: FastifyRequest,
    input: CreateNotification,
  ): Promise<Notification> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // Make sure the recipient exists inside this org (RLS would hide
      // cross-tenant users, but we want an explicit 404 for a missing id).
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 AND org_id = $2 AND is_active = true`,
        [input.userId, user.orgId],
      );
      if (rows.length === 0) {
        throw new NotFoundError("recipient user");
      }
      return notificationsRepo.create(client, user.orgId, input);
    });
  }

  async markRead(
    req: FastifyRequest,
    ids: string[],
  ): Promise<{ updated: number }> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const updated = await notificationsRepo.markRead(client, user.id, ids);
      return { updated };
    });
  }

  async markAllRead(
    req: FastifyRequest,
  ): Promise<{ updated: number }> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const updated = await notificationsRepo.markAllRead(client, user.id);
      return { updated };
    });
  }

  async removeForCurrent(req: FastifyRequest, id: string): Promise<void> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      // Ownership check — 404 if not theirs (unless admin_read; admins can
      // still delete own rows but not other users' rows without a stronger
      // permission we haven't defined yet).
      const row = await notificationsRepo.getById(client, id);
      if (!row) throw new NotFoundError("notification");
      if (row.userId !== user.id) {
        throw new ForbiddenError(
          "cannot delete a notification that isn't in your inbox",
        );
      }
      const ok = await notificationsRepo.softDelete(client, user.id, id);
      if (!ok) throw new NotFoundError("notification");
    });
  }

  async unreadCount(req: FastifyRequest): Promise<NotificationUnreadCount> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return notificationsRepo.unreadCount(client, user.id);
    });
  }
}
