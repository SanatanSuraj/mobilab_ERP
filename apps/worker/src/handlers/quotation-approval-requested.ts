/**
 * quotation.submitted_for_approval handler — automate.md Track 1 Phase 2.
 *
 *   quotation.submitted_for_approval → approvals.openTicket
 *
 * Mirrors `approvalsRepo.createRequestWithSteps` (apps/api/src/modules/
 * approvals/approvals.repository.ts:425) but inlines the raw SQL so the
 * worker package does not take a hard dep on the API package (see
 * types.ts — the dep graph points API → worker, never the reverse).
 *
 * ─── Entity-type note ─────────────────────────────────────────────────
 *
 * The APPROVAL_ENTITY_TYPES enum in packages/contracts/src/approvals.ts
 * ships 6 values today (work_order, purchase_order, deal_discount,
 * raw_material_issue, device_qc_final, invoice) — "quotation" is not in
 * the list, and the existing seed (ops/sql/seed/14-approvals-dev-data.sql)
 * has no quotation chain. We add both in the same Phase 2 batch:
 *   - packages/contracts/src/approvals.ts  : append 'quotation'
 *   - ops/sql/seed/14-approvals-dev-data.sql : idempotent CREATE+seed
 *
 * Until that seed runs, `resolveChain` returns null and the handler logs
 * a warn + returns. That's the graceful degradation path — the outbox
 * slot still marks the handler run as complete so re-delivery doesn't
 * keep retrying on a known-missing chain.
 *
 * ─── Idempotency ──────────────────────────────────────────────────────
 *
 * Two layers:
 *   1. outbox.handler_runs guards against double-runs of THIS handler
 *      (runner.ts — ON CONFLICT DO NOTHING on (outbox_id, handler_name)).
 *   2. approval_requests_entity_pending_unique (09-approvals.sql:123) —
 *      partial unique on (org, entity_type, entity_id) WHERE PENDING —
 *      blocks two PENDING requests racing for the same quotation if an
 *      operator manually opened one. We SELECT for that case before
 *      attempting INSERT and return early to avoid the 23505 throw.
 */

import type {
  EventHandler,
  QuotationApprovalRequestedPayload,
} from "./types.js";

interface QuotationRow {
  id: string;
  quotation_number: string;
  grand_total: string;
}

interface ChainRow {
  id: string;
  steps: unknown;
}

interface ExistingRequestRow {
  id: string;
}

interface ChainStepShape {
  stepNumber: number;
  roleId: string;
  requiresESignature: boolean;
}

function parseChainSteps(raw: unknown): ChainStepShape[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      "quotation.submitted_for_approval: chain steps jsonb is not an array",
    );
  }
  return raw.map((row, idx) => {
    if (typeof row !== "object" || row === null) {
      throw new Error(
        `quotation.submitted_for_approval: chain step ${idx} is not an object`,
      );
    }
    const obj = row as Record<string, unknown>;
    const stepNumber = obj.stepNumber;
    const roleId = obj.roleId;
    const requiresESignature = obj.requiresESignature;
    if (typeof stepNumber !== "number" || !Number.isInteger(stepNumber)) {
      throw new Error(
        `quotation.submitted_for_approval: chain step ${idx} has invalid stepNumber`,
      );
    }
    if (typeof roleId !== "string" || roleId.length === 0) {
      throw new Error(
        `quotation.submitted_for_approval: chain step ${idx} has invalid roleId`,
      );
    }
    return {
      stepNumber,
      roleId,
      requiresESignature: requiresESignature === true,
    };
  });
}

export const openTicket: EventHandler<
  QuotationApprovalRequestedPayload
> = async (client, payload, ctx) => {
  // 1. Load quotation for amount + sanity check. Handler refuses to open
  //    a ticket for a missing or deleted quotation — that's a data
  //    integrity bug upstream, not a retryable condition.
  const { rows: qRows } = await client.query<QuotationRow>(
    `SELECT id, quotation_number, grand_total
       FROM quotations
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [payload.quotationId],
  );
  const quotation = qRows[0];
  if (!quotation) {
    throw new Error(
      `quotation.submitted_for_approval: quotation ${payload.quotationId} not found`,
    );
  }

  // 2. Short-circuit if a PENDING request already exists for this quotation.
  //    Operator could have opened one manually, or a prior handler run
  //    succeeded but the outbox slot insert got interrupted (very rare —
  //    runner.ts opens the slot first). Either way, don't double-book.
  const { rows: existing } = await client.query<ExistingRequestRow>(
    `SELECT id FROM approval_requests
      WHERE entity_type = 'quotation'
        AND entity_id = $1
        AND status = 'PENDING'
      LIMIT 1`,
    [payload.quotationId],
  );
  if (existing.length > 0) {
    ctx.log.info(
      {
        outboxId: ctx.outboxId,
        quotationId: payload.quotationId,
        existingRequestId: existing[0]!.id,
      },
      "quotation.submitted_for_approval: PENDING request already exists; skipping",
    );
    return;
  }

  // 3. Resolve the chain. Amount-banded lookup mirrors
  //    approvalsRepo.resolveChain(). If no chain is seeded for quotation
  //    (i.e. the Track 1 migration hasn't run yet or a tenant hasn't
  //    configured one), we log + return rather than throw. The outbox
  //    slot still gets committed so we don't hot-loop on a missing seed.
  const { rows: chainRows } = await client.query<ChainRow>(
    `SELECT id, steps
       FROM approval_chain_definitions
      WHERE entity_type = 'quotation'
        AND is_active = true
        AND deleted_at IS NULL
        AND (min_amount IS NULL OR $1::numeric >= min_amount)
        AND (max_amount IS NULL OR $1::numeric <  max_amount)
      ORDER BY min_amount DESC NULLS LAST
      LIMIT 1`,
    [quotation.grand_total],
  );
  const chain = chainRows[0];
  if (!chain) {
    ctx.log.warn(
      {
        outboxId: ctx.outboxId,
        quotationId: payload.quotationId,
        quotationNumber: quotation.quotation_number,
        grandTotal: quotation.grand_total,
      },
      "quotation.submitted_for_approval: no approval chain seeded for entity_type='quotation' at this amount band; skipping (seed ops/sql/seed/14-approvals-dev-data.sql)",
    );
    return;
  }

  // 4. Parse steps jsonb. The schema CHECK guarantees it's a non-empty
  //    array; we still validate each row's shape to avoid downstream
  //    surprises if a tenant inserts hand-edited JSON.
  const steps = parseChainSteps(chain.steps);
  if (steps.length === 0) {
    throw new Error(
      `quotation.submitted_for_approval: chain ${chain.id} has zero steps (schema CHECK should have prevented this)`,
    );
  }
  const firstStep = steps[0]!;

  // 5. Insert the approval_request. current_step = first step's number.
  //    The unique index on (org, entity_type, entity_id) WHERE PENDING
  //    would raise 23505 if a race sneaked past the SELECT above — we
  //    accept that as a hard error so retries naturally fall through to
  //    the existing-request short-circuit on the next delivery.
  const { rows: insertedReq } = await client.query<{ id: string }>(
    `INSERT INTO approval_requests
       (org_id, chain_def_id, entity_type, entity_id, amount, currency,
        status, current_step, requested_by, notes)
     VALUES ($1, $2, 'quotation', $3, $4::numeric, 'INR',
             'PENDING', $5, $6,
             $7)
     RETURNING id`,
    [
      payload.orgId,
      chain.id,
      payload.quotationId,
      quotation.grand_total,
      firstStep.stepNumber,
      payload.submittedBy ?? null,
      `Auto-opened from quotation ${quotation.quotation_number} submit (outbox ${ctx.outboxId})`,
    ],
  );
  const requestId = insertedReq[0]!.id;

  // 6. Insert approval_steps in one multi-VALUES statement. Same shape as
  //    approvalsRepo.createRequestWithSteps.
  const stepPlaceholders: string[] = [];
  const stepValues: unknown[] = [];
  let p = 1;
  for (const s of steps) {
    stepPlaceholders.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`,
    );
    stepValues.push(
      payload.orgId,
      requestId,
      s.stepNumber,
      s.roleId,
      s.requiresESignature,
    );
  }
  await client.query(
    `INSERT INTO approval_steps
       (org_id, request_id, step_number, role_id, requires_e_signature)
     VALUES ${stepPlaceholders.join(", ")}`,
    stepValues,
  );

  // 7. Transition log: a single CREATE row. actor_role is NULL because
  //    the worker has no auth context (the API service layer fills it in
  //    from req.auth.roleId for human-driven creates). Auditors see this
  //    as a system-initiated open rather than a user action.
  await client.query(
    `INSERT INTO workflow_transitions
       (org_id, request_id, step_id, action, from_status, to_status,
        actor_id, actor_role, comment, metadata)
     VALUES ($1, $2, NULL, 'CREATE', 'NEW', 'PENDING',
             $3, NULL, NULL, $4::jsonb)`,
    [
      payload.orgId,
      requestId,
      payload.submittedBy ?? null,
      JSON.stringify({
        chainDefId: chain.id,
        amount: quotation.grand_total,
        currency: "INR",
        stepCount: steps.length,
        source: "outbox.quotation.submitted_for_approval",
        outboxId: ctx.outboxId,
        quotationNumber: quotation.quotation_number,
        quotationVersion: payload.quotationVersion,
      }),
    ],
  );

  ctx.log.info(
    {
      outboxId: ctx.outboxId,
      quotationId: payload.quotationId,
      quotationNumber: quotation.quotation_number,
      requestId,
      chainDefId: chain.id,
      stepCount: steps.length,
      firstRole: firstStep.roleId,
      grandTotal: quotation.grand_total,
    },
    "handler quotation.submitted_for_approval → approvals.openTicket",
  );
};
