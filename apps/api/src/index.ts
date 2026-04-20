/**
 * apps/api — Fastify server.
 *
 * Surface:
 *   /health         liveness
 *   /readyz         readiness (pg + redis)
 *   /metrics        Prometheus
 *   /auth/*         login / refresh / logout / me                (phase 1)
 *   /crm/*          accounts / contacts / leads / deals / tickets (phase 2)
 */

// Tracing first so pg + http get auto-instrumented.
import { initTracing } from "@mobilab/observability/tracing";
initTracing({ serviceName: "api" });

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import pg from "pg";
import {
  createLogger,
  registry,
  httpRequestsTotal,
  httpRequestDurationMs,
} from "@mobilab/observability";
import { installNumericTypeParser } from "@mobilab/db";
import { AUDIENCE, validatePermissionMap } from "@mobilab/contracts";
import { Cache } from "@mobilab/cache";
import {
  FeatureFlagService,
  PlanResolverService,
  QuotaService,
} from "@mobilab/quotas";
import { loadEnv } from "./env.js";
import { registerProblemHandler } from "./errors/problem.js";
import { TokenFactory } from "./modules/auth/tokens.js";
import { AuthService } from "./modules/auth/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { TenantStatusService } from "./modules/tenants/service.js";
import { createRequireFeature } from "./modules/quotas/guard.js";
import { registerApiCallsQuota } from "./modules/quotas/api-calls.js";
import { AccountsService } from "./modules/crm/accounts.service.js";
import { ContactsService } from "./modules/crm/contacts.service.js";
import { LeadsService } from "./modules/crm/leads.service.js";
import { DealsService } from "./modules/crm/deals.service.js";
import { TicketsService } from "./modules/crm/tickets.service.js";
import { registerCrmRoutes } from "./modules/crm/routes.js";
import { VendorAuthService, VendorAdminService } from "@mobilab/vendor-admin";
import { registerVendorRoutes } from "./modules/vendor/routes.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger({ service: "api", level: env.logLevel });

  // Sanity-check the permission catalogue at boot — catches typos that
  // would otherwise fail at first request. Phase-1 Gate 6 belt-and-braces.
  validatePermissionMap();

  installNumericTypeParser();

  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
    max: 10,
    application_name: "mobilab-api",
  });

  // Sprint 3 — the vendor-admin pool connects as `mobilab_vendor`
  // (BYPASSRLS). Tenant-side code MUST NOT use this pool; keeping the two
  // variables alongside each other in main() makes the distinction explicit
  // at the point where they're created. See ops/sql/seed/98-vendor-role.sql.
  const vendorPool = new pg.Pool({
    connectionString: env.vendorDatabaseUrl,
    max: 5,
    application_name: "mobilab-api-vendor",
  });

  const cache = new Cache({ url: env.cacheRedisUrl });
  await cache.connect();

  const tokens = new TokenFactory({
    secret: new TextEncoder().encode(env.jwtSecret),
    issuer: env.jwtIssuer,
    accessTokenTtlSec: env.accessTokenTtlSec,
  });

  // Sprint 1B — tenant lifecycle gate. Shared singleton: AuthService uses
  // it at token-issue time, AuthGuard uses it on every request.
  const tenantStatus = new TenantStatusService({ pool });

  // Sprint 1C — feature-flag read path. Resolver hits Postgres; FeatureFlag
  // caches the FeatureSnapshot blob in Redis for 60s. Every /crm/* request
  // goes through assertEnabled("module.crm") via the requireFeature guard.
  const planResolver = new PlanResolverService({ pool });
  const featureFlags = new FeatureFlagService({
    resolver: planResolver,
    cache,
  });
  const requireFeature = createRequireFeature(featureFlags);

  // Sprint 2 — quota enforcement. QuotaService reads limits through
  // FeatureFlagService (already Redis-cached) and writes to usage_records
  // via an atomic INSERT…ON CONFLICT. See modules/quotas/api-calls.ts for
  // the per-request hook that enforces + records api.calls.
  const quotas = new QuotaService({ pool, flags: featureFlags });

  const authService = new AuthService({
    pool,
    tokens,
    refreshTtlSec: env.refreshTokenTtlSec,
    tenantStatus,
  });

  // CRM services — each one is a thin orchestrator over a pg.Pool + withRequest.
  const accountsService = new AccountsService(pool);
  const contactsService = new ContactsService(pool);
  const leadsService = new LeadsService(pool);
  const dealsService = new DealsService(pool);
  const ticketsService = new TicketsService(pool);

  // Sprint 3 — vendor-admin stack. Uses the BYPASSRLS `vendorPool`, shares
  // the same TokenFactory (vendor tokens are a different audience within
  // the same signing secret), and invalidates the featureFlags cache on
  // plan changes so the tenant's next request sees the new plan.
  const vendorAuthService = new VendorAuthService({
    pool: vendorPool,
    tokens,
    refreshTtlSec: env.refreshTokenTtlSec,
  });
  const vendorAdminService = new VendorAdminService({
    pool: vendorPool,
    cacheInvalidate: (orgId) => featureFlags.invalidate(orgId),
  });

  const app = Fastify({
    logger: false, // we attach pino ourselves
    disableRequestLogging: true,
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB
  });

  // ─── Plugins ────────────────────────────────────────────────────────────────
  await app.register(helmet, { global: true, contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.webOrigin,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(sensible);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    // Login is more sensitive — per-route override applied below.
    keyGenerator: (req) => req.ip ?? "anon",
  });

  registerProblemHandler(app);

  // ─── Request/response observability ─────────────────────────────────────────
  app.addHook("onRequest", async (req) => {
    (req as unknown as { _startHrTime: bigint })._startHrTime =
      process.hrtime.bigint();
    log.debug(
      {
        method: req.method,
        url: req.url,
        ip: req.ip,
        reqId: req.id,
      },
      "req"
    );
  });
  app.addHook("onResponse", async (req, reply) => {
    const start = (req as unknown as { _startHrTime?: bigint })._startHrTime;
    const durMs = start
      ? Number(process.hrtime.bigint() - start) / 1_000_000
      : 0;
    const route = (req as unknown as { routeOptions?: { url?: string } })
      .routeOptions?.url ?? req.url;
    const labels = {
      method: req.method,
      route,
      status: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationMs.observe(labels, durMs);
  });

  // ─── Health + metrics ───────────────────────────────────────────────────────
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/readyz", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      await cache.client.ping();
      return reply.send({ status: "ready" });
    } catch (err) {
      log.error({ err }, "readiness check failed");
      return reply.code(503).send({ status: "degraded" });
    }
  });

  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });

  // ─── Quota hooks (Sprint 2) ─────────────────────────────────────────────────
  // Runs after route authGuards: assertQuota on preHandler, recordUsage on
  // onResponse. Skips /health, /readyz, /metrics, /auth, /vendor-admin.
  registerApiCallsQuota(app, { quotas, log });

  // ─── Routes ─────────────────────────────────────────────────────────────────
  await registerAuthRoutes(app, {
    service: authService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
    guardPortal: {
      tokens,
      expectedAudience: AUDIENCE.portal,
      tenantStatus,
    },
  });

  await registerCrmRoutes(app, {
    accounts: accountsService,
    contacts: contactsService,
    leads: leadsService,
    deals: dealsService,
    tickets: ticketsService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
    requireFeature,
  });

  // Sprint 3 — /vendor-admin/* surface. Lives alongside tenant routes but
  // uses the BYPASSRLS `vendorPool` via the services wired above.
  await registerVendorRoutes(app, {
    authService: vendorAuthService,
    adminService: vendorAdminService,
    guard: { tokens },
  });

  // ─── Start ──────────────────────────────────────────────────────────────────
  await app.listen({ port: env.port, host: env.host });
  log.info({ port: env.port, host: env.host }, "api listening");

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await vendorPool.end().catch(() => undefined);
    await cache.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[api] fatal:", err);
  process.exit(1);
});
