/**
 * Gate 3 — Outbox idempotency.
 *
 * ARCHITECTURE.md §8. The outbox has a partial unique index on
 * idempotency_key (WHERE idempotency_key IS NOT NULL). Duplicate inserts
 * with the same key are a no-op (ON CONFLICT DO NOTHING). Rows without
 * a key are always inserted.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { enqueueOutbox, withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

const AGG_ID = "00000000-0000-0000-0000-00000000f001";

describe("gate-3: outbox idempotency", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up only the rows this test owns. Other gates may be
    // touching outbox too (though fileParallelism=false in vitest config).
    await pool.query(
      `DELETE FROM outbox.events
        WHERE aggregate_id = $1 OR idempotency_key LIKE 'gate-3:%'`,
      [AGG_ID]
    );
  });

  it("double-insert with the same idempotency key inserts exactly once", async () => {
    const key = `gate-3:${Date.now()}`;
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const first = await enqueueOutbox(client, {
        aggregateType: "test_aggregate",
        aggregateId: AGG_ID,
        eventType: "test.happened",
        payload: { n: 1 },
        idempotencyKey: key,
      });
      expect(first.id).not.toBe("duplicate");

      const second = await enqueueOutbox(client, {
        aggregateType: "test_aggregate",
        aggregateId: AGG_ID,
        eventType: "test.happened",
        payload: { n: 2 }, // different payload, same key — should still dedupe
        idempotencyKey: key,
      });
      expect(second.id).toBe("duplicate");
    });

    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM outbox.events WHERE idempotency_key = $1`,
      [key]
    );
    expect(rows[0]!.c).toBe("1");
  });

  it("two inserts without idempotency key both succeed", async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const a = await enqueueOutbox(client, {
        aggregateType: "test_aggregate",
        aggregateId: AGG_ID,
        eventType: "test.happened",
        payload: { n: 1 },
      });
      const b = await enqueueOutbox(client, {
        aggregateType: "test_aggregate",
        aggregateId: AGG_ID,
        eventType: "test.happened",
        payload: { n: 2 },
      });
      expect(a.id).not.toBe("duplicate");
      expect(b.id).not.toBe("duplicate");
      expect(a.id).not.toBe(b.id);
    });
  });
});
