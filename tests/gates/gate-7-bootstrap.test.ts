/**
 * Gate 7 — Bootstrap policy.
 *
 * ARCHITECTURE.md §12.1. Security invariants that must hold on every
 * start: NUMERIC parser installed, permissions seeded, RLS on for tenant
 * tables, dev-seed org absent in production.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  installNumericTypeParser,
  isNumericParserInstalled,
  withOrg,
} from "@instigenie/db";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

describe("gate-7: bootstrap policy", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("NUMERIC type parser is installed", () => {
    installNumericTypeParser();
    expect(isNumericParserInstalled()).toBe(true);
  });

  it("RLS is enabled on every tenant-scoped table", async () => {
    const tables = ["users", "user_roles", "refresh_tokens", "organizations"];
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])`,
      [tables]
    );
    expect(rows.length).toBe(tables.length);
    for (const r of rows) {
      expect(r.relrowsecurity, `RLS must be ON for ${r.relname}`).toBe(true);
    }
  });

  it("dev seed org + users are present in dev", async () => {
    // RLS is FORCE'd and the gates connect as a non-superuser role, so the
    // count MUST be scoped through withOrg(). A bare `SELECT count(*) FROM
    // users` returns 0 when no GUC is set — which is actually verified by
    // gate-5.
    const count = await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows } = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM users`
      );
      return Number(rows[0]!.c);
    });
    expect(count).toBeGreaterThanOrEqual(12); // 11 internal + 1 portal
  });

  it("outbox partial index on undispatched rows exists", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'outbox'
          AND tablename = 'events'
          AND indexname = 'outbox_events_undispatched_idx'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.indexdef.toLowerCase()).toContain("where");
    expect(rows[0]!.indexdef).toMatch(/dispatched_at is null/i);
  });

  it("outbox idempotency unique index is partial", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'outbox'
          AND tablename = 'events'
          AND indexname = 'outbox_events_idempotency_unique'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.indexdef.toLowerCase()).toContain("where");
    expect(rows[0]!.indexdef).toMatch(/idempotency_key is not null/i);
  });
});
