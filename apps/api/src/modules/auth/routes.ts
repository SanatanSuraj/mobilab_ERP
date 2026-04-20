/**
 * Auth routes. Mounted at /auth/*.
 *
 *   POST /auth/login          { email, password, surface }
 *        → "authenticated"   (single membership short-circuit), OR
 *          "multi-tenant"    (tenantToken + memberships list)
 *   POST /auth/select-tenant  { tenantToken, orgId }
 *        → "authenticated"   (always)
 *   POST /auth/refresh        { refreshToken }
 *        → new access + rotated refresh
 *   POST /auth/logout         { refreshToken }
 *        → 204
 *   GET  /auth/me             (Bearer token)
 *        → { id, identityId, orgId, email, name, roles, permissions }
 */

import type { FastifyInstance } from "fastify";
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  SelectTenantRequestSchema,
  AUDIENCE,
} from "@mobilab/contracts";
import { z } from "zod";
import type { AuthService } from "./service.js";
import { createAuthGuard, type AuthGuardOptions } from "./guard.js";
import { requireUser } from "../../context/request-context.js";

export interface RegisterAuthRoutesOptions {
  service: AuthService;
  guardInternal: AuthGuardOptions;
  guardPortal: AuthGuardOptions;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  opts: RegisterAuthRoutesOptions
): Promise<void> {
  app.post("/auth/login", async (req, reply) => {
    const body = LoginRequestSchema.parse(req.body);
    const result = await opts.service.login({
      email: body.email,
      password: body.password,
      surface: body.surface,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    return reply.code(200).send(result);
  });

  app.post("/auth/select-tenant", async (req, reply) => {
    const body = SelectTenantRequestSchema.parse(req.body);
    const result = await opts.service.selectTenant({
      tenantToken: body.tenantToken,
      orgId: body.orgId,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    return reply.code(200).send(result);
  });

  app.post("/auth/refresh", async (req, reply) => {
    const body = RefreshRequestSchema.parse(req.body);
    const result = await opts.service.refresh({
      refreshToken: body.refreshToken,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    return reply.code(200).send(result);
  });

  app.post("/auth/logout", async (req, reply) => {
    const body = z
      .object({ refreshToken: z.string().min(1) })
      .parse(req.body);
    await opts.service.logout(body.refreshToken);
    return reply.code(204).send();
  });

  // /me can be called by either surface. We try internal first, fall back
  // to portal audience check.
  app.get("/auth/me", async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return reply.code(401).send({
        type: "https://mobilab.dev/problems/unauthorized",
        title: "unauthorized",
        status: 401,
        detail: "missing bearer token",
        code: "unauthorized",
      });
    }

    let user: Awaited<ReturnType<AuthService["me"]>> | null = null;
    try {
      await createAuthGuard(opts.guardInternal)(req, reply);
      user = await opts.service.me(requireUser(req).id, requireUser(req).orgId);
    } catch {
      try {
        await createAuthGuard(opts.guardPortal)(req, reply);
        user = await opts.service.me(requireUser(req).id, requireUser(req).orgId);
      } catch {
        throw new Error("unreachable");
      }
    }

    return reply.code(200).send(user);
  });
}

export { AUDIENCE };
