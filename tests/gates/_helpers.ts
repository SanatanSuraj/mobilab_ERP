/**
 * Shared helpers for the 7 Phase 1 correctness gates.
 *
 * These tests connect to the dev docker-compose Postgres/Redis (see
 * ops/compose/docker-compose.dev.yml). The URLs come from env so CI can
 * override; defaults match the local dev stack.
 */

import pg from "pg";
import { installNumericTypeParser } from "@mobilab/db";

// Gates must hit the DB as a non-superuser so RLS binds. The bootstrap role
// `mobilab` is a SUPERUSER (Postgres exempts superusers from all RLS), so we
// connect as `mobilab_app` — created in ops/sql/seed/99-app-role.sql with
// NOBYPASSRLS.
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://mobilab_app:mobilab_dev@localhost:5434/mobilab";

export const REDIS_BULL_URL =
  process.env.REDIS_BULL_URL ?? "redis://localhost:6381";

export const REDIS_CACHE_URL =
  process.env.REDIS_CACHE_URL ?? "redis://localhost:6382";

/** Dev seed org id (ops/sql/seed/03-dev-org-users.sql). */
export const DEV_ORG_ID = "00000000-0000-0000-0000-00000000a001";

export function makeTestPool(): pg.Pool {
  installNumericTypeParser();
  return new pg.Pool({
    connectionString: DATABASE_URL,
    max: 4,
    application_name: "mobilab-gates",
  });
}

export async function waitForPg(pool: pg.Pool, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
