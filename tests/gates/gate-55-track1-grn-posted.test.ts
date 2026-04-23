/**
 * Gate 55 — Track 1 Phase 1 emit #8: `grn.posted` (outbox-only).
 *
 * `GrnsService.post()` emits `grn.posted` at the end of the atomic
 * draft → POSTED transition (apps/api/src/modules/procurement/grns.service.ts,
 * see "Track 1 emit #8" comment). The emit fires after all of:
 *
 *   1. per-line stock_ledger rows landed (txn_type='GRN_RECEIPT'),
 *   2. po_lines.received_qty bumped,
 *   3. parent PO status recomputed (→ PARTIALLY_RECEIVED / RECEIVED),
 *   4. GRN header flipped DRAFT → POSTED,
 *
 * all inside the same `withRequest` txn. So "outbox row exists" is the
 * strongest possible proof the whole posting flow succeeded.
 *
 * The emit has no handler today (HANDLER_CATALOGUE has no subscriber for
 * `grn.posted`). Phase 2 consumers: the qc_inward scheduler that drafts
 * an inspection for the receipt, and Track 2 F3 finance accounting.
 * This gate pins the current "emit-only" state so a handler slipping in
 * without a matching E2E gate trips the HANDLER_CATALOGUE assertion.
 *
 * Pinned behaviour:
 *
 *   - The service writes an outbox.events row with
 *     `aggregate_type='grn'`, `event_type='grn.posted'`,
 *     `aggregate_id=<grnId>`, and
 *     `idempotency_key='grn.posted:<grnId>'`. No version suffix — the
 *     status guard (DRAFT → POSTED is one-way) makes per-grn the only
 *     sensible idempotency scope.
 *   - The payload carries every field in the
 *     `GrnPostedPayload` contract (apps/worker/src/handlers/types.ts):
 *     orgId, grnId, grnNumber, poId, vendorId, lines snapshot
 *     (itemId/quantity/uom/warehouseId per grn_line), actorId.
 *   - `lines` snapshot matches the grn_lines rows 1:1 — same count,
 *     same item ids, quantities as strings (numeric parser hook).
 *   - The status guard short-circuits a re-post of an already-POSTED
 *     GRN with StateTransitionError — so there's no second outbox
 *     write. (We assert the single outbox row remains after the
 *     expected error.)
 *   - Posting two distinct GRNs produces two distinct outbox rows.
 *
 * Deliberate non-scope:
 *
 *   - We don't assert stock_ledger / stock_summary correctness here;
 *     that's covered exhaustively by gate-22 (outbox → stock) and
 *     gate-33 (stock correctness under load).
 *   - We don't assert the PO status recompute detail; gate-25 (tenant
 *     isolation) and the integration suite cover receipt → PO status.
 *
 * Fixture tagging: all PO+GRN rows carry `notes LIKE 'gate-55 …'` so
 * the surgical DELETEs in beforeEach don't touch seed fixtures or other
 * gates' rows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  CreateGrn,
  CreateGrnLine,
  CreatePurchaseOrder,
  Grn,
  GrnWithLines,
  PurchaseOrderWithLines,
} from "@instigenie/contracts";
import { StateTransitionError } from "@instigenie/errors";
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

// Seed fixtures (stable UUIDs, see ops/sql/seed/08-inventory-dev-data.sql
// and 09-procurement-dev-data.sql).
const SEED_VENDOR_ECM = "00000000-0000-0000-0000-000000fe0001";
const SEED_ITEM_RESISTOR = "00000000-0000-0000-0000-000000fb0001";
const SEED_WH_MAIN = "00000000-0000-0000-0000-000000fa0001";

interface PurchaseOrdersServiceLike {
  create(
    req: ServiceRequest,
    input: CreatePurchaseOrder,
  ): Promise<PurchaseOrderWithLines>;
}

interface PurchaseOrdersServiceCtor {
  new (pool: pg.Pool): PurchaseOrdersServiceLike;
}

interface GrnsServiceLike {
  create(req: ServiceRequest, input: CreateGrn): Promise<GrnWithLines>;
  post(
    req: ServiceRequest,
    grnId: string,
    input: { expectedVersion: number },
  ): Promise<GrnWithLines>;
}

interface GrnsServiceCtor {
  new (pool: pg.Pool): GrnsServiceLike;
}

describe("gate-55: track 1 — grn.posted outbox emit", () => {
  let pool: pg.Pool;
  let pos: PurchaseOrdersServiceLike;
  let grns: GrnsServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const poMod = await loadApiService<{
      PurchaseOrdersService: PurchaseOrdersServiceCtor;
    }>("apps/api/src/modules/procurement/purchase-orders.service.ts");
    pos = new poMod.PurchaseOrdersService(pool);

    const grnMod = await loadApiService<{
      GrnsService: GrnsServiceCtor;
    }>("apps/api/src/modules/procurement/grns.service.ts");
    grns = new grnMod.GrnsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Cleanup is multi-step because of the FK web:
  //   po_lines     → purchase_orders (CASCADE)
  //   grn_lines    → grns (CASCADE)
  //   grn_lines    → po_lines (RESTRICT)  ← must delete GRN before PO
  //   grns         → purchase_orders (RESTRICT)  ← same
  //   stock_ledger → items/warehouses (RESTRICT, not to GRN — ref_doc_id
  //                  is a soft pointer so we clear it by value)
  //
  // So: outbox events → stock_ledger residue → GRNs (cascades grn_lines
  // and frees the po_line RESTRICT) → POs (cascades po_lines).
  //
  // stock_summary isn't touched here — the trigger only fires on INSERT
  // into stock_ledger, so deleting historical rows leaves the summary
  // slightly inflated. Harmless for gate-55 (we only receive, never
  // check availability) but documented so the next maintainer isn't
  // surprised.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE (event_type = 'grn.posted'
             AND aggregate_id IN (
               SELECT id FROM grns WHERE notes LIKE 'gate-55 %'
             ))
             OR (event_type = 'po.issued'
             AND aggregate_id IN (
               SELECT id FROM purchase_orders WHERE notes LIKE 'gate-55 %'
             ))`,
      );
      await client.query(
        `DELETE FROM stock_ledger
          WHERE ref_doc_type = 'GRN'
            AND ref_doc_id IN (SELECT id FROM grns WHERE notes LIKE 'gate-55 %')`,
      );
      await client.query(
        `DELETE FROM grns WHERE notes LIKE 'gate-55 %'`,
      );
      await client.query(
        `DELETE FROM purchase_orders WHERE notes LIKE 'gate-55 %'`,
      );
    });
  });

  /**
   * Seed an APPROVED PO with one line against SEED_ITEM_RESISTOR. We
   * bypass the approval route (no service API today to move DRAFT →
   * APPROVED beyond a generic `update()`) and patch the status via
   * direct SQL. Gate-55 is about the GRN-post emit, not PO approval —
   * and a separate gate exists for po.issued (gate-54).
   */
  async function seedApprovedPo(tag: string): Promise<PurchaseOrderWithLines> {
    const req = makeAdminRequest(DEV_ORG_ID);
    const po = await pos.create(req, {
      vendorId: SEED_VENDOR_ECM,
      currency: "INR",
      paymentTermsDays: 30,
      notes: `gate-55 ${tag}`,
      lines: [
        {
          itemId: SEED_ITEM_RESISTOR,
          quantity: "100.000",
          uom: "EA",
          unitPrice: "2.50",
          discountPct: "0",
          taxPct: "18",
        },
      ],
    });
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `UPDATE purchase_orders SET status = 'APPROVED' WHERE id = $1`,
        [po.id],
      );
    });
    return po;
  }

  it("emits grn.posted with full payload + snapshot lines on post", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const po = await seedApprovedPo(`happy-${suffix}`);

    // Draft GRN with one line covering the PO line in full.
    const grnLine: CreateGrnLine = {
      poLineId: po.lines[0]!.id,
      itemId: SEED_ITEM_RESISTOR,
      quantity: "100.000",
      uom: "EA",
      unitCost: "2.50",
      qcRejectedQty: "0",
    };
    const draft: GrnWithLines = await grns.create(req, {
      poId: po.id,
      vendorId: SEED_VENDOR_ECM,
      warehouseId: SEED_WH_MAIN,
      notes: `gate-55 happy-${suffix}`,
      lines: [grnLine],
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.lines).toHaveLength(1);

    // Post the draft.
    const posted = await grns.post(req, draft.id, {
      expectedVersion: draft.version,
    });
    expect(posted.status).toBe("POSTED");

    // Outbox row present + shape.
    const outbox = await waitForOutboxRow(pool, `grn.posted:${draft.id}`);
    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      grnId: draft.id,
      grnNumber: posted.grnNumber,
      poId: po.id,
      vendorId: SEED_VENDOR_ECM,
      actorId: DEV_ADMIN_ID,
    });

    // Lines snapshot — exact shape. The repo returns quantities as strings
    // (numeric parser hook), so the payload carries strings too.
    const payloadLines = (outbox.payload as {
      lines: Array<Record<string, unknown>>;
    }).lines;
    expect(payloadLines).toHaveLength(1);
    expect(payloadLines[0]).toEqual({
      itemId: SEED_ITEM_RESISTOR,
      quantity: "100.000",
      uom: "EA",
      warehouseId: SEED_WH_MAIN,
    });

    // Row-level shape — aggregate_type, event_type, aggregate_id.
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
      aggregate_type: "grn",
      aggregate_id: draft.id,
      event_type: "grn.posted",
    });
  });

  it("HANDLER_CATALOGUE does not subscribe to grn.posted today", () => {
    // Phase 1 emit — no handler consumer. Phase 2 will register the
    // qc_inward scheduler + Track 2 F3 finance accounting. This check
    // doubles as a tripwire if a handler slips in without a matching
    // E2E gate.
    const subscribers = HANDLER_CATALOGUE.filter(
      (e) => e.eventType === "grn.posted",
    );
    expect(subscribers).toHaveLength(0);
  });

  it("re-posting an already-POSTED GRN rejects without writing a second outbox row", async () => {
    // The service's post() guards on status === 'DRAFT' and throws
    // StateTransitionError otherwise. That throw happens BEFORE
    // enqueueOutbox, so no second row appears. We explicitly count the
    // outbox rows to prove no duplicate leaked in.
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const po = await seedApprovedPo(`re-post-${suffix}`);
    const draft = await grns.create(req, {
      poId: po.id,
      vendorId: SEED_VENDOR_ECM,
      warehouseId: SEED_WH_MAIN,
      notes: `gate-55 re-post-${suffix}`,
      lines: [
        {
          poLineId: po.lines[0]!.id,
          itemId: SEED_ITEM_RESISTOR,
          quantity: "50.000",
          uom: "EA",
          unitCost: "2.50",
          qcRejectedQty: "0",
        },
      ],
    });
    const posted = await grns.post(req, draft.id, {
      expectedVersion: draft.version,
    });
    expect(posted.status).toBe("POSTED");

    // Attempt to re-post. Version bumped by the first post, so fetch the
    // fresh version before retry — otherwise we'd get ConflictError first
    // and never reach the status guard.
    await expect(
      grns.post(req, draft.id, { expectedVersion: posted.version }),
    ).rejects.toBeInstanceOf(StateTransitionError);

    // Exactly one outbox row.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM outbox.events WHERE idempotency_key = $1`,
      [`grn.posted:${draft.id}`],
    );
    expect(rows).toHaveLength(1);
  });

  it("two distinct GRN posts produce two distinct outbox rows", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const makeAndPost = async (tag: string): Promise<Grn> => {
      const po = await seedApprovedPo(tag);
      const draft = await grns.create(req, {
        poId: po.id,
        vendorId: SEED_VENDOR_ECM,
        warehouseId: SEED_WH_MAIN,
        notes: `gate-55 ${tag}`,
        lines: [
          {
            poLineId: po.lines[0]!.id,
            itemId: SEED_ITEM_RESISTOR,
            quantity: "10.000",
            uom: "EA",
            unitCost: "2.50",
            qcRejectedQty: "0",
          },
        ],
      });
      return grns.post(req, draft.id, { expectedVersion: draft.version });
    };
    const a = await makeAndPost(`two-a-${suffix}`);
    const b = await makeAndPost(`two-b-${suffix}`);
    expect(a.id).not.toBe(b.id);

    const rowA = await waitForOutboxRow(pool, `grn.posted:${a.id}`);
    const rowB = await waitForOutboxRow(pool, `grn.posted:${b.id}`);
    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.payload).toMatchObject({ grnId: a.id });
    expect(rowB.payload).toMatchObject({ grnId: b.id });
  });
});
