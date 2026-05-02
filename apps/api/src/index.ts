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
import { createBullConnection } from "@instigenie/queue";
import {
  FeatureFlagService,
  PlanResolverService,
  QuotaService,
} from "@instigenie/quotas";
import { loadEnv } from "./env.js";
import { runBootstrapPolicy } from "./bootstrap-policy.js";
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
import { DealApprovalsService } from "./modules/crm/deal-approvals.service.js";
import { TicketsService } from "./modules/crm/tickets.service.js";
import { QuotationsService } from "./modules/crm/quotations.service.js";
import { SalesOrdersService } from "./modules/crm/sales-orders.service.js";
import { CrmReportsService } from "./modules/crm/reports.service.js";
import { registerCrmRoutes } from "./modules/crm/routes.js";
import { ItemsService } from "./modules/inventory/items.service.js";
import { WarehousesService } from "./modules/inventory/warehouses.service.js";
import { StockService } from "./modules/inventory/stock.service.js";
import { ReservationsService } from "./modules/inventory/reservations.service.js";
import { InventoryReportsService } from "./modules/inventory/reports.service.js";
import { registerInventoryRoutes } from "./modules/inventory/routes.js";
import { VendorsService } from "./modules/procurement/vendors.service.js";
import { IndentsService } from "./modules/procurement/indents.service.js";
import { PurchaseOrdersService } from "./modules/procurement/purchase-orders.service.js";
import { PoApprovalsService } from "./modules/procurement/po-approvals.service.js";
import { GrnsService } from "./modules/procurement/grns.service.js";
import { ProcurementReportsService } from "./modules/procurement/reports.service.js";
import { registerProcurementRoutes } from "./modules/procurement/routes.js";
import { ProductsService } from "./modules/production/products.service.js";
import { BomsService } from "./modules/production/boms.service.js";
import { WorkOrdersService } from "./modules/production/work-orders.service.js";
import { WoApprovalsService } from "./modules/production/wo-approvals.service.js";
import { DeviceInstancesService } from "./modules/production/device-instances.service.js";
import { MrpService } from "./modules/production/mrp.service.js";
import { ReportsService } from "./modules/production/reports.service.js";
import { EcnsService } from "./modules/production/ecns.service.js";
import { ProductionOverviewService } from "./modules/production/overview.service.js";
import { registerProductionRoutes } from "./modules/production/routes.js";
import { InspectionTemplatesService } from "./modules/qc/templates.service.js";
import { QcInspectionsService } from "./modules/qc/inspections.service.js";
import { QcCertsService } from "./modules/qc/certs.service.js";
import {
  QcCapaService,
  QcEquipmentService,
} from "./modules/qc/aux.service.js";
import { QcReportsService } from "./modules/qc/reports.service.js";
import { registerQcRoutes } from "./modules/qc/routes.js";
import { SalesInvoicesService } from "./modules/finance/sales-invoices.service.js";
import { PurchaseInvoicesService } from "./modules/finance/purchase-invoices.service.js";
import { PaymentsService } from "./modules/finance/payments.service.js";
import {
  CustomerLedgerService,
  VendorLedgerService,
} from "./modules/finance/ledger.service.js";
import { FinanceOverviewService } from "./modules/finance/overview.service.js";
import { EwayBillsService } from "./modules/finance/eway-bills.service.js";
import { FinanceReportsService } from "./modules/finance/reports.service.js";
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
import { PasswordResetService } from "./modules/password-reset/service.js";
import { registerPasswordResetRoutes } from "./modules/password-reset/routes.js";
import { VendorPasswordResetService } from "./modules/vendor-password-reset/service.js";
import { registerVendorPasswordResetRoutes } from "./modules/vendor-password-reset/routes.js";
import { OnboardingService } from "./modules/onboarding/service.js";
import { registerOnboardingRoutes } from "./modules/onboarding/routes.js";
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
  /**
   * Lightweight ioredis client pointed at redis-bull, owned by the API
   * process for liveness probing only — the API does not enqueue jobs
   * (the worker does). Exposed so the main()-side shutdown can quit
   * it cleanly alongside `pool` and `cache`.
   */
  bullProbe: ReturnType<typeof createBullConnection>;
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

  // Resilience: a pg.Pool emits "error" on every idle-client failure
  // (TCP RST when Postgres restarts, libpq EOF mid-pool-recycle, …). If
  // these events have no listener, Node treats them as unhandled and
  // crashes the process — verified in chaos testing where `docker stop
  // instigenie-postgres` killed the API. The handler logs and lets pg
  // recycle the bad client; in-flight queries fail naturally with a
  // 5xx that the global error handler converts to RFC7807, and the
  // next request opens a fresh client once Postgres is back.
  pool.on("error", (err) => {
    log.error({ err }, "pg pool error (idle client)");
  });
  vendorPool.on("error", (err) => {
    log.error({ err }, "pg vendor pool error (idle client)");
  });

  const cache = new Cache({ url: env.cacheRedisUrl });
  await cache.connect();
  // Same rationale as the pg.Pool listener — ioredis emits "error" on
  // every reconnect attempt while the server is unreachable, which
  // would crash the process without a listener. The cache itself
  // continues to retry in the background; downstream code that calls
  // `cache.client.*` will get a rejected promise and surface a 5xx
  // (caught by the global error handler).
  cache.client.on("error", (err) => {
    log.error({ err: { code: (err as { code?: string }).code, message: err.message } },
              "redis cache client error");
  });

  // Bull-redis health probe. The API itself doesn't enqueue jobs (the
  // worker does), but readiness must reflect the *whole* job pipeline
  // is up — a bull outage means notifications/PDF render/outbox don't
  // fire even though Postgres is fine. Construction is lazyConnect so
  // it doesn't block boot, and the "error" listener prevents the same
  // process-crash failure mode as the cache client.
  const bullProbe = createBullConnection(env.bullRedisUrl);
  bullProbe.on("error", (err) => {
    log.error({ err: { code: (err as { code?: string }).code, message: err.message } },
              "redis bull probe error");
  });

  // Verify the database is bootstrapped correctly BEFORE we wire any
  // services. RLS not enabled on a tenant table would mean every
  // subsequent query bypasses tenant isolation — refuse to start. Tests
  // that drive `buildApp()` against a hand-rolled minimal schema can opt
  // out via SKIP_BOOTSTRAP_POLICY=1.
  if (process.env.SKIP_BOOTSTRAP_POLICY !== "1") {
    await runBootstrapPolicy(pool, log);
  }

  const tokens = new TokenFactory({
    secret: new TextEncoder().encode(env.jwtSecret),
    issuer: env.jwtIssuer,
    accessTokenTtlSec: env.accessTokenTtlSec,
  });

  // Sprint 1B — tenant lifecycle gate. Shared singleton: AuthService uses
  // it at token-issue time, AuthGuard uses it on every request.
  //
  // Cache wiring (added 2026-05): the row is memoized in Redis with a
  // 30s TTL. Eliminates a DB round-trip on every authenticated request
  // after the first within the window. See service.ts header for the
  // eventual-consistency rationale and invalidate() for the override.
  const tenantStatus = new TenantStatusService({ pool, cache });

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
    // Reuse the cache Redis client for the per-account brute-force
    // counter — separate logical Redis DB from BullMQ so a queue flush
    // never wipes lockout state.
    lockoutStore: cache.client,
    // /auth/me cache (60s TTL). Hits on every page mount; caching here
    // eliminates the users + user_roles roundtrip on the common path.
    // See AuthService.invalidateMe for the post-write override.
    cache,
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
  // Quotations + deal-discount approvals share the central ApprovalsService.
  // The services themselves are constructed below the approvalsService block
  // so the dispatcher reference is available at construction. Forward
  // declarations stay implicit — TypeScript's `const` in this scope captures
  // them in the closure passed to registerCrmRoutes.
  const accountsService = new AccountsService(pool);
  const contactsService = new ContactsService(pool);
  const leadsService = new LeadsService(pool);
  const dealsService = new DealsService(pool);
  const ticketsService = new TicketsService(pool);
  const salesOrdersService = new SalesOrdersService(pool);
  const crmReportsService = new CrmReportsService(pool);

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
  const inventoryReportsService = new InventoryReportsService(pool);

  // Procurement services — Phase 2 §12.1 #4. Vendors + indents + POs + GRNs.
  // GRNs.post() writes to stock_ledger, so these services live downstream
  // of StockService (which is accessed via stockRepo from the shared pool).
  // PoApprovalsService is constructed below, after ApprovalsService, so
  // submit-for-approval can dispatch into the central approvals workflow.
  const vendorsService = new VendorsService(pool);
  const indentsService = new IndentsService(pool);
  const purchaseOrdersService = new PurchaseOrdersService(pool);
  const grnsService = new GrnsService(pool);
  const procurementReportsService = new ProcurementReportsService(pool);

  // Production services — Phase 2 §12.1 #5 / §13.2. Products + BOMs + WOs.
  // Gated by `module.manufacturing`. BOM activation atomically supersedes the
  // prior ACTIVE bom and flips products.active_bom_id. WO creation copies the
  // per-family wip_stage_templates into per-WO wip_stages instances.
  const productsService = new ProductsService(pool);
  const bomsService = new BomsService(pool);
  const workOrdersService = new WorkOrdersService(pool);
  const deviceInstancesService = new DeviceInstancesService(pool);
  const mrpService = new MrpService(pool);
  const reportsService = new ReportsService(pool);
  const ecnsService = new EcnsService(pool);
  const productionOverviewService = new ProductionOverviewService(pool);

  // QC services — Phase 2 §12.1 #6 / §13.4. Inspection templates, inspections
  // with DRAFT → IN_PROGRESS → PASSED/FAILED lifecycle, and append-only
  // certificates issued on PASSED FINAL_QC. Gated by `module.manufacturing`.
  const qcTemplatesService = new InspectionTemplatesService(pool);
  const qcInspectionsService = new QcInspectionsService(pool);
  const qcCertsService = new QcCertsService(pool);
  const qcEquipmentService = new QcEquipmentService(pool);
  const qcCapaService = new QcCapaService(pool);
  const qcReportsService = new QcReportsService(pool);

  // Finance services — Phase 2 §12.1 #7 / §13.6. Sales + purchase invoices
  // with DRAFT → AWAITING_APPROVAL → POSTED → CANCELLED lifecycle,
  // append-only customer/vendor ledgers with computed running balance, and
  // polymorphic payments that can settle N invoices atomically (with void
  // reversal). CORE module — not feature-flagged.
  //
  // SalesInvoicesService is constructed *below* approvalsService because
  // submit-for-posting opens an `invoice` approval_request inside the same
  // transaction. The HMAC e-signature is now captured at the chain's
  // terminal step (per the seed in 14-approvals-dev-data.sql) — the
  // signature_hash arrives via the finaliser context and is stamped onto
  // the row by `applyDecisionFromApprovals`.
  const purchaseInvoicesService = new PurchaseInvoicesService(pool);
  const paymentsService = new PaymentsService(pool);
  const customerLedgerService = new CustomerLedgerService(pool);
  const vendorLedgerService = new VendorLedgerService(pool);
  const financeOverviewService = new FinanceOverviewService(pool);
  const ewayBillsService = new EwayBillsService(pool);
  const financeReportsService = new FinanceReportsService(pool);

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

  // PoApprovalsService takes a reference to ApprovalsService so submit-for-
  // approval can open an approval_request inside the same transaction as
  // the DRAFT→PENDING_APPROVAL flip. The reverse edge (approval decision
  // → PO header update) is wired below via registerFinaliser to break the
  // construction-time circular dependency between the two services.
  const poApprovalsService = new PoApprovalsService({
    pool,
    approvals: approvalsService,
  });
  approvalsService.registerFinaliser("purchase_order", (client, ctx) =>
    poApprovalsService.applyDecisionFromApprovals(client, ctx),
  );
  // Cancel-finaliser: reverts PO PENDING_APPROVAL → DRAFT inside the
  // approval-cancel transaction so cancelling the approval doesn't
  // orphan the PO header in an unsubmittable, uneditable limbo.
  approvalsService.registerCancelFinaliser("purchase_order", (client, ctx) =>
    poApprovalsService.applyCancelFromApprovals(client, ctx),
  );

  // Quotation + deal-discount approvals — same shape as PoApprovalsService.
  // QuotationsService takes the deps form so transitionStatus() can dispatch
  // into approvals; the finaliser wires the decision → quotation status flip.
  const quotationsService = new QuotationsService({
    pool,
    approvals: approvalsService,
  });
  approvalsService.registerFinaliser("quotation", (client, ctx) =>
    quotationsService.applyDecisionFromApprovals(client, ctx),
  );

  const dealApprovalsService = new DealApprovalsService({
    pool,
    approvals: approvalsService,
  });
  approvalsService.registerFinaliser("deal_discount", (client, ctx) =>
    dealApprovalsService.applyDecisionFromApprovals(client, ctx),
  );

  // Sales invoice — same shape. submit-for-posting flips DRAFT →
  // AWAITING_APPROVAL and opens the approval_request; the finaliser
  // posts (APPROVED) or reverts (REJECTED) inside the act() transaction.
  const salesInvoicesService = new SalesInvoicesService({
    pool,
    approvals: approvalsService,
  });
  approvalsService.registerFinaliser("invoice", (client, ctx) =>
    salesInvoicesService.applyDecisionFromApprovals(client, ctx),
  );
  // Cancel-finaliser: AWAITING_APPROVAL → DRAFT, mirroring the REJECT
  // path. Without this, the cancel handler in SalesInvoicesService.cancel
  // (which already requires the approval be cancelled first) would never
  // see the invoice leave AWAITING_APPROVAL.
  approvalsService.registerCancelFinaliser("invoice", (client, ctx) =>
    salesInvoicesService.applyCancelFromApprovals(client, ctx),
  );

  // Work-order approvals — chain seeded in 14-approvals-dev-data.sql with
  // the standard 3-band shape (default <5L, 5L–20L, ≥20L). Finaliser:
  // APPROVED flips PLANNED → MATERIAL_CHECK (release for production);
  // REJECTED flips PLANNED → CANCELLED. Without this registration the
  // chain would be inert — `approvalsService.act()` would still finalise
  // the request but the WO header would never reflect the decision.
  const woApprovalsService = new WoApprovalsService({
    pool,
    approvals: approvalsService,
  });
  approvalsService.registerFinaliser("work_order", (client, ctx) =>
    woApprovalsService.applyDecisionFromApprovals(client, ctx),
  );

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
    webOrigin: env.webOrigin,
    // Same dev-only treatment as the tenant-side admin invite flow:
    // surface the raw accept URL on the response so vendor admins can
    // hand it over without SMTP wired up.
    includeDevAcceptUrl: env.nodeEnv !== "production",
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
    // Return RFC7807 Problem+JSON with the correct 429 status. Without
    // this builder the plugin throws a FastifyError that the global
    // error handler can't match, ending up as a generic 500 — which
    // both leaks "this is unhandled" and breaks 4xx/5xx SLO accounting.
    errorResponseBuilder: (req, ctx) => ({
      type: "https://instigenie.dev/problems/rate_limited",
      title: "rate_limited",
      status: 429,
      detail: `Rate limit exceeded, retry in ${ctx.after}`,
      instance: req.url,
      code: "rate_limited",
      details: { limit: ctx.max, ttl: ctx.ttl, retryAfter: ctx.after },
    }),
  });

  // ─── Per-credential rate-limit configs for unauth surfaces ─────────────────
  //
  // The global 300/min/IP limiter above is fine for browsing but laughably
  // wide for credential-stuffing (300 attempts/min × botnet-scale IPs). These
  // configs are applied per-route via { config: { rateLimit: ... } } and key
  // on the email from the request body so the same email can't be hammered
  // from many IPs simultaneously.
  //
  // NOTE: @fastify/rate-limit v10's `app.rateLimit(opts)` returns a marker
  // preHandler that does nothing on its own — the real per-route override is
  // the `config.rateLimit` object the route handler reads at registration
  // time. Pass these objects to the route registrars instead of a preHandler.
  //
  // Both fall back to req.ip when the body is missing/malformed so the
  // limiter still fires on a flood of garbage POSTs.
  function emailKey(req: import("fastify").FastifyRequest): string {
    const body = req.body as { email?: unknown } | undefined;
    const raw = typeof body?.email === "string" ? body.email : null;
    const email = raw?.trim().toLowerCase();
    return email && email.length > 0 ? `email:${email}` : `ip:${req.ip ?? "anon"}`;
  }

  const allowLoadTestBypass = (req: import("fastify").FastifyRequest) =>
    process.env.NODE_ENV !== "production" &&
    req.headers["x-load-test-bypass"] === "instigenie-dev-loadtest";

  // Per-route 429 builder. The global one above is set on the plugin
  // registration; per-route configs do NOT inherit it, so without this
  // override an exceeded route-level limit throws a generic FastifyError
  // that the problem handler turns into a 500.
  const credentialRateLimitErrorResponse = (
    req: import("fastify").FastifyRequest,
    ctx: { max: number; ttl: number; after: string },
  ) => ({
    type: "https://instigenie.dev/problems/rate_limited",
    title: "rate_limited",
    status: 429,
    detail: `Too many attempts for this account, retry in ${ctx.after}`,
    instance: req.url,
    code: "rate_limited",
    details: { limit: ctx.max, ttl: ctx.ttl, retryAfter: ctx.after },
  });

  // `hook: "preHandler"` is REQUIRED — @fastify/rate-limit defaults to
  // onRequest, which fires BEFORE body parsing, so the email-from-body
  // keyGenerator above would see `req.body === undefined` and fall back
  // to req.ip every time. preHandler runs after preValidation, so the
  // body is parsed and emailKey() returns the real per-account key.

  // Login: 5 attempts / minute / email. Tight enough to make brute-force
  // expensive, loose enough to survive a legit user mis-typing twice.
  const loginRateLimit = {
    max: 5,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: emailKey,
    allowList: allowLoadTestBypass,
    errorResponseBuilder: credentialRateLimitErrorResponse,
  } as const;

  // Forgot-password: 5 attempts / hour / email. Defends against email-bomb
  // abuse. The service-layer PasswordResetService also has a 5/hour DB-side
  // limit; this is a cheaper upstream sieve so the DB never sees the spam.
  const forgotPasswordRateLimit = {
    max: 5,
    timeWindow: "1 hour",
    hook: "preHandler",
    keyGenerator: emailKey,
    allowList: allowLoadTestBypass,
    errorResponseBuilder: credentialRateLimitErrorResponse,
  } as const;

  registerProblemHandler(app);

  // Echo Fastify's per-request `req.id` back to the caller. Without
  // this header a customer-reported error has no field to grep against
  // server logs — the value is already the `reqId` field on every
  // pino log line, so SREs only need to ask "what request id did your
  // browser see" to pull the full trace.
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

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
  // `/health` is the canonical name; `/healthz` is the same handler so
  // Kubernetes-style probes (which conventionally hit `*z` paths) and
  // generic uptime monitors that use either spelling both succeed.
  const healthHandler = async () => ({ status: "ok" });
  app.get("/health", healthHandler);
  app.get("/healthz", healthHandler);

  app.get("/readyz", async (_req, reply) => {
    // Probe every external dependency the request path needs. A
    // partial-up state (e.g. Postgres healthy but bull dead) means
    // we'd accept traffic that creates rows whose downstream jobs
    // never fire — caller never sees notifications, outbox builds up
    // unboundedly. Better to shed traffic until the whole pipeline
    // is healthy.
    //
    // Per-probe timeout matters: ioredis "offline queue" makes a
    // ping() hang for the full reconnect window when the server is
    // gone — without the race the readiness probe itself would time
    // out the LB instead of cleanly returning 503. 1500ms gives a
    // healthy server plenty of headroom while shedding traffic
    // promptly when something is dead.
    const PROBE_TIMEOUT_MS = 1500;
    const checks: Array<{ name: string; ok: boolean; err?: string }> = [];
    const withTimeout = async <T>(p: Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`probe timeout after ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        );
        p.then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e) => {
            clearTimeout(t);
            reject(e);
          },
        );
      });
    const probe = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await withTimeout(fn());
        checks.push({ name, ok: true });
      } catch (err) {
        checks.push({
          name,
          ok: false,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };
    await Promise.all([
      probe("postgres", () => pool.query("SELECT 1")),
      probe("redis-cache", () => cache.client.ping()),
      probe("redis-bull", () => bullProbe.ping()),
    ]);
    const allOk = checks.every((c) => c.ok);
    if (!allOk) {
      log.warn({ checks }, "readiness check failed");
      return reply.code(503).send({ status: "degraded", checks });
    }
    return reply.send({ status: "ready", checks });
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
    loginRateLimit,
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
    dealApprovals: dealApprovalsService,
    tickets: ticketsService,
    quotations: quotationsService,
    salesOrders: salesOrdersService,
    reports: crmReportsService,
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
    reports: inventoryReportsService,
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
    poApprovals: poApprovalsService,
    grns: grnsService,
    reports: procurementReportsService,
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
    woApprovals: woApprovalsService,
    deviceInstances: deviceInstancesService,
    mrp: mrpService,
    reports: reportsService,
    ecns: ecnsService,
    overview: productionOverviewService,
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
    equipment: qcEquipmentService,
    capa: qcCapaService,
    reports: qcReportsService,
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
    ewayBills: ewayBillsService,
    reports: financeReportsService,
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

  // Password reset — three public (unauthenticated) endpoints. The reset
  // token in the email IS the auth. Tables touched (user_identities,
  // password_reset_tokens, refresh_tokens) are global / no-RLS, so the
  // service uses a bare pool. devResetUrl is appended to the
  // forgot-password response in non-prod so QA / curl loops can advance
  // the flow without a real mailbox.
  const passwordResetService = new PasswordResetService({
    pool,
    webOrigin: env.webOrigin,
    includeDevResetUrl: env.nodeEnv !== "production",
  });
  await registerPasswordResetRoutes(app, {
    service: passwordResetService,
    forgotPasswordRateLimit,
  });

  // Onboarding — guided post-invite setup wizard. Reuses existing
  // warehouse/item/account/vendor repos for the optional sample-data
  // seed (1 row per resource), all inside one transaction so a
  // partial-seed retry can re-attempt cleanly.
  const onboardingService = new OnboardingService({ pool });
  await registerOnboardingRoutes(app, {
    service: onboardingService,
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
    loginRateLimit,
  });

  // Vendor password reset — public endpoints under /vendor-admin/auth/*.
  // Mirrors the tenant flow but writes/reads vendor.* tables and lands the
  // user on /vendor-admin/reset-password instead of /auth/reset-password.
  // Uses the BYPASSRLS vendorPool because vendor schema is global and the
  // instigenie_vendor role is the only one with write access to it.
  const vendorPasswordResetService = new VendorPasswordResetService({
    pool: vendorPool,
    webOrigin: env.webOrigin,
    includeDevResetUrl: env.nodeEnv !== "production",
  });
  await registerVendorPasswordResetRoutes(app, {
    service: vendorPasswordResetService,
    forgotPasswordRateLimit,
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
  // Per-user 60 rpm cap. Originally wired as a preHandler from
  // app.rateLimit({...}), which in @fastify/rate-limit v10 returns a
  // no-op marker — meaning the previous portal limit was silently
  // disabled. Switched to the per-route `config.rateLimit` shape that
  // the plugin actually honours. `hook: "preHandler"` runs after the
  // authGuard's preHandler so req.user is populated for keying.
  const portalRateLimit = {
    max: 60,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (req: import("fastify").FastifyRequest) =>
      req.user?.id ? `user:${req.user.id}` : `ip:${req.ip ?? "anon"}`,
    errorResponseBuilder: credentialRateLimitErrorResponse,
  } as const;
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

  return { app, pool, vendorPool, cache, bullProbe, env };
}

/**
 * Production entry point. Builds the app, binds the listener, and wires
 * SIGTERM/SIGINT to close resources. Tests never call this — they call
 * `buildApp()` directly and use `app.inject()`.
 */
async function main(): Promise<void> {
  const built = await buildApp();
  const { app, pool, vendorPool, cache, bullProbe, env } = built;
  const log = createLogger({ service: "api", level: env.logLevel });

  await app.listen({ port: env.port, host: env.host });
  log.info({ port: env.port, host: env.host }, "api listening");

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await vendorPool.end().catch(() => undefined);
    await cache.quit().catch(() => undefined);
    await bullProbe.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Last-resort process-level safety net. Without these any unhandled
  // exception or rejection (typically from an idle ioredis/pg client
  // emitting late) brings the whole process down — verified in chaos
  // testing. We log loudly and stay alive so in-flight requests can
  // complete and the auto-recovering clients (ioredis re-dials, pg
  // pool recycles bad clients) can heal in the background.
  //
  // Crucially we do NOT `process.exit()`. Fastify keeps serving; the
  // first dependent operation will surface a 5xx to the caller, and
  // /readyz fails so an LB sheds traffic until the dep returns.
  process.on("uncaughtException", (err) => {
    log.error(
      { err: { name: err.name, message: err.message, stack: err.stack } },
      "uncaughtException — keeping process alive",
    );
  });
  process.on("unhandledRejection", (reason) => {
    log.error(
      { reason: reason instanceof Error ? { name: reason.name, message: reason.message } : String(reason) },
      "unhandledRejection — keeping process alive",
    );
  });
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
