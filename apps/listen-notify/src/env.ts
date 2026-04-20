/**
 * Env-var loader. Fails fast on missing required vars rather than crashing
 * at first query. Pass LISTEN_NOTIFY_PORT=0 to disable the metrics endpoint
 * (useful in tests).
 *
 * DATABASE_DIRECT_URL is the LISTEN/NOTIFY-safe URL — see ARCHITECTURE.md
 * §6.3 + Phase 1 Gate 5. It MUST point straight at Postgres (:5432) and
 * never through PgBouncer in transaction mode, which loses LISTEN
 * subscriptions between queries. For backwards compatibility with older
 * dev .env files that only set DATABASE_URL, we fall back to that and rely
 * on assertDirectPgUrl() in src/index.ts to reject PgBouncer-flavoured
 * strings either way.
 */

export interface Env {
  databaseUrl: string;
  bullRedisUrl: string;
  metricsPort: number;
  logLevel: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadEnv(): Env {
  return {
    databaseUrl:
      process.env.DATABASE_DIRECT_URL?.trim() ||
      required("DATABASE_URL"),
    bullRedisUrl: required("REDIS_BULL_URL"),
    metricsPort: Number(process.env.LISTEN_NOTIFY_PORT ?? 4002),
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
