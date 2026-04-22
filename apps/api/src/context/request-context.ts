/**
 * Per-request context: the authenticated user + their active org/permissions.
 * Populated by the auth guard and read by route handlers.
 *
 * ARCHITECTURE.md §9.4. permissions are materialized at request time
 * (union of all role permissions) so handlers do one hash check.
 */

import type { FastifyRequest } from "fastify";
import type { Role, Permission, Audience } from "@instigenie/contracts";

export interface RequestUser {
  id: string;
  orgId: string;
  email: string;
  roles: Role[];
  permissions: Set<Permission>;
  audience: Audience;
  capabilities?: {
    permittedLines: string[];
    tier?: "T1" | "T2" | "T3";
    canPCBRework: boolean;
    canOCAssembly: boolean;
  };
}

declare module "fastify" {
  interface FastifyRequest {
    user?: RequestUser;
    /**
     * Portal customer link. Populated by the portal guard's post-auth hook
     * by looking up account_portal_users for (orgId, userId). Consumed by
     * withPortalRequest, which passes it to @instigenie/db/withPortalUser
     * as `app.current_portal_customer`. See ARCHITECTURE.md §3.7.
     *
     * Only ever set for requests on the portal audience. Reading it from an
     * internal-audience handler is a no-op (undefined); withPortalRequest
     * throws if it's missing.
     */
    portalCustomerId?: string;
  }
}

export function requireUser(req: FastifyRequest): RequestUser {
  if (!req.user) {
    throw new Error("requireUser: no authenticated user on request");
  }
  return req.user;
}
