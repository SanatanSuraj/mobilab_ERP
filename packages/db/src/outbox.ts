/**
 * Transactional outbox helper. ARCHITECTURE.md §8.
 *
 * The rule: every cross-module side-effect (publish event, call external
 * API) must be written as a row in `outbox.events` inside the same txn
 * as the domain change. A dedicated listener (apps/listen-notify) reads
 * from LISTEN/NOTIFY and dispatches to queues.
 *
 * This helper just gives you a typed append method. It does NOT commit —
 * you call it inside a withOrg() transaction and let that transaction
 * commit the event atomically with the business data.
 */

import type { PoolClient } from "pg";

export interface OutboxEvent {
  /** Aggregate type, e.g. "work_order", "device", "invoice". */
  aggregateType: string;
  /** Stable id of the aggregate (usually UUID). */
  aggregateId: string;
  /** Event name in past tense, e.g. "work_order.released". */
  eventType: string;
  /** Full serializable payload. Will be stored as JSONB. */
  payload: Record<string, unknown>;
  /** Optional idempotency key — unique per event to dedupe retries. */
  idempotencyKey?: string;
}

export async function enqueueOutbox(
  client: PoolClient,
  event: OutboxEvent
): Promise<{ id: string }> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO outbox.events
       (aggregate_type, aggregate_id, event_type, payload, idempotency_key)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (idempotency_key)
       WHERE idempotency_key IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.payload),
      event.idempotencyKey ?? null,
    ]
  );
  // If the idempotency key already existed we get no row back; return a
  // sentinel. Callers that care should supply a key and handle this.
  if (row.rows.length === 0) {
    return { id: "duplicate" };
  }
  return { id: row.rows[0]!.id };
}
