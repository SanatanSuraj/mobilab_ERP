export interface Env {
  databaseUrl: string;
  bullRedisUrl: string;
  metricsPort: number;
  logLevel: string;
  concurrency: number;
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
    metricsPort: Number(process.env.WORKER_PORT ?? 4001),
    logLevel: process.env.LOG_LEVEL ?? "info",
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  };
}
