/**
 * Per-request context: the authenticated user + their active org/permissions.
 * Populated by the auth guard and read by route handlers.
 *
 * ARCHITECTURE.md §9.4. permissions are materialized at request time
 * (union of all role permissions) so handlers do one hash check.
 */

import type { FastifyRequest } from "fastify";
import type { Role, Permission, Audience } from "@mobilab/contracts";

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
  }
}

export function requireUser(req: FastifyRequest): RequestUser {
  if (!req.user) {
    throw new Error("requireUser: no authenticated user on request");
  }
  return req.user;
}
