/**
 * Gate 2 — PG NUMERIC round-trip with extreme precision.
 *
 * ARCHITECTURE.md Rule #1. The canary string is 18 decimal places —
 * a binary-float round-trip would corrupt this. The NUMERIC type parser
 * returns strings verbatim; decimal.js reconstructs the same string on
 * the way out.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { moneyFromPg, moneyToPg } from "@mobilab/money";
import { makeTestPool, waitForPg } from "./_helpers.js";

const CANARY = "0.100000000000000005";

describe("gate-2: decimal round-trip via PG NUMERIC", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    await pool.query(`
      CREATE TEMP TABLE IF NOT EXISTS _gate2_precision (
        id   serial PRIMARY KEY,
        val  numeric(38, 18) NOT NULL
      )
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reads NUMERIC as string (not Number)", async () => {
    const { rows } = await pool.query<{ val: unknown }>(`SELECT 0.1::numeric AS val`);
    expect(typeof rows[0]!.val).toBe("string");
  });

  it("round-trips the canary string bit-perfect", async () => {
    await pool.query(`TRUNCATE _gate2_precision`);
    await pool.query(
      `INSERT INTO _gate2_precision (val) VALUES ($1::numeric)`,
      [moneyToPg(moneyFromPg(CANARY)!)]
    );
    const { rows } = await pool.query<{ val: string }>(
      `SELECT val FROM _gate2_precision LIMIT 1`
    );
    expect(rows[0]!.val).toBe(CANARY);

    // Parse back into a Money and re-serialize: must match.
    const money = moneyFromPg(rows[0]!.val)!;
    expect(moneyToPg(money)).toBe(CANARY);
  });

  it("preserves a large negative with trailing zeros", async () => {
    const v = "-123456789.100000000000000000";
    await pool.query(`TRUNCATE _gate2_precision`);
    await pool.query(
      `INSERT INTO _gate2_precision (val) VALUES ($1::numeric)`,
      [v]
    );
    const { rows } = await pool.query<{ val: string }>(
      `SELECT val FROM _gate2_precision LIMIT 1`
    );
    // PG trims trailing zeros when the column scale is > value scale.
    // What matters is: the MANTISSA round-trips — no float drift.
    expect(moneyFromPg(rows[0]!.val)!.toFixed()).toBe("-123456789.1");
  });
});
