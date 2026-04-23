/**
 * Auth guard. Parses the Authorization header, verifies the access token,
 * checks audience, loads roles, and attaches a RequestUser to req.user.
 *
 * Usage: register for every route EXCEPT login/refresh via an onRequest hook.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "@instigenie/errors";
import {
  AUDIENCE,
  type Audience,
  type Role,
  ROLE_PERMISSIONS,
  type Permission,
} from "@instigenie/contracts";
import type { TokenFactory } from "./tokens.js";
import type { TenantStatusService } from "../tenants/service.js";
import type { RequestUser } from "../../context/request-context.js";

export interface AuthGuardOptions {
  tokens: TokenFactory;
  expectedAudience: Audience;
  /**
   * Sprint 1B — per-request tenant lifecycle check. A valid JWT is not
   * sufficient; the tenant must still be ACTIVE (or TRIAL-not-expired).
   * This closes the gap where a token minted pre-suspension keeps working
   * for up to one access TTL.
   *
   * Cost: one PK lookup per request (<1ms). Add a 10s TTL cache in front
   * if request rate makes this meaningful.
   */
  tenantStatus: TenantStatusService;
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

    // Tenant-lifecycle gate. Throws TenantSuspendedError / TenantDeletedError /
    // TrialExpiredError which the error handler translates to Problem+JSON.
    await opts.tenantStatus.assertActive(claims.org);

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
      // `idn` is optional on JwtClaimsSchema — missing on pre-§4.2 tokens.
      // EsignatureService guards for null at the moment of use.
      identityId: claims.idn ?? null,
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
