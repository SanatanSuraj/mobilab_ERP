/**
 * Vendor ledger repository (vendor_ledger).
 *
 * APPEND-ONLY. Mirror of customer-ledger.repository.ts but for the AP side.
 * See that file for the design rationale (running balance at insert time,
 * reversals posted as new offsetting rows, etc.).
 */

import type { PoolClient } from "pg";
import type {
  CreateVendorLedgerEntry,
  VendorLedgerEntry,
  VendorLedgerEntryType,
  VendorLedgerReferenceType,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";
import { m, moneyToPg, ZERO } from "@mobilab/money";

interface LedgerRow {
  id: string;
  org_id: string;
  vendor_id: string;
  entry_date: Date;
  entry_type: VendorLedgerEntryType;
  debit: string;
  credit: string;
  running_balance: string;
  currency: string;
  reference_type: VendorLedgerReferenceType;
  reference_id: string | null;
  reference_number: string | null;
  description: string | null;
  recorded_by: string | null;
  created_at: Date;
}

function rowToEntry(r: LedgerRow): VendorLedgerEntry {
  return {
    id: r.id,
    orgId: r.org_id,
    vendorId: r.vendor_id,
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

const COLS = `id, org_id, vendor_id, entry_date, entry_type,
              debit, credit, running_balance, currency,
              reference_type, reference_id, reference_number,
              description, recorded_by, created_at`;

export interface VendorLedgerListFilters {
  vendorId?: string;
  entryType?: VendorLedgerEntryType;
  from?: string;
  to?: string;
  search?: string;
}

export const vendorLedgerRepo = {
  async list(
    client: PoolClient,
    filters: VendorLedgerListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: VendorLedgerEntry[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.vendorId) {
      where.push(`vendor_id = $${i}`);
      params.push(filters.vendorId);
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
    const countSql = `SELECT count(*)::bigint AS total FROM vendor_ledger ${whereSql}`;
    const listSql = `
      SELECT ${COLS}
        FROM vendor_ledger
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
  ): Promise<VendorLedgerEntry | null> {
    const { rows } = await client.query<LedgerRow>(
      `SELECT ${COLS} FROM vendor_ledger WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  },

  async currentBalance(
    client: PoolClient,
    vendorId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ running_balance: string }>(
      `SELECT running_balance FROM vendor_ledger
        WHERE vendor_id = $1
        ORDER BY entry_date DESC, created_at DESC
        LIMIT 1`,
      [vendorId],
    );
    return rows[0]?.running_balance ?? "0";
  },

  async append(
    client: PoolClient,
    orgId: string,
    recordedBy: string | null,
    input: CreateVendorLedgerEntry,
  ): Promise<VendorLedgerEntry> {
    const prev = await vendorLedgerRepo.currentBalance(client, input.vendorId);
    const debit = m(input.debit ?? "0");
    const credit = m(input.credit ?? "0");
    const delta = debit.minus(credit);
    const running = m(prev).plus(delta);
    const runningStr = moneyToPg(running.eq(ZERO) ? ZERO : running);

    const { rows } = await client.query<LedgerRow>(
      `INSERT INTO vendor_ledger (
         org_id, vendor_id, entry_date, entry_type,
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
        input.vendorId,
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
