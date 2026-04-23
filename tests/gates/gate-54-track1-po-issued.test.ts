/**
 * Gate 54 — Track 1 Phase 1 emit #7: `po.issued` (outbox-only).
 *
 * `PurchaseOrdersService.create()` emits `po.issued` on the same txn as
 * the domain write (see "Track 1 emit #7" comment in
 * apps/api/src/modules/procurement/purchase-orders.service.ts). There
 * is no separate DRAFT → ISSUED transition today — PO create IS the
 * issuance — so the idempotency_key has no version suffix
 * (`po.issued:${poId}`), matching the one-shot semantics.
 *
 * This is an outbox-only gate: HANDLER_CATALOGUE has no subscriber for
 * `po.issued` today. Phase 2 will register Track 2 F2
 * (finance.postVendorAdvance — see automate.md); the test pins that
 * empty-subscriber state so a handler slipping in without a matching
 * E2E gate trips here.
 *
 * Pinned behaviour:
 *
 *   - The service writes an outbox.events row with
 *     `aggregate_type='purchase_order'`, `event_type='po.issued'`,
 *     `aggregate_id=<poId>`, and `idempotency_key='po.issued:<poId>'`.
 *   - The payload carries all fields the handler contract advertises
 *     (`PoIssuedPayload` in apps/worker/src/handlers/types.ts):
 *     orgId, poId, poNumber, vendorId, totalValue (grand_total as
 *     string), currency, lines (optional snapshot of
 *     itemId/quantity/uom/unitPrice), actorId.
 *   - `lines` is a snapshot of exactly the lines submitted on create —
 *     numbers match, quantities and unit prices come through as
 *     strings (contracts use qtyStr/decimalStr).
 *   - Two distinct creates produce two distinct outbox rows (no
 *     per-vendor or per-org collapse).
 *   - A PO created with no lines still emits, with `lines: []`. This
 *     deliberately permits the "shell PO, lines added later via
 *     addLine()" workflow — Track 2 F2 handlers must tolerate empty
 *     line snapshots by joining po_lines on poId.
 *
 * Fixture tagging: all rows carry `notes LIKE 'gate-54 …'` so the
 * surgical DELETEs in beforeEach don't touch seed PO-2026-0001 /
 * PO-2026-0002 or any neighbouring gate's fixtures.
 *
 * We use the seeded V-ECM vendor (fe0001) and the seeded 1k resistor
 * item (fb0001). Both exist after `pnpm db:migrate` and are stable
 * UUIDs, so we skip a per-gate fixture bootstrap.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  CreatePoLine,
  CreatePurchaseOrder,
  PurchaseOrderWithLines,
} from "@instigenie/contracts";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";
import {
  HANDLER_CATALOGUE,
  loadApiService,
  makeAdminRequest,
  DEV_ADMIN_ID,
  type ServiceRequest,
  waitForOutboxRow,
} from "./_phase3-helpers.js";

// Seed fixtures (ops/sql/seed/09-procurement-dev-data.sql + 08-inventory-dev-data.sql).
// These are stable UUIDs — re-running `pnpm db:migrate` leaves them in place.
const SEED_VENDOR_ECM = "00000000-0000-0000-0000-000000fe0001";
const SEED_ITEM_RESISTOR = "00000000-0000-0000-0000-000000fb0001";
const SEED_ITEM_CAPACITOR = "00000000-0000-0000-0000-000000fb0002";

interface PurchaseOrdersServiceLike {
  create(
    req: ServiceRequest,
    input: CreatePurchaseOrder,
  ): Promise<PurchaseOrderWithLines>;
}

interface PurchaseOrdersServiceCtor {
  new (pool: pg.Pool): PurchaseOrdersServiceLike;
}

describe("gate-54: track 1 — po.issued outbox emit", () => {
  let pool: pg.Pool;
  let pos: PurchaseOrdersServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{
      PurchaseOrdersService: PurchaseOrdersServiceCtor;
    }>("apps/api/src/modules/procurement/purchase-orders.service.ts");
    pos = new mod.PurchaseOrdersService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Clean up prior gate-54 POs so re-runs are idempotent. Order:
  //   1. outbox rows keyed by our PO ids (FK cascade via handler_runs isn't
  //      in play here, but we delete first so purchase_orders can't reject),
  //   2. po_lines (cascades from PO anyway, but explicit is safer),
  //   3. purchase_orders (header).
  // The FK from PO → vendor is ON DELETE RESTRICT, so we never touch
  // `vendors` — we lean on the seeded V-ECM.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'po.issued'
            AND aggregate_id IN (
              SELECT id FROM purchase_orders WHERE notes LIKE 'gate-54 %'
            )`,
      );
      await client.query(
        `DELETE FROM po_lines
          WHERE po_id IN (
            SELECT id FROM purchase_orders WHERE notes LIKE 'gate-54 %'
          )`,
      );
      await client.query(
        `DELETE FROM purchase_orders WHERE notes LIKE 'gate-54 %'`,
      );
    });
  });

  function baseInput(tag: string, lines: CreatePoLine[]): CreatePurchaseOrder {
    return {
      vendorId: SEED_VENDOR_ECM,
      currency: "INR",
      paymentTermsDays: 30,
      notes: `gate-54 ${tag}`,
      lines,
    };
  }

  it("emits po.issued with the full payload on PO create", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const lines: CreatePoLine[] = [
      {
        itemId: SEED_ITEM_RESISTOR,
        quantity: "100.000",
        uom: "EA",
        unitPrice: "2.50",
        discountPct: "0",
        taxPct: "18",
      },
      {
        itemId: SEED_ITEM_CAPACITOR,
        quantity: "50.000",
        uom: "EA",
        unitPrice: "6.00",
        discountPct: "0",
        taxPct: "18",
      },
    ];
    const po: PurchaseOrderWithLines = await pos.create(
      req,
      baseInput(`single-${suffix}`, lines),
    );

    // Domain write landed.
    expect(po.id).toBeDefined();
    expect(po.vendorId).toBe(SEED_VENDOR_ECM);
    expect(po.lines).toHaveLength(2);
    // grand_total = (100×2.50 + 50×6.00) + 18% tax = 550 + 99 = 649.00
    expect(po.grandTotal).toBe("649.00");

    // Outbox row landed in the same txn.
    const outbox = await waitForOutboxRow(pool, `po.issued:${po.id}`);
    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      poId: po.id,
      poNumber: po.poNumber,
      vendorId: SEED_VENDOR_ECM,
      totalValue: po.grandTotal,
      currency: "INR",
      actorId: DEV_ADMIN_ID,
    });

    // lines snapshot shape — itemId/quantity/uom/unitPrice per input line.
    const payloadLines = (outbox.payload as { lines: Array<Record<string, unknown>> })
      .lines;
    expect(payloadLines).toHaveLength(2);
    // Repo returns qty/price as strings (qtyStr/decimalStr), so payload
    // carries strings. We match the shape rather than pinning ordering
    // exactly (the service preserves input order via lineNo).
    expect(payloadLines[0]).toEqual({
      itemId: SEED_ITEM_RESISTOR,
      quantity: "100.000",
      uom: "EA",
      unitPrice: "2.50",
    });
    expect(payloadLines[1]).toEqual({
      itemId: SEED_ITEM_CAPACITOR,
      quantity: "50.000",
      uom: "EA",
      unitPrice: "6.00",
    });

    // Row-level shape assertions — aggregate_type, aggregate_id,
    // event_type. Pulling from pool directly (not waitForOutboxRow) so
    // we also cover the non-payload columns.
    const { rows: evt } = await pool.query<{
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
    }>(
      `SELECT aggregate_type, aggregate_id, event_type
         FROM outbox.events WHERE id = $1`,
      [outbox.id],
    );
    expect(evt[0]).toMatchObject({
      aggregate_type: "purchase_order",
      aggregate_id: po.id,
      event_type: "po.issued",
    });
  });

  it("HANDLER_CATALOGUE does not subscribe to po.issued today", () => {
    // Phase 1 emit — no handler consumer. Phase 2 will register Track 2 F2
    // (finance.postVendorAdvance). This assertion doubles as a tripwire if
    // a handler slips in without a matching E2E gate.
    const subscribers = HANDLER_CATALOGUE.filter(
      (e) => e.eventType === "po.issued",
    );
    expect(subscribers).toHaveLength(0);
  });

  it("two distinct creates produce two distinct outbox rows", async () => {
    // Proves the idempotency_key is PO-scoped: even against the same
    // vendor, each create writes a distinct row.
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const mkLines = (): CreatePoLine[] => [
      {
        itemId: SEED_ITEM_RESISTOR,
        quantity: "10.000",
        uom: "EA",
        unitPrice: "2.50",
        discountPct: "0",
        taxPct: "0",
      },
    ];
    const a = await pos.create(req, baseInput(`two-a-${suffix}`, mkLines()));
    const b = await pos.create(req, baseInput(`two-b-${suffix}`, mkLines()));

    expect(a.id).not.toBe(b.id);
    expect(a.poNumber).not.toBe(b.poNumber);

    const rowA = await waitForOutboxRow(pool, `po.issued:${a.id}`);
    const rowB = await waitForOutboxRow(pool, `po.issued:${b.id}`);
    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.payload).toMatchObject({ poId: a.id, poNumber: a.poNumber });
    expect(rowB.payload).toMatchObject({ poId: b.id, poNumber: b.poNumber });
  });

  it("PO created with no lines still emits with empty lines array", async () => {
    // Track 2 F2 handlers are told in the header comment to join po_lines
    // on poId rather than trust the payload snapshot. Empty lines is the
    // legal "shell PO, fill later" state — the emit must still fire so a
    // future lines-added handler has a first event to attach to.
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const po: PurchaseOrderWithLines = await pos.create(
      req,
      baseInput(`empty-${suffix}`, []),
    );
    expect(po.lines).toHaveLength(0);
    expect(po.grandTotal).toBe("0.00");

    const outbox = await waitForOutboxRow(pool, `po.issued:${po.id}`);
    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      poId: po.id,
      poNumber: po.poNumber,
      totalValue: "0.00",
      currency: "INR",
      actorId: DEV_ADMIN_ID,
    });
    const payloadLines = (outbox.payload as { lines: unknown[] }).lines;
    expect(payloadLines).toEqual([]);
  });
});
