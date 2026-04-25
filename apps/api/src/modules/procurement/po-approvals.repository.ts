/**
 * PO approvals repository.
 *
 * Append-only audit log for approve/reject actions against a purchase
 * order. Pairs with the PO header's denormalised approved_by/approved_at
 * stamp (set by purchase-orders.service on APPROVE) — this table holds
 * the full who/when/why trail and the prior+new status pair.
 */

import type { PoolClient } from "pg";
import type { PoApproval, PoApprovalAction, PoStatus } from "@instigenie/contracts";

interface PoApprovalRow {
  id: string;
  org_id: string;
  po_id: string;
  action: PoApprovalAction;
  user_id: string | null;
  prior_status: PoStatus;
  new_status: PoStatus;
  remarks: string | null;
  created_at: Date;
}

function rowToApproval(r: PoApprovalRow): PoApproval {
  return {
    id: r.id,
    orgId: r.org_id,
    poId: r.po_id,
    action: r.action,
    userId: r.user_id,
    priorStatus: r.prior_status,
    newStatus: r.new_status,
    remarks: r.remarks,
    createdAt: r.created_at.toISOString(),
  };
}

const SELECT_COLS = `id, org_id, po_id, action, user_id, prior_status,
                     new_status, remarks, created_at`;

export interface InsertPoApprovalInput {
  orgId: string;
  poId: string;
  action: PoApprovalAction;
  userId: string | null;
  priorStatus: PoStatus;
  newStatus: PoStatus;
  remarks: string | null;
}

export const poApprovalsRepo = {
  async insertEntry(
    client: PoolClient,
    input: InsertPoApprovalInput
  ): Promise<PoApproval> {
    const { rows } = await client.query<PoApprovalRow>(
      `INSERT INTO po_approvals
         (org_id, po_id, action, user_id, prior_status, new_status, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_COLS}`,
      [
        input.orgId,
        input.poId,
        input.action,
        input.userId,
        input.priorStatus,
        input.newStatus,
        input.remarks,
      ]
    );
    return rowToApproval(rows[0]!);
  },

  async listForPo(client: PoolClient, poId: string): Promise<PoApproval[]> {
    const { rows } = await client.query<PoApprovalRow>(
      `SELECT ${SELECT_COLS}
         FROM po_approvals
        WHERE po_id = $1
        ORDER BY created_at DESC`,
      [poId]
    );
    return rows.map(rowToApproval);
  },
};
