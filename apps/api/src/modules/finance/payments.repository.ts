/**
 * Payments repository (payments).
 *
 * RECORDED-at-create, VOIDED-at-void. No editable surface past create —
 * corrections are VOID-and-repost. applied_to is a JSONB array on the row
 * (one payment → many invoice allocations).
 *
 * The service layer adds the cross-cutting ledger rows + invoice.amount_paid
 * bumps; the repository is pure CRUD.
 */

import type { PoolClient } from "pg";
import type {
  CreatePayment,
  Payment,
  PaymentAppliedInvoice,
  PaymentMode,
  PaymentStatus,
  PaymentType,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface PaymentRow {
  id: string;
  org_id: string;
  payment_number: string;
  payment_type: PaymentType;
  status: PaymentStatus;
  customer_id: string | null;
  vendor_id: string | null;
  counterparty_name: string | null;
  payment_date: Date;
  amount: string;
  currency: string;
  mode: PaymentMode;
  reference_no: string | null;
  applied_to: PaymentAppliedInvoice[];
  notes: string | null;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
  signature_hash: string | null;
  recorded_by: string | null;
  recorded_at: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    orgId: r.org_id,
    paymentNumber: r.payment_number,
    paymentType: r.payment_type,
    status: r.status,
    customerId: r.customer_id,
    vendorId: r.vendor_id,
    counterpartyName: r.counterparty_name,
    paymentDate: r.payment_date.toISOString().slice(0, 10),
    amount: r.amount,
    currency: r.currency,
    mode: r.mode,
    referenceNo: r.reference_no,
    appliedTo: Array.isArray(r.applied_to) ? r.applied_to : [],
    notes: r.notes,
    voidedAt: r.voided_at ? r.voided_at.toISOString() : null,
    voidedBy: r.voided_by,
    voidReason: r.void_reason,
    signatureHash: r.signature_hash,
    recordedBy: r.recorded_by,
    recordedAt: r.recorded_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const COLS = `id, org_id, payment_number, payment_type, status,
              customer_id, vendor_id, counterparty_name,
              payment_date, amount, currency, mode, reference_no,
              applied_to, notes,
              voided_at, voided_by, void_reason, signature_hash,
              recorded_by, recorded_at,
              created_at, updated_at, deleted_at`;

export interface PaymentListFilters {
  paymentType?: PaymentType;
  status?: PaymentStatus;
  customerId?: string;
  vendorId?: string;
  mode?: PaymentMode;
  from?: string;
  to?: string;
  search?: string;
}

export const paymentsRepo = {
  async list(
    client: PoolClient,
    filters: PaymentListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: Payment[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.paymentType) {
      where.push(`payment_type = $${i}`);
      params.push(filters.paymentType);
      i++;
    }
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.customerId) {
      where.push(`customer_id = $${i}`);
      params.push(filters.customerId);
      i++;
    }
    if (filters.vendorId) {
      where.push(`vendor_id = $${i}`);
      params.push(filters.vendorId);
      i++;
    }
    if (filters.mode) {
      where.push(`mode = $${i}`);
      params.push(filters.mode);
      i++;
    }
    if (filters.from) {
      where.push(`payment_date >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`payment_date <= $${i}::date`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(payment_number ILIKE $${i} OR reference_no ILIKE $${i} OR counterparty_name ILIKE $${i} OR notes ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM payments ${whereSql}`;
    const listSql = `
      SELECT ${COLS}
        FROM payments
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<PaymentRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToPayment),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Payment | null> {
    const { rows } = await client.query<PaymentRow>(
      `SELECT ${COLS} FROM payments WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToPayment(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    recordedBy: string | null,
    input: Omit<CreatePayment, "paymentNumber"> & { paymentNumber: string },
  ): Promise<Payment> {
    const { rows } = await client.query<PaymentRow>(
      `INSERT INTO payments (
         org_id, payment_number, payment_type, status,
         customer_id, vendor_id, counterparty_name,
         payment_date, amount, currency, mode, reference_no,
         applied_to, notes, recorded_by
       ) VALUES ($1,$2,$3,'RECORDED',$4,$5,$6,
                 COALESCE($7::date, current_date),
                 $8,
                 COALESCE($9, 'INR'),
                 $10, $11, $12::jsonb, $13, $14)
       RETURNING ${COLS}`,
      [
        orgId,
        input.paymentNumber,
        input.paymentType,
        input.customerId ?? null,
        input.vendorId ?? null,
        input.counterpartyName ?? null,
        input.paymentDate ?? null,
        input.amount,
        input.currency ?? null,
        input.mode,
        input.referenceNo ?? null,
        JSON.stringify(input.appliedTo ?? []),
        input.notes ?? null,
        recordedBy,
      ],
    );
    return rowToPayment(rows[0]!);
  },

  async markVoided(
    client: PoolClient,
    id: string,
    voidedBy: string | null,
    reason: string,
  ): Promise<Payment | null> {
    const { rows } = await client.query<PaymentRow>(
      `UPDATE payments
          SET status = 'VOIDED',
              voided_at = now(),
              voided_by = $2,
              void_reason = $3
        WHERE id = $1 AND status = 'RECORDED' AND deleted_at IS NULL
        RETURNING ${COLS}`,
      [id, voidedBy, reason],
    );
    return rows[0] ? rowToPayment(rows[0]) : null;
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE payments SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },
};
