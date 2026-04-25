/**
 * Admin-users routes — invitation create/list/revoke (admin) + preview/accept
 * (public). Mounted at /admin/users/* and /auth/accept-invite.
 *
 *   POST /admin/users/invite                      users:invite
 *   GET  /admin/users/invitations                 users:invite
 *   POST /admin/users/invitations/:id/revoke      users:invite
 *   GET  /auth/accept-invite/preview              — public (token is auth)
 *   POST /auth/accept-invite                      — public (token is auth)
 *
 * Admin routes compose authGuard + requirePermission("users:invite"). The
 * two /auth/accept-invite routes are unauthenticated by design — the raw
 * token in the URL is the secret. They sit on the public surface; rate
 * limiting is the global 300/min/IP already registered in apps/api/src/index.ts.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AcceptInvitePreviewQuerySchema,
  AcceptInviteRequestSchema,
  InviteUserRequestSchema,
  ListInvitationsQuerySchema,
  ListUsersQuerySchema,
  UpdateUserRequestSchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { AdminUsersService } from "./service.js";

const RevokeParamsSchema = z.object({
  id: z.string().uuid(),
});

export interface RegisterAdminUsersRoutesOptions {
  service: AdminUsersService;
  guardInternal: AuthGuardOptions;
}

export async function registerAdminUsersRoutes(
  app: FastifyInstance,
  opts: RegisterAdminUsersRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  const inviteGuards = [authGuard, requirePermission("users:invite")];

  // ── Admin surface ────────────────────────────────────────────────────

  app.post(
    "/admin/users/invite",
    { preHandler: inviteGuards },
    async (req, reply) => {
      const body = InviteUserRequestSchema.parse(req.body ?? {});
      const result = await opts.service.invite(req, body);
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/admin/users/invitations",
    { preHandler: inviteGuards },
    async (req, reply) => {
      const query = ListInvitationsQuerySchema.parse(req.query ?? {});
      const result = await opts.service.list(req, query);
      return reply.code(200).send(result);
    },
  );

  // Active members of the tenant — distinct from invitations. The Members
  // tab uses this so it doesn't need to derive the list from ACCEPTED
  // invitations (which loses pre-invite seeded users + bootstrap admins).
  app.get(
    "/admin/users",
    { preHandler: inviteGuards },
    async (req, reply) => {
      const query = ListUsersQuerySchema.parse(req.query ?? {});
      const result = await opts.service.listUsers(req, query);
      return reply.code(200).send(result);
    },
  );

  // Edit a member's name / role / membership status. At least one field
  // is required (enforced in the schema). Reuses `users:invite` so the
  // admin gate for membership changes is consistent across this surface.
  app.patch(
    "/admin/users/:id",
    { preHandler: inviteGuards },
    async (req, reply) => {
      const { id } = RevokeParamsSchema.parse(req.params ?? {});
      const body = UpdateUserRequestSchema.parse(req.body ?? {});
      const result = await opts.service.updateUser(req, id, body);
      return reply.code(200).send(result);
    },
  );

  // Remove a member from the org. Soft-delete via memberships.status =
  // REMOVED + role/refresh-token cleanup. Self-removal is refused.
  app.delete(
    "/admin/users/:id",
    { preHandler: inviteGuards },
    async (req, reply) => {
      const { id } = RevokeParamsSchema.parse(req.params ?? {});
      await opts.service.removeMember(req, id);
      return reply.code(204).send();
    },
  );

  // Hard-delete an invitation row. Used by the admin to clear EXPIRED /
  // REVOKED / ACCEPTED entries from the invitations card. Memberships
  // and users are not touched — those rows survive their originating
  // invitation row.
  app.delete(
    "/admin/users/invitations/:id",
    { preHandler: inviteGuards },
    async (req, reply) => {
      const { id } = RevokeParamsSchema.parse(req.params ?? {});
      await opts.service.deleteInvitation(req, id);
      return reply.code(204).send();
    },
  );

  app.post(
    "/admin/users/invitations/:id/revoke",
    { preHandler: inviteGuards },
    async (req, reply) => {
      const { id } = RevokeParamsSchema.parse(req.params ?? {});
      const result = await opts.service.revoke(req, id);
      return reply.code(200).send({ invitation: result });
    },
  );

  // ── Public accept surface ────────────────────────────────────────────

  app.get("/auth/accept-invite/preview", async (req, reply) => {
    const query = AcceptInvitePreviewQuerySchema.parse(req.query ?? {});
    const result = await opts.service.preview(query.token);
    return reply.code(200).send(result);
  });

  app.post("/auth/accept-invite", async (req, reply) => {
    const body = AcceptInviteRequestSchema.parse(req.body ?? {});
    const result = await opts.service.accept(req, body);
    return reply.code(200).send(result);
  });
}
