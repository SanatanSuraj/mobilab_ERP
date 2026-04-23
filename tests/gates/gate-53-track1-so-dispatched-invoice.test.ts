/**
 * Gate 53 — Track 1 Phase 1 emit #6 (E2E): `sales_order.dispatched` →
 * `finance.draftSalesInvoice` + `inventory.releaseReservations`.
 *
 * Emit site: apps/api/src/modules/crm/sales-orders.service.ts (same
 * transitionStatus() method as gate-52's CONFIRMED path; see the
 * "Track 1 emits #5 + #6" comment). DISPATCHED writes an outbox row
 * with idempotency_key `sales_order.dispatched:${id}:v${version}`.
 *
 * Two registered handlers in apps/worker/src/handlers/index.ts:
 *
 *   1. finance.draftSalesInvoice
 *      Loads the SO header + lines, drafts a sales_invoices row with
 *      status='DRAFT', currency='INR', and a nextInvoiceNumber bump of
 *      SI-YYYY-NNNN via finance_number_sequences. Idempotent at the
 *      business level via a SELECT-first short-circuit on
 *      `sales_invoices.sales_order_id` — even if the outbox slot
 *      regressed, a manual-drafted invoice wouldn't get duplicated.
 *
 *   2. inventory.releaseReservations
 *      Calls release_stock_reservations_by_ref(orgId, 'SO', soId, actorId)
 *      which flips every ACTIVE reservation for this SO to RELEASED and
 *      decrements stock_summary.reserved in the same txn.
 *
 * End-to-end chain exercised here:
 *
 *   DRAFT → CONFIRMED → PROCESSING → DISPATCHED
 *
 *   1. CONFIRMED path reuses gate-52's handler (`inventory.reserveForSo`)
 *      — we run it so the dispatched-path release has something to
 *      release. If that step regressed we wouldn't see it in this gate
 *      (that's gate-52's job), but we do assert the reservation lands
 *      ACTIVE here as a precondition for the RELEASED assertion later.
 *   2. DISPATCHED emits the outbox row + we drive both registered
 *      handlers via runHandlersForEvent.
 *   3. Assert: exactly one DRAFT sales_invoices row with the correct
 *      sales_order_id, grand_total, and a matching sales_invoice_lines
 *      row per SO line. Reservation for the SO flipped to RELEASED.
 *      handler_runs ledger has two COMPLETED rows keyed by
 *      (outboxId, handlerName).
 *   4. Redelivery: every handler returns SKIPPED; invoice count stays
 *      1, reservation stays RELEASED. The handler's own SELECT-first
 *      guard would also prevent duplication on a slot-regressed
 *      redelivery.
 *
 * A second test pins the manual-invoice short-circuit: if a human
 * drafts an invoice against the SO before dispatch fires, the
 * `finance.draftSalesInvoice` handler logs + skips without raising.
 * The `inventory.releaseReservations` handler still runs to completion
 * — release doesn't depend on the invoice state.
 *
 * Fixtures tagged `gate-53 …`. GATE53-WIDGET is a gate-owned
 * FINISHED_GOOD with an idempotent top-up, mirroring gate-52's pattern.
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

const GATE53_SKU = "GATE53-WIDGET";
const MAIN_WAREHOUSE_ID = "00000000-0000-0000-0000-000000fa0001";
const GATE53_MIN_STOCK = 100;

/**
 * Ensure a gate-owned FINISHED_GOOD with a top-up exists at WH-001.
 * Idempotent across runs. Mirrors gate-52's ensureGate52Item.
 */
async function ensureGate53Item(
  pool: pg.Pool,
): Promise<{ itemId: string; warehouseId: string }> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows: itemRows } = await client.query<{ id: string }>(
      `INSERT INTO items
         (org_id, sku, name, category, uom, default_warehouse_id, is_active)
       VALUES ($1, $2, 'gate-53 test widget', 'FINISHED_GOOD', 'EA', $3, true)
       ON CONFLICT (org_id, lower(sku)) WHERE deleted_at IS NULL
         DO UPDATE SET updated_at = now()
       RETURNING id`,
      [DEV_ORG_ID, GATE53_SKU, MAIN_WAREHOUSE_ID],
    );
    const itemId = itemRows[0]!.id;

    const { rows: sumRows } = await client.query<{ available: string | null }>(
      `SELECT available::text AS available
         FROM stock_summary
        WHERE org_id = $1 AND item_id = $2 AND warehouse_id = $3`,
      [DEV_ORG_ID, itemId, MAIN_WAREHOUSE_ID],
    );
    const currentAvailable = sumRows[0]
      ? Number(sumRows[0].available ?? 0)
      : 0;
    if (currentAvailable < GATE53_MIN_STOCK) {
      const topUp = GATE53_MIN_STOCK - currentAvailable;
      await client.query(
        `INSERT INTO stock_ledger
           (org_id, item_id, warehouse_id, quantity, uom, txn_type,
            ref_doc_type, unit_cost, posted_by, reason)
         VALUES ($1, $2, $3, $4::numeric, 'EA', 'ADJUSTMENT',
                 'ADJUSTMENT', 0, $5, 'gate-53 top-up')`,
        [DEV_ORG_ID, itemId, MAIN_WAREHOUSE_ID, topUp, DEV_USER_ID],
      );
    }
    return { itemId, warehouseId: MAIN_WAREHOUSE_ID };
  });
}

describe("gate-53: track 1 — sales_order.dispatched → finance.draftSalesInvoice + inventory.releaseReservations E2E", () => {
  let pool: pg.Pool;
  let salesOrders: SalesOrdersServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{
      SalesOrdersService: SalesOrdersServiceCtor;
    }>("apps/api/src/modules/crm/sales-orders.service.ts");
    salesOrders = new mod.SalesOrdersService(pool);
    await ensureGate53Item(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Cleanup order matters. Invoices FK-cascade on delete to lines; we
  // DELETE invoices FIRST (via sales_order_id lookup) since sales_orders
  // itself is deleted later. Reservations are released before delete so
  // stock_summary counters stay consistent across runs.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      const { rows: soIds } = await client.query<{ id: string }>(
        `SELECT id FROM sales_orders WHERE company LIKE 'gate-53 %'`,
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
              SELECT id FROM sales_orders WHERE company LIKE 'gate-53 %'
            )`,
      );
      // sales_invoice_lines cascades via FK ON DELETE CASCADE.
      await client.query(
        `DELETE FROM sales_invoices
          WHERE sales_order_id IN (
            SELECT id FROM sales_orders WHERE company LIKE 'gate-53 %'
          )`,
      );
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type IN ('sales_order.confirmed', 'sales_order.dispatched')
            AND aggregate_id IN (
              SELECT id FROM sales_orders WHERE company LIKE 'gate-53 %'
            )`,
      );
      await client.query(
        `DELETE FROM sales_order_line_items
          WHERE order_id IN (
            SELECT id FROM sales_orders WHERE company LIKE 'gate-53 %'
          )`,
      );
      await client.query(
        `DELETE FROM sales_orders WHERE company LIKE 'gate-53 %'`,
      );
    });
    await ensureGate53Item(pool);
  });

  /**
   * Create a DRAFT SO with a GATE53-WIDGET line, then walk the SO
   * through DRAFT → CONFIRMED (running inventory.reserveForSo) →
   * PROCESSING → DISPATCHED. Returns the DISPATCHED state + the outbox
   * row for sales_order.dispatched.
   *
   * CONFIRMED's reserveForSo handler is executed here so the eventual
   * dispatched-path release has an active reservation to release.
   * That handler is separately pinned by gate-52; we just drive it.
   */
  async function walkToDispatched(tag: string): Promise<{
    so: SalesOrder;
    dispatched: SalesOrder;
    outbox: { id: string; payload: Record<string, unknown> };
  }> {
    const req = makeRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 10);
    const input: CreateSalesOrder = {
      company: `gate-53 ${tag} ${suffix}`,
      contactName: "Gate 53 Contact",
      lineItems: [
        {
          productCode: GATE53_SKU,
          productName: "gate-53 test widget",
          quantity: 3,
          unitPrice: "100.00",
          discountPct: "0",
          taxPct: "18",
        },
      ],
    };
    const so = await salesOrders.create(req, input);

    const confirmed = await salesOrders.transitionStatus(req, so.id, {
      status: "CONFIRMED",
      expectedVersion: so.version,
    });
    const confirmedOutbox = await waitForOutboxRow(
      pool,
      `sales_order.confirmed:${so.id}:v${confirmed.version}`,
    );
    const reserveResults = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.confirmed",
      payload: confirmedOutbox.payload as Record<string, unknown> & {
        orgId: string;
      },
      ctx: { outboxId: confirmedOutbox.id, log: silentLog },
    });
    expect(reserveResults[0]!.status).toBe("COMPLETED");

    const processing = await salesOrders.transitionStatus(req, so.id, {
      status: "PROCESSING",
      expectedVersion: confirmed.version,
    });
    const dispatched = await salesOrders.transitionStatus(req, so.id, {
      status: "DISPATCHED",
      expectedVersion: processing.version,
    });
    const outbox = await waitForOutboxRow(
      pool,
      `sales_order.dispatched:${so.id}:v${dispatched.version}`,
    );
    return { so, dispatched, outbox };
  }

  it("handler catalogue registers both finance and inventory handlers for sales_order.dispatched", () => {
    expect(registeredHandlerNames("sales_order.dispatched")).toEqual([
      "finance.draftSalesInvoice",
      "inventory.releaseReservations",
    ]);
  });

  it("DISPATCHED drafts a DRAFT invoice, releases the SO reservation, and both handlers are idempotent", async () => {
    const { so, dispatched, outbox } = await walkToDispatched("happy");

    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      salesOrderId: so.id,
      salesOrderNumber: dispatched.orderNumber,
      customerId: null,
      actorId: DEV_USER_ID,
    });

    // Precondition: reserveForSo (run inside walkToDispatched) landed
    // one ACTIVE reservation. If this fails, the RELEASED assertion
    // later is meaningless.
    const precondition = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const { rows } = await c.query<{ status: string }>(
        `SELECT status FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [so.id],
      );
      return rows;
    });
    expect(precondition).toHaveLength(1);
    expect(precondition[0]!.status).toBe("ACTIVE");

    // Drive both registered handlers. Order in the catalogue: finance
    // first, then inventory (see handlers/index.ts comment).
    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.dispatched",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(first.map((r) => r.handlerName)).toEqual([
      "finance.draftSalesInvoice",
      "inventory.releaseReservations",
    ]);
    expect(first.map((r) => r.status)).toEqual(["COMPLETED", "COMPLETED"]);

    const snapshot = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const invs = await c.query<{
        id: string;
        invoice_number: string;
        status: string;
        sales_order_id: string;
        customer_name: string;
        subtotal: string;
        tax_total: string;
        grand_total: string;
      }>(
        `SELECT id, invoice_number, status, sales_order_id, customer_name,
                subtotal::text AS subtotal, tax_total::text AS tax_total,
                grand_total::text AS grand_total
           FROM sales_invoices
          WHERE sales_order_id = $1`,
        [so.id],
      );
      const lines = await c.query<{
        description: string;
        quantity: string;
        unit_price: string;
      }>(
        `SELECT description, quantity::text AS quantity,
                unit_price::text AS unit_price
           FROM sales_invoice_lines
          WHERE invoice_id = $1
          ORDER BY sequence_number`,
        [invs.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000"],
      );
      const reservations = await c.query<{ status: string }>(
        `SELECT status FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [so.id],
      );
      const runs = await c.query<{ handler_name: string; status: string }>(
        `SELECT handler_name, status FROM outbox.handler_runs
          WHERE outbox_id = $1 ORDER BY handler_name`,
        [outbox.id],
      );
      return {
        invs: invs.rows,
        lines: lines.rows,
        reservations: reservations.rows,
        runs: runs.rows,
      };
    });

    // Invoice created in DRAFT with the SO's totals. subtotal=300,
    // tax=54 (18% of 300), grand=354.
    expect(snapshot.invs).toHaveLength(1);
    expect(snapshot.invs[0]).toMatchObject({
      status: "DRAFT",
      sales_order_id: so.id,
      customer_name: so.company,
    });
    expect(snapshot.invs[0]!.invoice_number).toMatch(/^SI-\d{4}-\d{4}$/);
    expect(Number(snapshot.invs[0]!.subtotal)).toBeCloseTo(300, 2);
    expect(Number(snapshot.invs[0]!.tax_total)).toBeCloseTo(54, 2);
    expect(Number(snapshot.invs[0]!.grand_total)).toBeCloseTo(354, 2);

    // One line copied from the SO line.
    expect(snapshot.lines).toHaveLength(1);
    expect(snapshot.lines[0]!.description).toContain(GATE53_SKU);
    expect(Number(snapshot.lines[0]!.quantity)).toBe(3);
    expect(Number(snapshot.lines[0]!.unit_price)).toBe(100);

    // Reservation flipped to RELEASED (was ACTIVE).
    expect(snapshot.reservations).toHaveLength(1);
    expect(snapshot.reservations[0]!.status).toBe("RELEASED");

    // handler_runs ledger. Sort-order: finance.<… then inventory.<….
    expect(snapshot.runs).toEqual([
      { handler_name: "finance.draftSalesInvoice", status: "COMPLETED" },
      { handler_name: "inventory.releaseReservations", status: "COMPLETED" },
    ]);

    // Redelivery: every handler SKIPPED. Invoice count stays 1,
    // reservation stays RELEASED.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.dispatched",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(second.every((r) => r.status === "SKIPPED")).toBe(true);

    const flat = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const inv = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM sales_invoices WHERE sales_order_id = $1`,
        [so.id],
      );
      const res = await c.query<{ status: string }>(
        `SELECT status FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [so.id],
      );
      return { invCount: inv.rows[0]!.count, resStatus: res.rows[0]!.status };
    });
    expect(flat.invCount).toBe("1");
    expect(flat.resStatus).toBe("RELEASED");
  });

  it("pre-existing invoice: finance handler short-circuits, inventory handler still releases", async () => {
    // Simulate a human who manually drafted an invoice for this SO
    // before dispatch. The handler's SELECT-first guard (see
    // sales-order-dispatched.ts:90) should skip the INSERT — business
    // idempotency that survives a regressed handler_runs slot.
    //
    // We INSERT via raw SQL (inside withOrg) rather than through a
    // service method because a dedicated "manual draft before
    // dispatch" service path doesn't exist — a human edits a DRAFT
    // invoice landed via some other channel. Raw SQL is the most
    // faithful fixture for that race.
    const { so, outbox } = await walkToDispatched("existing-inv");

    const manualInvoiceId = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO sales_invoices
           (org_id, invoice_number, status, sales_order_id,
            customer_name, subtotal, tax_total, grand_total, currency)
         VALUES ($1, $2, 'DRAFT', $3, 'Manual gate-53 customer',
                 '100.0000', '0.0000', '100.0000', 'INR')
         RETURNING id`,
        [DEV_ORG_ID, `GATE53-MANUAL-${so.id.slice(0, 8)}`, so.id],
      );
      return rows[0]!.id;
    });

    const results = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "sales_order.dispatched",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(results.map((r) => r.status)).toEqual(["COMPLETED", "COMPLETED"]);

    const snapshot = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const invs = await c.query<{ id: string; status: string }>(
        `SELECT id, status FROM sales_invoices
          WHERE sales_order_id = $1
          ORDER BY created_at ASC`,
        [so.id],
      );
      const reservations = await c.query<{ status: string }>(
        `SELECT status FROM stock_reservations
          WHERE ref_doc_type = 'SO' AND ref_doc_id = $1`,
        [so.id],
      );
      return { invs: invs.rows, reservations: reservations.rows };
    });

    // Only the manually-drafted invoice exists. finance.draftSalesInvoice
    // short-circuited on its SELECT-first guard and didn't auto-draft.
    expect(snapshot.invs).toHaveLength(1);
    expect(snapshot.invs[0]!.id).toBe(manualInvoiceId);
    // inventory.releaseReservations ran unconditionally — release is
    // orthogonal to the invoice state.
    expect(snapshot.reservations).toHaveLength(1);
    expect(snapshot.reservations[0]!.status).toBe("RELEASED");
  });
});
