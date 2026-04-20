/**
 * Env-var loader. Fails fast on missing required vars rather than crashing
 * at first query. Pass LISTEN_NOTIFY_PORT=0 to disable the metrics endpoint
 * (useful in tests).
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
    databaseUrl: required("DATABASE_URL"),
    bullRedisUrl: required("REDIS_BULL_URL"),
    metricsPort: Number(process.env.LISTEN_NOTIFY_PORT ?? 4002),
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
