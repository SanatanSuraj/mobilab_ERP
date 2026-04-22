/**
 * Per-request portal DB wrapper. ARCHITECTURE.md §3.7 + §9.2 + §11.
 *
 * Every portal route handler runs inside this. It:
 *   1. Extracts the authenticated user from req (set by guardPortal).
 *   2. Extracts the portal-customer link from req.portalCustomerId, which
 *      the guard's pivot-lookup hook populated. If the hook didn't run
 *      (misconfiguration), this throws — we must never run a portal query
 *      without the customer GUC set.
 *   3. Delegates to `withPortalUser`, which sets all three GUCs:
 *        app.current_org, app.current_user, app.current_portal_customer
 *      inside a transaction.
 *
 * Because the portal's audience block handler rejects any non-/portal/*
 * path for portal tokens, the ONLY paths on which this wrapper is called
 * are /portal/* — which means the RLS predicate guarantees cross-customer
 * data can't leak, even if a portal-customer lookup is ever misconfigured
 * (the GUC simply won't match the row account_id, and the query returns
 * zero rows — fail closed, per §9.2).
 */

import type { FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { UnauthorizedError } from "@instigenie/errors";
import { withPortalUser } from "@instigenie/db";
import { requireUser } from "../../context/request-context.js";

export async function withPortalRequest<T>(
  req: FastifyRequest,
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const user = requireUser(req);
  const customerId = req.portalCustomerId;
  if (!customerId) {
    // Hard-fail: the guard promised to populate this. Running a portal
    // query without it would bypass the portal RLS restrictive predicate
    // (it short-circuits to TRUE when the GUC is unset).
    throw new UnauthorizedError("portal session has no customer link");
  }
  return withPortalUser(
    pool,
    { orgId: user.orgId, userId: user.id, customerId },
    fn,
  );
}
