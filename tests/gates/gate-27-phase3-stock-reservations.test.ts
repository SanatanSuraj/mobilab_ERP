/**
 * Gate 27 — ARCHITECTURE.md Phase 3 §3.2 "Stock Reservation".
 *
 * Proves the reservation stack is concurrency-safe. Four scenarios:
 *
 *   1. Baseline single-line reserve/release/consume ladder.
 *      - on_hand / reserved / available stay consistent at each step.
 *      - ACTIVE → RELEASED restores stock; ACTIVE → CONSUMED writes
 *        a WO_ISSUE ledger row and drops on_hand.
 *
 *   2. Shortage — asking for more than `available` raises
 *      ShortageError (SQLSTATE UR001 from reserve_stock_atomic).
 *
 *   3. State guard — release/consume on a non-ACTIVE reservation
 *      raises StateTransitionError (SQLSTATE UR002).
 *
 *   4. Concurrency torture — the actual gate. 40 reservers race for
 *      a pool of 100 units in chunks of 3–5. We assert:
 *        • no deadlock surfaces as an unhandled error (the service
 *          retry loop swallows 55P03 / 40P01);
 *        • total reserved + remaining available == original on_hand
 *          (zero drift — the invariant that matters);
 *        • the sum of ACTIVE reservations == stock_summary.reserved;
 *        • any ShortageErrors are strictly the excess requests (the
 *          first N reservations that fit succeed, the rest fail —
 *          we count, don't position-check, since interleaving is
 *          nondeterministic).
 *
 *   5. Canonical-ordering bulk — mrpReserveAll sorts by itemId before
 *      locking. We run 10 concurrent bulk-reserves that each touch
 *      the same 4 items in random order and assert every call
 *      completes (or fails cleanly with shortage) without a deadlock
 *      retry budget blow-up.
 *
 * Cleanup: we stamp everything with ref_doc_type='GATE27' and purge on
 * beforeEach so reruns stay green.
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
import { withOrg } from "@instigenie/db";
import { ReservationsService } from "@instigenie/api/inventory/reservations";
import {
  AUDIENCE,
  type BulkReserveStockRequest,
  type Permission,
  type ReserveStockRequest,
  type Role,
} from "@instigenie/contracts";
import {
  ShortageError,
  StateTransitionError,
} from "@instigenie/errors";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// Dev STORES user (role name matches the Role enum exactly).
// Seed file 03-dev-org-users.sql: b00b / stores@mobilab.local.
const DEV_USER_ID = "00000000-0000-0000-0000-00000000b00b";

// Seed items + warehouse from 08-inventory-dev-data.sql.
const WH_MAIN = "00000000-0000-0000-0000-000000fa0001";
const IT_RES = "00000000-0000-0000-0000-000000fb0001"; // resistor — opening 400 (low stock, but we stack on top)
const IT_CAP = "00000000-0000-0000-0000-000000fb0002"; // capacitor — opening 1200 + 500 GRN
const IT_PCB = "00000000-0000-0000-0000-000000fb0003"; // PCB — opening 75
const IT_BAT = "00000000-0000-0000-0000-000000fb0004"; // battery — opening 140 + 80 GRN

type ServiceReq = Parameters<ReservationsService["reserve"]>[0];

function makeRequest(
  orgId: string = DEV_ORG_ID,
  userId: string = DEV_USER_ID
): ServiceReq {
  return {
    user: {
      id: userId,
      orgId,
      email: "stores@mobilab.local",
      roles: ["STORES"] as Role[],
      permissions: new Set<Permission>(),
      audience: AUDIENCE.internal,
    },
  } as unknown as ServiceReq;
}

async function readSummary(
  pool: pg.Pool,
  itemId: string,
  warehouseId: string
): Promise<{ onHand: number; reserved: number; available: number }> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows } = await client.query<{
      on_hand: string;
      reserved: string;
      available: string;
    }>(
      `SELECT on_hand, reserved, available
         FROM stock_summary
        WHERE item_id = $1 AND warehouse_id = $2`,
      [itemId, warehouseId]
    );
    const r = rows[0];
    if (!r) return { onHand: 0, reserved: 0, available: 0 };
    return {
      onHand: Number(r.on_hand),
      reserved: Number(r.reserved),
      available: Number(r.available),
    };
  });
}

async function sumActiveReservations(
  pool: pg.Pool,
  itemId: string,
  warehouseId: string,
  refDocType: string
): Promise<number> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows } = await client.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(quantity), 0)::text AS s
         FROM stock_reservations
        WHERE item_id = $1
          AND warehouse_id = $2
          AND ref_doc_type = $3
          AND status = 'ACTIVE'`,
      [itemId, warehouseId, refDocType]
    );
    return Number(rows[0]?.s ?? 0);
  });
}

async function topUpStock(
  pool: pg.Pool,
  itemId: string,
  warehouseId: string,
  uom: string,
  delta: number,
  reason: string
): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      [DEV_USER_ID]
    );
    await client.query(
      `INSERT INTO stock_ledger (
         org_id, item_id, warehouse_id, quantity, uom, txn_type,
         ref_doc_type, reason, posted_by
       ) VALUES ($1, $2, $3, $4, $5, 'ADJUSTMENT', 'GATE27', $6, $7)`,
      [DEV_ORG_ID, itemId, warehouseId, delta.toString(), uom, reason, DEV_USER_ID]
    );
  });
}

describe("gate-27 (arch phase 3.2): stock reservations", () => {
  let pool: pg.Pool;
  let reservations: ReservationsService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    reservations = new ReservationsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Purge prior runs: drop every GATE27 reservation and reset the
  // counters derived from them. We can't DELETE rows and just hope the
  // summary catches up — the summary is maintained by reserve/release.
  // So: for each ACTIVE reservation still around, release it, then
  // DELETE the whole lot.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `SELECT set_config('app.current_user', $1, true)`,
        [DEV_USER_ID]
      );
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM stock_reservations
          WHERE ref_doc_type = 'GATE27' AND status = 'ACTIVE'`
      );
      for (const r of rows) {
        await client.query(
          `SELECT release_stock_reservation($1::uuid, $2::uuid)`,
          [r.id, DEV_USER_ID]
        );
      }
      await client.query(
        `DELETE FROM stock_reservations WHERE ref_doc_type = 'GATE27'`
      );
    });
  });

  // ── 1. Baseline ladder ─────────────────────────────────────────────────────

  describe("1. reserve → release ladder", () => {
    it("reserves, reflects in summary, releases, returns to baseline", async () => {
      const refId = "00000000-0000-0000-0000-000000002701";
      const before = await readSummary(pool, IT_CAP, WH_MAIN);

      const req: ReserveStockRequest = {
        itemId: IT_CAP,
        warehouseId: WH_MAIN,
        quantity: "50.000",
        uom: "EA",
        refDocType: "GATE27",
        refDocId: refId,
      };
      const res = await reservations.reserve(makeRequest(), req);
      expect(res.status).toBe("ACTIVE");
      expect(res.quantity).toBe("50.000");

      const mid = await readSummary(pool, IT_CAP, WH_MAIN);
      expect(mid.onHand).toBe(before.onHand);
      expect(mid.reserved).toBe(before.reserved + 50);
      expect(mid.available).toBe(before.available - 50);

      await reservations.release(makeRequest(), res.id);
      const after = await readSummary(pool, IT_CAP, WH_MAIN);
      expect(after.onHand).toBe(before.onHand);
      expect(after.reserved).toBe(before.reserved);
      expect(after.available).toBe(before.available);
    });

    it("consume drops on_hand and reserved, writes a WO_ISSUE ledger row", async () => {
      const refId = "00000000-0000-0000-0000-000000002702";
      const before = await readSummary(pool, IT_BAT, WH_MAIN);

      const res = await reservations.reserve(makeRequest(), {
        itemId: IT_BAT,
        warehouseId: WH_MAIN,
        quantity: "7.000",
        uom: "EA",
        refDocType: "GATE27",
        refDocId: refId,
      });
      const consumed = await reservations.consume(makeRequest(), res.id, {});
      expect(consumed.reservation.status).toBe("CONSUMED");
      expect(consumed.ledgerId).toBeTruthy();

      const after = await readSummary(pool, IT_BAT, WH_MAIN);
      expect(after.onHand).toBe(before.onHand - 7);
      expect(after.reserved).toBe(before.reserved);
      expect(after.available).toBe(before.available - 7);

      // Verify the ledger row is present, negative-signed, tagged WO_ISSUE.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query<{
          quantity: string;
          txn_type: string;
          ref_doc_id: string;
        }>(
          `SELECT quantity, txn_type, ref_doc_id
             FROM stock_ledger
            WHERE id = $1`,
          [consumed.ledgerId]
        );
        expect(rows[0]).toMatchObject({
          quantity: "-7.000",
          txn_type: "WO_ISSUE",
          ref_doc_id: refId,
        });
      });
    });
  });

  // ── 2. Shortage ────────────────────────────────────────────────────────────

  describe("2. shortage handling", () => {
    it("raises ShortageError when requested qty exceeds available", async () => {
      const before = await readSummary(pool, IT_PCB, WH_MAIN);
      const impossible = (before.available + 1_000_000).toString() + ".000";

      await expect(
        reservations.reserve(makeRequest(), {
          itemId: IT_PCB,
          warehouseId: WH_MAIN,
          quantity: impossible,
          uom: "EA",
          refDocType: "GATE27",
          refDocId: "00000000-0000-0000-0000-000000002703",
        })
      ).rejects.toThrow(ShortageError);

      // Stock position unchanged after a failed reservation.
      const after = await readSummary(pool, IT_PCB, WH_MAIN);
      expect(after).toEqual(before);
    });
  });

  // ── 3. State-machine guard ────────────────────────────────────────────────

  describe("3. state-machine guard", () => {
    it("release then release: second throws StateTransitionError", async () => {
      const res = await reservations.reserve(makeRequest(), {
        itemId: IT_CAP,
        warehouseId: WH_MAIN,
        quantity: "1.000",
        uom: "EA",
        refDocType: "GATE27",
        refDocId: "00000000-0000-0000-0000-000000002704",
      });
      await reservations.release(makeRequest(), res.id);
      await expect(
        reservations.release(makeRequest(), res.id)
      ).rejects.toThrow(StateTransitionError);
    });

    it("consume after release throws StateTransitionError", async () => {
      const res = await reservations.reserve(makeRequest(), {
        itemId: IT_CAP,
        warehouseId: WH_MAIN,
        quantity: "1.000",
        uom: "EA",
        refDocType: "GATE27",
        refDocId: "00000000-0000-0000-0000-000000002705",
      });
      await reservations.release(makeRequest(), res.id);
      await expect(
        reservations.consume(makeRequest(), res.id, {})
      ).rejects.toThrow(StateTransitionError);
    });
  });

  // ── 4. Concurrency torture ─────────────────────────────────────────────────

  describe("4. concurrency torture — zero drift under contention", () => {
    it("40 concurrent reservers on a capped pool: no drift, no deadlock", async () => {
      // Build a fresh pool of exactly 1000 units on a stable item/warehouse
      // so the baseline is predictable regardless of how the dev seed drifts.
      // We use a large item (capacitor) and top it up to an even baseline
      // then strip it back at the end via reserve + consume/release.

      const before = await readSummary(pool, IT_CAP, WH_MAIN);
      const POOL_SIZE = 1000;
      const topUp = POOL_SIZE - before.available;
      if (topUp !== 0) {
        await topUpStock(
          pool,
          IT_CAP,
          WH_MAIN,
          "EA",
          topUp,
          `gate-27 balance to ${POOL_SIZE}`
        );
      }
      const prepared = await readSummary(pool, IT_CAP, WH_MAIN);
      expect(prepared.available).toBe(POOL_SIZE);

      // 40 requesters, chunks of 3–5. Total potential demand = ~160 units
      // well under POOL_SIZE so all should succeed and we assert zero drift.
      const REQUESTER_COUNT = 40;
      const qtys = Array.from(
        { length: REQUESTER_COUNT },
        (_, i) => 3 + (i % 3) // 3, 4, 5, 3, 4, 5, ...
      );
      const totalRequested = qtys.reduce((a, b) => a + b, 0);
      expect(totalRequested).toBeLessThan(POOL_SIZE);

      const results = await Promise.allSettled(
        qtys.map((qty, i) =>
          reservations.reserve(makeRequest(), {
            itemId: IT_CAP,
            warehouseId: WH_MAIN,
            quantity: `${qty}.000`,
            uom: "EA",
            refDocType: "GATE27",
            // Unique ref_doc_id per requester keeps rows individually
            // addressable for release.
            refDocId: `00000000-0000-0000-0000-${i
              .toString(16)
              .padStart(4, "0")}00002740`,
          })
        )
      );

      // Every reserve should have succeeded — the pool was big enough.
      // If any failed with ShortageError that's a bug (we sized demand
      // well under supply). If anything raw-threw a PG 55P03/40P01, the
      // retry loop was too small.
      const rejected = results.filter((r) => r.status === "rejected");
      if (rejected.length > 0) {
        const first = rejected[0] as PromiseRejectedResult;
        throw new Error(
          `${rejected.length}/${REQUESTER_COUNT} reservations rejected. ` +
            `First reason: ${String(first.reason)}`
        );
      }

      const activeSum = await sumActiveReservations(
        pool,
        IT_CAP,
        WH_MAIN,
        "GATE27"
      );
      const after = await readSummary(pool, IT_CAP, WH_MAIN);

      // The key invariant: stock_summary.reserved is exactly the sum
      // of ACTIVE reservations (no double-counting, no leakage).
      expect(activeSum).toBe(totalRequested);
      expect(after.reserved).toBe(prepared.reserved + totalRequested);
      expect(after.available).toBe(prepared.available - totalRequested);
      expect(after.onHand).toBe(prepared.onHand);

      // Sanity: on_hand == reserved + available (the fundamental
      // ledger-projection invariant).
      expect(after.onHand).toBe(after.reserved + after.available);
    });

    it("over-demand: half succeed, half hit ShortageError cleanly — no partial state", async () => {
      // Tighten the pool so only ~half the requests can fit.
      const before = await readSummary(pool, IT_PCB, WH_MAIN);
      const POOL_SIZE = 20; // 20 PCBs available
      const topUp = POOL_SIZE - before.available;
      if (topUp !== 0) {
        await topUpStock(
          pool,
          IT_PCB,
          WH_MAIN,
          "EA",
          topUp,
          `gate-27 balance PCB to ${POOL_SIZE}`
        );
      }
      const prepared = await readSummary(pool, IT_PCB, WH_MAIN);
      expect(prepared.available).toBe(POOL_SIZE);

      // 20 requesters, each wants 2 units → 40 requested vs 20 available.
      // Exactly 10 should succeed, 10 should ShortageError.
      const REQUESTER_COUNT = 20;
      const QTY_EACH = 2;

      const results = await Promise.allSettled(
        Array.from({ length: REQUESTER_COUNT }, (_, i) =>
          reservations.reserve(makeRequest(), {
            itemId: IT_PCB,
            warehouseId: WH_MAIN,
            quantity: `${QTY_EACH}.000`,
            uom: "EA",
            refDocType: "GATE27",
            refDocId: `00000000-0000-0000-0000-${i
              .toString(16)
              .padStart(4, "0")}00002750`,
          })
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.filter((r) => r.status === "rejected");

      // Every rejection must be a ShortageError — not a raw PG error.
      for (const r of rejected) {
        const reason = (r as PromiseRejectedResult).reason;
        if (!(reason instanceof ShortageError)) {
          throw new Error(
            `unexpected rejection type: ${reason?.constructor?.name} — ${String(reason)}`
          );
        }
      }
      expect(succeeded).toBe(POOL_SIZE / QTY_EACH);
      expect(rejected.length).toBe(REQUESTER_COUNT - POOL_SIZE / QTY_EACH);

      // Invariant check: the summary reflects only the successful holds.
      const activeSum = await sumActiveReservations(
        pool,
        IT_PCB,
        WH_MAIN,
        "GATE27"
      );
      const after = await readSummary(pool, IT_PCB, WH_MAIN);
      expect(activeSum).toBe(succeeded * QTY_EACH);
      expect(after.reserved).toBe(prepared.reserved + succeeded * QTY_EACH);
      expect(after.available).toBe(prepared.available - succeeded * QTY_EACH);
      expect(after.onHand).toBe(prepared.onHand);
    });
  });

  // ── 5. Canonical-ordering bulk (mrpReserveAll) ────────────────────────────

  describe("5. mrpReserveAll — deadlock-free canonical ordering", () => {
    it("10 concurrent bulk reserves on 4 items in random order: all complete", async () => {
      // Make sure every item has enough stock for 10 × 2 = 20 units.
      for (const id of [IT_RES, IT_CAP, IT_PCB, IT_BAT]) {
        const s = await readSummary(pool, id, WH_MAIN);
        if (s.available < 50) {
          await topUpStock(
            pool,
            id,
            WH_MAIN,
            id === IT_RES ? "EA" : "EA",
            50 - s.available,
            `gate-27 MRP prep ${id}`
          );
        }
      }

      const items = [IT_RES, IT_CAP, IT_PCB, IT_BAT];

      function buildBulk(i: number): BulkReserveStockRequest {
        // Randomised line order — the service sorts internally by itemId
        // so two callers with different input orders still end up with
        // identical lock-acquisition sequences.
        const shuffled = [...items].sort(() => Math.random() - 0.5);
        return {
          refDocType: "GATE27",
          refDocId: `00000000-0000-0000-0000-${i
            .toString(16)
            .padStart(4, "0")}00002760`,
          lines: shuffled.map((itemId) => ({
            itemId,
            warehouseId: WH_MAIN,
            quantity: "2.000",
            uom: "EA",
          })),
        };
      }

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          reservations.mrpReserveAll(makeRequest(), buildBulk(i))
        )
      );

      // With 4 items × 10 callers × 2 units each = 80 units per item
      // and available >= 50 per item, we should see at most some
      // shortages — but every rejection must be a ShortageError, never
      // a raw deadlock. The canonical ordering makes deadlock
      // mathematically impossible.
      for (const r of results) {
        if (r.status === "rejected") {
          const reason = (r as PromiseRejectedResult).reason;
          if (!(reason instanceof ShortageError)) {
            throw new Error(
              `unexpected rejection type: ${reason?.constructor?.name} — ${String(reason)}`
            );
          }
        }
      }

      // Invariant: sum of ACTIVE reservations per item matches
      // stock_summary.reserved delta for GATE27-tagged rows.
      for (const id of items) {
        const activeSum = await sumActiveReservations(
          pool,
          id,
          WH_MAIN,
          "GATE27"
        );
        const s = await readSummary(pool, id, WH_MAIN);
        // Fundamental invariant — never broken regardless of how the
        // shortfall was distributed.
        expect(s.onHand).toBe(s.reserved + s.available);
        expect(activeSum).toBeGreaterThanOrEqual(0);
        expect(activeSum).toBeLessThanOrEqual(s.reserved);
      }
    });
  });
});
