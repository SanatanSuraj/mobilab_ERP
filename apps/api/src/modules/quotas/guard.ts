/**
 * Feature-gate preHandler.
 *
 * Shape matches requirePermission(): a factory that returns a Fastify
 * preHandler closure, so routes can stack it with authGuard +
 * requirePermission like any other gate.
 *
 *   preHandler: [
 *     authGuard,
 *     requireFeature("module.crm"),
 *     requirePermission("contacts:read"),
 *   ]
 *
 * Ordering notes:
 *   - authGuard must run first so req.user is populated.
 *   - requireFeature runs before requirePermission because "plan doesn't
 *     include this module" is a *better* error for the client than "you
 *     don't have read permission" — 402 tells them to upgrade; 401/403
 *     tells them to ask an admin for a role.
 */

import type { FastifyRequest } from "fastify";
import { UnauthorizedError } from "@instigenie/errors";
import type { FeatureFlagService } from "@instigenie/quotas";

export function createRequireFeature(flags: FeatureFlagService) {
  return function requireFeature(key: string) {
    return async function (req: FastifyRequest): Promise<void> {
      const user = req.user;
      if (!user) throw new UnauthorizedError("authentication required");
      // ModuleDisabledError (402) is thrown from inside assertEnabled on miss.
      await flags.assertEnabled(user.orgId, key);
    };
  };
}

export type RequireFeature = ReturnType<typeof createRequireFeature>;
