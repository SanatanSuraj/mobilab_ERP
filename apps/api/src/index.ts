/**
 * apps/api — Fastify server.
 *
 * Phase 1 surface:
 *   /health         liveness
 *   /readyz         readiness (pg + redis)
 *   /metrics        Prometheus
 *   /auth/*         login / refresh / logout / me
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
import { loadEnv } from "./env.js";
import { registerProblemHandler } from "./errors/problem.js";
import { TokenFactory } from "./modules/auth/tokens.js";
import { AuthService } from "./modules/auth/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";

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

  const cache = new Cache({ url: env.cacheRedisUrl });
  await cache.connect();

  const tokens = new TokenFactory({
    secret: new TextEncoder().encode(env.jwtSecret),
    issuer: env.jwtIssuer,
    accessTokenTtlSec: env.accessTokenTtlSec,
  });

  const authService = new AuthService({
    pool,
    tokens,
    refreshTtlSec: env.refreshTokenTtlSec,
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

  // ─── Routes ─────────────────────────────────────────────────────────────────
  await registerAuthRoutes(app, {
    service: authService,
    guardInternal: { tokens, expectedAudience: AUDIENCE.internal },
    guardPortal: { tokens, expectedAudience: AUDIENCE.portal },
  });

  // ─── Start ──────────────────────────────────────────────────────────────────
  await app.listen({ port: env.port, host: env.host });
  log.info({ port: env.port, host: env.host }, "api listening");

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
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
