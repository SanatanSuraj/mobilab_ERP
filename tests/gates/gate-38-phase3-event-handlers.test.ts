/**
 * Gate 38 — Phase 3 §3.1 Event Handler Catalogue.
 *
 * ARCHITECTURE.md §3.1 mandates a cross-module fan-out catalogue:
 *
 *   deal.won                    → production.createWorkOrder
 *                                 procurement.createMrpIndent
 *   qc_inward.passed            → inventory.recordStockIn
 *                                 finance.draftPurchaseInvoice
 *   qc_final.passed             → inventory.recordFinishedGoods
 *                                 finance.notifyValuation
 *                                 crm.notifySales
 *   delivery_challan.confirmed  → inventory.recordDispatch
 *                                 finance.generateEwb       (§3.4 EWB client)
 *                                 crm.whatsappNotify        (§3.4 WA client)
 *
 * Ten handlers in total. The gate drives each handler directly through
 * runHandlersForEvent (the same entry point the outbox-dispatch processor
 * uses) and asserts:
 *
 *   (a) The handler's domain side-effect landed (work_order row, indent
 *       row, stock_ledger row, notification row, etc.).
 *   (b) An outbox.handler_runs row was recorded with status='COMPLETED'
 *       keyed by (outboxId, handlerName).
 *   (c) Running the event a second time is a no-op — every handler
 *       returns status='SKIPPED' and the downstream row counts stay
 *       identical byte-for-byte. That's the §3.1 at-most-once-observable
 *       property under at-least-once delivery.
 *
 * External clients (§3.4) are swapped for fake objects that record the
 * calls made against them so we can assert the handler reached the
 * client; the real HTTP/breaker path is already covered by Gate 30 + 36.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";
import {
  HANDLER_CATALOGUE,
  runHandlersForEvent,
  type EwbClientLike,
  type WhatsAppClientLike,
  type HandlerContext,
} from "@instigenie/worker/handlers";

// ─── Test plumbing ───────────────────────────────────────────────────────
// The running DB is instigenie-postgres on :5434 (see `docker ps`). Gates
// have historically run against an env-overridden URL — the default in
// _helpers.ts points at a non-running `instigenie` DB. We inline the
// instigenie URL here so the file is self-contained.

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://instigenie_app:instigenie_dev@localhost:5434/instigenie";

const ORG_ID = "00000000-0000-0000-0000-00000000a001";
const PRODUCT_ID = "00000000-0000-0000-0000-000000fc0001"; // ECG Patient Monitor v2
const BOM_ID = "00000000-0000-0000-0000-000000fc0101"; // v3 ACTIVE
const ITEM_ID = "00000000-0000-0000-0000-000000fb0001"; // Resistor 1kΩ
const WAREHOUSE_ID = "00000000-0000-0000-0000-000000fa0001"; // Main Plant Store
const VENDOR_ID = "00000000-0000-0000-0000-000000fe0001"; // Elcon Mart
const GRN_ID = "00000000-0000-0000-0000-0000000f3001"; // GRN-2026-0001
const SALES_USER = "00000000-0000-0000-0000-00000000b003"; // sales@instigenie.local
const FINANCE_USER = "00000000-0000-0000-0000-00000000b005"; // finance@instigenie.local

/** Every gate-38 run gets a unique suffix so the test is re-runnable
 * without a DB wipe — the deterministic per-outbox pid/indent_number
 * derivation lives inside the handler itself. */
function runId(): string {
  return randomUUID().slice(0, 8).toUpperCase();
}

/** Swallow-style silent logger with the shape the handler expects. */
const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silentLog,
  level: "info",
} as unknown as HandlerContext["log"];

interface EwbCall {
  orgId: string;
  docNo: string;
  referenceId?: string;
}
function makeFakeEwb(): EwbClientLike & { calls: EwbCall[] } {
  const calls: EwbCall[] = [];
  return {
    calls,
    async generate(orgId, payload) {
      calls.push({
        orgId,
        docNo: payload.docNo,
        ...(payload.referenceId !== undefined
          ? { referenceId: payload.referenceId }
          : {}),
      });
      return {
        status: "GENERATED",
        response: {
          ewbNo: `EWB-${payload.docNo}`,
          ewbDate: payload.docDate,
          validUpto: payload.docDate,
        },
      };
    },
  };
}

interface WaCall {
  orgId: string;
  to: string;
  template: string;
  referenceId?: string;
}
function makeFakeWhatsApp(): WhatsAppClientLike & { calls: WaCall[] } {
  const calls: WaCall[] = [];
  return {
    calls,
    async send(orgId, payload) {
      calls.push({
        orgId,
        to: payload.to,
        template: payload.template,
        ...(payload.referenceId !== undefined
          ? { referenceId: payload.referenceId }
          : {}),
      });
      return {
        status: "SENT",
        response: { messageId: `WA-${payload.template}-${Date.now()}`, status: "queued" },
      };
    },
  };
}

// A stand-in outbox row so the handler_runs FK (outbox_id → outbox.events(id))
// is satisfied. We insert a fresh event, run the catalogue against it, and
// clean up at the end. No Redis / BullMQ in the loop — the gate drives
// runHandlersForEvent directly.
async function insertOutboxEvent(
  pool: pg.Pool,
  eventType: string,
  payload: object,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO outbox.events
       (aggregate_type, aggregate_id, event_type, payload, idempotency_key)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [
      eventType.split(".")[0] ?? "test",
      randomUUID(),
      eventType,
      JSON.stringify(payload),
      `gate-38-${eventType}-${randomUUID()}`,
    ],
  );
  return rows[0]!.id;
}

let pool: pg.Pool;

beforeAll(async () => {
  installNumericTypeParser();
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 6,
    application_name: "gate-38",
  });
});

afterAll(async () => {
  await pool.end();
});

// ─── deal.won ────────────────────────────────────────────────────────────

describe("Gate 38.1 — deal.won fans out to production + procurement", () => {
  test("createWorkOrder and createMrpIndent both land, idempotent on redelivery", async () => {
    const run = runId();
    const dealNumber = `DEAL-G38-${run}`;
    // Create a deal so the work_orders.deal_id FK passes.
    const dealId = await withOrg(pool, ORG_ID, async (client) => {
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `INSERT INTO deals (org_id, deal_number, title, company, contact_name, stage, value)
         VALUES ($1, $2, 'Gate 38 deal', 'Acme Corp', 'Alice', 'CLOSED_WON', 50000)
         RETURNING id`,
        [ORG_ID, dealNumber],
      );
      return row!.id;
    });

    const payload = {
      orgId: ORG_ID,
      dealId,
      dealNumber,
      productId: PRODUCT_ID,
      bomId: BOM_ID,
      bomVersionLabel: "v3",
      quantity: "10",
      indentLines: [
        { itemId: ITEM_ID, quantity: "100", uom: "EA", estimatedCost: "5" },
      ],
    };
    const outboxId = await insertOutboxEvent(pool, "deal.won", payload);

    // First delivery: both handlers run.
    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "deal.won",
      payload,
      ctx: { outboxId, log: silentLog },
    });
    expect(first.map((r) => r.handlerName).sort()).toEqual([
      "procurement.createMrpIndent",
      "production.createWorkOrder",
    ]);
    expect(first.every((r) => r.status === "COMPLETED")).toBe(true);

    // Assert (a) work_order row landed; (b) indent + 1 line landed.
    const snapshot1 = await withOrg(pool, ORG_ID, async (c) => {
      const wo = await c.query(
        `SELECT pid, status, quantity::text AS quantity
         FROM work_orders WHERE deal_id = $1`,
        [dealId],
      );
      const ind = await c.query(
        `SELECT indent_number, status, department FROM indents
         WHERE indent_number LIKE $1`,
        [`MRP-${dealNumber}-%`],
      );
      const indLines = await c.query(
        `SELECT line_no, item_id, quantity::text AS quantity
         FROM indent_lines WHERE indent_id IN (
           SELECT id FROM indents WHERE indent_number LIKE $1
         )
         ORDER BY line_no`,
        [`MRP-${dealNumber}-%`],
      );
      return { wo: wo.rows, ind: ind.rows, indLines: indLines.rows };
    });
    expect(snapshot1.wo).toHaveLength(1);
    expect(snapshot1.wo[0]!.status).toBe("PLANNED");
    expect(Number(snapshot1.wo[0]!.quantity)).toBe(10);
    expect(snapshot1.wo[0]!.pid).toMatch(new RegExp(`^WO-${dealNumber}-`));
    expect(snapshot1.ind).toHaveLength(1);
    expect(snapshot1.ind[0]).toMatchObject({
      department: "PRODUCTION",
      status: "SUBMITTED",
    });
    expect(snapshot1.indLines).toHaveLength(1);
    expect(snapshot1.indLines[0]!.line_no).toBe(1);
    expect(snapshot1.indLines[0]!.item_id).toBe(ITEM_ID);
    expect(Number(snapshot1.indLines[0]!.quantity)).toBe(100);

    // Second delivery — same outboxId. Both handlers SHOULD be SKIPPED
    // and the row counts MUST stay identical.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "deal.won",
      payload,
      ctx: { outboxId, log: silentLog },
    });
    expect(second.every((r) => r.status === "SKIPPED")).toBe(true);
    const snapshot2 = await withOrg(pool, ORG_ID, async (c) => {
      const wo = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM work_orders WHERE deal_id = $1`,
        [dealId],
      );
      const ind = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM indents WHERE indent_number LIKE $1`,
        [`MRP-${dealNumber}-%`],
      );
      return { wo: wo.rows[0]!.count, ind: ind.rows[0]!.count };
    });
    expect(snapshot2.wo).toBe("1");
    expect(snapshot2.ind).toBe("1");

    // Assert the idempotency ledger recorded exactly one row per handler.
    const runs = await pool.query<{ handler_name: string; status: string }>(
      `SELECT handler_name, status FROM outbox.handler_runs
       WHERE outbox_id = $1 ORDER BY handler_name`,
      [outboxId],
    );
    expect(runs.rows).toEqual([
      { handler_name: "procurement.createMrpIndent", status: "COMPLETED" },
      { handler_name: "production.createWorkOrder", status: "COMPLETED" },
    ]);
  });
});

// ─── qc_inward.passed ────────────────────────────────────────────────────

describe("Gate 38.2 — qc_inward.passed fans out to inventory + finance", () => {
  test("recordStockIn and draftPurchaseInvoice both land, idempotent", async () => {
    const run = runId();
    const grnNumber = `GRN-G38-${run}`;

    const payload = {
      orgId: ORG_ID,
      grnId: GRN_ID,
      grnNumber,
      vendorId: VENDOR_ID,
      vendorName: "Elcon Mart Pvt Ltd",
      itemId: ITEM_ID,
      warehouseId: WAREHOUSE_ID,
      quantity: "50",
      uom: "EA",
      unitPrice: "4.50",
    };

    // Counts MUST run under withOrg — stock_ledger has RLS so a plain
    // pool query (no app.current_org) returns 0 rows.
    const beforeLedger = await withOrg(pool, ORG_ID, async (c) =>
      c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM stock_ledger
         WHERE txn_type = 'GRN_RECEIPT'
           AND ref_doc_type = 'GRN' AND ref_doc_id = $1`,
        [GRN_ID],
      ),
    );

    const outboxId = await insertOutboxEvent(pool, "qc_inward.passed", payload);
    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "qc_inward.passed",
      payload,
      ctx: { outboxId, log: silentLog },
    });
    expect(first.every((r) => r.status === "COMPLETED")).toBe(true);

    const snap = await withOrg(pool, ORG_ID, async (c) => {
      const led = await c.query<{ quantity: string; uom: string }>(
        `SELECT quantity::text AS quantity, uom FROM stock_ledger
         WHERE txn_type = 'GRN_RECEIPT' AND ref_doc_id = $1 AND item_id = $2
         ORDER BY posted_at DESC LIMIT 1`,
        [GRN_ID, ITEM_ID],
      );
      const pi = await c.query<{
        invoice_number: string;
        status: string;
        match_status: string;
        grand_total: string;
      }>(
        `SELECT invoice_number, status, match_status, grand_total::text AS grand_total
         FROM purchase_invoices
         WHERE grn_id = $1 AND invoice_number LIKE $2`,
        [GRN_ID, `PI-${grnNumber}-%`],
      );
      const piLines = await c.query<{ item_id: string; line_total: string }>(
        `SELECT item_id, line_total::text AS line_total
         FROM purchase_invoice_lines
         WHERE invoice_id IN (
           SELECT id FROM purchase_invoices WHERE invoice_number LIKE $1
         )`,
        [`PI-${grnNumber}-%`],
      );
      return { led: led.rows, pi: pi.rows, piLines: piLines.rows };
    });
    expect(Number(snap.led[0]!.quantity)).toBe(50);
    expect(snap.led[0]!.uom).toBe("EA");
    expect(snap.pi).toHaveLength(1);
    expect(snap.pi[0]!.status).toBe("DRAFT");
    expect(snap.pi[0]!.match_status).toBe("PENDING");
    expect(Number(snap.pi[0]!.grand_total)).toBe(225);
    expect(snap.piLines).toHaveLength(1);
    expect(snap.piLines[0]!.item_id).toBe(ITEM_ID);

    // Idempotent redelivery.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "qc_inward.passed",
      payload,
      ctx: { outboxId, log: silentLog },
    });
    expect(second.every((r) => r.status === "SKIPPED")).toBe(true);

    const afterLedger = await withOrg(pool, ORG_ID, async (c) =>
      c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM stock_ledger
         WHERE txn_type = 'GRN_RECEIPT'
           AND ref_doc_type = 'GRN' AND ref_doc_id = $1`,
        [GRN_ID],
      ),
    );
    expect(Number(afterLedger.rows[0]!.count)).toBe(
      Number(beforeLedger.rows[0]!.count) + 1,
    );

    const piCount = await withOrg(pool, ORG_ID, async (c) =>
      c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM purchase_invoices
         WHERE invoice_number LIKE $1`,
        [`PI-${grnNumber}-%`],
      ),
    );
    expect(piCount.rows[0]!.count).toBe("1");
  });
});

// ─── qc_final.passed ────────────────────────────────────────────────────

describe("Gate 38.3 — qc_final.passed fans out to inventory + finance + crm", () => {
  test("recordFinishedGoods + notifyValuation + notifySales, idempotent", async () => {
    const run = runId();
    // Create a work order fixture so link-back works.
    const workOrderId = await withOrg(pool, ORG_ID, async (client) => {
      const {
        rows: [row],
      } = await client.query<{ id: string }>(
        `INSERT INTO work_orders
           (org_id, pid, product_id, bom_id, bom_version_label,
            quantity, status)
         VALUES ($1, $2, $3, $4, 'v3', 5, 'IN_PROGRESS')
         RETURNING id`,
        [ORG_ID, `WO-G38-${run}`, PRODUCT_ID, BOM_ID],
      );
      return row!.id;
    });
    const workOrderPid = `WO-G38-${run}`;
    const payload = {
      orgId: ORG_ID,
      workOrderId,
      workOrderPid,
      productItemId: ITEM_ID,
      warehouseId: WAREHOUSE_ID,
      quantity: "5",
      uom: "EA",
      unitCost: "1200",
      valuationRecipientUserId: FINANCE_USER,
      salesRecipientUserId: SALES_USER,
      lotNumber: `LOT-G38-${run}`,
    };

    const outboxId = await insertOutboxEvent(pool, "qc_final.passed", payload);
    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "qc_final.passed",
      payload,
      ctx: { outboxId, log: silentLog },
    });
    expect(first.map((r) => r.status).sort()).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);

    const snap = await withOrg(pool, ORG_ID, async (c) => {
      const led = await c.query<{ quantity: string; batch_no: string | null }>(
        `SELECT quantity::text AS quantity, batch_no
         FROM stock_ledger
         WHERE txn_type = 'WO_OUTPUT' AND ref_doc_id = $1`,
        [workOrderId],
      );
      const notifs = await c.query<{
        user_id: string;
        severity: string;
        title: string;
      }>(
        `SELECT user_id, severity, title FROM notifications
         WHERE reference_type = 'work_order' AND reference_id = $1
         ORDER BY severity`,
        [workOrderId],
      );
      return { led: led.rows, notifs: notifs.rows };
    });
    expect(snap.led).toHaveLength(1);
    expect(Number(snap.led[0]!.quantity)).toBe(5);
    expect(snap.led[0]!.batch_no).toBe(`LOT-G38-${run}`);
    expect(snap.notifs).toHaveLength(2);
    const byUser = Object.fromEntries(snap.notifs.map((n) => [n.user_id, n]));
    expect(byUser[FINANCE_USER]).toMatchObject({ severity: "INFO" });
    expect(byUser[SALES_USER]).toMatchObject({ severity: "SUCCESS" });

    // Redelivery: all three SKIPPED, row counts flat.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "qc_final.passed",
      payload,
      ctx: { outboxId, log: silentLog },
    });
    expect(second.every((r) => r.status === "SKIPPED")).toBe(true);
    const countsAfter = await withOrg(pool, ORG_ID, async (c) => {
      const led = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM stock_ledger
         WHERE txn_type = 'WO_OUTPUT' AND ref_doc_id = $1`,
        [workOrderId],
      );
      const notifs = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
         WHERE reference_type = 'work_order' AND reference_id = $1`,
        [workOrderId],
      );
      return { led: led.rows[0]!.count, notifs: notifs.rows[0]!.count };
    });
    expect(countsAfter.led).toBe("1");
    expect(countsAfter.notifs).toBe("2");
  });
});

// ─── delivery_challan.confirmed ──────────────────────────────────────────

describe("Gate 38.4 — delivery_challan.confirmed fans out to inv + EWB + WA", () => {
  test("recordDispatch + generateEwb + whatsappNotify, idempotent, fakes record the calls", async () => {
    const run = runId();
    const dcId = randomUUID();
    const dcNumber = `DC-G38-${run}`;
    const fakeEwb = makeFakeEwb();
    const fakeWa = makeFakeWhatsApp();

    const payload = {
      orgId: ORG_ID,
      dcId,
      dcNumber,
      itemId: ITEM_ID,
      warehouseId: WAREHOUSE_ID,
      quantity: "3",
      uom: "EA",
      unitCost: "1200",
      fromGstin: "27AAAAA0000A1Z5",
      toGstin: "27BBBBB0000B2Z5",
      customerGstin: "27BBBBB0000B2Z5",
      ewbDocNo: dcNumber,
      ewbDocDate: "22/04/2026",
      totalValue: "3600",
      customerPhone: "+919876500038",
      customerName: "Gate 38 Customer",
    };

    const outboxId = await insertOutboxEvent(
      pool,
      "delivery_challan.confirmed",
      payload,
    );
    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "delivery_challan.confirmed",
      payload,
      ctx: {
        outboxId,
        log: silentLog,
        clients: { ewb: fakeEwb, whatsapp: fakeWa },
      },
    });
    expect(first.map((r) => r.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);

    // Ledger row landed as negative quantity.
    const led = await withOrg(pool, ORG_ID, async (c) => {
      const { rows } = await c.query<{ quantity: string; uom: string }>(
        `SELECT quantity::text AS quantity, uom FROM stock_ledger
         WHERE txn_type = 'CUSTOMER_ISSUE' AND ref_doc_id = $1`,
        [dcId],
      );
      return rows;
    });
    expect(led).toHaveLength(1);
    expect(Number(led[0]!.quantity)).toBe(-3);
    expect(led[0]!.uom).toBe("EA");

    // Fakes received the call exactly once.
    expect(fakeEwb.calls).toHaveLength(1);
    expect(fakeEwb.calls[0]).toMatchObject({
      orgId: ORG_ID,
      docNo: dcNumber,
      referenceId: dcId,
    });
    expect(fakeWa.calls).toHaveLength(1);
    expect(fakeWa.calls[0]).toMatchObject({
      orgId: ORG_ID,
      to: "+919876500038",
      template: "dispatch_confirmation",
      referenceId: dcId,
    });

    // Redelivery: SKIPPED everywhere. Fakes MUST NOT be called a second
    // time — handler_runs short-circuits before `entry.handler()`.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "delivery_challan.confirmed",
      payload,
      ctx: {
        outboxId,
        log: silentLog,
        clients: { ewb: fakeEwb, whatsapp: fakeWa },
      },
    });
    expect(second.every((r) => r.status === "SKIPPED")).toBe(true);
    expect(fakeEwb.calls).toHaveLength(1);
    expect(fakeWa.calls).toHaveLength(1);
  });
});

// ─── Catalogue wiring — single lookup table, no duplicates ──────────────

describe("Gate 38.5 — HANDLER_CATALOGUE shape", () => {
  test("exposes the §3.1 + §4.1 + Track 1 Phase 2 handlers with unique names in declared order", () => {
    // Phase 3 §3.1 + Phase 4 §4.1 (compliance.enqueuePdfRender) + Track 1
    // Phase 2 fan-out (automate.md). Order matches the array in
    // apps/worker/src/handlers/index.ts, which is the order fan-out runs
    // in — production side-effects before compliance fan-out to the
    // pdf-render queue, with Track 1 entries appended after the original
    // Phase 3/4 rows.
    const expected = [
      ["deal.won", "production.createWorkOrder"],
      ["deal.won", "procurement.createMrpIndent"],
      ["qc_inward.passed", "inventory.recordStockIn"],
      ["qc_inward.passed", "finance.draftPurchaseInvoice"],
      ["qc_final.passed", "inventory.recordFinishedGoods"],
      ["qc_final.passed", "finance.notifyValuation"],
      ["qc_final.passed", "crm.notifySales"],
      ["qc_cert.issued", "compliance.enqueuePdfRender"],
      ["delivery_challan.confirmed", "inventory.recordDispatch"],
      ["delivery_challan.confirmed", "finance.generateEwb"],
      ["delivery_challan.confirmed", "crm.whatsappNotify"],
      // ── Track 1 Phase 2 (automate.md) ──
      ["sales_order.confirmed", "inventory.reserveForSo"],
      ["sales_order.dispatched", "finance.draftSalesInvoice"],
      ["sales_order.dispatched", "inventory.releaseReservations"],
      ["payment.received", "finance.observeSettlement"],
      // ── Admin-users invite email (outbox-backed notification) ──
      ["user.invite.created", "admin.sendInvitationEmail"],
    ];
    const actual = HANDLER_CATALOGUE.map((e) => [e.eventType, e.handlerName]);
    expect(actual).toEqual(expected);
    const names = HANDLER_CATALOGUE.map((e) => e.handlerName);
    expect(new Set(names).size).toBe(names.length);
  });
});
