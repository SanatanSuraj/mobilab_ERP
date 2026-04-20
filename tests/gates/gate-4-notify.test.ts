/**
 * Gate 4 — LISTEN/NOTIFY trigger.
 *
 * ARCHITECTURE.md §8. ops/sql/triggers/01-outbox-notify.sql fires
 * pg_notify on each outbox insert. apps/listen-notify uses this to drain
 * the outbox without polling.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { enqueueOutbox, withOrg } from "@mobilab/db";
import {
  DATABASE_URL,
  makeTestPool,
  waitForPg,
  DEV_ORG_ID,
} from "./_helpers.js";

describe("gate-4: outbox NOTIFY fires on insert", () => {
  let pool: pg.Pool;
  let listener: pg.Client;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    listener = new pg.Client({ connectionString: DATABASE_URL });
    await listener.connect();
    await listener.query("LISTEN outbox_event");
  });

  afterAll(async () => {
    await listener.end().catch(() => undefined);
    await pool.end();
  });

  it("fires a notification with the row id in the payload", async () => {
    const received: Array<{ channel: string; payload?: string }> = [];
    listener.on("notification", (msg) => {
      received.push({ channel: msg.channel, payload: msg.payload });
    });

    let insertedId = "";
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const ev = await enqueueOutbox(client, {
        aggregateType: "test_aggregate",
        aggregateId: "00000000-0000-0000-0000-00000000c001",
        eventType: "test.notify",
        payload: { ok: true },
      });
      insertedId = ev.id;
    });

    // pg_notify fires on COMMIT; give it a short window.
    await new Promise((r) => setTimeout(r, 500));

    const match = received.find((n) => n.channel === "outbox_event");
    expect(match).toBeDefined();
    expect(match!.payload).toBeDefined();
    const payload = JSON.parse(match!.payload!);
    expect(payload.id).toBe(insertedId);
    expect(payload.type).toBe("test.notify");
  });
});
