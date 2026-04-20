/**
 * Fastify hooks that enforce + record the `api.calls` quota.
 *
 * Where it runs:
 *   preHandler  — assertQuota(org, "api.calls"). Fires *after* authGuard
 *                 populated req.user so we know which tenant to charge.
 *                 Throws QuotaExceededError (429) on overflow.
 *
 *   onResponse  — recordUsage(org, "api.calls", 1). Fires after every
 *                 response regardless of status. Success & client errors
 *                 both count (a 4xx is still a call the tenant's tooling
 *                 made; we charge it). 5xx also counts — we don't want
 *                 tenants DoS'ing themselves past the quota by deliberately
 *                 triggering our errors, but a genuine backend failure is
 *                 on us. Keep behaviour consistent and auditable; product
 *                 can carve out specific routes later via a skip-list.
 *
 * Failure handling:
 *   - assertQuota fails closed: a 429 is preferable to over-serving.
 *   - recordUsage is fire-and-forget: if the usage write fails (DB blip),
 *     we log and move on — a dropped usage record is a small accuracy loss,
 *     not a correctness bug. Importantly we do NOT await the write in
 *     onResponse since the response bytes are already flushed.
 *
 * Skip list:
 *   /health, /readyz, /metrics are unauthenticated and have no req.user;
 *   naturally bypassed because assertQuota/recordUsage both need user.orgId.
 *   We also skip auth endpoints to avoid double-counting the login that
 *   creates the token (a login attempt isn't really a tenant action yet —
 *   it becomes one once the token is issued).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Logger } from "@mobilab/observability";
import type { QuotaService } from "@mobilab/quotas";

const API_CALLS_METRIC = "api.calls";

/**
 * URL prefixes that SHOULD NOT be counted against `api.calls.quota`.
 * /auth is excluded because login/refresh fire before we know the tenant;
 * health/readyz/metrics are ops endpoints; /vendor-admin is out of tenant
 * scope (vendor role, not tenant role) and will gain its own gate later.
 */
const SKIP_PREFIXES = ["/health", "/readyz", "/metrics", "/auth", "/vendor-admin"];

function shouldCount(req: FastifyRequest): boolean {
  if (!req.user) return false;
  const url = req.url || "";
  for (const p of SKIP_PREFIXES) {
    if (url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`)) {
      return false;
    }
  }
  return true;
}

export interface RegisterApiCallsQuotaOpts {
  quotas: QuotaService;
  log: Logger;
}

export function registerApiCallsQuota(
  app: FastifyInstance,
  opts: RegisterApiCallsQuotaOpts
): void {
  // ── preHandler: fail fast if this tenant is already at limit ────────────
  // Fastify runs preHandlers AFTER route-level preHandlers (authGuard etc.)
  // by default when hooked at the instance level — which is exactly the
  // order we want: authGuard fills req.user, then we check the quota.
  app.addHook("preHandler", async (req) => {
    if (!shouldCount(req)) return;
    // req.user is non-null by the time shouldCount() returns true.
    await opts.quotas.assertQuota(req.user!.orgId, API_CALLS_METRIC, 1);
  });

  // ── onResponse: best-effort usage bump, doesn't block the response ──────
  app.addHook("onResponse", (req, _reply, done) => {
    if (!shouldCount(req)) {
      done();
      return;
    }
    // Fire-and-forget — don't await in the hook because the bytes are
    // already out. Log on failure; a handful of dropped records is far
    // cheaper than holding a connection open for an extra roundtrip.
    opts.quotas
      .recordUsage(req.user!.orgId, API_CALLS_METRIC, 1)
      .catch((err: unknown) => {
        opts.log.warn({ err, orgId: req.user?.orgId }, "recordUsage failed");
      });
    done();
  });
}
