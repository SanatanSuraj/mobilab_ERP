/**
 * Gate 58 — Track 1 Phase 1 emit #10: `wo.stage_changed` (outbox-only).
 *
 * Every `WorkOrdersService.advanceStage()` call emits a `wo.stage_changed`
 * outbox row — see the "Track 1 emit #10" comment in
 * apps/api/src/modules/production/work-orders.service.ts. The emit fires
 * unconditionally (the `if (finalWo.status !== header.status || freshStage)`
 * guard is effectively "always true for a valid stage advance"), but the
 * idempotency key collapses "same WO-level status transition on the same
 * stage at the same rework generation" into a single row:
 *
 *     wo.stage_changed:${woId}:${stageId}:${finalWo.status}:r${reworkCount}
 *
 * This is intentional. Two shapes of deduplication are pinned by this
 * gate:
 *
 *   - COMPLETE on a non-QC stage keeps the WO at IN_PROGRESS (it just
 *     rolls the `current_stage_index` forward). That emit's key collides
 *     with the START emit for the same stage — the WO status didn't
 *     change — so only one row exists at the end. This matches the
 *     documented semantics: `wo.stage_changed` is a WO-level transition
 *     feed, not a stage-level one.
 *
 *   - COMPLETE on a QC-signoff stage flips the WO to QC_HOLD, so the key
 *     carries `QC_HOLD`. QC_FAIL then flips to REWORK and bumps the
 *     stage's rework counter, so the key carries `REWORK:r1`. Each leg
 *     of the rework cycle writes a distinct row.
 *
 * Handler-side: `HANDLER_CATALOGUE` has no subscriber for
 * `wo.stage_changed` today. Phase 2 wires:
 *   - Track 2 F5 FG valuation (on toStage=COMPLETED)
 *   - Track 2 F8 material issue (on the first stage START)
 *
 * Fixture strategy: we create fresh WOs per test via the service using
 * the seeded ECG product (v_pr_ecg, fc0001) which has an ACTIVE BOM
 * (v_bm_ecg3). The INSTRUMENT product family has 8 wip_stage_templates
 * seeded — stage 1 = Component Kitting (non-QC), stage 2 = PCB
 * Sub-Assembly (requires QC). Every WO we create carries `notes LIKE
 * 'gate-58 %'` so the surgical DELETEs below don't touch the seeded
 * v_wo_001/002/003 or any neighbouring gate.
 *
 * wip_stages.wo_id → work_orders(id) is ON DELETE CASCADE (see
 * ops/sql/init/05-production.sql), so deleting the WO header cleans up
 * its stages in one step.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  AdvanceWipStage,
  CreateWorkOrder,
  WipStage,
  WorkOrderWithStages,
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

// Seed fixture (ops/sql/seed/10-production-dev-data.sql). ECG Patient
// Monitor v2 has `active_bom_id = v_bm_ecg3` and `is_active = true` — so
// WorkOrdersService.create() accepts it with only productId + quantity.
const SEED_PRODUCT_ECG = "00000000-0000-0000-0000-000000fc0001";

interface WorkOrdersServiceLike {
  create(
    req: ServiceRequest,
    input: CreateWorkOrder,
  ): Promise<WorkOrderWithStages>;
  advanceStage(
    req: ServiceRequest,
    woId: string,
    stageId: string,
    input: AdvanceWipStage,
  ): Promise<WorkOrderWithStages>;
}

interface WorkOrdersServiceCtor {
  new (pool: pg.Pool): WorkOrdersServiceLike;
}

describe("gate-58: track 1 — wo.stage_changed outbox emit", () => {
  let pool: pg.Pool;
  let wos: WorkOrdersServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{
      WorkOrdersService: WorkOrdersServiceCtor;
    }>("apps/api/src/modules/production/work-orders.service.ts");
    wos = new mod.WorkOrdersService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Cleanup order:
  //   1. outbox.events keyed to gate-58 WOs (no FK back to work_orders).
  //   2. work_orders rows tagged `notes LIKE 'gate-58 %'` — cascades to
  //      wip_stages.
  // We never touch wip_stage_templates (shared across all INSTRUMENT WOs).
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'wo.stage_changed'
            AND aggregate_id IN (
              SELECT id FROM work_orders WHERE notes LIKE 'gate-58 %'
            )`,
      );
      await client.query(
        `DELETE FROM work_orders WHERE notes LIKE 'gate-58 %'`,
      );
    });
  });

  async function makeWo(tag: string): Promise<WorkOrderWithStages> {
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const input: CreateWorkOrder = {
      productId: SEED_PRODUCT_ECG,
      quantity: "1",
      priority: "NORMAL",
      notes: `gate-58 ${tag} ${suffix}`,
    };
    return wos.create(req, input);
  }

  function stageOf(
    wo: WorkOrderWithStages,
    sequenceNumber: number,
  ): WipStage {
    const stage = wo.stages.find((s) => s.sequenceNumber === sequenceNumber);
    if (!stage) {
      throw new Error(
        `stage with sequenceNumber=${sequenceNumber} not present on WO ${wo.id}`,
      );
    }
    return stage;
  }

  it("START on stage 1 of a PLANNED WO emits wo.stage_changed PLANNED→IN_PROGRESS", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const wo = await makeWo("start");
    expect(wo.status).toBe("PLANNED");
    // 8 INSTRUMENT stages copied from wip_stage_templates, all PENDING.
    expect(wo.stages).toHaveLength(8);
    expect(wo.stages.every((s) => s.status === "PENDING")).toBe(true);

    const stage1 = stageOf(wo, 1);
    expect(stage1.requiresQcSignoff).toBe(false);

    const after = await wos.advanceStage(req, wo.id, stage1.id, {
      action: "START",
    });
    expect(after.status).toBe("IN_PROGRESS");
    const stage1After = after.stages.find((s) => s.id === stage1.id);
    expect(stage1After?.status).toBe("IN_PROGRESS");

    const outbox = await waitForOutboxRow(
      pool,
      `wo.stage_changed:${wo.id}:${stage1.id}:IN_PROGRESS:r0`,
    );
    expect(outbox.payload).toEqual({
      orgId: DEV_ORG_ID,
      workOrderId: wo.id,
      workOrderPid: wo.pid,
      fromStage: "PLANNED",
      toStage: "IN_PROGRESS",
      actorId: DEV_ADMIN_ID,
    });

    // Row-level shape — aggregate_type, aggregate_id, event_type.
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
      aggregate_type: "work_order",
      aggregate_id: wo.id,
      event_type: "wo.stage_changed",
    });
  });

  it("QC cycle (COMPLETE→QC_HOLD, QC_FAIL→REWORK:r1, REWORK_DONE→IN_PROGRESS:r1) writes three distinct rows", async () => {
    // This test drives stage 2 (PCB Sub-Assembly, requires_qc_signoff) through
    // its full rework cycle. Each leg changes either the WO status or the
    // stage's rework counter, so each produces a distinct idempotency_key.
    const req = makeAdminRequest(DEV_ORG_ID);
    const wo = await makeWo("qc-cycle");
    const stage1 = stageOf(wo, 1);
    const stage2 = stageOf(wo, 2);
    expect(stage2.requiresQcSignoff).toBe(true);

    // Walk to stage 2 IN_PROGRESS: START stage 1, COMPLETE stage 1. These
    // two emits share key (:IN_PROGRESS:r0 on stage 1) and dedupe — that's
    // intentional and is covered by the NOT-duplicate-rows assertion below.
    await wos.advanceStage(req, wo.id, stage1.id, { action: "START" });
    const afterS1Complete = await wos.advanceStage(req, wo.id, stage1.id, {
      action: "COMPLETE",
    });
    const stage2AfterAutoAdvance = afterS1Complete.stages.find(
      (s) => s.id === stage2.id,
    );
    expect(stage2AfterAutoAdvance?.status).toBe("IN_PROGRESS");
    expect(afterS1Complete.status).toBe("IN_PROGRESS");

    // COMPLETE stage 2 — requires_qc_signoff=true → WO flips to QC_HOLD.
    const atQcHold = await wos.advanceStage(req, wo.id, stage2.id, {
      action: "COMPLETE",
    });
    expect(atQcHold.status).toBe("QC_HOLD");
    const rowQcHold = await waitForOutboxRow(
      pool,
      `wo.stage_changed:${wo.id}:${stage2.id}:QC_HOLD:r0`,
    );
    expect(rowQcHold.payload).toMatchObject({
      fromStage: "IN_PROGRESS",
      toStage: "QC_HOLD",
      workOrderId: wo.id,
    });

    // QC_FAIL — WO flips to REWORK and the stage's rework counter bumps
    // to 1. Both changes are captured in the new idempotency key.
    const atRework = await wos.advanceStage(req, wo.id, stage2.id, {
      action: "QC_FAIL",
      qcNotes: "gate-58 rework trigger",
    });
    expect(atRework.status).toBe("REWORK");
    const stage2AtRework = atRework.stages.find((s) => s.id === stage2.id);
    expect(stage2AtRework?.reworkCount).toBe(1);

    const rowRework = await waitForOutboxRow(
      pool,
      `wo.stage_changed:${wo.id}:${stage2.id}:REWORK:r1`,
    );
    expect(rowRework.payload).toMatchObject({
      fromStage: "QC_HOLD",
      toStage: "REWORK",
    });

    // REWORK_DONE — back to IN_PROGRESS; rework counter stays at 1.
    const backInProgress = await wos.advanceStage(req, wo.id, stage2.id, {
      action: "REWORK_DONE",
    });
    expect(backInProgress.status).toBe("IN_PROGRESS");

    const rowBack = await waitForOutboxRow(
      pool,
      `wo.stage_changed:${wo.id}:${stage2.id}:IN_PROGRESS:r1`,
    );
    expect(rowBack.payload).toMatchObject({
      fromStage: "REWORK",
      toStage: "IN_PROGRESS",
    });

    // All three rework-cycle rows are distinct.
    expect(rowQcHold.id).not.toBe(rowRework.id);
    expect(rowRework.id).not.toBe(rowBack.id);
    expect(rowQcHold.id).not.toBe(rowBack.id);
  });

  it("START + COMPLETE on a non-QC stage dedupe: WO-status-only key collapses both into one row", async () => {
    // Proves the documented semantics: `wo.stage_changed` is a WO-level
    // transition feed. A non-QC stage COMPLETE that merely rolls the
    // current_stage_index but keeps the WO at IN_PROGRESS produces a
    // payload identical (by key) to the stage-START emit, and the ON
    // CONFLICT (idempotency_key) DO NOTHING behaviour collapses it. If
    // someone later "fixes" this by moving stage status into the key,
    // this test will trip and force a design discussion.
    const req = makeAdminRequest(DEV_ORG_ID);
    const wo = await makeWo("dedupe");
    const stage1 = stageOf(wo, 1);

    await wos.advanceStage(req, wo.id, stage1.id, { action: "START" });
    await wos.advanceStage(req, wo.id, stage1.id, { action: "COMPLETE" });

    // Only one row should match the `:STAGE1:IN_PROGRESS:r0` key.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM outbox.events
        WHERE idempotency_key = $1`,
      [`wo.stage_changed:${wo.id}:${stage1.id}:IN_PROGRESS:r0`],
    );
    expect(rows).toHaveLength(1);

    // Meanwhile the auto-advance to stage 2 writes its own row keyed by
    // stage2.id — the key is different because the stageId segment differs,
    // even though the WO status (IN_PROGRESS) hasn't changed.
    // Note: the service emits with stageId = the stage passed to
    // advanceStage(), i.e. stage1. So there is NO separate emit for the
    // stage2 auto-promotion. This is the expected behaviour; we assert
    // only one gate-58 row exists for this WO as a result.
    const { rows: allRows } = await pool.query<{ id: string }>(
      `SELECT id FROM outbox.events
         WHERE event_type = 'wo.stage_changed' AND aggregate_id = $1`,
      [wo.id],
    );
    expect(allRows).toHaveLength(1);
  });

  it("HANDLER_CATALOGUE does not subscribe to wo.stage_changed today", () => {
    // Phase 2 will register Track 2 F5 (FG valuation on COMPLETED) and
    // Track 2 F8 (material issue on first-stage START). This assertion
    // tripwires a handler slipping in without a matching E2E gate.
    const subscribers = HANDLER_CATALOGUE.filter(
      (e) => e.eventType === "wo.stage_changed",
    );
    expect(subscribers).toHaveLength(0);
  });

  it("two distinct WOs produce outbox rows with distinct aggregate_ids", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const woA = await makeWo("two-a");
    const woB = await makeWo("two-b");
    const stageA1 = stageOf(woA, 1);
    const stageB1 = stageOf(woB, 1);

    await wos.advanceStage(req, woA.id, stageA1.id, { action: "START" });
    await wos.advanceStage(req, woB.id, stageB1.id, { action: "START" });

    const rowA = await waitForOutboxRow(
      pool,
      `wo.stage_changed:${woA.id}:${stageA1.id}:IN_PROGRESS:r0`,
    );
    const rowB = await waitForOutboxRow(
      pool,
      `wo.stage_changed:${woB.id}:${stageB1.id}:IN_PROGRESS:r0`,
    );
    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.payload).toMatchObject({ workOrderId: woA.id });
    expect(rowB.payload).toMatchObject({ workOrderId: woB.id });
  });
});
