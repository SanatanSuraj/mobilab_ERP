/**
 * Manual-entry queue repository. ARCHITECTURE.md §3.4.
 *
 * When an external API call can't land (circuit breaker open, transport
 * error, out-of-budget retries) the originating payload is parked here
 * so ops can either drain it once the downstream heals or key the entry
 * in by hand (the NIC EWB portal has a web UI for exactly this case).
 *
 * The table is defined in ops/sql/init/10-external-apis.sql.
 */

import type pg from "pg";

export type ManualEntrySource = "nic_ewb" | "gstn" | "whatsapp";

export interface ManualEntryRow {
  id: string;
  orgId: string;
  source: ManualEntrySource;
  referenceType: string | null;
  referenceId: string | null;
  payload: Record<string, unknown>;
  lastError: string | null;
  attempts: number;
  status: "PENDING" | "RESOLVED" | "ABANDONED";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
}

export interface EnqueueManualEntryInput {
  orgId: string;
  source: ManualEntrySource;
  payload: Record<string, unknown>;
  referenceType?: string | null;
  referenceId?: string | null;
  lastError?: string | null;
  attempts?: number;
  enqueuedBy?: string | null;
}

interface Row {
  id: string;
  org_id: string;
  source: ManualEntrySource;
  reference_type: string | null;
  reference_id: string | null;
  payload: Record<string, unknown>;
  last_error: string | null;
  attempts: number;
  status: "PENDING" | "RESOLVED" | "ABANDONED";
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  resolution_notes: string | null;
}

function toRow(r: Row): ManualEntryRow {
  return {
    id: r.id,
    orgId: r.org_id,
    source: r.source,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    payload: r.payload,
    lastError: r.last_error,
    attempts: r.attempts,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    resolutionNotes: r.resolution_notes,
  };
}

const COLS = `id, org_id, source, reference_type, reference_id, payload,
              last_error, attempts, status, created_at, updated_at,
              resolved_at, resolution_notes`;

export const manualEntryQueueRepo = {
  async enqueue(
    client: pg.PoolClient,
    input: EnqueueManualEntryInput,
  ): Promise<ManualEntryRow> {
    const { rows } = await client.query<Row>(
      `INSERT INTO manual_entry_queue
         (org_id, source, reference_type, reference_id, payload,
          last_error, attempts, enqueued_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING ${COLS}`,
      [
        input.orgId,
        input.source,
        input.referenceType ?? null,
        input.referenceId ?? null,
        JSON.stringify(input.payload),
        input.lastError ?? null,
        input.attempts ?? 0,
        input.enqueuedBy ?? null,
      ],
    );
    return toRow(rows[0]!);
  },

  async listPending(
    client: pg.PoolClient,
    filter: { source?: ManualEntrySource; limit?: number } = {},
  ): Promise<ManualEntryRow[]> {
    const where: string[] = ["status = 'PENDING'"];
    const params: unknown[] = [];
    if (filter.source) {
      params.push(filter.source);
      where.push(`source = $${params.length}`);
    }
    const limit = filter.limit ?? 50;
    const { rows } = await client.query<Row>(
      `SELECT ${COLS} FROM manual_entry_queue
        WHERE ${where.join(" AND ")}
        ORDER BY created_at ASC
        LIMIT ${limit}`,
      params,
    );
    return rows.map(toRow);
  },

  async markResolved(
    client: pg.PoolClient,
    id: string,
    input: { resolvedBy?: string | null; notes?: string | null } = {},
  ): Promise<ManualEntryRow | null> {
    const { rows } = await client.query<Row>(
      `UPDATE manual_entry_queue
          SET status = 'RESOLVED',
              resolved_by = $2,
              resolved_at = now(),
              resolution_notes = $3
        WHERE id = $1 AND status = 'PENDING'
        RETURNING ${COLS}`,
      [id, input.resolvedBy ?? null, input.notes ?? null],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },

  async markAbandoned(
    client: pg.PoolClient,
    id: string,
    reason: string,
  ): Promise<ManualEntryRow | null> {
    const { rows } = await client.query<Row>(
      `UPDATE manual_entry_queue
          SET status = 'ABANDONED',
              resolved_at = now(),
              resolution_notes = $2
        WHERE id = $1 AND status = 'PENDING'
        RETURNING ${COLS}`,
      [id, reason],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },
};
