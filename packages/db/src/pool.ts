/**
 * node-postgres Pool + Drizzle wiring. One Pool per process, shared across
 * requests. ARCHITECTURE.md §4 / §6.
 *
 * Connection flow in production:
 *   app → pgbouncer (transaction mode) → Postgres
 * so we keep Pool sizes small-ish; pgbouncer is the real pool.
 *
 * CRITICAL: `installNumericTypeParser()` MUST be called before creating
 * a Pool. We call it here defensively.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { installNumericTypeParser } from "./types.js";

const { Pool } = pg;

export interface MakePoolOptions {
  connectionString: string;
  /** Max pool size per process. Default 10 — pgbouncer handles fanout. */
  max?: number;
  /** ms before an idle client is evicted. Default 30_000. */
  idleTimeoutMillis?: number;
  /** ms to wait for a connection before throwing. Default 5_000. */
  connectionTimeoutMillis?: number;
  /** Label used in application_name — helps identify processes in pg_stat_activity. */
  applicationName?: string;
}

export interface Db {
  pool: pg.Pool;
  drizzle: ReturnType<typeof drizzle>;
}

export function makeDb(opts: MakePoolOptions): Db {
  installNumericTypeParser();

  const pool = new Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 5_000,
    application_name: opts.applicationName ?? "instigenie-app",
  });

  // Surface pool errors — without this they're silently swallowed.
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[@instigenie/db] pool error:", err);
  });

  const d = drizzle(pool);
  return { pool, drizzle: d };
}
