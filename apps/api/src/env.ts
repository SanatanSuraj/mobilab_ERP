export interface Env {
  databaseUrl: string;
  /**
   * Connection string for the vendor-admin pool (instigenie_vendor BYPASSRLS
   * role). Separate from databaseUrl on purpose — tenant-side traffic must
   * never resolve to a BYPASSRLS session, and a leaked tenant credential
   * must not grant the vendor role. Defaults to `databaseUrl` only in dev
   * so local docker-compose still works; production MUST set this.
   */
  vendorDatabaseUrl: string;
  cacheRedisUrl: string;
  bullRedisUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  port: number;
  host: string;
  logLevel: string;
  nodeEnv: string;
  webOrigin: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadEnv(): Env {
  const jwtSecret = required("JWT_SECRET");
  // Cheap guard against accidentally running prod with a dev-length secret.
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  const databaseUrl = required("DATABASE_URL");
  return {
    databaseUrl,
    vendorDatabaseUrl: process.env.VENDOR_DATABASE_URL ?? databaseUrl,
    cacheRedisUrl: required("REDIS_CACHE_URL"),
    bullRedisUrl: required("REDIS_BULL_URL"),
    jwtSecret,
    jwtIssuer: process.env.JWT_ISSUER ?? "instigenie-api",
    accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 900), // 15 min
    refreshTokenTtlSec: Number(process.env.REFRESH_TOKEN_TTL_SEC ?? 1_209_600), // 14 days
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "0.0.0.0",
    logLevel: process.env.LOG_LEVEL ?? "info",
    nodeEnv: process.env.NODE_ENV ?? "development",
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}
