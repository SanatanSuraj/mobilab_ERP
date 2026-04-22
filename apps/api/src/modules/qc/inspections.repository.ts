/**
 * QC inspections repository (qc_inspections + qc_findings).
 *
 * Inspections have their own 4-state lifecycle (DRAFT → IN_PROGRESS →
 * PASSED | FAILED). Findings are the per-parameter measurements snapshot
 * from inspection_parameters at start time — the service layer seeds them
 * on DRAFT → IN_PROGRESS transition.
 *
 * Findings CRUD is sibling-of-header: service layer bumps inspection
 * version via touchHeader() after any finding mutation.
 */

import type { PoolClient } from "pg";
import type {
  CreateQcFinding,
  CreateQcInspection,
  QcFinding,
  QcFindingResult,
  QcInspection,
  QcInspectionKind,
  QcInspectionStatus,
  QcParameterType,
  QcSourceType,
  QcVerdict,
  UpdateQcFinding,
  UpdateQcInspection,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Inspection header ────────────────────────────────────────────────────────

interface InspectionRow {
  id: string;
  org_id: string;
  inspection_number: string;
  template_id: string | null;
  template_code: string | null;
  template_name: string | null;
  kind: QcInspectionKind;
  status: QcInspectionStatus;
  source_type: QcSourceType;
  source_id: string;
  source_label: string | null;
  grn_line_id: string | null;
  wip_stage_id: string | null;
  work_order_id: string | null;
  item_id: string | null;
  product_id: string | null;
  sample_size: number | null;
  inspector_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  verdict: QcVerdict | null;
  verdict_notes: string | null;
  notes: string | null;
  version: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToInspection(r: InspectionRow): QcInspection {
  return {
    id: r.id,
    orgId: r.org_id,
    inspectionNumber: r.inspection_number,
    templateId: r.template_id,
    templateCode: r.template_code,
    templateName: r.template_name,
    kind: r.kind,
    status: r.status,
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceLabel: r.source_label,
    grnLineId: r.grn_line_id,
    wipStageId: r.wip_stage_id,
    workOrderId: r.work_order_id,
    itemId: r.item_id,
    productId: r.product_id,
    sampleSize: r.sample_size,
    inspectorId: r.inspector_id,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    verdict: r.verdict,
    verdictNotes: r.verdict_notes,
    notes: r.notes,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, inspection_number, template_id, template_code,
                     template_name, kind, status, source_type, source_id,
                     source_label, grn_line_id, wip_stage_id, work_order_id,
                     item_id, product_id, sample_size, inspector_id,
                     started_at, completed_at, verdict, verdict_notes, notes,
                     version, created_by, created_at, updated_at, deleted_at`;

export interface InspectionListFilters {
  kind?: QcInspectionKind;
  status?: QcInspectionStatus;
  sourceType?: QcSourceType;
  workOrderId?: string;
  wipStageId?: string;
  grnLineId?: string;
  itemId?: string;
  productId?: string;
  inspectorId?: string;
  verdict?: QcVerdict;
  from?: string;
  to?: string;
  search?: string;
}

// ── Findings ─────────────────────────────────────────────────────────────────

interface FindingRow {
  id: string;
  org_id: string;
  inspection_id: string;
  parameter_id: string | null;
  sequence_number: number;
  parameter_name: string;
  parameter_type: QcParameterType;
  expected_value: string | null;
  min_value: string | null;
  max_value: string | null;
  expected_text: string | null;
  uom: string | null;
  is_critical: boolean;
  actual_value: string | null;
  actual_numeric: string | null;
  actual_boolean: boolean | null;
  result: QcFindingResult;
  inspector_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToFinding(r: FindingRow): QcFinding {
  return {
    id: r.id,
    orgId: r.org_id,
    inspectionId: r.inspection_id,
    parameterId: r.parameter_id,
    sequenceNumber: r.sequence_number,
    parameterName: r.parameter_name,
    parameterType: r.parameter_type,
    expectedValue: r.expected_value,
    minValue: r.min_value,
    maxValue: r.max_value,
    expectedText: r.expected_text,
    uom: r.uom,
    isCritical: r.is_critical,
    actualValue: r.actual_value,
    actualNumeric: r.actual_numeric,
    actualBoolean: r.actual_boolean,
    result: r.result,
    inspectorNotes: r.inspector_notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const FINDING_COLS = `id, org_id, inspection_id, parameter_id, sequence_number,
                      parameter_name, parameter_type, expected_value, min_value,
                      max_value, expected_text, uom, is_critical, actual_value,
                      actual_numeric, actual_boolean, result, inspector_notes,
                      created_at, updated_at`;

// ── Repo ─────────────────────────────────────────────────────────────────────

export const inspectionsRepo = {
  async list(
    client: PoolClient,
    filters: InspectionListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: QcInspection[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.kind) {
      where.push(`kind = $${i}`);
      params.push(filters.kind);
      i++;
    }
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.sourceType) {
      where.push(`source_type = $${i}`);
      params.push(filters.sourceType);
      i++;
    }
    if (filters.workOrderId) {
      where.push(`work_order_id = $${i}`);
      params.push(filters.workOrderId);
      i++;
    }
    if (filters.wipStageId) {
      where.push(`wip_stage_id = $${i}`);
      params.push(filters.wipStageId);
      i++;
    }
    if (filters.grnLineId) {
      where.push(`grn_line_id = $${i}`);
      params.push(filters.grnLineId);
      i++;
    }
    if (filters.itemId) {
      where.push(`item_id = $${i}`);
      params.push(filters.itemId);
      i++;
    }
    if (filters.productId) {
      where.push(`product_id = $${i}`);
      params.push(filters.productId);
      i++;
    }
    if (filters.inspectorId) {
      where.push(`inspector_id = $${i}`);
      params.push(filters.inspectorId);
      i++;
    }
    if (filters.verdict) {
      where.push(`verdict = $${i}`);
      params.push(filters.verdict);
      i++;
    }
    if (filters.from) {
      where.push(`created_at >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`created_at < ($${i}::date + interval '1 day')`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(inspection_number ILIKE $${i} OR template_name ILIKE $${i} OR source_label ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM qc_inspections ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM qc_inspections
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<InspectionRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToInspection),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string,
  ): Promise<QcInspection | null> {
    const { rows } = await client.query<InspectionRow>(
      `SELECT ${SELECT_COLS} FROM qc_inspections
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToInspection(rows[0]) : null;
  },

  async getByNumber(
    client: PoolClient,
    number: string,
  ): Promise<QcInspection | null> {
    const { rows } = await client.query<InspectionRow>(
      `SELECT ${SELECT_COLS} FROM qc_inspections
        WHERE inspection_number = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [number],
    );
    return rows[0] ? rowToInspection(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    inspectionNumber: string,
    createdBy: string | null,
    input: Omit<CreateQcInspection, "inspectionNumber"> & {
      templateCode?: string | null;
      templateName?: string | null;
    },
  ): Promise<QcInspection> {
    const { rows } = await client.query<InspectionRow>(
      `INSERT INTO qc_inspections (
         org_id, inspection_number, template_id, template_code, template_name,
         kind, source_type, source_id, source_label, grn_line_id, wip_stage_id,
         work_order_id, item_id, product_id, sample_size, inspector_id, notes,
         created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        inspectionNumber,
        input.templateId ?? null,
        input.templateCode ?? null,
        input.templateName ?? null,
        input.kind,
        input.sourceType,
        input.sourceId,
        input.sourceLabel ?? null,
        input.grnLineId ?? null,
        input.wipStageId ?? null,
        input.workOrderId ?? null,
        input.itemId ?? null,
        input.productId ?? null,
        input.sampleSize ?? null,
        input.inspectorId ?? null,
        input.notes ?? null,
        createdBy,
      ],
    );
    return rowToInspection(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateQcInspection,
  ): Promise<QcInspection | "version_conflict" | null> {
    const cur = await inspectionsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.status !== undefined) col("status", input.status);
    if (input.inspectorId !== undefined) col("inspector_id", input.inspectorId);
    if (input.startedAt !== undefined) col("started_at", input.startedAt);
    if (input.completedAt !== undefined) col("completed_at", input.completedAt);
    if (input.verdict !== undefined) col("verdict", input.verdict);
    if (input.verdictNotes !== undefined)
      col("verdict_notes", input.verdictNotes);
    if (input.sampleSize !== undefined) col("sample_size", input.sampleSize);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<InspectionRow>(
      `UPDATE qc_inspections SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params,
    );
    if (!rows[0]) return "version_conflict";
    return rowToInspection(rows[0]);
  },

  /** Service-layer-only: flip status + lifecycle timestamps atomically. */
  async setStatus(
    client: PoolClient,
    id: string,
    status: QcInspectionStatus,
    extra: {
      startedAt?: boolean;
      completedAt?: boolean;
      inspectorId?: string | null;
      verdict?: QcVerdict | null;
      verdictNotes?: string | null;
    } = {},
  ): Promise<QcInspection | null> {
    const sets: string[] = [`status = $2`, `updated_at = now()`];
    const params: unknown[] = [id, status];
    let i = 3;
    if (extra.startedAt) sets.push(`started_at = now()`);
    if (extra.completedAt) sets.push(`completed_at = now()`);
    if (extra.inspectorId !== undefined) {
      sets.push(`inspector_id = $${i++}`);
      params.push(extra.inspectorId);
    }
    if (extra.verdict !== undefined) {
      sets.push(`verdict = $${i++}`);
      params.push(extra.verdict);
    }
    if (extra.verdictNotes !== undefined) {
      sets.push(`verdict_notes = $${i++}`);
      params.push(extra.verdictNotes);
    }
    const { rows } = await client.query<InspectionRow>(
      `UPDATE qc_inspections SET ${sets.join(", ")}
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params,
    );
    return rows[0] ? rowToInspection(rows[0]) : null;
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE qc_inspections SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },

  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `UPDATE qc_inspections SET updated_at = now() WHERE id = $1`,
      [id],
    );
  },

  // ── Findings ───────────────────────────────────────────────────────────────

  async listFindings(
    client: PoolClient,
    inspectionId: string,
  ): Promise<QcFinding[]> {
    const { rows } = await client.query<FindingRow>(
      `SELECT ${FINDING_COLS} FROM qc_findings
        WHERE inspection_id = $1 ORDER BY sequence_number ASC`,
      [inspectionId],
    );
    return rows.map(rowToFinding);
  },

  async getFindingById(
    client: PoolClient,
    id: string,
  ): Promise<QcFinding | null> {
    const { rows } = await client.query<FindingRow>(
      `SELECT ${FINDING_COLS} FROM qc_findings WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToFinding(rows[0]) : null;
  },

  async nextFindingSeq(
    client: PoolClient,
    inspectionId: string,
  ): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next
         FROM qc_findings WHERE inspection_id = $1`,
      [inspectionId],
    );
    return rows[0]!.next;
  },

  async addFinding(
    client: PoolClient,
    orgId: string,
    inspectionId: string,
    input: CreateQcFinding,
  ): Promise<QcFinding> {
    const seq =
      input.sequenceNumber ??
      (await inspectionsRepo.nextFindingSeq(client, inspectionId));
    const { rows } = await client.query<FindingRow>(
      `INSERT INTO qc_findings (
         org_id, inspection_id, parameter_id, sequence_number, parameter_name,
         parameter_type, expected_value, min_value, max_value, expected_text,
         uom, is_critical, actual_value, actual_numeric, actual_boolean,
         result, inspector_notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING ${FINDING_COLS}`,
      [
        orgId,
        inspectionId,
        input.parameterId ?? null,
        seq,
        input.parameterName,
        input.parameterType,
        input.expectedValue ?? null,
        input.minValue ?? null,
        input.maxValue ?? null,
        input.expectedText ?? null,
        input.uom ?? null,
        input.isCritical ?? false,
        input.actualValue ?? null,
        input.actualNumeric ?? null,
        input.actualBoolean ?? null,
        input.result ?? "PENDING",
        input.inspectorNotes ?? null,
      ],
    );
    return rowToFinding(rows[0]!);
  },

  async updateFinding(
    client: PoolClient,
    findingId: string,
    input: UpdateQcFinding,
  ): Promise<QcFinding | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.actualValue !== undefined) col("actual_value", input.actualValue);
    if (input.actualNumeric !== undefined)
      col("actual_numeric", input.actualNumeric);
    if (input.actualBoolean !== undefined)
      col("actual_boolean", input.actualBoolean);
    if (input.result !== undefined) col("result", input.result);
    if (input.inspectorNotes !== undefined)
      col("inspector_notes", input.inspectorNotes);
    if (sets.length === 0) return inspectionsRepo.getFindingById(client, findingId);

    params.push(findingId);
    const { rows } = await client.query<FindingRow>(
      `UPDATE qc_findings SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${FINDING_COLS}`,
      params,
    );
    return rows[0] ? rowToFinding(rows[0]) : null;
  },

  async deleteFinding(
    client: PoolClient,
    findingId: string,
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM qc_findings WHERE id = $1`,
      [findingId],
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Service-layer: summary of findings for a given inspection. Used to
   * compute the verdict (pass/fail) automatically if the caller doesn't
   * supply one. If any CRITICAL finding is FAIL, verdict is FAIL; else
   * if any finding is FAIL, verdict is FAIL; else PASS.
   */
  async summarise(
    client: PoolClient,
    inspectionId: string,
  ): Promise<{
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    pending: number;
    criticalFailed: number;
  }> {
    const { rows } = await client.query<{
      total: string;
      passed: string;
      failed: string;
      skipped: string;
      pending: string;
      critical_failed: string;
    }>(
      `SELECT count(*)::bigint AS total,
              sum(CASE WHEN result = 'PASS' THEN 1 ELSE 0 END)::bigint AS passed,
              sum(CASE WHEN result = 'FAIL' THEN 1 ELSE 0 END)::bigint AS failed,
              sum(CASE WHEN result = 'SKIPPED' THEN 1 ELSE 0 END)::bigint AS skipped,
              sum(CASE WHEN result = 'PENDING' THEN 1 ELSE 0 END)::bigint AS pending,
              sum(CASE WHEN is_critical AND result = 'FAIL' THEN 1 ELSE 0 END)::bigint AS critical_failed
         FROM qc_findings
        WHERE inspection_id = $1`,
      [inspectionId],
    );
    const row = rows[0]!;
    return {
      total: Number(row.total),
      passed: Number(row.passed),
      failed: Number(row.failed),
      skipped: Number(row.skipped),
      pending: Number(row.pending),
      criticalFailed: Number(row.critical_failed),
    };
  },
};
