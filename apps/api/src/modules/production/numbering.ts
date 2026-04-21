/**
 * Per-(org, kind, year) monotonic number generator for production PIDs.
 *
 * Mirrors procurement/numbering.ts. Currently only emits WO PIDs in the
 * format `PID-YYYY-NNNN`; a new kind can be added by extending the
 * ProductionNumberKind enum in @mobilab/contracts and the PREFIX map below.
 *
 * Writes to `production_number_sequences`. Uses `INSERT ... ON CONFLICT`
 * to atomically bump last_seq and return the new value.
 */

import type { PoolClient } from "pg";
import type { ProductionNumberKind } from "@mobilab/contracts";

const PREFIX: Record<ProductionNumberKind, string> = {
  WO: "PID",
};

export async function nextProductionNumber(
  client: PoolClient,
  orgId: string,
  kind: ProductionNumberKind,
  year: number = new Date().getUTCFullYear()
): Promise<string> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO production_number_sequences (org_id, kind, year, last_seq)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (org_id, kind, year)
     DO UPDATE SET last_seq = production_number_sequences.last_seq + 1,
                   updated_at = now()
     RETURNING last_seq`,
    [orgId, kind, year]
  );
  const seq = rows[0]!.last_seq;
  return `${PREFIX[kind]}-${year}-${String(seq).padStart(4, "0")}`;
}
