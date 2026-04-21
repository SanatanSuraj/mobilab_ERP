/**
 * Notification templates repository. Mirror of qc/templates.repository.ts
 * but header-only (no sub-entity); the Phase 2 "parameter" analogue doesn't
 * exist because templates are self-contained rendering strings.
 *
 * Unique constraint on (org_id, event_type, channel) WHERE deleted_at IS
 * NULL is enforced at the DB layer; duplicate inserts surface as code 23505
 * which the service translates to ConflictError.
 */

import type { PoolClient } from "pg";
import type {
  CreateNotificationTemplate,
  NotificationChannel,
  NotificationSeverity,
  NotificationTemplate,
  UpdateNotificationTemplate,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface TemplateRow {
  id: string;
  org_id: string;
  event_type: string;
  channel: NotificationChannel;
  name: string;
  description: string | null;
  subject_template: string | null;
  body_template: string;
  default_severity: NotificationSeverity;
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToTemplate(r: TemplateRow): NotificationTemplate {
  return {
    id: r.id,
    orgId: r.org_id,
    eventType: r.event_type,
    channel: r.channel,
    name: r.name,
    description: r.description,
    subjectTemplate: r.subject_template,
    bodyTemplate: r.body_template,
    defaultSeverity: r.default_severity,
    isActive: r.is_active,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, event_type, channel, name, description,
                     subject_template, body_template, default_severity,
                     is_active, version, created_by, created_at, updated_at,
                     deleted_at`;

export interface TemplateListFilters {
  eventType?: string;
  channel?: NotificationChannel;
  isActive?: boolean;
  search?: string;
}

export const notificationTemplatesRepo = {
  async list(
    client: PoolClient,
    filters: TemplateListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: NotificationTemplate[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.eventType) {
      where.push(`event_type = $${i}`);
      params.push(filters.eventType);
      i++;
    }
    if (filters.channel) {
      where.push(`channel = $${i}`);
      params.push(filters.channel);
      i++;
    }
    if (filters.isActive !== undefined) {
      where.push(`is_active = $${i}`);
      params.push(filters.isActive);
      i++;
    }
    if (filters.search) {
      where.push(
        `(event_type ILIKE $${i} OR name ILIKE $${i} OR COALESCE(description, '') ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM notification_templates ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM notification_templates
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<TemplateRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToTemplate),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<NotificationTemplate | null> {
    const { rows } = await client.query<TemplateRow>(
      `SELECT ${SELECT_COLS} FROM notification_templates
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToTemplate(rows[0]) : null;
  },

  async findByEventChannel(
    client: PoolClient,
    eventType: string,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null> {
    const { rows } = await client.query<TemplateRow>(
      `SELECT ${SELECT_COLS} FROM notification_templates
        WHERE event_type = $1 AND channel = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [eventType, channel],
    );
    return rows[0] ? rowToTemplate(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    createdBy: string | null,
    input: CreateNotificationTemplate,
  ): Promise<NotificationTemplate> {
    const { rows } = await client.query<TemplateRow>(
      `INSERT INTO notification_templates (
         org_id, event_type, channel, name, description, subject_template,
         body_template, default_severity, is_active, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.eventType,
        input.channel,
        input.name,
        input.description ?? null,
        input.subjectTemplate ?? null,
        input.bodyTemplate,
        input.defaultSeverity,
        input.isActive,
        createdBy,
      ],
    );
    return rowToTemplate(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateNotificationTemplate,
  ): Promise<NotificationTemplate | "version_conflict" | null> {
    const cur = await notificationTemplatesRepo.getById(client, id);
    if (!cur) return null;
    if (
      input.expectedVersion !== undefined &&
      cur.version !== input.expectedVersion
    ) {
      return "version_conflict";
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.eventType !== undefined) col("event_type", input.eventType);
    if (input.channel !== undefined) col("channel", input.channel);
    if (input.name !== undefined) col("name", input.name);
    if (input.description !== undefined) col("description", input.description);
    if (input.subjectTemplate !== undefined)
      col("subject_template", input.subjectTemplate);
    if (input.bodyTemplate !== undefined)
      col("body_template", input.bodyTemplate);
    if (input.defaultSeverity !== undefined)
      col("default_severity", input.defaultSeverity);
    if (input.isActive !== undefined) col("is_active", input.isActive);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    // When no expectedVersion supplied, don't condition on it.
    let sql: string;
    if (input.expectedVersion !== undefined) {
      params.push(input.expectedVersion);
      const verIdx = i;
      sql = `UPDATE notification_templates SET ${sets.join(", ")}
              WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
              RETURNING ${SELECT_COLS}`;
    } else {
      sql = `UPDATE notification_templates SET ${sets.join(", ")}
              WHERE id = $${idIdx} AND deleted_at IS NULL
              RETURNING ${SELECT_COLS}`;
    }
    const { rows } = await client.query<TemplateRow>(sql, params);
    if (!rows[0]) return "version_conflict";
    return rowToTemplate(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE notification_templates SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },
};
