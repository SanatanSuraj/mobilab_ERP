/**
 * Notifications routes. Mounted at /notifications/*.
 *
 * Scope (Phase 2):
 *   - notification templates (CRUD)
 *   - in-app feed: list own, mark-read (one + all), soft-delete, unread-count
 *   - admin list (across users in org, requires admin_read)
 *   - admin create ("dispatch" a notification to a user)
 *
 * Permissions:
 *   - GET  /notifications                    → notifications:read (own)
 *   - GET  /notifications/all                → notifications:admin_read
 *   - GET  /notifications/unread-count       → notifications:read (own)
 *   - GET  /notifications/:id                → notifications:read (own + admin_read)
 *   - POST /notifications/mark-read          → notifications:read
 *   - POST /notifications/mark-all-read      → notifications:read
 *   - POST /notifications                    → notifications:dispatch
 *   - DELETE /notifications/:id              → notifications:read (own)
 *   - GET/POST/PATCH/DELETE /notifications/templates/** → notifications:templates:manage
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CreateNotificationSchema,
  CreateNotificationTemplateSchema,
  MarkNotificationsReadSchema,
  NotificationListQuerySchema,
  NotificationTemplateListQuerySchema,
  UpdateNotificationTemplateSchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { NotificationTemplatesService } from "./templates.service.js";
import type { NotificationsService } from "./notifications.service.js";

export interface RegisterNotificationsRoutesOptions {
  templates: NotificationTemplatesService;
  notifications: NotificationsService;
  guardInternal: AuthGuardOptions;
}

const IdParamSchema = z.object({ id: z.string().uuid() });

// Admin list extends the normal query with an optional userId filter.
const AdminNotificationListQuerySchema =
  NotificationListQuerySchema.extend({
    userId: z.string().uuid().optional(),
  });

export async function registerNotificationsRoutes(
  app: FastifyInstance,
  opts: RegisterNotificationsRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);

  const notifRead = [authGuard, requirePermission("notifications:read")];
  const notifAdminRead = [
    authGuard,
    requirePermission("notifications:admin_read"),
  ];
  const notifDispatch = [
    authGuard,
    requirePermission("notifications:dispatch"),
  ];
  const templatesManage = [
    authGuard,
    requirePermission("notifications:templates:manage"),
  ];

  // ─── Inbox: own feed ─────────────────────────────────────────────────────

  app.get(
    "/notifications",
    { preHandler: notifRead },
    async (req, reply) => {
      const query = NotificationListQuerySchema.parse(req.query);
      return reply.send(await opts.notifications.listMine(req, query));
    },
  );

  app.get(
    "/notifications/unread-count",
    { preHandler: notifRead },
    async (req, reply) => {
      return reply.send(await opts.notifications.unreadCount(req));
    },
  );

  app.get(
    "/notifications/:id",
    { preHandler: notifRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.notifications.getForCurrent(req, id));
    },
  );

  app.post(
    "/notifications/mark-read",
    { preHandler: notifRead },
    async (req, reply) => {
      const body = MarkNotificationsReadSchema.parse(req.body);
      return reply.send(await opts.notifications.markRead(req, body.ids));
    },
  );

  app.post(
    "/notifications/mark-all-read",
    { preHandler: notifRead },
    async (req, reply) => {
      return reply.send(await opts.notifications.markAllRead(req));
    },
  );

  app.delete(
    "/notifications/:id",
    { preHandler: notifRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.notifications.removeForCurrent(req, id);
      return reply.code(204).send();
    },
  );

  // ─── Admin: cross-user feed + dispatch ───────────────────────────────────

  app.get(
    "/notifications/all",
    { preHandler: notifAdminRead },
    async (req, reply) => {
      const query = AdminNotificationListQuerySchema.parse(req.query);
      return reply.send(await opts.notifications.listAll(req, query));
    },
  );

  app.post(
    "/notifications",
    { preHandler: notifDispatch },
    async (req, reply) => {
      const body = CreateNotificationSchema.parse(req.body);
      return reply.code(201).send(await opts.notifications.create(req, body));
    },
  );

  // ─── Templates ───────────────────────────────────────────────────────────

  app.get(
    "/notifications/templates",
    { preHandler: templatesManage },
    async (req, reply) => {
      const query = NotificationTemplateListQuerySchema.parse(req.query);
      return reply.send(await opts.templates.list(req, query));
    },
  );

  app.get(
    "/notifications/templates/:id",
    { preHandler: templatesManage },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.templates.getById(req, id));
    },
  );

  app.post(
    "/notifications/templates",
    { preHandler: templatesManage },
    async (req, reply) => {
      const body = CreateNotificationTemplateSchema.parse(req.body);
      return reply.code(201).send(await opts.templates.create(req, body));
    },
  );

  app.patch(
    "/notifications/templates/:id",
    { preHandler: templatesManage },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateNotificationTemplateSchema.parse(req.body);
      return reply.send(await opts.templates.update(req, id, body));
    },
  );

  app.delete(
    "/notifications/templates/:id",
    { preHandler: templatesManage },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.templates.remove(req, id);
      return reply.code(204).send();
    },
  );
}
