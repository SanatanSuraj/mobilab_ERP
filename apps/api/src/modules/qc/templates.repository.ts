/**
 * Inspection templates repository. Header (inspection_templates) + parameters
 * (inspection_parameters). Pattern-matches boms.repository.ts.
 *
 * Templates are scoped by `kind` (IQC / SUB_QC / FINAL_QC) and bind to the
 * relevant entity (item for IQC, wip_stage_template for SUB_QC, product for
 * FINAL_QC). Service layer orchestrates parameter CRUD + header version bumps.
 */

import type { PoolClient } from "pg";
import type {
  CreateInspectionParameter,
  CreateInspectionTemplate,
  InspectionParameter,
  InspectionTemplate,
  ProductFamily,
  QcInspectionKind,
  QcParameterType,
  UpdateInspectionParameter,
  UpdateInspectionTemplate,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

// ── Template header ──────────────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  org_id: string;
  code: string;
  name: string;
  kind: QcInspectionKind;
  product_family: ProductFamily | null;
  wip_stage_template_id: string | null;
  item_id: string | null;
  product_id: string | null;
  description: string | null;
  sampling_plan: string | null;
  is_active: boolean;
  version: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToTemplate(r: TemplateRow): InspectionTemplate {
  return {
    id: r.id,
    orgId: r.org_id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    productFamily: r.product_family,
    wipStageTemplateId: r.wip_stage_template_id,
    itemId: r.item_id,
    productId: r.product_id,
    description: r.description,
    samplingPlan: r.sampling_plan,
    isActive: r.is_active,
    version: r.version,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, code, name, kind, product_family,
                     wip_stage_template_id, item_id, product_id, description,
                     sampling_plan, is_active, version, created_by, created_at,
                     updated_at, deleted_at`;

export interface TemplateListFilters {
  kind?: QcInspectionKind;
  productFamily?: ProductFamily;
  itemId?: string;
  productId?: string;
  wipStageTemplateId?: string;
  isActive?: boolean;
  search?: string;
}

// ── Parameter ────────────────────────────────────────────────────────────────

interface ParameterRow {
  id: string;
  org_id: string;
  template_id: string;
  sequence_number: number;
  name: string;
  parameter_type: QcParameterType;
  expected_value: string | null;
  min_value: string | null;
  max_value: string | null;
  expected_text: string | null;
  uom: string | null;
  is_critical: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToParameter(r: ParameterRow): InspectionParameter {
  return {
    id: r.id,
    orgId: r.org_id,
    templateId: r.template_id,
    sequenceNumber: r.sequence_number,
    name: r.name,
    parameterType: r.parameter_type,
    expectedValue: r.expected_value,
    minValue: r.min_value,
    maxValue: r.max_value,
    expectedText: r.expected_text,
    uom: r.uom,
    isCritical: r.is_critical,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const PARAMETER_COLS = `id, org_id, template_id, sequence_number, name,
                        parameter_type, expected_value, min_value, max_value,
                        expected_text, uom, is_critical, notes, created_at,
                        updated_at`;

// ── Repo ─────────────────────────────────────────────────────────────────────

export const templatesRepo = {
  // ── Header ─────────────────────────────────────────────────────────────────

  async list(
    client: PoolClient,
    filters: TemplateListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: InspectionTemplate[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.kind) {
      where.push(`kind = $${i}`);
      params.push(filters.kind);
      i++;
    }
    if (filters.productFamily) {
      where.push(`product_family = $${i}`);
      params.push(filters.productFamily);
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
    if (filters.wipStageTemplateId) {
      where.push(`wip_stage_template_id = $${i}`);
      params.push(filters.wipStageTemplateId);
      i++;
    }
    if (filters.isActive !== undefined) {
      where.push(`is_active = $${i}`);
      params.push(filters.isActive);
      i++;
    }
    if (filters.search) {
      where.push(`(code ILIKE $${i} OR name ILIKE $${i} OR description ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM inspection_templates ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM inspection_templates
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
  ): Promise<InspectionTemplate | null> {
    const { rows } = await client.query<TemplateRow>(
      `SELECT ${SELECT_COLS} FROM inspection_templates
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToTemplate(rows[0]) : null;
  },

  async getByCode(
    client: PoolClient,
    code: string,
  ): Promise<InspectionTemplate | null> {
    const { rows } = await client.query<TemplateRow>(
      `SELECT ${SELECT_COLS} FROM inspection_templates
        WHERE lower(code) = lower($1) AND deleted_at IS NULL
        LIMIT 1`,
      [code],
    );
    return rows[0] ? rowToTemplate(rows[0]) : null;
  },

  async createHeader(
    client: PoolClient,
    orgId: string,
    createdBy: string | null,
    input: Omit<CreateInspectionTemplate, "parameters">,
  ): Promise<InspectionTemplate> {
    const { rows } = await client.query<TemplateRow>(
      `INSERT INTO inspection_templates (
         org_id, code, name, kind, product_family, wip_stage_template_id,
         item_id, product_id, description, sampling_plan, is_active, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.code,
        input.name,
        input.kind,
        input.productFamily ?? null,
        input.wipStageTemplateId ?? null,
        input.itemId ?? null,
        input.productId ?? null,
        input.description ?? null,
        input.samplingPlan ?? null,
        input.isActive ?? true,
        createdBy,
      ],
    );
    return rowToTemplate(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateInspectionTemplate,
  ): Promise<InspectionTemplate | "version_conflict" | null> {
    const cur = await templatesRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.code !== undefined) col("code", input.code);
    if (input.name !== undefined) col("name", input.name);
    if (input.productFamily !== undefined)
      col("product_family", input.productFamily);
    if (input.wipStageTemplateId !== undefined)
      col("wip_stage_template_id", input.wipStageTemplateId);
    if (input.itemId !== undefined) col("item_id", input.itemId);
    if (input.productId !== undefined) col("product_id", input.productId);
    if (input.description !== undefined) col("description", input.description);
    if (input.samplingPlan !== undefined)
      col("sampling_plan", input.samplingPlan);
    if (input.isActive !== undefined) col("is_active", input.isActive);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<TemplateRow>(
      `UPDATE inspection_templates SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params,
    );
    if (!rows[0]) return "version_conflict";
    return rowToTemplate(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE inspection_templates SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },

  async touchHeader(client: PoolClient, id: string): Promise<void> {
    await client.query(
      `UPDATE inspection_templates SET updated_at = now() WHERE id = $1`,
      [id],
    );
  },

  // ── Parameters ─────────────────────────────────────────────────────────────

  async listParameters(
    client: PoolClient,
    templateId: string,
  ): Promise<InspectionParameter[]> {
    const { rows } = await client.query<ParameterRow>(
      `SELECT ${PARAMETER_COLS} FROM inspection_parameters
        WHERE template_id = $1 ORDER BY sequence_number ASC`,
      [templateId],
    );
    return rows.map(rowToParameter);
  },

  async getParameterById(
    client: PoolClient,
    id: string,
  ): Promise<InspectionParameter | null> {
    const { rows } = await client.query<ParameterRow>(
      `SELECT ${PARAMETER_COLS} FROM inspection_parameters WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToParameter(rows[0]) : null;
  },

  async nextParameterSeq(
    client: PoolClient,
    templateId: string,
  ): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next
         FROM inspection_parameters WHERE template_id = $1`,
      [templateId],
    );
    return rows[0]!.next;
  },

  async addParameter(
    client: PoolClient,
    orgId: string,
    templateId: string,
    input: CreateInspectionParameter,
  ): Promise<InspectionParameter> {
    const seq =
      input.sequenceNumber ??
      (await templatesRepo.nextParameterSeq(client, templateId));
    const { rows } = await client.query<ParameterRow>(
      `INSERT INTO inspection_parameters (
         org_id, template_id, sequence_number, name, parameter_type,
         expected_value, min_value, max_value, expected_text, uom,
         is_critical, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${PARAMETER_COLS}`,
      [
        orgId,
        templateId,
        seq,
        input.name,
        input.parameterType,
        input.expectedValue ?? null,
        input.minValue ?? null,
        input.maxValue ?? null,
        input.expectedText ?? null,
        input.uom ?? null,
        input.isCritical ?? false,
        input.notes ?? null,
      ],
    );
    return rowToParameter(rows[0]!);
  },

  async updateParameter(
    client: PoolClient,
    parameterId: string,
    input: UpdateInspectionParameter,
  ): Promise<InspectionParameter | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.sequenceNumber !== undefined)
      col("sequence_number", input.sequenceNumber);
    if (input.name !== undefined) col("name", input.name);
    if (input.parameterType !== undefined)
      col("parameter_type", input.parameterType);
    if (input.expectedValue !== undefined)
      col("expected_value", input.expectedValue);
    if (input.minValue !== undefined) col("min_value", input.minValue);
    if (input.maxValue !== undefined) col("max_value", input.maxValue);
    if (input.expectedText !== undefined)
      col("expected_text", input.expectedText);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.isCritical !== undefined) col("is_critical", input.isCritical);
    if (input.notes !== undefined) col("notes", input.notes);
    if (sets.length === 0) return templatesRepo.getParameterById(client, parameterId);

    params.push(parameterId);
    const { rows } = await client.query<ParameterRow>(
      `UPDATE inspection_parameters SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING ${PARAMETER_COLS}`,
      params,
    );
    return rows[0] ? rowToParameter(rows[0]) : null;
  },

  async deleteParameter(
    client: PoolClient,
    parameterId: string,
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `DELETE FROM inspection_parameters WHERE id = $1`,
      [parameterId],
    );
    return (rowCount ?? 0) > 0;
  },
};
