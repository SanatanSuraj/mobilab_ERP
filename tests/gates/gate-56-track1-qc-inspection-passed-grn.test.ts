/**
 * Gate 56 — Track 1 Phase 1 emit #9a: `qc_inspection.passed` for the
 * GRN_LINE (IQC) source path.
 *
 * `QcInspectionsService.complete()` emits `qc_inspection.passed` when
 * the caller's verdict is `PASS`. The emit is a lean header-only event
 * (see the "Track 1 emit #9" comment in
 * apps/api/src/modules/qc/inspections.service.ts): it carries pointers
 * — inspectionId, sourceType, sourceId, grnLineId/workOrderId/wipStageId —
 * and expects Phase 2 handlers to join back for the rich data they need
 * (vendor name, unit price, warehouse, …).
 *
 * Today HANDLER_CATALOGUE has subscribers for the *legacy* event names
 * `qc_inward.passed` and `qc_final.passed` (see
 * handlers/qc-inward-passed.ts + qc-final-passed.ts), but NOT for
 * `qc_inspection.passed`. Phase 2 either upgrades those handlers to
 * read from inspectionId, or adds a payload-assembler that renames the
 * event. Either way, this gate pins the "empty subscriber" state for
 * now so the first Phase 2 handler that slips in without a matching
 * E2E gate trips here.
 *
 * Gate 56 covers the GRN_LINE source (kind=IQC). Gate 57 covers the WO
 * source (kind=FINAL_QC). Split into two files because the fixture
 * setup diverges (GRN+grn_line ref vs work_order ref) and the payload
 * shape differs in which of the three nullable source-FKs is populated.
 *
 * Pinned behaviour:
 *
 *   - `complete()` with verdict=PASS writes an outbox.events row with
 *     `aggregate_type='qc_inspection'`,
 *     `event_type='qc_inspection.passed'`,
 *     `idempotency_key='qc_inspection.passed:<inspectionId>'`.
 *   - Payload carries the 9 contract fields (orgId, inspectionId,
 *     inspectionNumber, kind, sourceType, sourceId, grnLineId,
 *     workOrderId, wipStageId). For a GRN_LINE source, grnLineId is
 *     set while workOrderId/wipStageId are null.
 *   - `complete()` with verdict=FAIL writes NO outbox row. The emit
 *     guard is literally `if (input.verdict === "PASS")` — a negative
 *     verdict is a final state too, but the event stream only carries
 *     the positive transition.
 *   - HANDLER_CATALOGUE has zero subscribers for `qc_inspection.passed`.
 *
 * Fixture: we use the seeded grn_line `0000000f3101` (line 1 of
 * GRN-2026-0001, POSTED — ops/sql/seed/09-procurement-dev-data.sql).
 * Tagging by `notes LIKE 'gate-56 …'` on the qc_inspection row keeps
 * cleanup surgical.
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
  assertNoOutboxRow,
  HANDLER_CATALOGUE,
  loadApiService,
  makeAdminRequest,
  type ServiceRequest,
  waitForOutboxRow,
} from "./_phase3-helpers.js";

// Seeded GRN line from ops/sql/seed/09-procurement-dev-data.sql
// (v_grl_01 — line 1 of GRN-2026-0001, against item v_it_res / warehouse
// v_wh_main). The GRN is POSTED so the grn_line row is effectively
// immutable from the service perspective; we're only reading its id.
const SEED_GRN_LINE = "00000000-0000-0000-0000-0000000f3101";

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

describe("gate-56: track 1 — qc_inspection.passed (GRN_LINE / IQC)", () => {
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

  // Cleanup order:
  //   1. outbox events for our inspections (cascades any handler_runs —
  //      though HANDLER_CATALOGUE has no subscriber today so the
  //      handler_runs table is empty for this event).
  //   2. qc_findings (explicit before inspection — they'd cascade
  //      anyway, but explicit DELETE fails loudly if a FK drift
  //      appears later).
  //   3. qc_inspections (matches notes tag).
  // qc_certs has FK ON DELETE RESTRICT into qc_inspections, so a bad
  // run that left behind a cert would trip step 3 loudly. We don't
  // issue certs in gate-56 so this shouldn't happen.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'qc_inspection.passed'
            AND aggregate_id IN (
              SELECT id FROM qc_inspections WHERE notes LIKE 'gate-56 %'
            )`,
      );
      await client.query(
        `DELETE FROM qc_findings
          WHERE inspection_id IN (
            SELECT id FROM qc_inspections WHERE notes LIKE 'gate-56 %'
          )`,
      );
      await client.query(
        `DELETE FROM qc_inspections WHERE notes LIKE 'gate-56 %'`,
      );
    });
  });

  /**
   * Build a DRAFT → IN_PROGRESS inspection ready to complete. Seeds
   * exactly one finding with `result: 'PASS'` so the no-pending check
   * passes, and skips template seeding (no templateId supplied).
   *
   * The qc_inspections table has a `tg_bump_version` BEFORE UPDATE
   * trigger (ops/sql/triggers/08-qc.sql). The service's `addFinding`
   * path ends with `inspectionsRepo.touchHeader()` — a one-column
   * UPDATE that fires the trigger and bumps `version`. So after
   * `create → addFinding` the header version is 2, not 1. We re-read
   * via `getById` rather than hard-coding `draft.version + 1` so the
   * count survives any future trigger changes.
   */
  async function buildInProgressInspection(
    tag: string,
  ): Promise<{ inspection: QcInspection; afterStartVersion: number }> {
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const draft = await qc.create(req, {
      kind: "IQC",
      sourceType: "GRN_LINE",
      sourceId: SEED_GRN_LINE,
      grnLineId: SEED_GRN_LINE,
      sourceLabel: `gate-56 ${tag} ${suffix}`,
      sampleSize: 1,
      notes: `gate-56 ${tag} ${suffix}`,
    });
    await qc.addFinding(req, draft.id, {
      parameterName: "gate-56 single check",
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

  it("emits qc_inspection.passed on verdict=PASS with full GRN_LINE payload", async () => {
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

    // Outbox row + full payload.
    const outbox = await waitForOutboxRow(
      pool,
      `qc_inspection.passed:${inspection.id}`,
    );
    expect(outbox.payload).toEqual({
      orgId: DEV_ORG_ID,
      inspectionId: inspection.id,
      inspectionNumber: passed.inspectionNumber,
      kind: "IQC",
      sourceType: "GRN_LINE",
      sourceId: SEED_GRN_LINE,
      grnLineId: SEED_GRN_LINE,
      // For GRN_LINE source, work_order / wip_stage fields are null.
      workOrderId: null,
      wipStageId: null,
    });

    // Aggregate shape.
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
    // The legacy `qc_inward.passed` / `qc_final.passed` handlers do not
    // match this event name. This assertion enforces the "lean emit, no
    // handler" state documented in the service comment until Phase 2
    // adds either a payload-assembler or upgrades the legacy handlers.
    const subscribers = HANDLER_CATALOGUE.filter(
      (e) => e.eventType === "qc_inspection.passed",
    );
    expect(subscribers).toHaveLength(0);
  });

  it("verdict=FAIL does not emit qc_inspection.passed", async () => {
    // A completed-with-FAIL inspection is still a valid terminal state
    // — findings are locked, verdict is stamped — but the emit guard
    // is `if (input.verdict === "PASS")` so the event stream only
    // carries the positive transition. Pins that behaviour so a
    // future refactor that broadens the emit surfaces here.
    const req = makeAdminRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const draft = await qc.create(req, {
      kind: "IQC",
      sourceType: "GRN_LINE",
      sourceId: SEED_GRN_LINE,
      grnLineId: SEED_GRN_LINE,
      sourceLabel: `gate-56 fail ${suffix}`,
      sampleSize: 1,
      notes: `gate-56 fail ${suffix}`,
    });
    // Add a FAILED (non-critical) finding so `complete(FAIL)` passes
    // the "no pending" and "verdict consistent with findings" checks.
    await qc.addFinding(req, draft.id, {
      parameterName: "gate-56 failing check",
      parameterType: "BOOLEAN",
      isCritical: false,
      actualBoolean: false,
      result: "FAIL",
    });
    // See buildInProgressInspection for the version-bump note.
    const afterFinding = await qc.getById(req, draft.id);
    const started = await qc.start(req, draft.id, {
      expectedVersion: afterFinding.version,
    });
    const failed = await qc.complete(req, started.id, {
      expectedVersion: started.version,
      verdict: "FAIL",
      verdictNotes: "gate-56: expected fail",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.verdict).toBe("FAIL");

    await assertNoOutboxRow(pool, `qc_inspection.passed:${started.id}`);
  });

  it("two distinct PASSED inspections produce two distinct outbox rows", async () => {
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
      inspectionNumber: a.inspectionNumber,
    });
    expect(rowB.payload).toMatchObject({
      inspectionId: b.id,
      inspectionNumber: b.inspectionNumber,
    });
  });
});
