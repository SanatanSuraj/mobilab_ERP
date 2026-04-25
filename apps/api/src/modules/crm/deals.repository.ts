/**
 * Deals repository. Adds two things on top of the baseline:
 *
 *   1. `nextDealNumber(orgId, year)` — atomic counter via
 *      `crm_number_sequences`, formatted as DEAL-YYYY-NNNN.
 *   2. `updateWithVersion(id, patch, expectedVersion)` — optimistic lock.
 *      Mismatch returns `null`; the service translates to ConflictError.
 *
 * A BEFORE UPDATE trigger in ops/sql/triggers/04-crm.sql bumps `version` on
 * every successful UPDATE so readers can trust the monotonic value.
 */

import type { PoolClient } from "pg";
import type {
  CreateDeal,
  Deal,
  DealStage,
  UpdateDeal,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface DealRow {
  id: string;
  org_id: string;
  deal_number: string;
  title: string;
  account_id: string | null;
  contact_id: string | null;
  company: string;
  contact_name: string;
  stage: DealStage;
  value: string;
  probability: number;
  assigned_to: string | null;
  expected_close: Date | null;
  closed_at: Date | null;
  lost_reason: string | null;
  lead_id: string | null;
  pending_discount_pct: string | null;
  approved_discount_pct: string | null;
  discount_approved_by: string | null;
  discount_approved_at: Date | null;
  discount_request_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function toIsoDate(d: Date | null): string | null {
  if (!d) return null;
  // expected_close is DATE (no time) — pg returns a Date anchored at UTC midnight.
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

function rowToDeal(r: DealRow): Deal {
  return {
    id: r.id,
    orgId: r.org_id,
    dealNumber: r.deal_number,
    title: r.title,
    accountId: r.account_id,
    contactId: r.contact_id,
    company: r.company,
    contactName: r.contact_name,
    stage: r.stage,
    value: r.value,
    probability: r.probability,
    assignedTo: r.assigned_to,
    expectedClose: toIsoDate(r.expected_close),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    lostReason: r.lost_reason,
    leadId: r.lead_id,
    pendingDiscountPct: r.pending_discount_pct,
    approvedDiscountPct: r.approved_discount_pct,
    discountApprovedBy: r.discount_approved_by,
    discountApprovedAt: r.discount_approved_at
      ? r.discount_approved_at.toISOString()
      : null,
    discountRequestId: r.discount_request_id,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, deal_number, title, account_id, contact_id,
                     company, contact_name, stage, value, probability,
                     assigned_to, expected_close, closed_at, lost_reason,
                     lead_id, pending_discount_pct, approved_discount_pct,
                     discount_approved_by, discount_approved_at,
                     discount_request_id, version, created_at, updated_at,
                     deleted_at`;

export interface DealListFilters {
  stage?: DealStage;
  assignedTo?: string;
  accountId?: string;
  search?: string;
}

/**
 * Generate the next deal number for (orgId, year). Uses an INSERT ... ON
 * CONFLICT DO UPDATE to atomically bump the counter without a race.
 */
async function nextDealNumber(
  client: PoolClient,
  orgId: string,
  year: number
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO crm_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, 'DEAL', $2, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = crm_number_sequences.last_seq + 1
     RETURNING last_seq`,
    [orgId, year]
  );
  const seq = rows[0]!.last_seq;
  return `DEAL-${year}-${String(seq).padStart(4, "0")}`;
}

export const dealsRepo = {
  async list(
    client: PoolClient,
    filters: DealListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Deal[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.stage) {
      where.push(`stage = $${i}`);
      params.push(filters.stage);
      i++;
    }
    if (filters.assignedTo) {
      where.push(`assigned_to = $${i}`);
      params.push(filters.assignedTo);
      i++;
    }
    if (filters.accountId) {
      where.push(`account_id = $${i}`);
      params.push(filters.accountId);
      i++;
    }
    if (filters.search) {
      where.push(
        `(title ILIKE $${i} OR deal_number ILIKE $${i} OR company ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM deals ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM deals
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<DealRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToDeal),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Deal | null> {
    const { rows } = await client.query<DealRow>(
      `SELECT ${SELECT_COLS} FROM deals
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToDeal(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateDeal
  ): Promise<Deal> {
    const year = new Date().getUTCFullYear();
    const dealNumber = await nextDealNumber(client, orgId, year);
    const { rows } = await client.query<DealRow>(
      `INSERT INTO deals (
         org_id, deal_number, title, account_id, contact_id, company,
         contact_name, stage, value, probability, assigned_to,
         expected_close, lead_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        dealNumber,
        input.title,
        input.accountId ?? null,
        input.contactId ?? null,
        input.company,
        input.contactName,
        input.stage ?? "DISCOVERY",
        input.value ?? "0",
        input.probability ?? 20,
        input.assignedTo ?? null,
        input.expectedClose ?? null,
        input.leadId ?? null,
      ]
    );
    return rowToDeal(rows[0]!);
  },

  /**
   * Optimistic-locked update. Returns:
   *   - Deal on success
   *   - null if the row doesn't exist / is soft-deleted
   *   - "version_conflict" if the version didn't match (caller → 409)
   */
  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateDeal
  ): Promise<Deal | "version_conflict" | null> {
    // First confirm existence + snapshot current version so we can distinguish
    // "not found" from "version conflict".
    const cur = await dealsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.title !== undefined) col("title", input.title);
    if (input.accountId !== undefined) col("account_id", input.accountId);
    if (input.contactId !== undefined) col("contact_id", input.contactId);
    if (input.company !== undefined) col("company", input.company);
    if (input.contactName !== undefined) col("contact_name", input.contactName);
    if (input.stage !== undefined) col("stage", input.stage);
    if (input.value !== undefined) col("value", input.value);
    if (input.probability !== undefined) col("probability", input.probability);
    if (input.assignedTo !== undefined) col("assigned_to", input.assignedTo);
    if (input.expectedClose !== undefined)
      col("expected_close", input.expectedClose);
    if (input.leadId !== undefined) col("lead_id", input.leadId);
    if (sets.length === 0) return cur;

    // Version-guarded UPDATE — trigger bumps version on success.
    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<DealRow>(
      `UPDATE deals SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToDeal(rows[0]);
  },

  /**
   * Stage transition — also version-locked. Sets closed_at when moving
   * into CLOSED_WON / CLOSED_LOST, and lost_reason for CLOSED_LOST.
   */
  async transitionStage(
    client: PoolClient,
    id: string,
    args: {
      stage: DealStage;
      expectedVersion: number;
      lostReason: string | null;
    }
  ): Promise<Deal | "version_conflict" | null> {
    const cur = await dealsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const closing = args.stage === "CLOSED_WON" || args.stage === "CLOSED_LOST";
    const { rows } = await client.query<DealRow>(
      `UPDATE deals
          SET stage = $1,
              closed_at = CASE WHEN $2::boolean THEN now() ELSE closed_at END,
              lost_reason = CASE WHEN $1 = 'CLOSED_LOST' THEN $3 ELSE lost_reason END
        WHERE id = $4 AND version = $5 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [args.stage, closing, args.lostReason, id, args.expectedVersion]
    );
    if (!rows[0]) return "version_conflict";
    return rowToDeal(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE deals SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Park a pending discount + the FK to the live approval_request on the
   * deal row. Called by DealApprovalsService inside the same transaction
   * that creates the approval_request, so the row never sits with a stale
   * `discount_request_id` pointing at nothing.
   *
   * Optimistic-locked on the caller-supplied expectedVersion so a stale UI
   * submit fails with the same "version_conflict" sentinel as every other
   * deal mutation.
   */
  async setPendingDiscount(
    client: PoolClient,
    id: string,
    args: {
      pendingDiscountPct: string;
      discountRequestId: string;
      expectedVersion: number;
    },
  ): Promise<Deal | "version_conflict" | null> {
    const cur = await dealsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== args.expectedVersion) return "version_conflict";

    const { rows } = await client.query<DealRow>(
      `UPDATE deals
          SET pending_discount_pct = $1,
              discount_request_id  = $2
        WHERE id = $3 AND version = $4 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [
        args.pendingDiscountPct,
        args.discountRequestId,
        id,
        args.expectedVersion,
      ],
    );
    if (!rows[0]) return "version_conflict";
    return rowToDeal(rows[0]);
  },

  /**
   * Apply the terminal decision on a deal-discount approval. APPROVE copies
   * pending → approved + stamps approver + clears the request id; REJECT
   * clears all pending state and the request id. The row's `version`
   * trigger bumps in either case so subscribers see a fresh snapshot.
   *
   * Called by the deal-approvals finaliser inside the act() transaction —
   * no expectedVersion gate because the approvals layer is the source of
   * truth for the action.
   */
  async applyDiscountDecision(
    client: PoolClient,
    id: string,
    args: {
      finalStatus: "APPROVED" | "REJECTED";
      approverId: string;
    },
  ): Promise<Deal | null> {
    const cur = await dealsRepo.getById(client, id);
    if (!cur) return null;
    if (args.finalStatus === "APPROVED") {
      const { rows } = await client.query<DealRow>(
        `UPDATE deals
            SET approved_discount_pct = pending_discount_pct,
                pending_discount_pct  = NULL,
                discount_approved_by  = $1,
                discount_approved_at  = now(),
                discount_request_id   = NULL
          WHERE id = $2 AND deleted_at IS NULL
          RETURNING ${SELECT_COLS}`,
        [args.approverId, id],
      );
      return rows[0] ? rowToDeal(rows[0]) : null;
    }
    const { rows } = await client.query<DealRow>(
      `UPDATE deals
          SET pending_discount_pct = NULL,
              discount_request_id  = NULL
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      [id],
    );
    return rows[0] ? rowToDeal(rows[0]) : null;
  },
};

// exported for the leads service (lead conversion creates a deal inside the
// same transaction without reissuing the INSERT template).
export { nextDealNumber };
