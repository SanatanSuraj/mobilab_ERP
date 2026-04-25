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
  /**
   * HMAC-SHA256 key used to seal electronic-signature hashes
   * (ARCHITECTURE.md §4.2 / §9.5). The hash stored on approval_steps /
   * workflow_transitions is keyed with this pepper so a leaked DB dump
   * alone cannot reproduce it — an auditor recomputes by re-HMACing
   * (reason || user || actedAt) against the same key.
   *
   * Empty string is accepted for dev/test (the hash degrades to a plain
   * SHA-256) but production MUST set it. At least 32 chars is enforced
   * when nodeEnv !== 'development'|'test'.
   */
  esignaturePepper: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Substrings that, if found in JWT_SECRET, indicate the operator copied a
 * placeholder out of `.env.example` or a quickstart guide instead of
 * minting a real secret. We refuse to start in production when any of
 * these appears so the API never signs tokens with a value an attacker
 * already has.
 *
 * We allow them in development/test so the dev compose file can keep its
 * "instigenie-dev-secret-…" placeholder for local work.
 */
const JWT_SECRET_BLOCKLIST = [
  "changeme",
  "change-me",
  "placeholder",
  "example",
  "your-secret",
  "your_secret",
  "instigenie-dev-secret",
  "default",
  "password",
];

export function loadEnv(): Env {
  const jwtSecret = required("JWT_SECRET");
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProductionLike = nodeEnv !== "development" && nodeEnv !== "test";
  // Length floor — applies in every environment so dev/test still get a
  // real cryptographic secret rather than a 4-char string.
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  if (isProductionLike) {
    // Distinct-character check guards against degenerate values like a
    // 32-char run of "x". An HS256 secret with that little entropy is
    // brute-forceable; refuse to boot.
    const distinctChars = new Set(jwtSecret).size;
    if (distinctChars < 16) {
      throw new Error(
        "JWT_SECRET has insufficient entropy (need >= 16 distinct chars in production)",
      );
    }
    const lower = jwtSecret.toLowerCase();
    for (const banned of JWT_SECRET_BLOCKLIST) {
      if (lower.includes(banned)) {
        throw new Error(
          `JWT_SECRET contains banned placeholder substring "${banned}"; mint a fresh secret in production`,
        );
      }
    }
  }
  const databaseUrl = required("DATABASE_URL");
  const esignaturePepper = process.env.ESIGNATURE_PEPPER ?? "";
  if (
    nodeEnv !== "development" &&
    nodeEnv !== "test" &&
    esignaturePepper.length < 32
  ) {
    throw new Error(
      "ESIGNATURE_PEPPER must be set to at least 32 characters in non-development environments",
    );
  }
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
    nodeEnv,
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    esignaturePepper,
  };
}
