/**
 * Customer ledger repository (customer_ledger).
 *
 * APPEND-ONLY. Intentionally ships only: list, getById, append. No update,
 * no delete. Reversals are posted as new offsetting rows.
 *
 * Running balance is computed AT INSERT TIME by reading the most recent
 * balance for the customer and applying the new (debit - credit) delta.
 * Phase 3 may migrate this to a materialised summary view; for now the
 * row-at-time read is cheap enough given the per-customer index.
 */

import type { PoolClient } from "pg";
import type {
  CreateCustomerLedgerEntry,
  CustomerLedgerEntry,
  CustomerLedgerEntryType,
  CustomerLedgerReferenceType,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";
import { m, moneyToPg, ZERO } from "@instigenie/money";

interface LedgerRow {
  id: string;
  org_id: string;
  customer_id: string;
  entry_date: Date;
  entry_type: CustomerLedgerEntryType;
  debit: string;
  credit: string;
  running_balance: string;
  currency: string;
  reference_type: CustomerLedgerReferenceType;
  reference_id: string | null;
  reference_number: string | null;
  description: string | null;
  recorded_by: string | null;
  created_at: Date;
}

function rowToEntry(r: LedgerRow): CustomerLedgerEntry {
  return {
    id: r.id,
    orgId: r.org_id,
    customerId: r.customer_id,
    entryDate: r.entry_date.toISOString().slice(0, 10),
    entryType: r.entry_type,
    debit: r.debit,
    credit: r.credit,
    runningBalance: r.running_balance,
    currency: r.currency,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    referenceNumber: r.reference_number,
    description: r.description,
    recordedBy: r.recorded_by,
    createdAt: r.created_at.toISOString(),
  };
}

const COLS = `id, org_id, customer_id, entry_date, entry_type,
              debit, credit, running_balance, currency,
              reference_type, reference_id, reference_number,
              description, recorded_by, created_at`;

export interface CustomerLedgerListFilters {
  customerId?: string;
  entryType?: CustomerLedgerEntryType;
  from?: string;
  to?: string;
  search?: string;
}

export const customerLedgerRepo = {
  async list(
    client: PoolClient,
    filters: CustomerLedgerListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: CustomerLedgerEntry[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.customerId) {
      where.push(`customer_id = $${i}`);
      params.push(filters.customerId);
      i++;
    }
    if (filters.entryType) {
      where.push(`entry_type = $${i}`);
      params.push(filters.entryType);
      i++;
    }
    if (filters.from) {
      where.push(`entry_date >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`entry_date <= $${i}::date`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(reference_number ILIKE $${i} OR description ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countSql = `SELECT count(*)::bigint AS total FROM customer_ledger ${whereSql}`;
    const listSql = `
      SELECT ${COLS}
        FROM customer_ledger
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<LedgerRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToEntry),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<CustomerLedgerEntry | null> {
    const { rows } = await client.query<LedgerRow>(
      `SELECT ${COLS} FROM customer_ledger WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  },

  /**
   * Current running balance for a customer = most recent row's running_balance,
   * or 0 if none exists. Uses the per-customer DESC index for O(1) lookup.
   */
  async currentBalance(
    client: PoolClient,
    customerId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ running_balance: string }>(
      `SELECT running_balance FROM customer_ledger
        WHERE customer_id = $1
        ORDER BY entry_date DESC, created_at DESC
        LIMIT 1`,
      [customerId],
    );
    return rows[0]?.running_balance ?? "0";
  },

  /**
   * Append a new ledger row. Computes runningBalance = prevBalance + debit
   * - credit and stores it on the new row. Service-enforced append-only.
   */
  async append(
    client: PoolClient,
    orgId: string,
    recordedBy: string | null,
    input: CreateCustomerLedgerEntry,
  ): Promise<CustomerLedgerEntry> {
    const prev = await customerLedgerRepo.currentBalance(client, input.customerId);
    const debit = m(input.debit ?? "0");
    const credit = m(input.credit ?? "0");
    const delta = debit.minus(credit);
    const running = m(prev).plus(delta);
    const runningStr = moneyToPg(running.eq(ZERO) ? ZERO : running);

    const { rows } = await client.query<LedgerRow>(
      `INSERT INTO customer_ledger (
         org_id, customer_id, entry_date, entry_type,
         debit, credit, running_balance, currency,
         reference_type, reference_id, reference_number,
         description, recorded_by
       ) VALUES ($1,$2,
                 COALESCE($3::date, current_date),
                 $4, $5, $6, $7,
                 COALESCE($8, 'INR'),
                 $9, $10, $11, $12, $13)
       RETURNING ${COLS}`,
      [
        orgId,
        input.customerId,
        input.entryDate ?? null,
        input.entryType,
        moneyToPg(debit),
        moneyToPg(credit),
        runningStr,
        input.currency ?? null,
        input.referenceType,
        input.referenceId ?? null,
        input.referenceNumber ?? null,
        input.description ?? null,
        recordedBy,
      ],
    );
    return rowToEntry(rows[0]!);
  },
};
