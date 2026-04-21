/**
 * Notifications (inbox) repository. Per-user append-only feed with
 * is_read flips as the only mutation. No optimistic concurrency — the
 * read/unread toggle is idempotent by design.
 *
 * Service layer filters by user_id for regular reads. Admin reads (with
 * notifications:admin_read) can pass userId=undefined to skip the filter.
 */

import type { PoolClient } from "pg";
import type {
  CreateNotification,
  Notification,
  NotificationSeverity,
  NotificationUnreadCount,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface NotificationRow {
  id: string;
  org_id: string;
  user_id: string;
  event_type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link_url: string | null;
  reference_type: string | null;
  reference_id: string | null;
  template_id: string | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToNotification(r: NotificationRow): Notification {
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    eventType: r.event_type,
    severity: r.severity,
    title: r.title,
    body: r.body,
    linkUrl: r.link_url,
    referenceType: r.reference_type,
    referenceId: r.reference_id,
    templateId: r.template_id,
    isRead: r.is_read,
    readAt: r.read_at ? r.read_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, user_id, event_type, severity, title, body,
                     link_url, reference_type, reference_id, template_id,
                     is_read, read_at, created_at, updated_at, deleted_at`;

export interface NotificationListFilters {
  /**
   * When defined, scope to this user's inbox. Omit for admin reads (the
   * service layer decides which case applies based on permissions).
   */
  userId?: string;
  isRead?: boolean;
  severity?: NotificationSeverity;
  eventType?: string;
  referenceType?: string;
  referenceId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export const notificationsRepo = {
  async list(
    client: PoolClient,
    filters: NotificationListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: Notification[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.userId) {
      where.push(`user_id = $${i}`);
      params.push(filters.userId);
      i++;
    }
    if (filters.isRead !== undefined) {
      where.push(`is_read = $${i}`);
      params.push(filters.isRead);
      i++;
    }
    if (filters.severity) {
      where.push(`severity = $${i}`);
      params.push(filters.severity);
      i++;
    }
    if (filters.eventType) {
      where.push(`event_type = $${i}`);
      params.push(filters.eventType);
      i++;
    }
    if (filters.referenceType) {
      where.push(`reference_type = $${i}`);
      params.push(filters.referenceType);
      i++;
    }
    if (filters.referenceId) {
      where.push(`reference_id = $${i}`);
      params.push(filters.referenceId);
      i++;
    }
    if (filters.from) {
      where.push(`created_at >= $${i}`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`created_at <= $${i}`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(`(title ILIKE $${i} OR body ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM notifications ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM notifications
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<NotificationRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToNotification),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<Notification | null> {
    const { rows } = await client.query<NotificationRow>(
      `SELECT ${SELECT_COLS} FROM notifications
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToNotification(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateNotification,
  ): Promise<Notification> {
    const { rows } = await client.query<NotificationRow>(
      `INSERT INTO notifications (
         org_id, user_id, event_type, severity, title, body, link_url,
         reference_type, reference_id, template_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.userId,
        input.eventType,
        input.severity,
        input.title,
        input.body,
        input.linkUrl ?? null,
        input.referenceType ?? null,
        input.referenceId ?? null,
        input.templateId ?? null,
      ],
    );
    return rowToNotification(rows[0]!);
  },

  /**
   * Flip one or more rows to read. Scoped by user_id so a misdirected id
   * from another user is silently ignored rather than throwing — the
   * user-facing behaviour of "mark read" should not leak existence.
   */
  async markRead(
    client: PoolClient,
    userId: string,
    ids: string[],
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const { rowCount } = await client.query(
      `UPDATE notifications
          SET is_read = true, read_at = now()
        WHERE user_id = $1
          AND id = ANY($2::uuid[])
          AND is_read = false
          AND deleted_at IS NULL`,
      [userId, ids],
    );
    return rowCount ?? 0;
  },

  /**
   * "Mark all unread as read" for a given user. Returns count flipped.
   */
  async markAllRead(
    client: PoolClient,
    userId: string,
  ): Promise<number> {
    const { rowCount } = await client.query(
      `UPDATE notifications
          SET is_read = true, read_at = now()
        WHERE user_id = $1
          AND is_read = false
          AND deleted_at IS NULL`,
      [userId],
    );
    return rowCount ?? 0;
  },

  /**
   * Soft-delete a row from an inbox. Caller should verify ownership first
   * so the 404 is honest.
   */
  async softDelete(
    client: PoolClient,
    userId: string,
    id: string,
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE notifications SET deleted_at = now()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Cheap header-bell counter. Reads from the partial index on
   * (user_id, created_at DESC) WHERE is_read = false.
   */
  async unreadCount(
    client: PoolClient,
    userId: string,
  ): Promise<NotificationUnreadCount> {
    const { rows } = await client.query<{
      severity: NotificationSeverity;
      count: string;
    }>(
      `SELECT severity, count(*)::bigint AS count
         FROM notifications
        WHERE user_id = $1
          AND is_read = false
          AND deleted_at IS NULL
        GROUP BY severity`,
      [userId],
    );
    const bySeverity = {
      INFO: 0,
      SUCCESS: 0,
      WARNING: 0,
      ERROR: 0,
      CRITICAL: 0,
    };
    let total = 0;
    for (const r of rows) {
      const n = Number(r.count);
      bySeverity[r.severity] = n;
      total += n;
    }
    return { total, bySeverity };
  },
};
