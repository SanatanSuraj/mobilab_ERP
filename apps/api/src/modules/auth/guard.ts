/**
 * Auth guard. Parses the Authorization header, verifies the access token,
 * checks audience, loads roles, and attaches a RequestUser to req.user.
 *
 * Usage: register for every route EXCEPT login/refresh via an onRequest hook.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "@mobilab/errors";
import {
  AUDIENCE,
  type Audience,
  type Role,
  ROLE_PERMISSIONS,
  type Permission,
} from "@mobilab/contracts";
import type { TokenFactory } from "./tokens.js";
import type { RequestUser } from "../../context/request-context.js";

export interface AuthGuardOptions {
  tokens: TokenFactory;
  expectedAudience: Audience;
}

export function createAuthGuard(opts: AuthGuardOptions) {
  return async function authGuard(
    req: FastifyRequest,
    _reply: FastifyReply
  ): Promise<void> {
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) {
      throw new UnauthorizedError("missing bearer token");
    }
    const token = h.slice("Bearer ".length).trim();
    if (!token) throw new UnauthorizedError("empty bearer token");

    const claims = await opts.tokens.verifyAccess(token, opts.expectedAudience);

    const roles = (claims.roles ?? []) as Role[];
    const perms = new Set<Permission>();
    for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) perms.add(p);

    const user: RequestUser = {
      id: claims.sub,
      orgId: claims.org,
      email: "", // populated via /me if needed; not in access token by default
      roles,
      permissions: perms,
      audience: claims.aud,
      capabilities: claims.capabilities,
    };
    req.user = user;
  };
}

/**
 * Factory for route-level permission checks. Use as a second preHandler:
 *   preHandler: [authGuard, requirePermission("work_orders:release")]
 */
export function requirePermission(perm: Permission) {
  return async function (req: FastifyRequest): Promise<void> {
    const user = req.user;
    if (!user) throw new UnauthorizedError("authentication required");
    if (!user.permissions.has(perm)) {
      throw new UnauthorizedError("permission denied"); // 401 — caller can
      // narrow to 403 via ForbiddenError if preferred. We pick 401 here to
      // hide which permissions exist.
    }
  };
}

export { AUDIENCE };
