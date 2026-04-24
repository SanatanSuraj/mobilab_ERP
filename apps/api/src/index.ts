/**
 * apps/api — Fastify server.
 *
 * Surface:
 *   /health         liveness
 *   /readyz         readiness (pg + redis)
 *   /metrics        Prometheus
 *   /auth/*         login / refresh / logout / me                (phase 1)
 *   /crm/*          accounts / contacts / leads / deals / tickets (phase 2)
 *   /inventory/*    items / warehouses / stock ledger + summary  (phase 2)
 *   /procurement/*  vendors / indents / purchase orders / GRNs   (phase 2)
 *   /production/*   products / BOMs / work orders / WIP stages   (phase 2)
 *   /qc/*           inspection templates / inspections / certs    (phase 2)
 */

// Tracing first so pg + http get auto-instrumented.
import { initTracing } from "@instigenie/observability/tracing";
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
} from "@instigenie/observability";
import { installNumericTypeParser } from "@instigenie/db";
import { AUDIENCE, validatePermissionMap } from "@instigenie/contracts";
import { Cache } from "@instigenie/cache";
import {
  FeatureFlagService,
  PlanResolverService,
  QuotaService,
} from "@instigenie/quotas";
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
import { QuotationsService } from "./modules/crm/quotations.service.js";
import { SalesOrdersService } from "./modules/crm/sales-orders.service.js";
import { registerCrmRoutes } from "./modules/crm/routes.js";
import { ItemsService } from "./modules/inventory/items.service.js";
import { WarehousesService } from "./modules/inventory/warehouses.service.js";
import { StockService } from "./modules/inventory/stock.service.js";
import { ReservationsService } from "./modules/inventory/reservations.service.js";
import { registerInventoryRoutes } from "./modules/inventory/routes.js";
import { VendorsService } from "./modules/procurement/vendors.service.js";
import { IndentsService } from "./modules/procurement/indents.service.js";
import { PurchaseOrdersService } from "./modules/procurement/purchase-orders.service.js";
import { GrnsService } from "./modules/procurement/grns.service.js";
import { registerProcurementRoutes } from "./modules/procurement/routes.js";
import { ProductsService } from "./modules/production/products.service.js";
import { BomsService } from "./modules/production/boms.service.js";
import { WorkOrdersService } from "./modules/production/work-orders.service.js";
import { DeviceInstancesService } from "./modules/production/device-instances.service.js";
import { registerProductionRoutes } from "./modules/production/routes.js";
import { InspectionTemplatesService } from "./modules/qc/templates.service.js";
import { QcInspectionsService } from "./modules/qc/inspections.service.js";
import { QcCertsService } from "./modules/qc/certs.service.js";
import { registerQcRoutes } from "./modules/qc/routes.js";
import { SalesInvoicesService } from "./modules/finance/sales-invoices.service.js";
import { PurchaseInvoicesService } from "./modules/finance/purchase-invoices.service.js";
import { PaymentsService } from "./modules/finance/payments.service.js";
import {
  CustomerLedgerService,
  VendorLedgerService,
} from "./modules/finance/ledger.service.js";
import { FinanceOverviewService } from "./modules/finance/overview.service.js";
import { registerFinanceRoutes } from "./modules/finance/routes.js";
import { NotificationTemplatesService } from "./modules/notifications/templates.service.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";
import { registerNotificationsRoutes } from "./modules/notifications/routes.js";
import { ApprovalsService } from "./modules/approvals/approvals.service.js";
import { registerApprovalsRoutes } from "./modules/approvals/routes.js";
import { AdminAuditService } from "./modules/admin-audit/service.js";
import { registerAdminAuditRoutes } from "./modules/admin-audit/routes.js";
import { AdminUsersService } from "./modules/admin-users/service.js";
import { registerAdminUsersRoutes } from "./modules/admin-users/routes.js";
import { EsignatureService } from "./modules/esignature/service.js";
import { VendorAuthService, VendorAdminService } from "@instigenie/vendor-admin";
import { registerVendorRoutes } from "./modules/vendor/routes.js";
import { PortalService, registerPortalRoutes } from "./modules/portal/index.js";

/**
 * Result of a single buildApp() call. Tests and main() both consume this —
 * tests need handles on pool/vendorPool/cache to close them in afterAll,
 * main() needs them for the SIGTERM shutdown sequence.
 */
export interface BuiltApp {
  app: ReturnType<typeof Fastify>;
  pool: pg.Pool;
  vendorPool: pg.Pool;
  cache: Cache;
  env: ReturnType<typeof loadEnv>;
}

/**
 * Factory — constructs the Fastify app with every plugin and route wired,
 * WITHOUT calling app.listen(). Tests import this and drive the app via
 * `app.inject()` so the full preHandler stack (auth → RBAC → feature-flag →
 * quota → handler) is exercised without opening a socket.
 *
 * Returns the resource handles so callers (test harnesses and the main()
 * entry) can tear them down cleanly.
 */
export async function buildApp(): Promise<BuiltApp> {
  const env = loadEnv();
  const log = createLogger({ service: "api", level: env.logLevel });

  // Sanity-check the permission catalogue at boot — catches typos that
  // would otherwise fail at first request. Phase-1 Gate 6 belt-and-braces.
  validatePermissionMap();

  installNumericTypeParser();

  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
    max: 10,
    application_name: "instigenie-api",
  });

  // Sprint 3 — the vendor-admin pool connects as `instigenie_vendor`
  // (BYPASSRLS). Tenant-side code MUST NOT use this pool; keeping the two
  // variables alongside each other in main() makes the distinction explicit
  // at the point where they're created. See ops/sql/seed/98-vendor-role.sql.
  const vendorPool = new pg.Pool({
    connectionString: env.vendorDatabaseUrl,
    max: 5,
    application_name: "instigenie-api-vendor",
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

  // E-signature primitive — Phase 4 §4.2 / §9.5. Shared across any
  // critical action that requires password re-entry. Constructed BEFORE
  // the services that depend on it (StockService, SalesInvoicesService,
  // ApprovalsService, QcInspectionsService) so each one can take it in
  // its deps struct. Never construct one ad-hoc in a handler — the
  // pepper MUST come from the single env load.
  const esignatureService = new EsignatureService({
    pool,
    pepper: env.esignaturePepper,
  });

  // CRM services — each one is a thin orchestrator over a pg.Pool + withRequest.
  const accountsService = new AccountsService(pool);
  const contactsService = new ContactsService(pool);
  const leadsService = new LeadsService(pool);
  const dealsService = new DealsService(pool);
  const ticketsService = new TicketsService(pool);
  const quotationsService = new QuotationsService(pool);
  const salesOrdersService = new SalesOrdersService(pool);

  // Inventory services — Phase 2 §12.1 #3. Same shape as CRM services: one
  // per domain aggregate, all sharing the RLS-enforced `pool`.
  //
  // StockService takes the esignature dep so postEntry() enforces
  // password re-entry on SCRAP (stock write-off) and CUSTOMER_ISSUE
  // (device release) per Phase 4 §9.5. itemsService / warehousesService
  // are pure CRUD with no critical actions — plain pool is fine.
  const itemsService = new ItemsService(pool);
  const warehousesService = new WarehousesService(pool);
  const stockService = new StockService({
    pool,
    esignature: esignatureService,
  });
  // Phase 3 §3.2 — concurrency-safe reservations on top of stock_summary.
  const reservationsService = new ReservationsService(pool);

  // Procurement services — Phase 2 §12.1 #4. Vendors + indents + POs + GRNs.
  // GRNs.post() writes to stock_ledger, so these services live downstream
  // of StockService (which is accessed via stockRepo from the shared pool).
  const vendorsService = new VendorsService(pool);
  const indentsService = new IndentsService(pool);
  const purchaseOrdersService = new PurchaseOrdersService(pool);
  const grnsService = new GrnsService(pool);

  // Production services — Phase 2 §12.1 #5 / §13.2. Products + BOMs + WOs.
  // Gated by `module.manufacturing`. BOM activation atomically supersedes the
  // prior ACTIVE bom and flips products.active_bom_id. WO creation copies the
  // per-family wip_stage_templates into per-WO wip_stages instances.
  const productsService = new ProductsService(pool);
  const bomsService = new BomsService(pool);
  const workOrdersService = new WorkOrdersService(pool);
  const deviceInstancesService = new DeviceInstancesService(pool);

  // QC services — Phase 2 §12.1 #6 / §13.4. Inspection templates, inspections
  // with DRAFT → IN_PROGRESS → PASSED/FAILED lifecycle, and append-only
  // certificates issued on PASSED FINAL_QC. Gated by `module.manufacturing`.
  const qcTemplatesService = new InspectionTemplatesService(pool);
  const qcInspectionsService = new QcInspectionsService(pool);
  const qcCertsService = new QcCertsService(pool);

  // Finance services — Phase 2 §12.1 #7 / §13.6. Sales + purchase invoices
  // with DRAFT → POSTED → CANCELLED lifecycle, append-only customer/vendor
  // ledgers with computed running balance, and polymorphic payments that
  // can settle N invoices atomically (with void reversal). CORE module —
  // not feature-flagged. Phase 4 §4.2c injects EsignatureService into
  // SalesInvoicesService so POST rejects missing password + HMAC-stamps
  // signature_hash on the row.
  const salesInvoicesService = new SalesInvoicesService({
    pool,
    esignature: esignatureService,
  });
  const purchaseInvoicesService = new PurchaseInvoicesService(pool);
  const paymentsService = new PaymentsService(pool);
  const customerLedgerService = new CustomerLedgerService(pool);
  const vendorLedgerService = new VendorLedgerService(pool);
  const financeOverviewService = new FinanceOverviewService(pool);

  // Notifications services — Phase 2 §12.1 #8 / §13.7. Record-only in-app
  // feed + template library. No dispatch in Phase 2 (that's Phase 3 event-bus
  // wiring). CORE module — every tenant gets it, no feature flag.
  const notificationTemplatesService = new NotificationTemplatesService(pool);
  const notificationsService = new NotificationsService(pool);

  // Approvals service — Phase 3 §3.3. Chain-driven workflow engine with
  // e-signature support and an append-only workflow_transitions audit
  // log. Phase 4 §4.2 injects EsignatureService so requires_e_signature
  // steps actually validate the re-entered password before advancing.
  const approvalsService = new ApprovalsService({
    pool,
    esignature: esignatureService,
  });

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
    // Dev-only bypass so local load tests (tests/load/) aren't strangled
    // by the 300/min per-IP limit — every k6 VU shares 127.0.0.1, which
    // turns the global limit into effectively ~5 rps total. Only honoured
    // when NODE_ENV !== "production" — in prod the header is ignored.
    allowList: (req) =>
      process.env.NODE_ENV !== "production" &&
      req.headers["x-load-test-bypass"] === "instigenie-dev-loadtest",
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
    quotations: quotationsService,
    salesOrders: salesOrdersService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
    requireFeature,
  });

  await registerInventoryRoutes(app, {
    items: itemsService,
    warehouses: warehousesService,
    stock: stockService,
    reservations: reservationsService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
    requireFeature,
  });

  await registerProcurementRoutes(app, {
    vendors: vendorsService,
    indents: indentsService,
    purchaseOrders: purchaseOrdersService,
    grns: grnsService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
    requireFeature,
  });

  await registerProductionRoutes(app, {
    products: productsService,
    boms: bomsService,
    workOrders: workOrdersService,
    deviceInstances: deviceInstancesService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
    requireFeature,
  });

  await registerQcRoutes(app, {
    templates: qcTemplatesService,
    inspections: qcInspectionsService,
    certs: qcCertsService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
    requireFeature,
  });

  await registerFinanceRoutes(app, {
    salesInvoices: salesInvoicesService,
    purchaseInvoices: purchaseInvoicesService,
    payments: paymentsService,
    customerLedger: customerLedgerService,
    vendorLedger: vendorLedgerService,
    overview: financeOverviewService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
  });

  await registerNotificationsRoutes(app, {
    templates: notificationTemplatesService,
    notifications: notificationsService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
  });

  await registerApprovalsRoutes(app, {
    approvals: approvalsService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
  });

  // Phase 4 §4.2 — tenant-facing admin audit dashboard at /admin/audit/*.
  // Reads audit.log (RLS-scoped), joins users for actor-name hydration,
  // gated behind `admin:audit:read`.
  const adminAuditService = new AdminAuditService(pool);
  await registerAdminAuditRoutes(app, {
    service: adminAuditService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
  });

  // User-invitation flow. Admin routes (invite/list/revoke) at
  // /admin/users/* guarded by `users:invite`; public accept routes at
  // /auth/accept-invite(/preview) authenticated by the raw token carried
  // in the email URL. Worker handler `user-invite-created` (see
  // apps/worker/src/handlers/user-invite-created.ts) consumes the outbox
  // event emitted by invite() and writes to invitation_emails.
  const adminUsersService = new AdminUsersService({
    pool,
    tokens,
    refreshTtlSec: env.refreshTokenTtlSec,
    tenantStatus,
    webOrigin: env.webOrigin,
    // Emit dev accept URL on the invite response for any non-prod build so
    // the dashboard can link straight to the accept page without an email.
    includeDevAcceptUrl: env.nodeEnv !== "production",
  });
  await registerAdminUsersRoutes(app, {
    service: adminUsersService,
    guardInternal: {
      tokens,
      expectedAudience: AUDIENCE.internal,
      tenantStatus,
    },
  });

  // Sprint 3 — /vendor-admin/* surface. Lives alongside tenant routes but
  // uses the BYPASSRLS `vendorPool` via the services wired above.
  await registerVendorRoutes(app, {
    authService: vendorAuthService,
    adminService: vendorAdminService,
    guard: { tokens },
  });

  // Phase 3 §3.7 — Customer portal surface at /portal/*.
  //
  // Rate limit: 60 rpm/user. We build a route-scoped limiter via
  // app.rateLimit({...}) — the global limiter registered above stays at
  // 300/min/IP for every other surface. keyGenerator prefers user.id (set
  // by guardPortal before this runs) and falls back to ip so that an
  // unauthenticated probe can't evade the cap by omitting the header.
  //
  // Audience fencing: registerPortalRoutes uses guardPortal (expectedAudience
  // = instigenie-portal), which rejects internal tokens on JWT verify. The
  // internal routes above already use guardInternal, which symmetrically
  // rejects portal tokens. So "portal tokens blocked from non-/portal/* " is
  // enforced at the JWT layer — no per-route hook needed.
  const portalService = new PortalService({ pool });
  const portalRateLimit = app.rateLimit({
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.user?.id ?? req.ip ?? "anon",
  });
  await registerPortalRoutes(app, {
    service: portalService,
    pool,
    guardPortal: {
      tokens,
      expectedAudience: AUDIENCE.portal,
      tenantStatus,
    },
    portalRateLimit,
  });

  return { app, pool, vendorPool, cache, env };
}

/**
 * Production entry point. Builds the app, binds the listener, and wires
 * SIGTERM/SIGINT to close resources. Tests never call this — they call
 * `buildApp()` directly and use `app.inject()`.
 */
async function main(): Promise<void> {
  const built = await buildApp();
  const { app, pool, vendorPool, cache, env } = built;
  const log = createLogger({ service: "api", level: env.logLevel });

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

// Only launch the server when NOT running under Vitest. Vitest sets
// process.env.VITEST automatically, so importing `buildApp` from a test
// file does not trigger the listen() side-effect.
if (!process.env.VITEST) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[api] fatal:", err);
    process.exit(1);
  });
}
