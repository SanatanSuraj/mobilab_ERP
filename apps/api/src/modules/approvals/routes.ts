/**
 * Approvals routes. Mounted at /approvals/*.
 *
 * Scope (Phase 3):
 *   - GET  /approvals                       list requests (approvals:read)
 *   - GET  /approvals/inbox                  pending steps for my role (approvals:read)
 *   - GET  /approvals/:id                    full detail — request + steps + transitions
 *   - POST /approvals                        create a request (approvals:request)
 *   - POST /approvals/:id/act                approve/reject current step (approvals:act)
 *   - POST /approvals/:id/cancel             cancel a pending request (approvals:cancel or requester)
 *   - GET  /approvals/chains                 chain library (approvals:read)
 *   - GET  /approvals/chains/:id             one chain def
 *   - POST /approvals/chains                 create chain def (approvals:chains:manage)
 *   - DELETE /approvals/chains/:id           soft-delete chain def (approvals:chains:manage)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ApprovalActPayloadSchema,
  ApprovalCancelPayloadSchema,
  ApprovalChainListQuerySchema,
  ApprovalInboxQuerySchema,
  ApprovalRequestListQuerySchema,
  CreateApprovalChainDefinitionSchema,
  CreateApprovalRequestSchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { ApprovalsService } from "./approvals.service.js";

export interface RegisterApprovalsRoutesOptions {
  approvals: ApprovalsService;
  guardInternal: AuthGuardOptions;
}

const IdParamSchema = z.object({ id: z.string().uuid() });

export async function registerApprovalsRoutes(
  app: FastifyInstance,
  opts: RegisterApprovalsRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);

  const approvalsRead = [authGuard, requirePermission("approvals:read")];
  const approvalsRequest = [authGuard, requirePermission("approvals:request")];
  const approvalsAct = [authGuard, requirePermission("approvals:act")];
  const approvalsCancel = [authGuard, requirePermission("approvals:read")];
  const chainsManage = [
    authGuard,
    requirePermission("approvals:chains:manage"),
  ];

  // ── Requests ──────────────────────────────────────────────────────────────

  app.get(
    "/approvals",
    { preHandler: approvalsRead },
    async (req, reply) => {
      const query = ApprovalRequestListQuerySchema.parse(req.query);
      return reply.send(await opts.approvals.listRequests(req, query));
    },
  );

  app.get(
    "/approvals/inbox",
    { preHandler: approvalsRead },
    async (req, reply) => {
      const query = ApprovalInboxQuerySchema.parse(req.query);
      return reply.send(await opts.approvals.listInbox(req, query));
    },
  );

  // Chains list/detail live under /approvals/chains — declared before
  // /approvals/:id so the literal path wins the match.
  app.get(
    "/approvals/chains",
    { preHandler: approvalsRead },
    async (req, reply) => {
      const query = ApprovalChainListQuerySchema.parse(req.query);
      return reply.send(await opts.approvals.listChains(req, query));
    },
  );

  app.get(
    "/approvals/chains/:id",
    { preHandler: approvalsRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.approvals.getChain(req, id));
    },
  );

  app.post(
    "/approvals/chains",
    { preHandler: chainsManage },
    async (req, reply) => {
      const body = CreateApprovalChainDefinitionSchema.parse(req.body);
      return reply.code(201).send(await opts.approvals.createChain(req, body));
    },
  );

  app.delete(
    "/approvals/chains/:id",
    { preHandler: chainsManage },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.approvals.removeChain(req, id);
      return reply.code(204).send();
    },
  );

  app.get(
    "/approvals/:id",
    { preHandler: approvalsRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.approvals.getRequestDetail(req, id));
    },
  );

  app.post(
    "/approvals",
    { preHandler: approvalsRequest },
    async (req, reply) => {
      const body = CreateApprovalRequestSchema.parse(req.body);
      return reply.code(201).send(await opts.approvals.createRequest(req, body));
    },
  );

  app.post(
    "/approvals/:id/act",
    { preHandler: approvalsAct },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = ApprovalActPayloadSchema.parse(req.body);
      return reply.send(await opts.approvals.act(req, id, body));
    },
  );

  app.post(
    "/approvals/:id/cancel",
    { preHandler: approvalsCancel },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = ApprovalCancelPayloadSchema.parse(req.body);
      return reply.send(
        await opts.approvals.cancelRequest(req, id, body.reason),
      );
    },
  );
}
