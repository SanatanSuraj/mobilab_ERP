/**
 * Gate 63 — Outbox handler idempotency coverage audit.
 *
 * TESTING_PLAN.md §3.1 / §6 priority gap:
 *   "Every event handler must supply a deterministic idempotency key
 *    so a retry of an at-least-once delivery can be de-duped at the DB
 *    level — coverage audit not currently proven."
 *
 * The ARCHITECTURE.md §3.1 design does NOT ask handlers to thread
 * their own idempotency keys through the payload. Instead, the
 * idempotency FENCE is structural and applied uniformly by the worker
 * runner (apps/worker/src/handlers/runner.ts):
 *
 *   INSERT INTO outbox.handler_runs (outbox_id, handler_name, status)
 *   VALUES ($1, $2, 'COMPLETED')
 *   ON CONFLICT (outbox_id, handler_name) DO NOTHING
 *
 * with `outbox.handler_runs` declaring PRIMARY KEY (outbox_id, handler_name)
 * in ops/sql/init/13-event-handlers.sql. That pair IS the idempotency
 * key; the handler body is only invoked when the INSERT claimed a slot.
 *
 * So the "coverage audit" resolves into three assertions:
 *
 *   (1) STRUCTURE — every entry in HANDLER_CATALOGUE has a non-empty,
 *       globally unique `handlerName` shaped like `group.verbAction`,
 *       paired with a non-empty `eventType` shaped like
 *       `aggregate.verb` or `aggregate_noun.verb`. Duplicates or
 *       malformed names would silently break the fence because the
 *       PRIMARY KEY would coalesce two logically distinct handlers
 *       into one slot (or — with empty names — leave the CHECK
 *       constraint to fail the whole txn on every retry).
 *
 *   (2) RUNNER CONTRACT — the runner source contains the exact
 *       `ON CONFLICT (outbox_id, handler_name) DO NOTHING` fragment.
 *       If someone refactors the runner to use a different conflict
 *       target (or removes the clause entirely), the fence is gone.
 *       This is a structural guard: the static string has to be in
 *       the file.
 *
 *   (3) LIVE DEDUPE — drive a stub handler through `runHandler` with
 *       a real outbox event id, assert the body fires exactly once
 *       even though we invoke runHandler twice with the same
 *       (outboxId, handlerName). The behavioral contract that (1)+(2)
 *       promise.
 *
 * If this gate fails, an at-least-once delivery retry would execute a
 * handler body twice and double-book its side effects — exactly the
 * failure mode the §3.1 catalogue exists to prevent.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withOrg, enqueueOutbox } from "@instigenie/db";
import {
  HANDLER_CATALOGUE,
  runHandler,
  type EventHandler,
  type HandlerContext,
  type HandlerEntry,
} from "@instigenie/worker/handlers";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

const REPO_ROOT = resolve(__dirname, "..", "..");

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: "silent",
} as unknown as HandlerContext["log"];

/** `group.verbAction` — lowercase group, dot, camelCase verb phrase. */
const HANDLER_NAME_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.[a-z][A-Za-z0-9]*$/;

/**
 * `aggregate.verb` (deal.won), `aggregate_noun.verb_noun`
 * (qc_inward.passed, quotation.submitted_for_approval), or a 3-segment
 * `aggregate.noun.verb` (user.invite.created) — all snake/dot
 * lowercase. Permits 2–3 dot-separated segments so the catalogue can
 * namespace multi-word domains without breaking the fence check.
 */
const EVENT_TYPE_RE =
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,2}$/;

describe("gate-63: outbox handler idempotency coverage", () => {
  // ── 1. Catalogue structure ───────────────────────────────────────────

  describe("1. HANDLER_CATALOGUE structure", () => {
    it("has at least one registered handler", () => {
      expect(HANDLER_CATALOGUE.length).toBeGreaterThan(0);
    });

    it("every entry has non-empty eventType and handlerName", () => {
      for (const entry of HANDLER_CATALOGUE) {
        expect(entry.eventType, `entry missing eventType: ${JSON.stringify(entry)}`)
          .toBeTruthy();
        expect(entry.handlerName, `entry missing handlerName for event ${entry.eventType}`)
          .toBeTruthy();
        expect(typeof entry.handler).toBe("function");
      }
    });

    it("every eventType matches the documented aggregate.verb convention", () => {
      const bad: string[] = [];
      for (const e of HANDLER_CATALOGUE) {
        if (!EVENT_TYPE_RE.test(e.eventType)) bad.push(e.eventType);
      }
      expect(bad, `malformed eventType(s): ${bad.join(", ")}`).toEqual([]);
    });

    it("every handlerName matches the documented group.verbAction convention", () => {
      const bad: string[] = [];
      for (const e of HANDLER_CATALOGUE) {
        if (!HANDLER_NAME_RE.test(e.handlerName)) bad.push(e.handlerName);
      }
      expect(bad, `malformed handlerName(s): ${bad.join(", ")}`).toEqual([]);
    });

    it("handlerName values are globally unique across the catalogue", () => {
      // A duplicate handlerName would collapse two logically distinct
      // catalogue entries into one slot in outbox.handler_runs and
      // silently skip the second handler on every re-delivery — a
      // correctness-destroying regression.
      const counts = new Map<string, number>();
      for (const e of HANDLER_CATALOGUE) {
        counts.set(e.handlerName, (counts.get(e.handlerName) ?? 0) + 1);
      }
      const dups = [...counts.entries()].filter(([, n]) => n > 1);
      expect(dups, `duplicate handlerName(s): ${JSON.stringify(dups)}`).toEqual(
        [],
      );
    });

    it("(eventType, handlerName) pairs are unique — defence-in-depth", () => {
      // Even if handlerName is globally unique, the pair is what the
      // runner dispatches on. A duplicate pair would cause the SAME
      // handler to run twice per event, which the runner's
      // idempotency fence would collapse — so this is a correctness
      // property of the catalogue definition itself, not the runner.
      const seen = new Set<string>();
      const dups: string[] = [];
      for (const e of HANDLER_CATALOGUE) {
        const key = `${e.eventType}|${e.handlerName}`;
        if (seen.has(key)) dups.push(key);
        seen.add(key);
      }
      expect(dups, `duplicate (event,handler) pair(s): ${dups.join(", ")}`).toEqual(
        [],
      );
    });
  });

  // ── 2. Runner contract ───────────────────────────────────────────────

  describe("2. runner enforces (outbox_id, handler_name) fence", () => {
    it("runner source contains the ON CONFLICT DO NOTHING clause", async () => {
      const runnerPath = resolve(
        REPO_ROOT,
        "apps/worker/src/handlers/runner.ts",
      );
      const src = await readFile(runnerPath, "utf8");
      // Exact fragment — tolerating whitespace but not conflict target
      // drift. If someone changes the conflict target, this test fails
      // loudly.
      const normalised = src.replace(/\s+/g, " ");
      expect(normalised).toContain(
        "ON CONFLICT (outbox_id, handler_name) DO NOTHING",
      );
      expect(normalised).toContain("INSERT INTO outbox.handler_runs");
    });

    it("handler_runs table declares the PK on (outbox_id, handler_name)", async () => {
      // Belt-and-braces: the ON CONFLICT target only has meaning if the
      // table actually has a matching unique constraint. If a later
      // migration drops the PK or widens it, ON CONFLICT collapses to a
      // no-op and the fence evaporates.
      const sqlPath = resolve(
        REPO_ROOT,
        "ops/sql/init/13-event-handlers.sql",
      );
      const src = await readFile(sqlPath, "utf8");
      const normalised = src.replace(/\s+/g, " ");
      expect(normalised).toContain("PRIMARY KEY (outbox_id, handler_name)");
    });
  });

  // ── 3. Live dedupe ───────────────────────────────────────────────────

  describe("3. live dedupe — runner skips the second delivery", () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = makeTestPool();
      await waitForPg(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      // Clean anything left by a prior aborted run of this gate so the
      // handler_runs unique fence starts empty for our synthetic event.
      await pool.query(
        `DELETE FROM outbox.events WHERE event_type = 'gate63.idempotency_probe'`,
      );
    });

    it("second runHandler call with same (outboxId, handlerName) is SKIPPED and does NOT re-run the body", async () => {
      // Counter visible to both runs via closure. If the fence breaks
      // we'll see 2 here on the second run.
      let callCount = 0;
      const body: EventHandler<{ orgId: string }> = async () => {
        callCount += 1;
      };
      const entry: HandlerEntry = {
        eventType: "gate63.idempotency_probe",
        handlerName: "gate63.probeHandler",
        handler: body as unknown as HandlerEntry["handler"],
      };

      // Seed an outbox.events row so handler_runs' FK to outbox.events
      // is satisfied.
      let outboxId = "";
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const ev = await enqueueOutbox(client, {
          aggregateType: "gate63_probe",
          aggregateId: randomUUID(),
          eventType: entry.eventType,
          payload: { orgId: DEV_ORG_ID },
        });
        outboxId = ev.id;
      });

      const ctx: HandlerContext = { outboxId, log: silentLog };

      const first = await runHandler({
        pool,
        entry,
        payload: { orgId: DEV_ORG_ID },
        ctx,
      });
      expect(first.status).toBe("COMPLETED");
      expect(callCount).toBe(1);

      const second = await runHandler({
        pool,
        entry,
        payload: { orgId: DEV_ORG_ID },
        ctx,
      });
      expect(second.status).toBe("SKIPPED");
      // The fence must stop the body from running a second time — this
      // is the behavioural contract the whole §3.1 design hinges on.
      expect(callCount).toBe(1);

      // And exactly one handler_runs row exists for the pair — the
      // physical shape of the fence.
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM outbox.handler_runs
          WHERE outbox_id = $1 AND handler_name = $2`,
        [outboxId, entry.handlerName],
      );
      expect(rows[0]!.count).toBe("1");

      // Teardown: explicit delete so re-runs of the file stay clean.
      await pool.query(
        `DELETE FROM outbox.events WHERE id = $1`,
        [outboxId],
      );
    });

    it("two DIFFERENT handlers against the same outbox event both run — fence is per-pair, not per-event", async () => {
      // Establishing the OTHER half of the contract: the fence is
      // (outbox_id, handler_name) — so two distinct handlers fanning
      // out from one event both get their chance. A regression that
      // widened the fence to just outbox_id would make the second
      // handler silently SKIP.
      let callsA = 0;
      let callsB = 0;
      const entryA: HandlerEntry = {
        eventType: "gate63.idempotency_probe",
        handlerName: "gate63.handlerA",
        handler: (async () => {
          callsA += 1;
        }) as unknown as HandlerEntry["handler"],
      };
      const entryB: HandlerEntry = {
        eventType: "gate63.idempotency_probe",
        handlerName: "gate63.handlerB",
        handler: (async () => {
          callsB += 1;
        }) as unknown as HandlerEntry["handler"],
      };

      let outboxId = "";
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const ev = await enqueueOutbox(client, {
          aggregateType: "gate63_probe",
          aggregateId: randomUUID(),
          eventType: entryA.eventType,
          payload: { orgId: DEV_ORG_ID },
        });
        outboxId = ev.id;
      });
      const ctx: HandlerContext = { outboxId, log: silentLog };

      const a = await runHandler({
        pool,
        entry: entryA,
        payload: { orgId: DEV_ORG_ID },
        ctx,
      });
      const b = await runHandler({
        pool,
        entry: entryB,
        payload: { orgId: DEV_ORG_ID },
        ctx,
      });

      expect(a.status).toBe("COMPLETED");
      expect(b.status).toBe("COMPLETED");
      expect(callsA).toBe(1);
      expect(callsB).toBe(1);

      // Teardown.
      await pool.query(
        `DELETE FROM outbox.events WHERE id = $1`,
        [outboxId],
      );
    });
  });
});
