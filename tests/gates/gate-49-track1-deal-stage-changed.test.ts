/**
 * Gate 49 — Track 1 Phase 1 emit #2: `deal.stage_changed` (outbox-only).
 *
 * Every successful `deals.transitionStage()` call emits a
 * `deal.stage_changed` outbox event (apps/api/src/modules/crm/deals.service.ts,
 * see the "Track 1 emit #2" comment). The emit is outbox-only: no entry
 * in apps/worker/src/handlers/index.ts subscribes to it today. Phase 2
 * consumers include pipeline health dashboards and the win-rate KPI job.
 *
 * This gate pins:
 *
 *   - Every valid stage transition produces exactly one outbox row.
 *   - The idempotency_key follows the documented `deal.stage_changed:${id}:v${version}`
 *     shape — the `v${version}` suffix dedupes retries across the same
 *     version while still allowing a future back-transition to emit.
 *   - The payload carries from/to stages correctly, with `lostReason`
 *     populated only on CLOSED_LOST and null otherwise.
 *   - An invalid transition (DISCOVERY → CLOSED_WON) does NOT write an
 *     outbox row. Prevents "event emitted before domain commit" drift.
 *   - A version-conflict retry (ConflictError) also writes no outbox
 *     row. The service throws before enqueueOutbox is called.
 *
 * Deliberate non-scope:
 *   - deal.won emission on CLOSED_WON is its own gate (gate-50). This
 *     gate avoids the CLOSED_WON path so we don't have to seed the
 *     ACCEPTED-quotation + active-BOM chain here.
 *
 * Cleanup is tagged `gate-49 …`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  CreateDeal,
  Deal,
  TransitionDealStage,
} from "@instigenie/contracts";
import { ConflictError, StateTransitionError } from "@instigenie/errors";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";
import {
  assertNoOutboxRow,
  HANDLER_CATALOGUE,
  loadApiService,
  makeRequest,
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

describe("gate-49: track 1 — deal.stage_changed outbox emit", () => {
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

  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type IN ('deal.stage_changed', 'deal.won')
            AND aggregate_id IN (
              SELECT id FROM deals WHERE company LIKE 'gate-49 %'
            )`,
      );
      await client.query(
        `DELETE FROM deals WHERE company LIKE 'gate-49 %'`,
      );
    });
  });

  async function makeDeal(tag: string): Promise<Deal> {
    const req = makeRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const input: CreateDeal = {
      title: `gate-49 ${tag} ${suffix}`,
      company: `gate-49 ${tag} ${suffix}`,
      contactName: "Gate 49 Contact",
      stage: "DISCOVERY",
      value: "10000",
      probability: 20,
    };
    return deals.create(req, input);
  }

  it("DISCOVERY → PROPOSAL emits a deal.stage_changed with from/to stages", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const deal = await makeDeal("disc-prop");
    const moved = await deals.transitionStage(req, deal.id, {
      stage: "PROPOSAL",
      expectedVersion: deal.version,
    });
    expect(moved.stage).toBe("PROPOSAL");

    const outbox = await waitForOutboxRow(
      pool,
      `deal.stage_changed:${deal.id}:v${moved.version}`,
    );
    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      dealId: deal.id,
      dealNumber: moved.dealNumber,
      fromStage: "DISCOVERY",
      toStage: "PROPOSAL",
      lostReason: null,
      actorId: req.user.id,
    });
  });

  it("CLOSED_LOST emits with a populated lostReason", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const deal = await makeDeal("closed-lost");
    const reason = "gate-49 customer chose competitor";
    const moved = await deals.transitionStage(req, deal.id, {
      stage: "CLOSED_LOST",
      expectedVersion: deal.version,
      lostReason: reason,
    });
    expect(moved.stage).toBe("CLOSED_LOST");

    const outbox = await waitForOutboxRow(
      pool,
      `deal.stage_changed:${deal.id}:v${moved.version}`,
    );
    expect(outbox.payload).toMatchObject({
      fromStage: "DISCOVERY",
      toStage: "CLOSED_LOST",
      lostReason: reason,
    });
  });

  it("multi-hop DISCOVERY → PROPOSAL → NEGOTIATION emits two distinct rows keyed by version", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const deal = await makeDeal("multi-hop");
    const toProposal = await deals.transitionStage(req, deal.id, {
      stage: "PROPOSAL",
      expectedVersion: deal.version,
    });
    const toNego = await deals.transitionStage(req, deal.id, {
      stage: "NEGOTIATION",
      expectedVersion: toProposal.version,
    });

    const row1 = await waitForOutboxRow(
      pool,
      `deal.stage_changed:${deal.id}:v${toProposal.version}`,
    );
    const row2 = await waitForOutboxRow(
      pool,
      `deal.stage_changed:${deal.id}:v${toNego.version}`,
    );
    expect(row1.id).not.toBe(row2.id);
    expect(row1.payload).toMatchObject({ toStage: "PROPOSAL" });
    expect(row2.payload).toMatchObject({
      fromStage: "PROPOSAL",
      toStage: "NEGOTIATION",
    });
  });

  it("invalid transition (DISCOVERY → CLOSED_WON) rejects without emitting", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const deal = await makeDeal("invalid-edge");
    await expect(
      deals.transitionStage(req, deal.id, {
        stage: "CLOSED_WON",
        expectedVersion: deal.version,
      }),
    ).rejects.toBeInstanceOf(StateTransitionError);
    // The service throws BEFORE enqueueOutbox — version would have been
    // 2 if the write had happened, so this key can never collide with a
    // real row.
    await assertNoOutboxRow(
      pool,
      `deal.stage_changed:${deal.id}:v${deal.version + 1}`,
    );
  });

  it("version conflict rejects without emitting", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const deal = await makeDeal("ver-conflict");
    // Stale expectedVersion — service raises ConflictError before the
    // outbox write.
    await expect(
      deals.transitionStage(req, deal.id, {
        stage: "PROPOSAL",
        expectedVersion: deal.version + 99,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await assertNoOutboxRow(
      pool,
      `deal.stage_changed:${deal.id}:v${deal.version + 100}`,
    );
    // Also assert no row at any plausible successor version (belt-and-braces).
    await assertNoOutboxRow(
      pool,
      `deal.stage_changed:${deal.id}:v${deal.version + 1}`,
    );
  });

  it("HANDLER_CATALOGUE does not subscribe to deal.stage_changed today", () => {
    const subs = HANDLER_CATALOGUE.filter(
      (e) => e.eventType === "deal.stage_changed",
    );
    expect(subs).toHaveLength(0);
  });
});
