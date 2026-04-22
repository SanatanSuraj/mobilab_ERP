/**
 * Gate 35 — ARCHITECTURE.md Phase 3 §3.8: "deadlock-free MRP —
 * 20 concurrent MRPs on overlapping components".
 *
 * The Phase-3 promise: mrpReserveAll sorts every input line by
 * (itemId, warehouseId) before calling reserve_stock_atomic in
 * sequence inside a single transaction. Two callers with different
 * input orderings still end up acquiring the FOR UPDATE locks in the
 * SAME order — which makes a wait-for cycle mathematically
 * impossible on the summary rows those calls touch.
 *
 * Gate 27 already proved this at 10 concurrent callers × 4 items.
 * Gate 35 turns the dial up:
 *
 *   • 20 concurrent MRP runs (double the Gate 27 fleet)
 *   • 8 overlapping components (every caller touches every item)
 *   • Each caller submits its lines in a DIFFERENT random order, so
 *     the lock-order proof has to do real work — the input is
 *     adversarial.
 *
 * Assertions:
 *
 *   1. No raw pg.DatabaseError surfaces with code 40P01 or 55P03.
 *      The retry loop in ReservationsService wraps those; if one
 *      leaks we have a regression.
 *   2. Every rejection (if any) is a ShortageError. Nothing else
 *      should be possible — NotFoundError on seeded items means a
 *      test-setup bug, ValidationError means a schema drift, and
 *      any other AppError means the service layer broke its
 *      contract.
 *   3. Fundamental ledger-projection invariant holds per item:
 *      on_hand == reserved + available, available >= 0.
 *   4. Σ(ACTIVE reservations.quantity WHERE ref_doc_type='GATE35')
 *      equals the delta stock_summary.reserved moved from baseline.
 *      (Gate 33 proves the equivalent for single-line reserves; this
 *      proves it holds through mrpReserveAll's all-or-nothing txn
 *      under contention.)
 *   5. Wall-clock completes under 60s (informational; the canonical-
 *      ordering guarantee says this shouldn't scale badly, and if it
 *      does we want to know).
 *
 * Fixtures: 8 synthetic items GATE35-1..GATE35-8 at UUIDs
 * 000000fb3501..000000fb3508, in a dedicated warehouse
 * 000000fa3501. Stock is topped up to 5000 units each before the
 * concurrency scenario, more than enough to swallow 20 callers
 * requesting a handful of units per item.
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
  type Role,
} from "@instigenie/contracts";
import { ShortageError } from "@instigenie/errors";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

const DEV_USER_ID = "00000000-0000-0000-0000-00000000b00b";

const WH_GATE35 = "00000000-0000-0000-0000-000000fa3501";
const ITEM_COUNT = 8;
const ITEMS: string[] = Array.from({ length: ITEM_COUNT }, (_, i) => {
  const suffix = (i + 1).toString(16).padStart(2, "0");
  return `00000000-0000-0000-0000-000000fb35${suffix}`;
});

const GATE_REF = "GATE35";
const BASELINE_PER_ITEM = 5_000;

const MRP_RUN_COUNT = 20;
const QTY_PER_LINE = 3;

type ServiceReq = Parameters<ReservationsService["mrpReserveAll"]>[0];

function makeRequest(): ServiceReq {
  return {
    user: {
      id: DEV_USER_ID,
      orgId: DEV_ORG_ID,
      email: "stores@mobilab.local",
      roles: ["STORES"] as Role[],
      permissions: new Set<Permission>(),
      audience: AUDIENCE.internal,
    },
  } as unknown as ServiceReq;
}

async function ensureFixtures(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      [DEV_USER_ID]
    );

    await client.query(
      `INSERT INTO warehouses (
         id, org_id, code, name, kind, address, city, state, country,
         postal_code, is_default, is_active, manager_id
       ) VALUES (
         $1, $2, 'WH-GATE35', 'Gate-35 MRP Warehouse', 'PRIMARY',
         'Synthetic', 'Bengaluru', 'KA', 'IN', '560100', false, true, $3
       ) ON CONFLICT (id) DO NOTHING`,
      [WH_GATE35, DEV_ORG_ID, DEV_USER_ID]
    );

    for (let i = 0; i < ITEMS.length; i++) {
      const itemId = ITEMS[i]!;
      const sku = `GATE35-${(i + 1).toString().padStart(2, "0")}`;
      await client.query(
        `INSERT INTO items (
           id, org_id, sku, name, description, category, uom, unit_cost,
           default_warehouse_id, is_serialised, is_batched
         ) VALUES (
           $1, $2, $3, $4, 'Gate-35 component',
           'RAW_MATERIAL', 'EA', 1.00, $5, false, false
         ) ON CONFLICT (id) DO NOTHING`,
        [itemId, DEV_ORG_ID, sku, `Gate-35 component ${i + 1}`, WH_GATE35]
      );

      await client.query(
        `INSERT INTO item_warehouse_bindings (
           org_id, item_id, warehouse_id, reorder_level, reorder_qty,
           bin_location
         ) VALUES ($1, $2, $3, 0, 0, $4)
         ON CONFLICT (org_id, item_id, warehouse_id) DO NOTHING`,
        [DEV_ORG_ID, itemId, WH_GATE35, `M-${(i + 1).toString().padStart(2, "0")}`]
      );
    }
  });
}

async function resetBaseline(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `SELECT set_config('app.current_user', $1, true)`,
      [DEV_USER_ID]
    );

    // Release + delete every GATE35 reservation first.
    const { rows: active } = await client.query<{ id: string }>(
      `SELECT id FROM stock_reservations
        WHERE ref_doc_type = $1 AND status = 'ACTIVE'`,
      [GATE_REF]
    );
    for (const r of active) {
      await client.query(
        `SELECT release_stock_reservation($1::uuid, $2::uuid)`,
        [r.id, DEV_USER_ID]
      );
    }
    await client.query(
      `DELETE FROM stock_reservations WHERE ref_doc_type = $1`,
      [GATE_REF]
    );

    // Top each item back to BASELINE_PER_ITEM on_hand.
    for (const itemId of ITEMS) {
      const { rows } = await client.query<{ on_hand: string }>(
        `SELECT on_hand FROM stock_summary
          WHERE item_id = $1 AND warehouse_id = $2`,
        [itemId, WH_GATE35]
      );
      const current = Number(rows[0]?.on_hand ?? 0);
      const delta = BASELINE_PER_ITEM - current;
      if (delta !== 0) {
        await client.query(
          `INSERT INTO stock_ledger (
             org_id, item_id, warehouse_id, quantity, uom, txn_type,
             ref_doc_type, reason, posted_by
           ) VALUES ($1, $2, $3, $4, 'EA', 'ADJUSTMENT', $5, $6, $7)`,
          [
            DEV_ORG_ID,
            itemId,
            WH_GATE35,
            delta.toString(),
            GATE_REF,
            `gate-35 baseline reset to ${BASELINE_PER_ITEM}`,
            DEV_USER_ID,
          ]
        );
      }
    }
  });
}

async function readSummaries(
  pool: pg.Pool
): Promise<Map<string, { onHand: number; reserved: number; available: number }>> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows } = await client.query<{
      item_id: string;
      on_hand: string;
      reserved: string;
      available: string;
    }>(
      `SELECT item_id, on_hand, reserved, available
         FROM stock_summary
        WHERE warehouse_id = $1 AND item_id = ANY($2::uuid[])`,
      [WH_GATE35, ITEMS]
    );
    const map = new Map<
      string,
      { onHand: number; reserved: number; available: number }
    >();
    for (const r of rows) {
      map.set(r.item_id, {
        onHand: Number(r.on_hand),
        reserved: Number(r.reserved),
        available: Number(r.available),
      });
    }
    return map;
  });
}

async function sumActive(pool: pg.Pool): Promise<Map<string, number>> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows } = await client.query<{ item_id: string; total: string }>(
      `SELECT item_id, COALESCE(SUM(quantity), 0)::text AS total
         FROM stock_reservations
        WHERE ref_doc_type = $1 AND status = 'ACTIVE'
          AND warehouse_id = $2
        GROUP BY item_id`,
      [GATE_REF, WH_GATE35]
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.item_id, Number(r.total));
    return map;
  });
}

// Deterministic pseudo-random shuffle. Seeding per-call lets us build
// reproducible-but-different orderings per MRP caller without pulling
// in a dep. Knuth/Fisher-Yates using mulberry32.
function shuffle<T>(array: readonly T[], seed: number): T[] {
  const a = [...array];
  let s = seed >>> 0;
  function rand(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe("gate-35 (arch phase 3.8): deadlock-free MRP", () => {
  let pool: pg.Pool;
  let reservations: ReservationsService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    reservations = new ReservationsService(pool);
    await ensureFixtures(pool);
  });

  afterAll(async () => {
    await resetBaseline(pool);
    await pool.end();
  });

  beforeEach(async () => {
    await resetBaseline(pool);
  });

  it(
    "20 concurrent MRP runs on 8 overlapping components never deadlock",
    async () => {
      // Per-caller lines. Every caller touches every item, QTY_PER_LINE
      // each. With BASELINE_PER_ITEM = 5000, supply per item is
      // 20 × 3 = 60 units needed vs 5000 available — ShortageError is
      // impossible, so any rejection is a genuine bug.
      function buildBulk(i: number): BulkReserveStockRequest {
        const shuffled = shuffle(ITEMS, 0x1337_0000 + i);
        return {
          refDocType: GATE_REF,
          refDocId: `00000000-0000-0000-0000-${i
            .toString(16)
            .padStart(4, "0")}00003500`,
          lines: shuffled.map((itemId) => ({
            itemId,
            warehouseId: WH_GATE35,
            quantity: `${QTY_PER_LINE}.000`,
            uom: "EA",
          })),
        };
      }

      const before = await readSummaries(pool);
      for (const itemId of ITEMS) {
        expect(before.get(itemId)?.onHand).toBe(BASELINE_PER_ITEM);
        expect(before.get(itemId)?.reserved).toBe(0);
      }

      const start = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: MRP_RUN_COUNT }, (_, i) =>
          reservations.mrpReserveAll(makeRequest(), buildBulk(i))
        )
      );
      const elapsedMs = Date.now() - start;

      // (1)+(2) No unexpected error types. Any rejection is a bug —
      // either a deadlock slipped the retry loop, or a shortage we
      // sized out. We explicitly enumerate by instanceof ShortageError
      // because deadlocks surface as pg.DatabaseError with code 40P01,
      // which is neither Shortage nor State.
      const rejected = results.filter((r) => r.status === "rejected");
      for (const r of rejected) {
        const reason = (r as PromiseRejectedResult).reason;
        const code = (reason as { code?: string })?.code;
        if (code === "40P01") {
          throw new Error(
            `deadlock (40P01) leaked past retry loop: ${String(reason)}`
          );
        }
        if (code === "55P03") {
          throw new Error(
            `lock_not_available (55P03) leaked past retry loop: ${String(reason)}`
          );
        }
        if (!(reason instanceof ShortageError)) {
          throw new Error(
            `unexpected rejection type: ${reason?.constructor?.name} — ${String(reason)}`
          );
        }
      }
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      // Sized to fit — every MRP should have completed.
      expect(succeeded).toBe(MRP_RUN_COUNT);

      // (3)+(4) Invariants.
      const after = await readSummaries(pool);
      const actives = await sumActive(pool);
      const expectedReservedPerItem = MRP_RUN_COUNT * QTY_PER_LINE;
      for (const itemId of ITEMS) {
        const s = after.get(itemId)!;
        const active = actives.get(itemId) ?? 0;

        expect(s.onHand, `onHand==reserved+available ${itemId}`).toBe(
          s.reserved + s.available
        );
        expect(s.available).toBeGreaterThanOrEqual(0);
        expect(s.reserved, `reserved delta ${itemId}`).toBe(
          expectedReservedPerItem
        );
        expect(active, `active sum ${itemId}`).toBe(expectedReservedPerItem);
        expect(s.available).toBe(BASELINE_PER_ITEM - expectedReservedPerItem);
      }

      // (5) Latency — informational but guarded against regression.
      // eslint-disable-next-line no-console
      console.log(
        `[gate-35] ${MRP_RUN_COUNT} MRP runs × ${ITEM_COUNT} items ` +
          `completed in ${elapsedMs}ms`
      );
      expect(elapsedMs).toBeLessThan(60_000);
    },
    90_000
  );
});
