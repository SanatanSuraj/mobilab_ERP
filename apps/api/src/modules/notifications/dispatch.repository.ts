/**
 * Notification dispatch DLQ repository. ARCHITECTURE.md §3.6 (Phase 3).
 *
 * This table holds the "we rendered and tried to deliver but the channel
 * transport failed" parking lot. It's distinct from `manual_entry_queue`:
 *   - manual_entry_queue holds raw external-API payloads (so ops can
 *     re-submit to NIC / GSTN / WABA directly)
 *   - notification_dispatch_dlq holds already-rendered user-facing output
 *     (so ops can see exactly what a recipient would have received and,
 *     for IN_APP, redrive into the notifications table)
 *
 * One row per (event, channel, recipient) delivery attempt. Status machine:
 *   PENDING → RETRIED   (redispatch won; row kept for audit)
 *   PENDING → ABANDONED (retry budget blown; manual follow-up required)
 *
 * Table DDL: ops/sql/init/11-notification-dispatch-dlq.sql
 */

import type { PoolClient } from "pg";
import type {
  NotificationChannel,
  NotificationDispatchDlqRow,
  NotificationDispatchDlqStatus,
} from "@instigenie/contracts";

export interface EnqueueDispatchDlqInput {
  orgId: string;
  eventType: string;
  channel: NotificationChannel;
  recipientUserId?: string | null;
  templateId?: string | null;
  subject?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
  lastError?: string | null;
  attempts?: number;
}

interface DlqRow {
  id: string;
  org_id: string;
  event_type: string;
  channel: NotificationChannel;
  recipient_user_id: string | null;
  template_id: string | null;
  subject: string | null;
  body: string;
  metadata: Record<string, unknown>;
  last_error: string | null;
  attempts: number;
  status: NotificationDispatchDlqStatus;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: DlqRow): NotificationDispatchDlqRow {
  return {
    id: r.id,
    orgId: r.org_id,
    eventType: r.event_type,
    channel: r.channel,
    recipientUserId: r.recipient_user_id,
    templateId: r.template_id,
    subject: r.subject,
    body: r.body,
    metadata: r.metadata ?? {},
    lastError: r.last_error,
    attempts: r.attempts,
    status: r.status,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    resolutionNotes: r.resolution_notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const COLS = `id, org_id, event_type, channel, recipient_user_id, template_id,
              subject, body, metadata, last_error, attempts, status,
              resolved_by, resolved_at, resolution_notes,
              created_at, updated_at`;

export interface ListDispatchDlqFilters {
  channel?: NotificationChannel;
  eventType?: string;
  status?: NotificationDispatchDlqStatus;
  limit?: number;
}

export const notificationDispatchDlqRepo = {
  async enqueue(
    client: PoolClient,
    input: EnqueueDispatchDlqInput,
  ): Promise<NotificationDispatchDlqRow> {
    const { rows } = await client.query<DlqRow>(
      `INSERT INTO notification_dispatch_dlq
         (org_id, event_type, channel, recipient_user_id, template_id,
          subject, body, metadata, last_error, attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       RETURNING ${COLS}`,
      [
        input.orgId,
        input.eventType,
        input.channel,
        input.recipientUserId ?? null,
        input.templateId ?? null,
        input.subject ?? null,
        input.body,
        JSON.stringify(input.metadata ?? {}),
        input.lastError ?? null,
        input.attempts ?? 1,
      ],
    );
    return toRow(rows[0]!);
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<NotificationDispatchDlqRow | null> {
    const { rows } = await client.query<DlqRow>(
      `SELECT ${COLS} FROM notification_dispatch_dlq WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },

  async listPending(
    client: PoolClient,
    filter: ListDispatchDlqFilters = {},
  ): Promise<NotificationDispatchDlqRow[]> {
    const where: string[] = ["status = 'PENDING'"];
    const params: unknown[] = [];
    if (filter.channel) {
      params.push(filter.channel);
      where.push(`channel = $${params.length}`);
    }
    if (filter.eventType) {
      params.push(filter.eventType);
      where.push(`event_type = $${params.length}`);
    }
    const limit = filter.limit ?? 50;
    const { rows } = await client.query<DlqRow>(
      `SELECT ${COLS} FROM notification_dispatch_dlq
        WHERE ${where.join(" AND ")}
        ORDER BY created_at ASC
        LIMIT ${limit}`,
      params,
    );
    return rows.map(toRow);
  },

  async list(
    client: PoolClient,
    filter: ListDispatchDlqFilters = {},
  ): Promise<NotificationDispatchDlqRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.channel) {
      params.push(filter.channel);
      where.push(`channel = $${params.length}`);
    }
    if (filter.eventType) {
      params.push(filter.eventType);
      where.push(`event_type = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
    const limit = filter.limit ?? 100;
    const { rows } = await client.query<DlqRow>(
      `SELECT ${COLS} FROM notification_dispatch_dlq
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      params,
    );
    return rows.map(toRow);
  },

  async markRetried(
    client: PoolClient,
    id: string,
    input: { resolvedBy?: string | null; notes?: string | null } = {},
  ): Promise<NotificationDispatchDlqRow | null> {
    const { rows } = await client.query<DlqRow>(
      `UPDATE notification_dispatch_dlq
          SET status = 'RETRIED',
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
    client: PoolClient,
    id: string,
    reason: string,
    input: { resolvedBy?: string | null } = {},
  ): Promise<NotificationDispatchDlqRow | null> {
    const { rows } = await client.query<DlqRow>(
      `UPDATE notification_dispatch_dlq
          SET status = 'ABANDONED',
              resolved_by = $3,
              resolved_at = now(),
              resolution_notes = $2
        WHERE id = $1 AND status = 'PENDING'
        RETURNING ${COLS}`,
      [id, reason, input.resolvedBy ?? null],
    );
    return rows[0] ? toRow(rows[0]) : null;
  },
};
