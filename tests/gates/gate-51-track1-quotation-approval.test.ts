/**
 * Gate 51 — Track 1 Phase 1 emit #4 (E2E): `quotation.submitted_for_approval`
 * → `approvals.openQuotationTicket` handler.
 *
 * The service fires `quotation.submitted_for_approval` every time a
 * quotation enters AWAITING_APPROVAL — either via the create path
 * (grand_total > 500k auto-lands in that state but does NOT emit —
 * there is no enqueueOutbox call in create(); the emit lives in
 * transitionStatus) or via an explicit DRAFT → AWAITING_APPROVAL
 * transition (this gate's path). The registered handler:
 *
 *   - Loads the quotation, refuses to open if already-PENDING.
 *   - Resolves the approval chain from
 *     approval_chain_definitions WHERE entity_type='quotation' and
 *     amount fits the min/max band.
 *   - Inserts approval_requests + approval_steps (one per step) +
 *     workflow_transitions (CREATE row).
 *
 * See apps/worker/src/handlers/quotation-approval-requested.ts.
 *
 * Gate 51 pins:
 *
 *   - Happy path (grand_total=1000 → default <20L chain = 1 step
 *     SALES_MANAGER) produces one approval_requests row, one
 *     approval_steps row, one workflow_transitions CREATE row; and the
 *     outbox.handler_runs slot records COMPLETED.
 *   - Redelivery with the same outboxId returns SKIPPED — the slot
 *     short-circuits before the handler body runs, so no duplicate
 *     approval rows land.
 *   - Payload fields the handler reads (quotationId, quotationNumber,
 *     quotationVersion, submittedBy) are all populated by the service.
 *
 * Cleanup: fixtures tagged `gate-51 …`. approval_requests cascade to
 * approval_steps + workflow_transitions on ON DELETE CASCADE (see
 * ops/sql/init/09-approvals.sql), so deleting the header is enough.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  CreateQuotation,
  Quotation,
  TransitionQuotationStatus,
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

interface QuotationsServiceLike {
  create(req: ServiceRequest, input: CreateQuotation): Promise<Quotation>;
  transitionStatus(
    req: ServiceRequest,
    id: string,
    input: TransitionQuotationStatus,
  ): Promise<Quotation>;
}
interface QuotationsServiceCtor {
  new (pool: pg.Pool): QuotationsServiceLike;
}

describe("gate-51: track 1 — quotation.submitted_for_approval E2E", () => {
  let pool: pg.Pool;
  let quotations: QuotationsServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{
      QuotationsService: QuotationsServiceCtor;
    }>("apps/api/src/modules/crm/quotations.service.ts");
    quotations = new mod.QuotationsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Delete approval_requests for gate-51 quotations first — steps +
    // workflow_transitions cascade on FK delete. Then drop the outbox
    // row + quotation. Quotation line items cascade from the header.
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM approval_requests
          WHERE entity_type = 'quotation'
            AND entity_id IN (
              SELECT id FROM quotations WHERE company LIKE 'gate-51 %'
            )`,
      );
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'quotation.submitted_for_approval'
            AND aggregate_id IN (
              SELECT id FROM quotations WHERE company LIKE 'gate-51 %'
            )`,
      );
      await client.query(
        `DELETE FROM quotations WHERE company LIKE 'gate-51 %'`,
      );
    });
  });

  it("DRAFT → AWAITING_APPROVAL emits and the approvals handler opens a ticket", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    // Under-threshold grand_total keeps the quote in DRAFT on create
    // (the auto-AWAITING_APPROVAL on create path applies only above
    // 500k). Then transitionStatus does the manual hop that fires the
    // emit.
    const created = await quotations.create(req, {
      company: `gate-51 ${suffix}`,
      contactName: "Gate 51 Contact",
      lineItems: [
        {
          productCode: "GATE51-ITEM",
          productName: "gate-51 product",
          quantity: 1,
          unitPrice: "1000",
          discountPct: "0",
          taxPct: "0",
        },
      ],
    });
    expect(created.status).toBe("DRAFT");

    const moved = await quotations.transitionStatus(req, created.id, {
      status: "AWAITING_APPROVAL",
      expectedVersion: created.version,
    });
    expect(moved.status).toBe("AWAITING_APPROVAL");

    const outbox = await waitForOutboxRow(
      pool,
      `quotation.submitted_for_approval:${created.id}:v${moved.version}`,
    );
    expect(outbox.payload).toMatchObject({
      orgId: DEV_ORG_ID,
      quotationId: created.id,
      quotationNumber: moved.quotationNumber,
      quotationVersion: moved.version,
      submittedBy: req.user.id,
    });

    // The handler catalogue binds exactly one handler to this event.
    expect(registeredHandlerNames("quotation.submitted_for_approval")).toEqual([
      "approvals.openQuotationTicket",
    ]);

    const first = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "quotation.submitted_for_approval",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("COMPLETED");

    // Assert the handler's domain writes landed: one approval_request
    // PENDING, one approval_step, one workflow_transitions CREATE.
    const snap = await withOrg(pool, DEV_ORG_ID, async (c) => {
      const reqs = await c.query<{
        id: string;
        entity_type: string;
        status: string;
        amount: string;
        currency: string;
        current_step: number;
      }>(
        `SELECT id, entity_type, status, amount::text AS amount, currency,
                current_step
           FROM approval_requests
          WHERE entity_type = 'quotation' AND entity_id = $1`,
        [created.id],
      );
      const steps = await c.query<{
        step_number: number;
        role_id: string;
        requires_e_signature: boolean;
      }>(
        `SELECT step_number, role_id, requires_e_signature
           FROM approval_steps
          WHERE request_id = $1
          ORDER BY step_number`,
        [reqs.rows[0]?.id ?? null],
      );
      const txns = await c.query<{ action: string; from_status: string; to_status: string }>(
        `SELECT action, from_status, to_status
           FROM workflow_transitions
          WHERE request_id = $1
          ORDER BY created_at`,
        [reqs.rows[0]?.id ?? null],
      );
      return { reqs: reqs.rows, steps: steps.rows, txns: txns.rows };
    });
    expect(snap.reqs).toHaveLength(1);
    expect(snap.reqs[0]!).toMatchObject({
      entity_type: "quotation",
      status: "PENDING",
      current_step: 1,
    });
    expect(Number(snap.reqs[0]!.amount)).toBe(1000);
    // <20L band: one SALES_MANAGER step.
    expect(snap.steps).toHaveLength(1);
    expect(snap.steps[0]).toMatchObject({
      step_number: 1,
      role_id: "SALES_MANAGER",
      requires_e_signature: false,
    });
    expect(snap.txns).toHaveLength(1);
    expect(snap.txns[0]).toMatchObject({
      action: "CREATE",
      from_status: "NEW",
      to_status: "PENDING",
    });

    // handler_runs slot — one COMPLETED row.
    const runs = await pool.query<{ handler_name: string; status: string }>(
      `SELECT handler_name, status FROM outbox.handler_runs
        WHERE outbox_id = $1`,
      [outbox.id],
    );
    expect(runs.rows).toEqual([
      { handler_name: "approvals.openQuotationTicket", status: "COMPLETED" },
    ]);

    // Redelivery — slot short-circuits, no new rows.
    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "quotation.submitted_for_approval",
      payload: outbox.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outbox.id, log: silentLog },
    });
    expect(second[0]!.status).toBe("SKIPPED");

    const flat = await withOrg(pool, DEV_ORG_ID, async (c) =>
      c.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM approval_requests
          WHERE entity_type = 'quotation' AND entity_id = $1`,
        [created.id],
      ),
    );
    expect(flat.rows[0]!.count).toBe("1");
  });

  it("second delivery from a DIFFERENT outbox skips because a PENDING request already exists", async () => {
    // Proves the handler's own idempotency belt-and-braces check on top
    // of outbox.handler_runs. If a race lets the same quotation be
    // re-submitted (e.g. the user clicks twice and the version check
    // lets both through somehow), the handler short-circuits on the
    // approval_requests_entity_pending_unique partial index and logs.
    const req = makeRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 8);
    const created = await quotations.create(req, {
      company: `gate-51 ${suffix}`,
      contactName: "Gate 51 Contact",
      lineItems: [
        {
          productCode: "GATE51-ITEM-B",
          productName: "gate-51 product B",
          quantity: 1,
          unitPrice: "2000",
          discountPct: "0",
          taxPct: "0",
        },
      ],
    });
    const moved = await quotations.transitionStatus(req, created.id, {
      status: "AWAITING_APPROVAL",
      expectedVersion: created.version,
    });
    const outboxA = await waitForOutboxRow(
      pool,
      `quotation.submitted_for_approval:${created.id}:v${moved.version}`,
    );

    // First delivery opens the ticket.
    await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "quotation.submitted_for_approval",
      payload: outboxA.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outboxA.id, log: silentLog },
    });

    // Synthesize a SECOND outbox row targeting the same quotation. In
    // reality the service can't emit two rows for the same (id,version)
    // because of the idempotency_key unique, but a pathological race
    // (operator approves → rejects → re-submits at same version … ) is
    // still worth pinning. We insert a raw outbox row here and run the
    // handler against it; the handler's SELECT-before-INSERT guard
    // catches the existing PENDING and returns early (status=COMPLETED,
    // no new approval_requests row).
    const { rows: raw } = await pool.query<{ id: string }>(
      `INSERT INTO outbox.events
         (aggregate_type, aggregate_id, event_type, payload, idempotency_key)
       VALUES ('quotation', $1, 'quotation.submitted_for_approval', $2::jsonb, $3)
       RETURNING id`,
      [
        created.id,
        JSON.stringify(outboxA.payload),
        `quotation.submitted_for_approval:${created.id}:v${moved.version}:retry`,
      ],
    );
    const outboxBId = raw[0]!.id;

    const second = await runHandlersForEvent({
      pool,
      entries: HANDLER_CATALOGUE,
      eventType: "quotation.submitted_for_approval",
      payload: outboxA.payload as Record<string, unknown> & { orgId: string },
      ctx: { outboxId: outboxBId, log: silentLog },
    });
    expect(second[0]!.status).toBe("COMPLETED");

    const count = await withOrg(pool, DEV_ORG_ID, async (c) =>
      c.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM approval_requests
          WHERE entity_type = 'quotation' AND entity_id = $1`,
        [created.id],
      ),
    );
    expect(count.rows[0]!.count).toBe("1");

    // Cleanup the raw outbox row — it's not caught by the beforeEach
    // sweep because the idempotency_key has a custom ':retry' suffix.
    await pool.query(`DELETE FROM outbox.events WHERE id = $1`, [outboxBId]);
  });
});
