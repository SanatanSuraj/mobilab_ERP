/**
 * QC auxiliary repositories — qc_equipment + qc_capa_actions.
 *
 * Both are read-only Phase-5 surfaces (writes via SQL seed only). Each
 * exposes list + getById, identical to the device_instances pattern in
 * production/device-instances.repository.ts.
 */

import type { PoolClient } from "pg";
import type {
  QcEquipment,
  QcEquipmentCategory,
  QcEquipmentStatus,
  QcCapaAction,
  CapaSourceType,
  CapaSeverity,
  CapaStatus,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ─── qc_equipment ────────────────────────────────────────────────────────────

interface EquipmentRow {
  id: string;
  org_id: string;
  asset_code: string;
  name: string;
  category: QcEquipmentCategory;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  location: string | null;
  status: QcEquipmentStatus;
  calibration_interval_days: number;
  last_calibrated_at: Date | null;
  next_due_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToEquipment(r: EquipmentRow): QcEquipment {
  return {
    id: r.id,
    orgId: r.org_id,
    assetCode: r.asset_code,
    name: r.name,
    category: r.category,
    manufacturer: r.manufacturer,
    modelNumber: r.model_number,
    serialNumber: r.serial_number,
    location: r.location,
    status: r.status,
    calibrationIntervalDays: r.calibration_interval_days,
    lastCalibratedAt: r.last_calibrated_at
      ? r.last_calibrated_at.toISOString()
      : null,
    nextDueAt: r.next_due_at ? r.next_due_at.toISOString() : null,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const EQUIPMENT_COLS = `
  id, org_id, asset_code, name, category, manufacturer, model_number,
  serial_number, location, status, calibration_interval_days,
  last_calibrated_at, next_due_at, notes, created_at, updated_at
`;

export interface EquipmentListFilters {
  category?: QcEquipmentCategory;
  status?: QcEquipmentStatus;
  search?: string;
}

export const qcEquipmentRepo = {
  async list(
    client: PoolClient,
    filters: EquipmentListFilters,
    plan: PaginationPlan
  ): Promise<{ data: QcEquipment[]; total: number }> {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.category) {
      where.push(`category = $${i}`);
      params.push(filters.category);
      i++;
    }
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.search) {
      where.push(`(asset_code ILIKE $${i} OR name ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM qc_equipment ${whereSql}`;
    const listSql = `
      SELECT ${EQUIPMENT_COLS}
        FROM qc_equipment
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<EquipmentRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToEquipment),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string
  ): Promise<QcEquipment | null> {
    const { rows } = await client.query<EquipmentRow>(
      `SELECT ${EQUIPMENT_COLS} FROM qc_equipment WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToEquipment(rows[0]) : null;
  },
};

// ─── qc_capa_actions ─────────────────────────────────────────────────────────

interface CapaRow {
  id: string;
  org_id: string;
  capa_number: string;
  title: string;
  description: string | null;
  source_type: CapaSourceType;
  source_ref: string | null;
  action_type: "CORRECTIVE" | "PREVENTIVE" | "BOTH";
  severity: CapaSeverity;
  status: CapaStatus;
  owner_name: string | null;
  due_date: Date | null;
  closed_at: Date | null;
  root_cause: string | null;
  effectiveness_check: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToCapa(r: CapaRow): QcCapaAction {
  return {
    id: r.id,
    orgId: r.org_id,
    capaNumber: r.capa_number,
    title: r.title,
    description: r.description,
    sourceType: r.source_type,
    sourceRef: r.source_ref,
    actionType: r.action_type,
    severity: r.severity,
    status: r.status,
    ownerName: r.owner_name,
    dueDate: r.due_date ? r.due_date.toISOString().slice(0, 10) : null,
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    rootCause: r.root_cause,
    effectivenessCheck: r.effectiveness_check,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const CAPA_COLS = `
  id, org_id, capa_number, title, description, source_type, source_ref,
  action_type, severity, status, owner_name, due_date, closed_at,
  root_cause, effectiveness_check, created_at, updated_at
`;

export interface CapaListFilters {
  status?: CapaStatus;
  severity?: CapaSeverity;
  sourceType?: CapaSourceType;
  search?: string;
}

export const qcCapaRepo = {
  async list(
    client: PoolClient,
    filters: CapaListFilters,
    plan: PaginationPlan
  ): Promise<{ data: QcCapaAction[]; total: number }> {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.severity) {
      where.push(`severity = $${i}`);
      params.push(filters.severity);
      i++;
    }
    if (filters.sourceType) {
      where.push(`source_type = $${i}`);
      params.push(filters.sourceType);
      i++;
    }
    if (filters.search) {
      where.push(`(capa_number ILIKE $${i} OR title ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM qc_capa_actions ${whereSql}`;
    const listSql = `
      SELECT ${CAPA_COLS}
        FROM qc_capa_actions
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<CapaRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToCapa),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string
  ): Promise<QcCapaAction | null> {
    const { rows } = await client.query<CapaRow>(
      `SELECT ${CAPA_COLS} FROM qc_capa_actions WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToCapa(rows[0]) : null;
  },
};
