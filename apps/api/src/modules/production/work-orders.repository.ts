/**
 * Work orders repository (header + wip_stages).
 *
 * Work orders drive a 7-state lifecycle (PLANNED → MATERIAL_CHECK → IN_PROGRESS
 * → QC_HOLD ↔ REWORK → COMPLETED | CANCELLED). Each WO has an ordered sequence
 * of wip_stages copied from wip_stage_templates at create time so later
 * template edits don't mutate in-flight WOs.
 *
 * Stage mutations (START/COMPLETE/QC_PASS/QC_FAIL/REWORK_DONE) are coordinated
 * by the service layer — this repo exposes primitive flippers + the next-stage
 * lookup and leaves the decision logic upstream.
 */

import type { PoolClient } from "pg";
import type {
  CreateWorkOrder,
  ProductFamily,
  UpdateWorkOrder,
  WipBoardCard,
  WipStage,
  WipStageQcResult,
  WipStageStatus,
  WipStageTemplate,
  WoPriority,
  WoStatus,
  WorkOrder,
  WorkOrderListItem,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Header ───────────────────────────────────────────────────────────────────

interface WorkOrderRow {
  id: string;
  org_id: string;
  pid: string;
  product_id: string;
  bom_id: string;
  bom_version_label: string;
  quantity: string;
  status: WoStatus;
  priority: WoPriority;
  target_date: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  deal_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  current_stage_index: number;
  rework_count: number;
  lot_number: string | null;
  device_serials: string[];
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function rowToWorkOrder(r: WorkOrderRow): WorkOrder {
  return {
    id: r.id,
    orgId: r.org_id,
    pid: r.pid,
    productId: r.product_id,
    bomId: r.bom_id,
    bomVersionLabel: r.bom_version_label,
    quantity: r.quantity,
    status: r.status,
    priority: r.priority,
    targetDate: isoDate(r.target_date),
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    dealId: r.deal_id,
    assignedTo: r.assigned_to,
    createdBy: r.created_by,
    currentStageIndex: r.current_stage_index,
    reworkCount: r.rework_count,
    lotNumber: r.lot_number,
    deviceSerials: r.device_serials ?? [],
    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, pid, product_id, bom_id, bom_version_label,
                     quantity, status, priority, target_date, started_at,
                     completed_at, deal_id, assigned_to, created_by,
                     current_stage_index, rework_count, lot_number,
                     device_serials, notes, version, created_at, updated_at,
                     deleted_at`;

export interface WorkOrderListFilters {
  status?: WoStatus;
  priority?: WoPriority;
  productId?: string;
  assignedTo?: string;
  dealId?: string;
  from?: string;
  to?: string;
  search?: string;
}

// ── Stages ───────────────────────────────────────────────────────────────────

interface WipStageRow {
  id: string;
  org_id: string;
  wo_id: string;
  template_id: string | null;
  sequence_number: number;
  stage_name: string;
  requires_qc_signoff: boolean;
  expected_duration_hours: string;
  status: WipStageStatus;
  started_at: Date | null;
  completed_at: Date | null;
  qc_result: WipStageQcResult | null;
  qc_notes: string | null;
  rework_count: number;
  assigned_to: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToWipStage(r: WipStageRow): WipStage {
  return {
    id: r.id,
    orgId: r.org_id,
    woId: r.wo_id,
    templateId: r.template_id,
    sequenceNumber: r.sequence_number,
    stageName: r.stage_name,
    requiresQcSignoff: r.requires_qc_signoff,
    expectedDurationHours: r.expected_duration_hours,
    status: r.status,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    qcResult: r.qc_result,
    qcNotes: r.qc_notes,
    reworkCount: r.rework_count,
    assignedTo: r.assigned_to,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const STAGE_COLS = `id, org_id, wo_id, template_id, sequence_number, stage_name,
                    requires_qc_signoff, expected_duration_hours, status,
                    started_at, completed_at, qc_result, qc_notes, rework_count,
                    assigned_to, notes, created_at, updated_at`;

// ── Templates ────────────────────────────────────────────────────────────────

interface WipStageTemplateRow {
  id: string;
  org_id: string;
  product_family: WipStageTemplate["productFamily"];
  sequence_number: number;
  stage_name: string;
  requires_qc_signoff: boolean;
  expected_duration_hours: string;
  responsible_role: string;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToTemplate(r: WipStageTemplateRow): WipStageTemplate {
  return {
    id: r.id,
    orgId: r.org_id,
    productFamily: r.product_family,
    sequenceNumber: r.sequence_number,
    stageName: r.stage_name,
    requiresQcSignoff: r.requires_qc_signoff,
    expectedDurationHours: r.expected_duration_hours,
    responsibleRole: r.responsible_role,
    notes: r.notes,
    isActive: r.is_active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const TEMPLATE_COLS = `id, org_id, product_family, sequence_number, stage_name,
                       requires_qc_signoff, expected_duration_hours,
                       responsible_role, notes, is_active, created_at, updated_at`;

// ── Repo ─────────────────────────────────────────────────────────────────────

export const workOrdersRepo = {
  // ── Header ─────────────────────────────────────────────────────────────────

  /**
   * Paginated list of work orders enriched with product master + embedded
   * stages[]. Two queries (header+product, then stages keyed by wo_id) so the
   * page never issues N+1 to render its `productName`/`productCode` columns
   * or the in-row stage progress chip.
   */
  async list(
    client: PoolClient,
    filters: WorkOrderListFilters,
    plan: PaginationPlan
  ): Promise<{ data: WorkOrderListItem[]; total: number }> {
    const where: string[] = ["wo.deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`wo.status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.priority) {
      where.push(`wo.priority = $${i}`);
      params.push(filters.priority);
      i++;
    }
    if (filters.productId) {
      where.push(`wo.product_id = $${i}`);
      params.push(filters.productId);
      i++;
    }
    if (filters.assignedTo) {
      where.push(`wo.assigned_to = $${i}`);
      params.push(filters.assignedTo);
      i++;
    }
    if (filters.dealId) {
      where.push(`wo.deal_id = $${i}`);
      params.push(filters.dealId);
      i++;
    }
    if (filters.from) {
      where.push(`wo.created_at >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`wo.created_at < ($${i}::date + interval '1 day')`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(wo.pid ILIKE $${i} OR wo.notes ILIKE $${i} OR wo.lot_number ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const woCols = SELECT_COLS.replace(/(\w+)/g, "wo.$1");
    // plan.orderBy is `col asc|desc` (see planPagination); prefix the column.
    const orderBy = `wo.${plan.orderBy}`;
    const countSql = `
      SELECT count(*)::bigint AS total
        FROM work_orders wo
       ${whereSql}
    `;
    const listSql = `
      SELECT ${woCols},
             p.product_code, p.name AS product_name, p.family AS product_family
        FROM work_orders wo
        JOIN products p ON p.id = wo.product_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<
        WorkOrderRow & {
          product_code: string;
          product_name: string;
          product_family: ProductFamily;
        }
      >(listSql, params),
    ]);
    if (listRes.rows.length === 0) {
      return { data: [], total: Number(countRes.rows[0]!.total) };
    }
    const woIds = listRes.rows.map((r) => r.id);
    const stagesRes = await client.query<WipStageRow>(
      `SELECT ${STAGE_COLS} FROM wip_stages
        WHERE wo_id = ANY($1::uuid[])
        ORDER BY wo_id, sequence_number ASC`,
      [woIds]
    );
    const stagesByWo = new Map<string, WipStage[]>();
    for (const s of stagesRes.rows) {
      const arr = stagesByWo.get(s.wo_id) ?? [];
      arr.push(rowToWipStage(s));
      stagesByWo.set(s.wo_id, arr);
    }
    return {
      data: listRes.rows.map((r) => ({
        ...rowToWorkOrder(r),
        productCode: r.product_code,
        productName: r.product_name,
        productFamily: r.product_family,
        stages: stagesByWo.get(r.id) ?? [],
      })),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<WorkOrder | null> {
    const { rows } = await client.query<WorkOrderRow>(
      `SELECT ${SELECT_COLS} FROM work_orders
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToWorkOrder(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    pid: string,
    createdBy: string | null,
    productId: string,
    bomId: string,
    bomVersionLabel: string,
    input: Omit<
      CreateWorkOrder,
      "pid" | "productId" | "bomId" | "deviceSerials"
    > & { deviceSerials?: string[] }
  ): Promise<WorkOrder> {
    const { rows } = await client.query<WorkOrderRow>(
      `INSERT INTO work_orders (
         org_id, pid, product_id, bom_id, bom_version_label, quantity,
         priority, target_date, deal_id, assigned_to, created_by,
         lot_number, device_serials, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        pid,
        productId,
        bomId,
        bomVersionLabel,
        input.quantity,
        input.priority ?? "NORMAL",
        input.targetDate ?? null,
        input.dealId ?? null,
        input.assignedTo ?? null,
        createdBy,
        input.lotNumber ?? null,
        input.deviceSerials ?? [],
        input.notes ?? null,
      ]
    );
    return rowToWorkOrder(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateWorkOrder
  ): Promise<WorkOrder | "version_conflict" | null> {
    const cur = await workOrdersRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.status !== undefined) {
      col("status", input.status);
      if (input.status === "IN_PROGRESS" && cur.startedAt === null) {
        col("started_at", new Date().toISOString());
      }
      if (input.status === "COMPLETED") {
        col("completed_at", new Date().toISOString());
      }
    }
    if (input.priority !== undefined) col("priority", input.priority);
    if (input.targetDate !== undefined) col("target_date", input.targetDate);
    if (input.assignedTo !== undefined) col("assigned_to", input.assignedTo);
    if (input.lotNumber !== undefined) col("lot_number", input.lotNumber);
    if (input.deviceSerials !== undefined)
      col("device_serials", input.deviceSerials);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<WorkOrderRow>(
      `UPDATE work_orders SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToWorkOrder(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE work_orders SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },

  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `UPDATE work_orders SET updated_at = now() WHERE id = $1`,
      [id]
    );
  },

  /** Service-layer-only: flip status atomically without version check. */
  async setStatus(
    client: PoolClient,
    id: string,
    status: WoStatus,
    extra: { startedAt?: boolean; completedAt?: boolean } = {}
  ): Promise<void> {
    const sets: string[] = ["status = $2", "updated_at = now()"];
    if (extra.startedAt) sets.push(`started_at = now()`);
    if (extra.completedAt) sets.push(`completed_at = now()`);
    await client.query(
      `UPDATE work_orders SET ${sets.join(", ")} WHERE id = $1`,
      [id, status]
    );
  },

  async setCurrentStageIndex(
    client: PoolClient,
    id: string,
    stageIndex: number
  ): Promise<void> {
    await client.query(
      `UPDATE work_orders
          SET current_stage_index = $2,
              updated_at = now()
        WHERE id = $1`,
      [id, stageIndex]
    );
  },

  async incrementReworkCount(
    client: PoolClient,
    id: string
  ): Promise<void> {
    await client.query(
      `UPDATE work_orders
          SET rework_count = rework_count + 1,
              updated_at = now()
        WHERE id = $1`,
      [id]
    );
  },

  // ── Stages ─────────────────────────────────────────────────────────────────

  async listStages(client: PoolClient, woId: string): Promise<WipStage[]> {
    const { rows } = await client.query<WipStageRow>(
      `SELECT ${STAGE_COLS} FROM wip_stages
        WHERE wo_id = $1 ORDER BY sequence_number ASC`,
      [woId]
    );
    return rows.map(rowToWipStage);
  },

  /**
   * Kanban-board projection: every non-cancelled, non-deleted WO joined with
   * its product master, plus every stage row keyed by wo_id. Two queries
   * (header+product, then all stages for the matching WOs) — the page never
   * issues N+1.
   */
  async listForBoard(client: PoolClient): Promise<WipBoardCard[]> {
    const woCols = SELECT_COLS.replace(/(\w+)/g, "wo.$1");
    const headerSql = `
      SELECT ${woCols},
             p.product_code, p.name AS product_name, p.family AS product_family
        FROM work_orders wo
        JOIN products p ON p.id = wo.product_id
       WHERE wo.deleted_at IS NULL
         AND wo.status <> 'CANCELLED'
       ORDER BY
         CASE wo.priority
           WHEN 'CRITICAL' THEN 1
           WHEN 'HIGH'     THEN 2
           WHEN 'NORMAL'   THEN 3
           WHEN 'LOW'      THEN 4
         END ASC,
         wo.target_date ASC NULLS LAST,
         wo.created_at DESC
       LIMIT 200
    `;
    const headerRes = await client.query<
      WorkOrderRow & {
        product_code: string;
        product_name: string;
        product_family: ProductFamily;
      }
    >(headerSql);
    if (headerRes.rows.length === 0) return [];
    const woIds = headerRes.rows.map((r) => r.id);
    const stagesRes = await client.query<WipStageRow>(
      `SELECT ${STAGE_COLS} FROM wip_stages
        WHERE wo_id = ANY($1::uuid[])
        ORDER BY wo_id, sequence_number ASC`,
      [woIds]
    );
    const stagesByWo = new Map<string, WipStage[]>();
    for (const s of stagesRes.rows) {
      const arr = stagesByWo.get(s.wo_id) ?? [];
      arr.push(rowToWipStage(s));
      stagesByWo.set(s.wo_id, arr);
    }
    return headerRes.rows.map((r) => ({
      ...rowToWorkOrder(r),
      productCode: r.product_code,
      productName: r.product_name,
      productFamily: r.product_family,
      stages: stagesByWo.get(r.id) ?? [],
    }));
  },

  async getStageById(
    client: PoolClient,
    id: string
  ): Promise<WipStage | null> {
    const { rows } = await client.query<WipStageRow>(
      `SELECT ${STAGE_COLS} FROM wip_stages WHERE id = $1`,
      [id]
    );
    return rows[0] ? rowToWipStage(rows[0]) : null;
  },

  async createStage(
    client: PoolClient,
    orgId: string,
    woId: string,
    template: WipStageTemplate,
    status: WipStageStatus
  ): Promise<WipStage> {
    const { rows } = await client.query<WipStageRow>(
      `INSERT INTO wip_stages (
         org_id, wo_id, template_id, sequence_number, stage_name,
         requires_qc_signoff, expected_duration_hours, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${STAGE_COLS}`,
      [
        orgId,
        woId,
        template.id,
        template.sequenceNumber,
        template.stageName,
        template.requiresQcSignoff,
        template.expectedDurationHours,
        status,
      ]
    );
    return rowToWipStage(rows[0]!);
  },

  async updateStageFields(
    client: PoolClient,
    id: string,
    fields: {
      status?: WipStageStatus;
      startedAt?: string | null | "now";
      completedAt?: string | null | "now";
      qcResult?: WipStageQcResult | null;
      qcNotes?: string | null;
      reworkCount?: number;
      assignedTo?: string | null;
      notes?: string | null;
    }
  ): Promise<WipStage | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (fields.status !== undefined) col("status", fields.status);
    if (fields.startedAt !== undefined) {
      if (fields.startedAt === "now") {
        sets.push(`started_at = now()`);
      } else {
        col("started_at", fields.startedAt);
      }
    }
    if (fields.completedAt !== undefined) {
      if (fields.completedAt === "now") {
        sets.push(`completed_at = now()`);
      } else {
        col("completed_at", fields.completedAt);
      }
    }
    if (fields.qcResult !== undefined) col("qc_result", fields.qcResult);
    if (fields.qcNotes !== undefined) col("qc_notes", fields.qcNotes);
    if (fields.reworkCount !== undefined)
      col("rework_count", fields.reworkCount);
    if (fields.assignedTo !== undefined) col("assigned_to", fields.assignedTo);
    if (fields.notes !== undefined) col("notes", fields.notes);
    sets.push(`updated_at = now()`);

    if (sets.length === 1) return workOrdersRepo.getStageById(client, id);

    params.push(id);
    const { rows } = await client.query<WipStageRow>(
      `UPDATE wip_stages SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${STAGE_COLS}`,
      params
    );
    return rows[0] ? rowToWipStage(rows[0]) : null;
  },

  // ── Templates ──────────────────────────────────────────────────────────────

  async listTemplates(
    client: PoolClient,
    productFamily?: WipStageTemplate["productFamily"]
  ): Promise<WipStageTemplate[]> {
    const params: unknown[] = [];
    let sql = `SELECT ${TEMPLATE_COLS} FROM wip_stage_templates WHERE is_active`;
    if (productFamily) {
      sql += ` AND product_family = $1`;
      params.push(productFamily);
    }
    sql += ` ORDER BY product_family ASC, sequence_number ASC`;
    const { rows } = await client.query<WipStageTemplateRow>(sql, params);
    return rows.map(rowToTemplate);
  },
};
