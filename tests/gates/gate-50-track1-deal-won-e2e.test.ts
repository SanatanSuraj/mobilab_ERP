/**
 * Gate 50 — Track 1 Phase 1 emit #3 (E2E): `deal.won` → registered
 * handlers land domain writes.
 *
 * The deal.stage_changed path is already pinned by gate-49. This gate
 * is the end-to-end companion: CLOSED_WON emits BOTH deal.stage_changed
 * AND deal.won, and the deal.won fan-out is registered in
 * apps/worker/src/handlers/index.ts against:
 *
 *   - production.createWorkOrder     → work_orders row
 *   - procurement.createMrpIndent    → indents row (header)
 *
 * The gate drives the full chain:
 *
 *   1. Seed product + ACTIVE BOM + ACCEPTED quotation (the
 *      precondition the service asserts for CLOSED_WON — see
 *      deals.service.ts "Part D #1 fix" comment).
 *   2. Walk deal DISCOVERY → PROPOSAL → NEGOTIATION → CLOSED_WON via
 *      DealsService.transitionStage. The final hop emits two outbox
 *      rows (stage_changed + won).
 *   3. Poll for the `deal.won:${id}:v${version}` outbox row via
 *      `waitForOutboxRow`.
 *   4. Drive BOTH registered deal.won handlers via
 *      `runHandlersForEvent` (the same entry point the worker
 *      dispatcher uses).
 *   5. Assert work_orders + indents rows exist, tagged back to the
 *      deal by deal_id / indent_number prefix. Handler_runs ledger has
 *      one COMPLETED row per handler.
 *   6. Redelivery: repeat runHandlersForEvent → every handler returns
 *      SKIPPED. Row counts stay flat. This is the §3.1
 *      at-most-once-observable property under at-least-once delivery.
 *
 * Coverage note: gate-38.1 runs the same two handlers against a
 * synthesized outbox row. The distinction: gate-38 proves the handlers
 * work in isolation given an ideal payload; gate-50 proves the service
 * actually EMITS a payload shape those handlers accept. If the service
 * ever trims a required field from the deal.won payload (say dropping
 * bomVersionLabel), gate-50 fails on the handler's NOT NULL violation
 * while gate-38 keeps passing. That's the gap we're closing here.
 *
 * Cleanup: fixtures tagged `gate-50 …`. Product + BOM are idempotent
 * via the GATE50-PRODUCT code, mirroring gate-46's approach.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  CreateDeal,
  Deal,
  TransitionDealStage,
} from "@instigenie/contracts";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";
import {
  HANDLER_CATALOGUE,
  loadApiService,
  makeRequest,
  registeredHandlerNames,
  runHandlersForEvent,
  silentLog,
  type ServiceRequest,
  waitForOutboxRow,
} from "./_phase3-helpers.js";

interface DealsServiceLike {
  create(req: ServiceRequest, input: CreateDeal): Promise<Deal>;
  transitionStage(
    req: ServiceRequest,
    id: string,
    input: TransitionDealStage,
  ): Promise<Deal>;
}
interface DealsServiceCtor {
  new (pool: pg.Pool): DealsServiceLike;
}

const GATE50_PRODUCT_CODE = "GATE50-PRODUCT";

/**
 * Idempotent product + ACTIVE BOM seed. Same shape as gate-46's
 * `ensureGate46WinProduct` — one product row per run, reused across
 * tests. Partial unique on (org, lower(code)) WHERE deleted_at IS NULL
 * doubles as the idempotency key.
 */
async function ensureGate50Product(
  pool: pg.Pool,
): Promise<{ productId: string; bomId: string }> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows: prodRows } = await client.query<{
      id: string;
      active_bom_id: string | null;
    }>(
      `INSERT INTO products (org_id, product_code, name, family, uom)
       VALUES ($1, $2, 'gate-50 test product', 'MODULE', 'PCS')
       ON CONFLICT (org_id, lower(product_code)) WHERE deleted_at IS NULL
         DO UPDATE SET updated_at = now()
       RETURNING id, active_bom_id`,
      [DEV_ORG_ID, GATE50_PRODUCT_CODE],
    );
    const product = prodRows[0]!;
    if (product.active_bom_id) {
      return { productId: product.id, bomId: product.active_bom_id };
    }
    const { rows: bomRows } = await client.query<{ id: string }>(
      `INSERT INTO bom_versions
         (org_id, product_id, version_label, status)
       VALUES ($1, $2, 'v1-gate50', 'ACTIVE')
       RETURNING id`,
      [DEV_ORG_ID, product.id],
    );
    const bomId = bomRows[0]!.id;
    await client.query(
      `UPDATE products SET active_bom_id = $2 WHERE id = $1`,
      [product.id, bomId],
    );
    return { productId: product.id, bomId };
  });
}

/**
 * Seed the ACCEPTED quotation + primary line the service reads when
 * emitting deal.won. Fresh per-deal.
 */
async function seedAcceptedQuotation(
  pool: pg.Pool,
  dealId: string,
): Promise<void> {
  await ensureGate50Product(pool);
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const quotationNumber = `GATE50-Q-${suffix}`;
    const { rows: qRows } = await client.query<{ id: string }>(
      `INSERT INTO quotations
         (org_id, quotation_number, deal_id, company, contact_name,
          status, subtotal, tax_amount, grand_total)
       VALUES ($1, $2, $3, 'gate-50 customer', 'gate-50 contact',
               'ACCEPTED', 1000, 0, 1000)
       RETURNING id`,
      [DEV_ORG_ID, quotationNumber, dealId],
    );
    const quotationId = qRows[0]!.id;
    await client.query(
      `INSERT INTO quotation_line_items
         (org_id, quotation_id, product_code, product_name,
          quantity, unit_price, line_total)
       VALUES ($1, $2, $3, 'gate-50 product', 3, 1000, 3000)`,
      [DEV_ORG_ID, quotationId, GATE50_PRODUCT_CODE],
    );
  });
}

/** Walk DISCOVERY → PROPOSAL → NEGOTIATION, return the deal at NEGOTIATION. */
async function advanceToNegotiation(
  deals: DealsServiceLike,
  deal: Deal,
): Promise<Deal> {
  const req = makeRequest(DEV_ORG_ID);
  const a = await deals.transitionStage(req, deal.id, {
    stage: "PROPOSAL",
    expectedVersion: deal.version,
  });
  return deals.transitionStage(req, deal.id, {
    stage: "NEGOTIATION",
    expectedVersion: a.version,
  });
}

describe("gate-50: track 1 — deal.won E2E through handlers", () => {
  let pool: pg.Pool;
  let deals: DealsServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{ DealsService: DealsServiceCtor }>(
      "apps/api/src/modules/crm/deals.service.ts",
    );
    deals = new mod.DealsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Cleanup is aggressive on per-deal rows but leaves the product + BOM
  // alive (idempotent across runs). handler_runs rows FK-cascade from
  // outbox.events on delete, so the outbox.events DELETE cleans both.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      // Drop downstream rows first so the deal DELETE doesn't trip FKs.
      await client.query(
        `DELETE FROM indent_lines WHERE indent_id IN (
           SELECT id FROM indents WHERE indent_number LIKE 'MRP-%' AND notes LIKE '%gate-50%'
         )`,
      );
      await client.query(
        `DELETE FROM indents WHERE indent_number LIKE 'MRP-%' AND notes LIKE '%gate-50%'`,
      );
      await client.query(
        `DELETE FROM work_orders WHERE pid LIKE 'WO-%' AND deal_id IN (
           SELECT id FROM deals WHERE company LIKE 'gate-50 %'
         )`,
      );
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type IN ('deal.stage_changed', 'deal.won')
            AND aggregate_id IN (
              SELECT id FROM deals WHERE company LIKE 'gate-50 %'
            )`,
      );
      await client.query(
        `DELETE FROM quotations WHERE quotation_number LIKE 'GATE50-Q-%'`,
      );
      await client.query(
        `DELETE FROM deals WHERE company LIKE 'gate-50 %'`,
      );
    });
  });

  it("CLOSED_WON fires deal.won and both registered handlers land their writes idempotently", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const created = await deals.create(req, {
      title: `gate-50 deal ${suffix}`,
      company: `gate-50 ${suffix}`,
      contactName: "Gate 50 Contact",
      stage: "DISCOVERY",
      value: "50000",
      probability: 20,
    });
    const atNego = await advanceToNegotiation(deals, created);
    await seedAcceptedQuotation(pool, created.id);
    const won = await deals.transitionStage(req, created.id, {
      stage: "CLOSED_WON",
      expectedVersion: atNego.version,
    });
    expect(won.stage).toBe("CLOSED_WON");

    // Sibling emit — sanity check the stage_changed row also landed for
    // the same version so we know the commit order held.
    await waitForOutboxRow(
      pool,
      `deal.stage_changed:${created.id}:v${won.version}`,
    );

    const outbox = await waitForOutboxRow(
      pool,
      `deal.won:${created.id}:v${won.version}`,
    );
    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      dealId: created.id,
      dealNumber: won.dealNumber,
      bomVersionLabel: "v1-gate50",
      quantity: "3",
      requestedBy: req.user.id,
    });

    // Service resolves productId / bomId through the active-BOM chain —
    // verify they point at our seeded product/bom.
    const { productId, bomId } = await ensureGate50Product(pool);
    expect(outbox.payload).toMatchObject({ productId, bomId });

    // Drive the handler catalogue once, asserting both handlers complete.
    const expectedHandlers = registeredHandlerNames("deal.won").sort();
    expect(expectedHandlers).toEqual([
      "procurement.createMrpIndent",
      "production.createWorkOrder",
    ]);

    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "deal.won",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(first.map((r) => r.status).sort()).toEqual([
      "COMPLETED",
      "COMPLETED",
    ]);

    // Assert domain rows landed. work_orders is RLS-gated so the count
    // must run under withOrg.
    const snapshot = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const wo = await c.query<{
        pid: string;
        status: string;
        quantity: string;
        deal_id: string;
      }>(
        `SELECT pid, status, quantity::text AS quantity, deal_id
           FROM work_orders WHERE deal_id = $1`,
        [created.id],
      );
      const ind = await c.query<{
        indent_number: string;
        status: string;
        department: string;
      }>(
        `SELECT indent_number, status, department
           FROM indents WHERE indent_number LIKE $1`,
        [`MRP-${won.dealNumber}-%`],
      );
      return { wo: wo.rows, ind: ind.rows };
    });
    expect(snapshot.wo).toHaveLength(1);
    expect(snapshot.wo[0]!.status).toBe("PLANNED");
    expect(Number(snapshot.wo[0]!.quantity)).toBe(3);
    expect(snapshot.wo[0]!.pid).toMatch(new RegExp(`^WO-${won.dealNumber}-`));
    expect(snapshot.ind).toHaveLength(1);
    expect(snapshot.ind[0]).toMatchObject({
      department: "PRODUCTION",
      status: "SUBMITTED",
    });

    // handler_runs ledger — one COMPLETED row per handler keyed by
    // (outboxId, handlerName). Same shape gate-38 asserts.
    const runs = await pool.query<{ handler_name: string; status: string }>(
      `SELECT handler_name, status FROM outbox.handler_runs
        WHERE outbox_id = $1 ORDER BY handler_name`,
      [outbox.id],
    );
    expect(runs.rows).toEqual([
      { handler_name: "procurement.createMrpIndent", status: "COMPLETED" },
      { handler_name: "production.createWorkOrder", status: "COMPLETED" },
    ]);

    // Redelivery — every handler returns SKIPPED, row counts stay flat.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "deal.won",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(second.every((r) => r.status === "SKIPPED")).toBe(true);

    const flat = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const wo = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM work_orders WHERE deal_id = $1`,
        [created.id],
      );
      const ind = await c.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM indents WHERE indent_number LIKE $1`,
        [`MRP-${won.dealNumber}-%`],
      );
      return { wo: wo.rows[0]!.count, ind: ind.rows[0]!.count };
    });
    expect(flat.wo).toBe("1");
    expect(flat.ind).toBe("1");
  });
});
