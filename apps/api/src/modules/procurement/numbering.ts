/**
 * Per-(org, kind, year) monotonic number generator for IND/PO/GRN.
 *
 * Writes to `procurement_number_sequences`. Uses `INSERT ... ON CONFLICT`
 * to atomically bump last_seq and return the new value. The row is locked
 * for the rest of the transaction so a parallel transaction sees the bump.
 *
 * Produced format: `IND-2026-0001`, `PO-2026-0042`, `GRN-2026-0007`.
 * Width 4 rolls over at 9999 per (org, kind, year) — more than enough
 * for any real-world throughput; we can widen without a data migration by
 * just changing `.padStart(4, "0")`.
 */

import type { PoolClient } from "pg";
import type { ProcurementNumberKind } from "@mobilab/contracts";

const PREFIX: Record<ProcurementNumberKind, string> = {
  INDENT: "IND",
  PO: "PO",
  GRN: "GRN",
};

export async function nextProcurementNumber(
  client: PoolClient,
  orgId: string,
  kind: ProcurementNumberKind,
  year: number = new Date().getUTCFullYear()
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO procurement_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = procurement_number_sequences.last_seq + 1,
                   updated_at = now()
     RETURNING last_seq`,
    [orgId, kind, year]
  );
  const seq = rows[0]!.last_seq;
  return `${PREFIX[kind]}-${year}-${String(seq).padStart(4, "0")}`;
}
