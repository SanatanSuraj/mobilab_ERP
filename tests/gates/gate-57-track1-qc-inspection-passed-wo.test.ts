/**
 * Gate 57 — Track 1 Phase 1 emit #9b: `qc_inspection.passed` for the
 * WO (FINAL_QC) source path.
 *
 * Sibling to gate-56. Same service method
 * (QcInspectionsService.complete()), same emit body (lean header event,
 * see inspections.service.ts), same idempotency_key shape — but the
 * payload has `workOrderId` populated and `grnLineId` / `wipStageId`
 * null. This gate pins the WO-source leg so a regression that mis-
 * maps sourceType↔FK column (e.g. a refactor that accidentally omits
 * workOrderId from the payload) lands here.
 *
 * We don't repeat the FAIL-no-emit test case from gate-56 — the emit
 * guard is `if (verdict === "PASS")` which is source-type agnostic.
 * We do repeat the HANDLER_CATALOGUE empty-subscriber assertion as a
 * cheap per-gate belt-and-braces.
 *
 * Fixture: we use the seeded work_order `000000fc0401` (PID-2026-0001,
 * IN_PROGRESS — ops/sql/seed/10-production-dev-data.sql). The WO's own
 * status isn't touched; the inspection just points at it.
 * Tagging by `notes LIKE 'gate-57 …'` keeps cleanup surgical.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  CompleteQcInspection,
  CreateQcFinding,
  CreateQcInspection,
  QcFinding,
  QcInspection,
  QcInspectionWithFindings,
  StartQcInspection,
} from "@instigenie/contracts";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";
import {
  HANDLER_CATALOGUE,
  loadApiService,
  makeAdminRequest,
  type ServiceRequest,
  waitForOutboxRow,
} from "./_phase3-helpers.js";

// Seeded work order from ops/sql/seed/10-production-dev-data.sql
// (v_wo_001 — PID-2026-0001, IN_PROGRESS). We only read its id.
const SEED_WORK_ORDER = "00000000-0000-0000-0000-000000fc0401";

interface QcInspectionsServiceLike {
  create(
    req: ServiceRequest,
    input: CreateQcInspection,
  ): Promise<QcInspectionWithFindings>;
  getById(
    req: ServiceRequest,
    inspectionId: string,
  ): Promise<QcInspectionWithFindings>;
  addFinding(
    req: ServiceRequest,
    inspectionId: string,
    input: CreateQcFinding,
  ): Promise<QcFinding>;
  start(
    req: ServiceRequest,
    inspectionId: string,
    input: StartQcInspection,
  ): Promise<QcInspectionWithFindings>;
  complete(
    req: ServiceRequest,
    inspectionId: string,
    input: CompleteQcInspection,
  ): Promise<QcInspectionWithFindings>;
}

interface QcInspectionsServiceCtor {
  new (pool: pg.Pool): QcInspectionsServiceLike;
}

describe("gate-57: track 1 — qc_inspection.passed (WO / FINAL_QC)", () => {
  let pool: pg.Pool;
  let qc: QcInspectionsServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{
      QcInspectionsService: QcInspectionsServiceCtor;
    }>("apps/api/src/modules/qc/inspections.service.ts");
    qc = new mod.QcInspectionsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'qc_inspection.passed'
            AND aggregate_id IN (
              SELECT id FROM qc_inspections WHERE notes LIKE 'gate-57 %'
            )`,
      );
      await client.query(
        `DELETE FROM qc_findings
          WHERE inspection_id IN (
            SELECT id FROM qc_inspections WHERE notes LIKE 'gate-57 %'
          )`,
      );
      await client.query(
        `DELETE FROM qc_inspections WHERE notes LIKE 'gate-57 %'`,
      );
    });
  });

  // See gate-56 for the version-bump note on addFinding → touchHeader.
  async function buildInProgressInspection(
    tag: string,
  ): Promise<{ inspection: QcInspection; afterStartVersion: number }> {
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const draft = await qc.create(req, {
      kind: "FINAL_QC",
      sourceType: "WO",
      sourceId: SEED_WORK_ORDER,
      workOrderId: SEED_WORK_ORDER,
      sourceLabel: `gate-57 ${tag} ${suffix}`,
      sampleSize: 1,
      notes: `gate-57 ${tag} ${suffix}`,
    });
    await qc.addFinding(req, draft.id, {
      parameterName: "gate-57 single check",
      parameterType: "BOOLEAN",
      isCritical: false,
      actualBoolean: true,
      result: "PASS",
    });
    const afterFinding = await qc.getById(req, draft.id);
    const started = await qc.start(req, draft.id, {
      expectedVersion: afterFinding.version,
    });
    return { inspection: started, afterStartVersion: started.version };
  }

  it("emits qc_inspection.passed on verdict=PASS with workOrderId populated and GRN/WIP nulls", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const { inspection, afterStartVersion } = await buildInProgressInspection(
      "happy",
    );

    const passed = await qc.complete(req, inspection.id, {
      expectedVersion: afterStartVersion,
      verdict: "PASS",
    });
    expect(passed.status).toBe("PASSED");
    expect(passed.verdict).toBe("PASS");
    expect(passed.workOrderId).toBe(SEED_WORK_ORDER);

    const outbox = await waitForOutboxRow(
      pool,
      `qc_inspection.passed:${inspection.id}`,
    );
    expect(outbox.payload).toEqual({
      orgId: DEV_ORG_ID,
      inspectionId: inspection.id,
      inspectionNumber: passed.inspectionNumber,
      kind: "FINAL_QC",
      sourceType: "WO",
      sourceId: SEED_WORK_ORDER,
      workOrderId: SEED_WORK_ORDER,
      // For WO source, GRN-line and WIP-stage fields are null.
      grnLineId: null,
      wipStageId: null,
    });

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
      aggregate_type: "qc_inspection",
      aggregate_id: inspection.id,
      event_type: "qc_inspection.passed",
    });
  });

  it("HANDLER_CATALOGUE has no subscriber for qc_inspection.passed today", () => {
    // Belt-and-braces — gate-56 has the same assertion. If a Phase 2
    // handler lands targeting only the WO-source path, we want the
    // failure to surface whether a reviewer is looking at the GRN or
    // WO gate.
    const subscribers = HANDLER_CATALOGUE.filter(
      (e) => e.eventType === "qc_inspection.passed",
    );
    expect(subscribers).toHaveLength(0);
  });

  it("two distinct PASSED WO inspections produce two distinct outbox rows", async () => {
    const req = makeAdminRequest(DEV_ORG_ID);
    const { inspection: a, afterStartVersion: vA } =
      await buildInProgressInspection("two-a");
    const { inspection: b, afterStartVersion: vB } =
      await buildInProgressInspection("two-b");

    await qc.complete(req, a.id, { expectedVersion: vA, verdict: "PASS" });
    await qc.complete(req, b.id, { expectedVersion: vB, verdict: "PASS" });

    const rowA = await waitForOutboxRow(pool, `qc_inspection.passed:${a.id}`);
    const rowB = await waitForOutboxRow(pool, `qc_inspection.passed:${b.id}`);
    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.payload).toMatchObject({
      inspectionId: a.id,
      workOrderId: SEED_WORK_ORDER,
    });
    expect(rowB.payload).toMatchObject({
      inspectionId: b.id,
      workOrderId: SEED_WORK_ORDER,
    });
  });
});
