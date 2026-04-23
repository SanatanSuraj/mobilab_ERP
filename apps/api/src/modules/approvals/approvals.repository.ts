/**
 * Approvals repository. Thin CRUD + state-machine wrappers over the four
 * tables (chain defs / requests / steps / transitions). All queries run
 * inside withRequest() so RLS and the audit actor GUC are set.
 *
 * ARCHITECTURE.md §3.3.
 */

import type { PoolClient } from "pg";
import type {
  ApprovalAction,
  ApprovalChainDefinition,
  ApprovalChainStep,
  ApprovalEntityType,
  ApprovalInboxItem,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalStep,
  ApprovalStepStatus,
  WorkflowTransition,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ─── Chain definitions ───────────────────────────────────────────────────────

interface ChainDefRow {
  id: string;
  org_id: string;
  entity_type: ApprovalEntityType;
  name: string;
  description: string | null;
  min_amount: string | null;
  max_amount: string | null;
  steps: unknown;
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToChainDef(r: ChainDefRow): ApprovalChainDefinition {
  return {
    id: r.id,
    orgId: r.org_id,
    entityType: r.entity_type,
    name: r.name,
    description: r.description,
    minAmount: r.min_amount,
    maxAmount: r.max_amount,
    steps: (r.steps as ApprovalChainStep[]) ?? [],
    isActive: r.is_active,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const CHAIN_COLS = `id, org_id, entity_type, name, description, min_amount, max_amount,
                    steps, is_active, version, created_by, created_at, updated_at, deleted_at`;

// ─── Requests ────────────────────────────────────────────────────────────────

interface RequestRow {
  id: string;
  org_id: string;
  chain_def_id: string;
  entity_type: ApprovalEntityType;
  entity_id: string;
  amount: string | null;
  currency: string;
  status: ApprovalRequestStatus;
  current_step: number | null;
  requested_by: string | null;
  completed_at: Date | null;
  completed_by: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToRequest(r: RequestRow): ApprovalRequest {
  return {
    id: r.id,
    orgId: r.org_id,
    chainDefId: r.chain_def_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    currentStep: r.current_step,
    requestedBy: r.requested_by,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    completedBy: r.completed_by,
    cancellationReason: r.cancellation_reason,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const REQUEST_COLS = `id, org_id, chain_def_id, entity_type, entity_id, amount, currency,
                      status, current_step, requested_by, completed_at, completed_by,
                      cancellation_reason, notes, created_at, updated_at`;

// ─── Steps ───────────────────────────────────────────────────────────────────

interface StepRow {
  id: string;
  org_id: string;
  request_id: string;
  step_number: number;
  role_id: string;
  requires_e_signature: boolean;
  status: ApprovalStepStatus;
  acted_by: string | null;
  acted_at: Date | null;
  comment: string | null;
  e_signature_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToStep(r: StepRow): ApprovalStep {
  return {
    id: r.id,
    orgId: r.org_id,
    requestId: r.request_id,
    stepNumber: r.step_number,
    roleId: r.role_id,
    requiresESignature: r.requires_e_signature,
    status: r.status,
    actedBy: r.acted_by,
    actedAt: r.acted_at ? r.acted_at.toISOString() : null,
    comment: r.comment,
    eSignatureHash: r.e_signature_hash,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const STEP_COLS = `id, org_id, request_id, step_number, role_id, requires_e_signature,
                   status, acted_by, acted_at, comment, e_signature_hash,
                   created_at, updated_at`;

// ─── Transitions ─────────────────────────────────────────────────────────────

interface TransitionRow {
  id: string;
  org_id: string;
  request_id: string;
  step_id: string | null;
  action: ApprovalAction;
  from_status: string;
  to_status: string;
  actor_id: string | null;
  actor_role: string | null;
  comment: string | null;
  e_signature_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

function rowToTransition(r: TransitionRow): WorkflowTransition {
  return {
    id: r.id,
    orgId: r.org_id,
    requestId: r.request_id,
    stepId: r.step_id,
    action: r.action,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    comment: r.comment,
    eSignatureHash: r.e_signature_hash,
    metadata: r.metadata,
    createdAt: r.created_at.toISOString(),
  };
}

const TRANSITION_COLS = `id, org_id, request_id, step_id, action, from_status, to_status,
                         actor_id, actor_role, comment, e_signature_hash, metadata, created_at`;

// ─── List filters ────────────────────────────────────────────────────────────

export interface ChainListFilters {
  entityType?: ApprovalEntityType;
  isActive?: boolean;
  search?: string;
}

export interface RequestListFilters {
  entityType?: ApprovalEntityType;
  entityId?: string;
  status?: ApprovalRequestStatus;
  requestedBy?: string;
  from?: string;
  to?: string;
}

// ─── Repo ────────────────────────────────────────────────────────────────────

export const approvalsRepo = {
  // ── Chain definitions ──────────────────────────────────────────────────────

  /**
   * Resolve the chain definition for (entityType, amount). Picks the
   * highest-matching band: ORDER BY min_amount DESC NULLS LAST.
   *
   * Returns `null` if no chain is defined — the caller decides whether that
   * means "no approval required" or "misconfiguration".
   */
  async resolveChain(
    client: PoolClient,
    entityType: ApprovalEntityType,
    amount: string | null,
  ): Promise<ApprovalChainDefinition | null> {
    const { rows } = await client.query<ChainDefRow>(
      `SELECT ${CHAIN_COLS}
         FROM approval_chain_definitions
        WHERE entity_type = $1
          AND is_active = true
          AND deleted_at IS NULL
          AND (min_amount IS NULL OR ($2::numeric IS NOT NULL AND $2::numeric >= min_amount))
          AND (max_amount IS NULL OR ($2::numeric IS NOT NULL AND $2::numeric <  max_amount))
        ORDER BY min_amount DESC NULLS LAST
        LIMIT 1`,
      [entityType, amount],
    );
    return rows[0] ? rowToChainDef(rows[0]) : null;
  },

  async getChainById(
    client: PoolClient,
    id: string,
  ): Promise<ApprovalChainDefinition | null> {
    const { rows } = await client.query<ChainDefRow>(
      `SELECT ${CHAIN_COLS} FROM approval_chain_definitions
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToChainDef(rows[0]) : null;
  },

  async listChains(
    client: PoolClient,
    filters: ChainListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: ApprovalChainDefinition[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.entityType) {
      where.push(`entity_type = $${i}`);
      params.push(filters.entityType);
      i++;
    }
    if (filters.isActive !== undefined) {
      where.push(`is_active = $${i}`);
      params.push(filters.isActive);
      i++;
    }
    if (filters.search) {
      where.push(`(name ILIKE $${i} OR description ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(
        `SELECT count(*)::bigint AS total FROM approval_chain_definitions ${whereSql}`,
        params,
      ),
      client.query<ChainDefRow>(
        `SELECT ${CHAIN_COLS} FROM approval_chain_definitions
         ${whereSql} ORDER BY ${plan.orderBy}
         LIMIT ${plan.limit} OFFSET ${plan.offset}`,
        params,
      ),
    ]);
    return {
      data: listRes.rows.map(rowToChainDef),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async createChain(
    client: PoolClient,
    orgId: string,
    createdBy: string | null,
    input: {
      entityType: ApprovalEntityType;
      name: string;
      description?: string;
      minAmount?: string;
      maxAmount?: string;
      steps: ApprovalChainStep[];
      isActive: boolean;
    },
  ): Promise<ApprovalChainDefinition> {
    const { rows } = await client.query<ChainDefRow>(
      `INSERT INTO approval_chain_definitions
         (org_id, entity_type, name, description, min_amount, max_amount,
          steps, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
       RETURNING ${CHAIN_COLS}`,
      [
        orgId,
        input.entityType,
        input.name,
        input.description ?? null,
        input.minAmount ?? null,
        input.maxAmount ?? null,
        JSON.stringify(input.steps),
        input.isActive,
        createdBy,
      ],
    );
    return rowToChainDef(rows[0]!);
  },

  async softDeleteChain(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE approval_chain_definitions SET deleted_at = now(), is_active = false
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },

  // ── Requests ───────────────────────────────────────────────────────────────

  async getRequestById(
    client: PoolClient,
    id: string,
  ): Promise<ApprovalRequest | null> {
    const { rows } = await client.query<RequestRow>(
      `SELECT ${REQUEST_COLS} FROM approval_requests WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToRequest(rows[0]) : null;
  },

  async getRequestByEntity(
    client: PoolClient,
    entityType: ApprovalEntityType,
    entityId: string,
  ): Promise<ApprovalRequest | null> {
    const { rows } = await client.query<RequestRow>(
      `SELECT ${REQUEST_COLS} FROM approval_requests
        WHERE entity_type = $1 AND entity_id = $2 AND status = 'PENDING'
        LIMIT 1`,
      [entityType, entityId],
    );
    return rows[0] ? rowToRequest(rows[0]) : null;
  },

  async listRequests(
    client: PoolClient,
    filters: RequestListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: ApprovalRequest[]; total: number }> {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.entityType) {
      where.push(`entity_type = $${i}`);
      params.push(filters.entityType);
      i++;
    }
    if (filters.entityId) {
      where.push(`entity_id = $${i}`);
      params.push(filters.entityId);
      i++;
    }
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.requestedBy) {
      where.push(`requested_by = $${i}`);
      params.push(filters.requestedBy);
      i++;
    }
    if (filters.from) {
      where.push(`created_at >= $${i}`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`created_at <= $${i}`);
      params.push(filters.to);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(
        `SELECT count(*)::bigint AS total FROM approval_requests ${whereSql}`,
        params,
      ),
      client.query<RequestRow>(
        `SELECT ${REQUEST_COLS} FROM approval_requests
         ${whereSql} ORDER BY ${plan.orderBy}
         LIMIT ${plan.limit} OFFSET ${plan.offset}`,
        params,
      ),
    ]);
    return {
      data: listRes.rows.map(rowToRequest),
      total: Number(countRes.rows[0]!.total),
    };
  },

  /**
   * Atomically insert a request + its steps + a CREATE transition row.
   * Caller runs inside a transaction so partial inserts never escape.
   */
  async createRequestWithSteps(
    client: PoolClient,
    orgId: string,
    requestedBy: string | null,
    actorRole: string | null,
    input: {
      chainDefId: string;
      entityType: ApprovalEntityType;
      entityId: string;
      amount: string | null;
      currency: string;
      notes: string | null;
      steps: ApprovalChainStep[];
    },
  ): Promise<{ request: ApprovalRequest; steps: ApprovalStep[] }> {
    const firstStep = input.steps[0]!;
    const { rows: reqRows } = await client.query<RequestRow>(
      `INSERT INTO approval_requests
         (org_id, chain_def_id, entity_type, entity_id, amount, currency,
          status, current_step, requested_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9)
       RETURNING ${REQUEST_COLS}`,
      [
        orgId,
        input.chainDefId,
        input.entityType,
        input.entityId,
        input.amount,
        input.currency,
        firstStep.stepNumber,
        requestedBy,
        input.notes,
      ],
    );
    const request = rowToRequest(reqRows[0]!);

    // Insert steps in one multi-VALUES statement.
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const s of input.steps) {
      values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      params.push(orgId, request.id, s.stepNumber, s.roleId, s.requiresESignature);
    }
    const { rows: stepRows } = await client.query<StepRow>(
      `INSERT INTO approval_steps
         (org_id, request_id, step_number, role_id, requires_e_signature)
       VALUES ${values.join(", ")}
       RETURNING ${STEP_COLS}`,
      params,
    );

    // Transition log: single CREATE row.
    await client.query(
      `INSERT INTO workflow_transitions
         (org_id, request_id, step_id, action, from_status, to_status,
          actor_id, actor_role, comment, metadata)
       VALUES ($1,$2,NULL,'CREATE','NEW','PENDING',$3,$4,NULL,$5::jsonb)`,
      [
        orgId,
        request.id,
        requestedBy,
        actorRole,
        JSON.stringify({
          chainDefId: input.chainDefId,
          amount: input.amount,
          currency: input.currency,
          stepCount: input.steps.length,
        }),
      ],
    );

    return { request, steps: stepRows.map(rowToStep) };
  },

  async listStepsForRequest(
    client: PoolClient,
    requestId: string,
  ): Promise<ApprovalStep[]> {
    const { rows } = await client.query<StepRow>(
      `SELECT ${STEP_COLS} FROM approval_steps
        WHERE request_id = $1 ORDER BY step_number`,
      [requestId],
    );
    return rows.map(rowToStep);
  },

  async listTransitionsForRequest(
    client: PoolClient,
    requestId: string,
  ): Promise<WorkflowTransition[]> {
    const { rows } = await client.query<TransitionRow>(
      `SELECT ${TRANSITION_COLS} FROM workflow_transitions
        WHERE request_id = $1 ORDER BY created_at`,
      [requestId],
    );
    return rows.map(rowToTransition);
  },

  /**
   * Inbox: pending steps whose role_id is in the caller's role set.
   * Joined against the parent request for entity context.
   */
  async listInbox(
    client: PoolClient,
    roleIds: string[],
    filter: { entityType?: ApprovalEntityType },
    plan: PaginationPlan,
  ): Promise<{ data: ApprovalInboxItem[]; total: number }> {
    if (roleIds.length === 0) return { data: [], total: 0 };
    const where: string[] = [
      "s.status = 'PENDING'",
      "s.role_id = ANY($1::text[])",
      "r.status = 'PENDING'",
      "r.current_step = s.step_number",
    ];
    const params: unknown[] = [roleIds];
    let i = 2;
    if (filter.entityType) {
      where.push(`r.entity_type = $${i}`);
      params.push(filter.entityType);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(
        `SELECT count(*)::bigint AS total
           FROM approval_steps s
           JOIN approval_requests r ON r.id = s.request_id
          ${whereSql}`,
        params,
      ),
      client.query<StepRow & RequestRow & { s_id: string; r_id: string }>(
        // Avoid column-name collisions by aliasing in a subquery that json-
        // bundles the two shapes.
        `SELECT s.id AS s_id, s.step_number, s.role_id, s.requires_e_signature,
                r.id AS r_id, r.org_id, r.chain_def_id, r.entity_type, r.entity_id,
                r.amount, r.currency, r.status, r.current_step, r.requested_by,
                r.completed_at, r.completed_by, r.cancellation_reason, r.notes,
                r.created_at, r.updated_at
           FROM approval_steps s
           JOIN approval_requests r ON r.id = s.request_id
          ${whereSql}
          ORDER BY r.created_at DESC
          LIMIT ${plan.limit} OFFSET ${plan.offset}`,
        params,
      ),
    ]);
    const data: ApprovalInboxItem[] = listRes.rows.map((row) => {
      // Rebuild the request from row
      const reqRow: RequestRow = {
        id: row.r_id,
        org_id: row.org_id,
        chain_def_id: row.chain_def_id,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        current_step: row.current_step,
        requested_by: row.requested_by,
        completed_at: row.completed_at,
        completed_by: row.completed_by,
        cancellation_reason: row.cancellation_reason,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      return {
        stepId: row.s_id,
        stepNumber: row.step_number,
        roleId: row.role_id,
        requiresESignature: row.requires_e_signature,
        request: rowToRequest(reqRow),
      };
    });
    return { data, total: Number(countRes.rows[0]!.total) };
  },

  /**
   * Lock the (request, step) pair for mutation. Returns the step and its
   * parent request — caller is expected to run inside a transaction so the
   * SELECT ... FOR UPDATE sticks.
   */
  async lockStepForAction(
    client: PoolClient,
    requestId: string,
  ): Promise<
    | { request: ApprovalRequest; step: ApprovalStep | null }
    | null
  > {
    const { rows: reqRows } = await client.query<RequestRow>(
      `SELECT ${REQUEST_COLS} FROM approval_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (reqRows.length === 0) return null;
    const request = rowToRequest(reqRows[0]!);
    if (request.currentStep == null) {
      return { request, step: null };
    }
    const { rows: stepRows } = await client.query<StepRow>(
      `SELECT ${STEP_COLS} FROM approval_steps
        WHERE request_id = $1 AND step_number = $2 FOR UPDATE`,
      [requestId, request.currentStep],
    );
    return { request, step: stepRows[0] ? rowToStep(stepRows[0]!) : null };
  },

  /**
   * Record the step decision. Sets status=APPROVED|REJECTED, acted_by/at/
   * comment/hash. Returns the updated step.
   *
   * actedAt is passed from the caller rather than defaulted to now()
   * because the §4.2 e-signature hash is HMAC'd against the exact same
   * ISO-8601 string the step row persists. If we defaulted to now() in
   * SQL, the hash would be computed against Node-clock and verified
   * against Postgres-clock — a small skew would render every signature
   * non-reproducible for auditors. Passing the caller's value once
   * threads the same timestamp through both.
   */
  async updateStepDecision(
    client: PoolClient,
    stepId: string,
    input: {
      status: "APPROVED" | "REJECTED";
      actedBy: string;
      actedAt: string; // ISO-8601 from ApprovalsService.act()
      comment: string | null;
      eSignatureHash: string | null;
    },
  ): Promise<ApprovalStep> {
    const { rows } = await client.query<StepRow>(
      `UPDATE approval_steps
          SET status = $2,
              acted_by = $3,
              acted_at = $4::timestamptz,
              comment = $5,
              e_signature_hash = $6
        WHERE id = $1
        RETURNING ${STEP_COLS}`,
      [
        stepId,
        input.status,
        input.actedBy,
        input.actedAt,
        input.comment,
        input.eSignatureHash,
      ],
    );
    return rowToStep(rows[0]!);
  },

  /**
   * Advance the request: set current_step to the next step number, or
   * finalise status=APPROVED/REJECTED + completed_at/by + current_step=NULL.
   */
  async progressRequest(
    client: PoolClient,
    requestId: string,
    input: {
      nextStep: number | null;
      finalStatus: ApprovalRequestStatus | null;
      completedBy: string | null;
    },
  ): Promise<ApprovalRequest> {
    if (input.finalStatus) {
      const { rows } = await client.query<RequestRow>(
        `UPDATE approval_requests
            SET status = $2, current_step = NULL,
                completed_at = now(), completed_by = $3
          WHERE id = $1
          RETURNING ${REQUEST_COLS}`,
        [requestId, input.finalStatus, input.completedBy],
      );
      return rowToRequest(rows[0]!);
    }
    const { rows } = await client.query<RequestRow>(
      `UPDATE approval_requests
          SET current_step = $2
        WHERE id = $1
        RETURNING ${REQUEST_COLS}`,
      [requestId, input.nextStep],
    );
    return rowToRequest(rows[0]!);
  },

  async cancelRequest(
    client: PoolClient,
    requestId: string,
    input: { cancelledBy: string; reason: string },
  ): Promise<ApprovalRequest> {
    const { rows } = await client.query<RequestRow>(
      `UPDATE approval_requests
          SET status = 'CANCELLED', current_step = NULL,
              completed_at = now(), completed_by = $2,
              cancellation_reason = $3
        WHERE id = $1
        RETURNING ${REQUEST_COLS}`,
      [requestId, input.cancelledBy, input.reason],
    );
    return rowToRequest(rows[0]!);
  },

  async logTransition(
    client: PoolClient,
    orgId: string,
    input: {
      requestId: string;
      stepId: string | null;
      action: ApprovalAction;
      fromStatus: string;
      toStatus: string;
      actorId: string | null;
      actorRole: string | null;
      comment: string | null;
      eSignatureHash: string | null;
      metadata: Record<string, unknown> | null;
    },
  ): Promise<WorkflowTransition> {
    const { rows } = await client.query<TransitionRow>(
      `INSERT INTO workflow_transitions
         (org_id, request_id, step_id, action, from_status, to_status,
          actor_id, actor_role, comment, e_signature_hash, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       RETURNING ${TRANSITION_COLS}`,
      [
        orgId,
        input.requestId,
        input.stepId,
        input.action,
        input.fromStatus,
        input.toStatus,
        input.actorId,
        input.actorRole,
        input.comment,
        input.eSignatureHash,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
    return rowToTransition(rows[0]!);
  },
};
