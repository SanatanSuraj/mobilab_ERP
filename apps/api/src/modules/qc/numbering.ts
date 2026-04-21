/**
 * Per-(org, kind, year) monotonic number generator for QC identifiers.
 *
 * Mirrors production/numbering.ts. Emits:
 *   - QC-YYYY-NNNN  (kind=QC)   — qc_inspections.inspection_number
 *   - QCC-YYYY-NNNN (kind=QCC)  — qc_certs.cert_number
 *
 * Writes to `qc_number_sequences`. Uses `INSERT ... ON CONFLICT` to
 * atomically bump last_seq and return the new value.
 */

import type { PoolClient } from "pg";
import type { QcNumberKind } from "@mobilab/contracts";

const PREFIX: Record<QcNumberKind, string> = {
  QC: "QC",
  QCC: "QCC",
};

export async function nextQcNumber(
  client: PoolClient,
  orgId: string,
  kind: QcNumberKind,
  year: number = new Date().getUTCFullYear(),
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO qc_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = qc_number_sequences.last_seq + 1,
                   updated_at = now()
     RETURNING last_seq`,
    [orgId, kind, year],
  );
  const seq = rows[0]!.last_seq;
  return `${PREFIX[kind]}-${year}-${String(seq).padStart(4, "0")}`;
}
