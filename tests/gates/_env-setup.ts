/**
 * Vitest setup — seed process.env with the dev-stack defaults that
 * `apps/worker/src/env.ts` and `apps/api/src/env.ts` require at module load.
 *
 * Several gates import from `@instigenie/worker/handlers`, which eagerly
 * calls `loadEnv()` at module-init time (apps/worker/src/handlers/index.ts
 * builds the user.invite.created handler on import). That call throws if
 * DATABASE_URL / REDIS_BULL_URL are missing — so they must be present in
 * process.env *before* the test file's top-level imports resolve.
 *
 * Values mirror the dev docker-compose stack (ops/compose/docker-compose.dev.yml)
 * and the fallback URLs in tests/gates/_helpers.ts. Any value already set
 * externally (e.g. by CI) wins.
 */

const defaults: Record<string, string> = {
  DATABASE_URL:
    "postgres://instigenie_app:instigenie_dev@localhost:5434/instigenie",
  VENDOR_DATABASE_URL:
    "postgres://instigenie_vendor:instigenie_dev@localhost:5434/instigenie",
  REDIS_BULL_URL: "redis://localhost:6381",
  REDIS_CACHE_URL: "redis://localhost:6382",
  // Test-only secrets. buildApp() enforces JWT_SECRET ≥32 chars.
  JWT_SECRET: "gates-suite-test-jwt-secret-minimum-thirty-two-chars",
  ESIGNATURE_PEPPER:
    "gates-suite-test-esignature-pepper-minimum-thirty-two-chars",
  JWT_ISSUER: "instigenie-api",
  WEB_ORIGIN: "http://localhost:3000",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
