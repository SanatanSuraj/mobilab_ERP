/**
 * Admin audit dashboard routes — mounted at /admin/audit/*.
 * ARCHITECTURE.md §4.2.
 *
 *   GET /admin/audit/entries ?tableName=&action=&userId=&rowId=
 *                            &fromDate=&toDate=&q=&limit=&offset=
 *
 * Guarded by `admin:audit:read`. The guard composition is the standard
 * internal-surface pair: authGuard (JWT + tenant lifecycle) then
 * requirePermission(). RLS runs inside the service — a caller without
 * the admin role could never get here, but even if something went
 * wrong at the guard layer, the tenant_isolation policy on audit.log
 * would still fence cross-tenant reads.
 */

import type { FastifyInstance } from "fastify";
import { AdminAuditListQuerySchema } from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { AdminAuditService } from "./service.js";

export interface RegisterAdminAuditRoutesOptions {
  service: AdminAuditService;
  guardInternal: AuthGuardOptions;
}

export async function registerAdminAuditRoutes(
  app: FastifyInstance,
  opts: RegisterAdminAuditRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  const auditRead = [authGuard, requirePermission("admin:audit:read")];

  app.get(
    "/admin/audit/entries",
    { preHandler: auditRead },
    async (req, reply) => {
      const query = AdminAuditListQuerySchema.parse(req.query ?? {});
      const result = await opts.service.list(req, query);
      return reply.code(200).send(result);
    },
  );
}
