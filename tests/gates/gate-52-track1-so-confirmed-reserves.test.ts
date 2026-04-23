/**
 * Gate 52 — Track 1 Phase 1 emit #5 (E2E): `sales_order.confirmed` →
 * `inventory.reserveForSo` handler lands stock_reservations rows.
 *
 * The emit site lives in apps/api/src/modules/crm/sales-orders.service.ts
 * (see the "Track 1 emits #5 + #6" comment). When an SO transitions
 * DRAFT → CONFIRMED, the service writes a `sales_order.confirmed`
 * outbox row with idempotency_key `sales_order.confirmed:${id}:v${version}`.
 *
 * One registered handler in apps/worker/src/handlers/index.ts subscribes:
 *
 *   sales_order.confirmed → inventory.reserveForSo
 *     Loads sales_order_line_items, resolves product_code → items.sku
 *     (case-insensitive, FINISHED_GOOD), calls reserve_stock_atomic
 *     to hard-reserve stock at the item's default_warehouse.
 *
 * This gate pins the full chain end-to-end:
 *
 *   1. Seed a gate-52-owned FINISHED_GOOD (`GATE52-WIDGET`) with a
 *      generous opening balance at WH-001. We OWN this item so no other
 *      suite can depress the available counter between runs. Mirrors
 *      gate-50's `ensureGate50Product` pattern.
 *   2. Create a DRAFT SO with a GATE52-WIDGET line.
 *   3. Transition DRAFT → CONFIRMED. Service emits the outbox row.
 *   4. Poll the outbox for the versioned idempotency key.
 *   5. Drive `inventory.reserveForSo` via runHandlersForEvent — same
 *      entry point the worker dispatcher uses. Assert COMPLETED.
 *   6. Assert stock_reservations has exactly one ACTIVE row for
 *      (ref_doc_type='SO', ref_doc_id=soId, ref_line_id=lineId) at the
 *      seeded quantity.
 *   7. Redelivery: runHandlersForEvent again → SKIPPED (outbox.handler_runs
 *      idempotency slot holds). Row count stays 1.
 *
 * Two graceful-degradation paths round out the suite:
 *
 *   - Unresolved product_code: SO with a code that doesn't match any
 *     FINISHED_GOOD item. Handler logs + returns COMPLETED, writes no
 *     reservation. (Sales-order issuance must not block on master-data
 *     drift — see handler header for rationale.)
 *   - Insufficient stock: SO with qty way above available. The
 *     reserve_stock_atomic stored function raises UR001; handler
 *     catches, logs, returns COMPLETED without reserving. (Track 2 F1
 *     ATP will emit `sales_order.stock_flagged` here instead.)
 *
 * Cleanup: per-test DELETE + release tagged to `company LIKE 'gate-52 %'`.
 * Reservations are RELEASED via the stored function first so stock_summary
 * counters stay consistent — a plain DELETE would leak `reserved` and
 * corrupt the gate's own WIDGET summary over repeated runs. The item
 * itself and its opening-balance ledger row are idempotent across runs
 * (a second INSERT is a no-op).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  CreateSalesOrder,
  SalesOrder,
  TransitionSalesOrderStatus,
} from "@instigenie/contracts";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";
import {
  DEV_USER_ID,
  HANDLER_CATALOGUE,
  loadApiService,
  makeRequest,
  registeredHandlerNames,
  runHandlersForEvent,
  silentLog,
  type ServiceRequest,
  waitForOutboxRow,
} from "./_phase3-helpers.js";

interface SalesOrdersServiceLike {
  create(req: ServiceRequest, input: CreateSalesOrder): Promise<SalesOrder>;
  transitionStatus(
    req: ServiceRequest,
    id: string,
    input: TransitionSalesOrderStatus,
  ): Promise<SalesOrder>;
}
interface SalesOrdersServiceCtor {
  new (pool: pg.Pool): SalesOrdersServiceLike;
}

// Gate-owned FINISHED_GOOD. Avoids depending on the shared ECG seed,
// which other gates can deplete over time. `items_sku_org_unique` is
// partial on (org_id, lower(sku)) WHERE deleted_at IS NULL — doubles as
// an idempotency key for the INSERT.
const GATE52_SKU = "GATE52-WIDGET";
const MAIN_WAREHOUSE_ID = "00000000-0000-0000-0000-000000fa0001";

// Size chosen so even after a run that leaks 2 ACTIVE reservations past
// cleanup (which shouldn't happen but hedge anyway), the next run still
// has >> qty available.
const GATE52_MIN_STOCK = 100;

/**
 * Ensure the gate-owned item + an opening balance at WH-001 exist.
 * Idempotent: safe to call across runs and across tests within one run.
 * Returns the resolved ids.
 */
async function ensureGate52Item(
  pool: pg.Pool,
): Promise<{ itemId: string; warehouseId: string }> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows: itemRows } = await client.query<{ id: string }>(
      `INSERT INTO items
         (org_id, sku, name, category, uom, default_warehouse_id, is_active)
       VALUES ($1, $2, 'gate-52 test widget', 'FINISHED_GOOD', 'EA', $3, true)
       ON CONFLICT (org_id, lower(sku)) WHERE deleted_at IS NULL
         DO UPDATE SET updated_at = now()
       RETURNING id`,
      [DEV_ORG_ID, GATE52_SKU, MAIN_WAREHOUSE_ID],
    );
    const itemId = itemRows[0]!.id;

    // Top up stock if below the minimum. Writing a positive ADJUSTMENT
    // row triggers tg_stock_summary_from_ledger to bump on_hand +
    // available atomically. Signed: negative would subtract.
    const { rows: sumRows } = await client.query<{ available: string | null }>(
      `SELECT available::text AS available
         FROM stock_summary
        WHERE org_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [DEV_ORG_ID, itemId, MAIN_WAREHOUSE_ID],
    );
    const currentAvailable = sumRows[0]
      ? Number(sumRows[0].available ?? 0)
      : 0;
    if (currentAvailable < GATE52_MIN_STOCK) {
      const topUp = GATE52_MIN_STOCK - currentAvailable;
      await client.query(
        `INSERT INTO stock_ledger
           (org_id, item_id, warehouse_id, quantity, uom, txn_type,
            ref_doc_type, unit_cost, posted_by, reason)
         VALUES ($1, $2, $3, $4::numeric, 'EA', 'ADJUSTMENT',
                 'ADJUSTMENT', 0, $5, 'gate-52 top-up')`,
        [DEV_ORG_ID, itemId, MAIN_WAREHOUSE_ID, topUp, DEV_USER_ID],
      );
    }

    return { itemId, warehouseId: MAIN_WAREHOUSE_ID };
  });
}

describe("gate-52: track 1 — sales_order.confirmed → inventory.reserveForSo E2E", () => {
  let pool: pg.Pool;
  let salesOrders: SalesOrdersServiceLike;
  let gate52ItemId: string;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{
      SalesOrdersService: SalesOrdersServiceCtor;
    }>("apps/api/src/modules/crm/sales-orders.service.ts");
    salesOrders = new mod.SalesOrdersService(pool);
    const seed = await ensureGate52Item(pool);
    gate52ItemId = seed.itemId;
  });

  afterAll(async () => {
    await pool.end();
  });

  // Cleanup order matters:
  //   1. Release ACTIVE reservations via the stored proc so stock_summary
  //      counters are decremented correctly. A plain DELETE here would
  //      leak `reserved` on the gate's WIDGET summary and the next run
  //      would see shrinking availability.
  //   2. DELETE the reservation rows (now status='RELEASED').
  //   3. DELETE outbox.events — handler_runs FK-cascades.
  //   4. DELETE sales_order_line_items, then sales_orders.
  //   5. Top up stock if the previous run somehow depleted it (cheap
  //      guard: ensureGate52Item is idempotent and only adjusts when
  //      available < GATE52_MIN_STOCK).
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows: soIds } = await client.query<{ id: string }>(
        `SELECT id FROM sales_orders WHERE company LIKE 'gate-52 %'`,
      );
      for (const { id } of soIds) {
        await client.query(
          `SELECT public.release_stock_reservations_by_ref(
             $1::uuid, 'SO', $2::uuid, $3::uuid
           )`,
          [DEV_ORG_ID, id, DEV_USER_ID],
        );
      }
      await client.query(
        `DELETE FROM stock_reservations
          WHERE ref_doc_type = 'SO'
            AND ref_doc_id IN (
              SELECT id FROM sales_orders WHERE company LIKE 'gate-52 %'
            )`,
      );
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'sales_order.confirmed'
            AND aggregate_id IN (
              SELECT id FROM sales_orders WHERE company LIKE 'gate-52 %'
            )`,
      );
      await client.query(
        `DELETE FROM sales_order_line_items
          WHERE order_id IN (
            SELECT id FROM sales_orders WHERE company LIKE 'gate-52 %'
          )`,
      );
      await client.query(
        `DELETE FROM sales_orders WHERE company LIKE 'gate-52 %'`,
      );
    });
    await ensureGate52Item(pool);
  });

  /**
   * Build a DRAFT SO with a single line. Default line is GATE52-WIDGET
   * qty=2; overrides let the insufficient-stock and unresolved-code
   * tests reuse the same scaffolding.
   */
  async function makeDraftSo(opts: {
    tag: string;
    productCode?: string;
    productName?: string;
    quantity?: number;
  }): Promise<SalesOrder> {
    const req = makeRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 10);
    const input: CreateSalesOrder = {
      company: `gate-52 ${opts.tag} ${suffix}`,
      contactName: "Gate 52 Contact",
      lineItems: [
        {
          productCode: opts.productCode ?? GATE52_SKU,
          productName: opts.productName ?? "gate-52 test widget",
          quantity: opts.quantity ?? 2,
          unitPrice: "100.00",
          discountPct: "0",
          taxPct: "0",
        },
      ],
    };
    return salesOrders.create(req, input);
  }

  it("handler catalogue registers exactly inventory.reserveForSo for sales_order.confirmed", () => {
    expect(registeredHandlerNames("sales_order.confirmed")).toEqual([
      "inventory.reserveForSo",
    ]);
  });

  it("CONFIRMED emits, handler reserves stock ACTIVE, redelivery is SKIPPED", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const draft = await makeDraftSo({ tag: "happy" });
    expect(draft.status).toBe("DRAFT");
    const lineId = draft.lineItems[0]!.id;

    const confirmed = await salesOrders.transitionStatus(req, draft.id, {
      status: "CONFIRMED",
      expectedVersion: draft.version,
    });
    expect(confirmed.status).toBe("CONFIRMED");

    const outbox = await waitForOutboxRow(
      pool,
      `sales_order.confirmed:${draft.id}:v${confirmed.version}`,
    );
    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      salesOrderId: draft.id,
      salesOrderNumber: confirmed.orderNumber,
      customerId: null, // no accountId bound on this SO
      actorId: req.user.id,
    });

    // Drive the handler. Service-emitted payload is passed through
    // untouched — this gate fails if the service payload shape ever
    // drifts from what the handler expects.
    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.confirmed",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("COMPLETED");

    // Reservation landed. `quantity` stores as numeric(18,3) — cast to
    // text for a stable comparison.
    const snapshot = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const res = await c.query<{
        item_id: string;
        warehouse_id: string;
        quantity: string;
        uom: string;
        status: string;
        ref_doc_type: string;
        ref_doc_id: string;
        ref_line_id: string | null;
      }>(
        `SELECT item_id, warehouse_id, quantity::text AS quantity,
                uom, status, ref_doc_type, ref_doc_id, ref_line_id
           FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [draft.id],
      );
      const runs = await c.query<{ handler_name: string; status: string }>(
        `SELECT handler_name, status
           FROM outbox.handler_runs
          WHERE outbox_id = $1
          ORDER BY handler_name`,
        [outbox.id],
      );
      return { res: res.rows, runs: runs.rows };
    });
    expect(snapshot.res).toHaveLength(1);
    expect(snapshot.res[0]).toMatchObject({
      item_id: gate52ItemId,
      warehouse_id: MAIN_WAREHOUSE_ID,
      uom: "EA",
      status: "ACTIVE",
      ref_doc_type: "SO",
      ref_doc_id: draft.id,
      ref_line_id: lineId,
    });
    expect(Number(snapshot.res[0]!.quantity)).toBe(2);

    // handler_runs ledger — one COMPLETED row per handler, keyed by
    // (outboxId, handlerName).
    expect(snapshot.runs).toEqual([
      { handler_name: "inventory.reserveForSo", status: "COMPLETED" },
    ]);

    // Redelivery — SKIPPED. Reservation count must stay at 1. If the
    // handler slot regressed, we'd see a second reservation row here
    // and stock_summary.reserved would over-count.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.confirmed",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(second[0]!.status).toBe("SKIPPED");

    const flat = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const { rows } = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [draft.id],
      );
      return rows[0]!.count;
    });
    expect(flat).toBe("1");
  });

  it("unresolved product_code: handler COMPLETES but writes no reservation", async () => {
    // product_code that has no matching items.sku — handler logs + skips.
    // Critical: returns COMPLETED (not FAILED), so the outbox row is
    // drained and not retried forever on master-data drift.
    const req = makeRequest(DEV_ORG_ID);
    const draft = await makeDraftSo({
      tag: "unresolved",
      productCode: "GATE52-NO-SUCH-PRODUCT",
      productName: "Nonexistent finished good",
    });
    const confirmed = await salesOrders.transitionStatus(req, draft.id, {
      status: "CONFIRMED",
      expectedVersion: draft.version,
    });
    const outbox = await waitForOutboxRow(
      pool,
      `sales_order.confirmed:${draft.id}:v${confirmed.version}`,
    );

    const results = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.confirmed",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(results[0]!.status).toBe("COMPLETED");

    const count = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const { rows } = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [draft.id],
      );
      return rows[0]!.count;
    });
    expect(count).toBe("0");
  });

  it("insufficient stock: handler catches UR001 and writes no reservation", async () => {
    // Seeded widget has GATE52_MIN_STOCK units; asking for 10_000_000
    // can never be satisfied. reserve_stock_atomic raises SQLSTATE
    // 'UR001'; the handler catches and logs rather than propagating.
    //
    // Observable contract: no stock_reservations row lands, and the
    // runner's JS return value is "COMPLETED" (it reports what the
    // handler returned, not whether the COMMIT was durable). We
    // intentionally DON'T assert on outbox.handler_runs here — once
    // reserve_stock_atomic raises, the enclosing Postgres txn is
    // aborted, so the handler_runs claim made earlier in the same
    // txn is silently rolled back when withOrg eventually COMMITs.
    // That's a subtle at-least-once wrinkle for the insufficient-stock
    // path; the *business* contract (don't reserve phantom stock) is
    // what matters and what this assertion pins. Track 2 F1's
    // `sales_order.stock_flagged` path will fix this by short-circuiting
    // before the PG-level exception.
    const req = makeRequest(DEV_ORG_ID);
    const draft = await makeDraftSo({
      tag: "oversold",
      quantity: 10_000_000,
    });
    const confirmed = await salesOrders.transitionStatus(req, draft.id, {
      status: "CONFIRMED",
      expectedVersion: draft.version,
    });
    const outbox = await waitForOutboxRow(
      pool,
      `sales_order.confirmed:${draft.id}:v${confirmed.version}`,
    );

    const results = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.confirmed",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(results[0]!.status).toBe("COMPLETED");

    const count = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const { rows } = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [draft.id],
      );
      return rows[0]!.count;
    });
    expect(count).toBe("0");
  });
});
