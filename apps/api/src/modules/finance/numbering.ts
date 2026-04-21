/**
 * Per-(org, kind, year) monotonic number generator for finance identifiers.
 *
 * Mirrors qc/numbering.ts. Emits:
 *   - SI-YYYY-NNNN  (kind=SI)  — sales_invoices.invoice_number
 *   - PI-YYYY-NNNN  (kind=PI)  — purchase_invoices.invoice_number
 *   - PAY-YYYY-NNNN (kind=PAY) — payments.payment_number
 *
 * Writes to `finance_number_sequences`. Uses `INSERT ... ON CONFLICT` to
 * atomically bump last_seq and return the new value.
 */

import type { PoolClient } from "pg";
import type { FinanceNumberKind } from "@mobilab/contracts";

const PREFIX: Record<FinanceNumberKind, string> = {
  SI: "SI",
  PI: "PI",
  PAY: "PAY",
};

export async function nextFinanceNumber(
  client: PoolClient,
  orgId: string,
  kind: FinanceNumberKind,
  year: number = new Date().getUTCFullYear(),
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO finance_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = finance_number_sequences.last_seq + 1,
                   updated_at = now()
     RETURNING last_seq`,
    [orgId, kind, year],
  );
  const seq = rows[0]!.last_seq;
  return `${PREFIX[kind]}-${year}-${String(seq).padStart(4, "0")}`;
}
