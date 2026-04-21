/**
 * QC contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §13.4. Matches ops/sql/init/06-qc.sql.
 *
 * Scope (Phase 2):
 *   - inspection_templates (+ inspection_parameters)
 *   - qc_inspections (+ qc_findings)
 *   - qc_certs
 *
 * Explicitly deferred to Phase 3:
 *   - NCR workflow (OPEN → INVESTIGATION → RCA_SIGNED → DISPOSITION → CLOSED)
 *   - CAPA management + 8D reports
 *   - Calibration schedules + calibration logs
 *   - Failure-mode catalogue / defect taxonomy master tables
 *   - Statistical process control (SPC) charts
 *
 * Rules (same as production.ts):
 *   - Measurement values are decimal-strings. NEVER Number().
 *   - Enums are UPPER_SNAKE to match DB CHECK constraints.
 *   - Headers have optimistic concurrency via expectedVersion.
 *   - Finding CRUD is siblings-of-header: separate endpoints, bumps
 *     header.version via service-layer side-effects.
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";
import { ProductFamilySchema } from "./production.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** NUMERIC(18,4) measurement value — four decimals for instrument outputs. */
const measurementStr = z
  .string()
  .trim()
  .regex(
    /^-?\d+(\.\d{1,4})?$/u,
    'must be a measurement string like "120.0000" (up to 4 decimals)',
  );

const uuid = z.string().uuid();

// ─── Enums ───────────────────────────────────────────────────────────────────

export const QC_INSPECTION_KINDS = ["IQC", "SUB_QC", "FINAL_QC"] as const;
export const QcInspectionKindSchema = z.enum(QC_INSPECTION_KINDS);
export type QcInspectionKind = z.infer<typeof QcInspectionKindSchema>;

export const QC_INSPECTION_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "PASSED",
  "FAILED",
] as const;
export const QcInspectionStatusSchema = z.enum(QC_INSPECTION_STATUSES);
export type QcInspectionStatus = z.infer<typeof QcInspectionStatusSchema>;

export const QC_SOURCE_TYPES = ["GRN_LINE", "WIP_STAGE", "WO"] as const;
export const QcSourceTypeSchema = z.enum(QC_SOURCE_TYPES);
export type QcSourceType = z.infer<typeof QcSourceTypeSchema>;

export const QC_VERDICTS = ["PASS", "FAIL"] as const;
export const QcVerdictSchema = z.enum(QC_VERDICTS);
export type QcVerdict = z.infer<typeof QcVerdictSchema>;

export const QC_PARAMETER_TYPES = [
  "NUMERIC",
  "TEXT",
  "BOOLEAN",
  "CHECKBOX",
] as const;
export const QcParameterTypeSchema = z.enum(QC_PARAMETER_TYPES);
export type QcParameterType = z.infer<typeof QcParameterTypeSchema>;

export const QC_FINDING_RESULTS = ["PENDING", "PASS", "FAIL", "SKIPPED"] as const;
export const QcFindingResultSchema = z.enum(QC_FINDING_RESULTS);
export type QcFindingResult = z.infer<typeof QcFindingResultSchema>;

export const QC_NUMBER_KINDS = ["QC", "QCC"] as const;
export const QcNumberKindSchema = z.enum(QC_NUMBER_KINDS);
export type QcNumberKind = z.infer<typeof QcNumberKindSchema>;

// ─── Inspection Templates + Parameters ──────────────────────────────────────

export const InspectionParameterSchema = z.object({
  id: uuid,
  orgId: uuid,
  templateId: uuid,
  sequenceNumber: z.number().int().positive(),
  name: z.string(),
  parameterType: QcParameterTypeSchema,
  expectedValue: measurementStr.nullable(),
  minValue: measurementStr.nullable(),
  maxValue: measurementStr.nullable(),
  expectedText: z.string().nullable(),
  uom: z.string().nullable(),
  isCritical: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InspectionParameter = z.infer<typeof InspectionParameterSchema>;

export const InspectionTemplateSchema = z.object({
  id: uuid,
  orgId: uuid,
  code: z.string(),
  name: z.string(),
  kind: QcInspectionKindSchema,
  productFamily: ProductFamilySchema.nullable(),
  wipStageTemplateId: uuid.nullable(),
  itemId: uuid.nullable(),
  productId: uuid.nullable(),
  description: z.string().nullable(),
  samplingPlan: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdBy: uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type InspectionTemplate = z.infer<typeof InspectionTemplateSchema>;

export const InspectionTemplateWithParametersSchema =
  InspectionTemplateSchema.extend({
    parameters: z.array(InspectionParameterSchema),
  });
export type InspectionTemplateWithParameters = z.infer<
  typeof InspectionTemplateWithParametersSchema
>;

export const CreateInspectionParameterSchema = z.object({
  sequenceNumber: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(200),
  parameterType: QcParameterTypeSchema,
  expectedValue: measurementStr.optional(),
  minValue: measurementStr.optional(),
  maxValue: measurementStr.optional(),
  expectedText: z.string().trim().max(2000).optional(),
  uom: z.string().trim().max(32).optional(),
  isCritical: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateInspectionParameter = z.infer<
  typeof CreateInspectionParameterSchema
>;

export const UpdateInspectionParameterSchema =
  CreateInspectionParameterSchema.partial();
export type UpdateInspectionParameter = z.infer<
  typeof UpdateInspectionParameterSchema
>;

export const CreateInspectionTemplateSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  kind: QcInspectionKindSchema,
  productFamily: ProductFamilySchema.optional(),
  wipStageTemplateId: uuid.optional(),
  itemId: uuid.optional(),
  productId: uuid.optional(),
  description: z.string().trim().max(2000).optional(),
  samplingPlan: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
  parameters: z.array(CreateInspectionParameterSchema).default([]),
});
export type CreateInspectionTemplate = z.infer<
  typeof CreateInspectionTemplateSchema
>;

export const UpdateInspectionTemplateSchema = z.object({
  code: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  productFamily: ProductFamilySchema.optional(),
  wipStageTemplateId: uuid.optional(),
  itemId: uuid.optional(),
  productId: uuid.optional(),
  description: z.string().trim().max(2000).optional(),
  samplingPlan: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateInspectionTemplate = z.infer<
  typeof UpdateInspectionTemplateSchema
>;

export const InspectionTemplateListQuerySchema = PaginationQuerySchema.extend({
  kind: QcInspectionKindSchema.optional(),
  productFamily: ProductFamilySchema.optional(),
  itemId: uuid.optional(),
  productId: uuid.optional(),
  wipStageTemplateId: uuid.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── QC Inspections + Findings ──────────────────────────────────────────────

export const QcFindingSchema = z.object({
  id: uuid,
  orgId: uuid,
  inspectionId: uuid,
  parameterId: uuid.nullable(),
  sequenceNumber: z.number().int().positive(),
  parameterName: z.string(),
  parameterType: QcParameterTypeSchema,
  expectedValue: measurementStr.nullable(),
  minValue: measurementStr.nullable(),
  maxValue: measurementStr.nullable(),
  expectedText: z.string().nullable(),
  uom: z.string().nullable(),
  isCritical: z.boolean(),
  actualValue: z.string().nullable(),
  actualNumeric: measurementStr.nullable(),
  actualBoolean: z.boolean().nullable(),
  result: QcFindingResultSchema,
  inspectorNotes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QcFinding = z.infer<typeof QcFindingSchema>;

export const QcInspectionSchema = z.object({
  id: uuid,
  orgId: uuid,
  inspectionNumber: z.string(),
  templateId: uuid.nullable(),
  templateCode: z.string().nullable(),
  templateName: z.string().nullable(),
  kind: QcInspectionKindSchema,
  status: QcInspectionStatusSchema,
  sourceType: QcSourceTypeSchema,
  sourceId: uuid,
  sourceLabel: z.string().nullable(),
  grnLineId: uuid.nullable(),
  wipStageId: uuid.nullable(),
  workOrderId: uuid.nullable(),
  itemId: uuid.nullable(),
  productId: uuid.nullable(),
  sampleSize: z.number().int().positive().nullable(),
  inspectorId: uuid.nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  verdict: QcVerdictSchema.nullable(),
  verdictNotes: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdBy: uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type QcInspection = z.infer<typeof QcInspectionSchema>;

export const QcInspectionWithFindingsSchema = QcInspectionSchema.extend({
  findings: z.array(QcFindingSchema),
});
export type QcInspectionWithFindings = z.infer<
  typeof QcInspectionWithFindingsSchema
>;

export const CreateQcInspectionSchema = z.object({
  /** Optional — service auto-generates QC-YYYY-NNNN via qc_number_sequences if absent. */
  inspectionNumber: z.string().trim().min(1).max(32).optional(),
  templateId: uuid.optional(),
  kind: QcInspectionKindSchema,
  sourceType: QcSourceTypeSchema,
  sourceId: uuid,
  sourceLabel: z.string().trim().max(200).optional(),
  grnLineId: uuid.optional(),
  wipStageId: uuid.optional(),
  workOrderId: uuid.optional(),
  itemId: uuid.optional(),
  productId: uuid.optional(),
  sampleSize: z.number().int().positive().optional(),
  inspectorId: uuid.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateQcInspection = z.infer<typeof CreateQcInspectionSchema>;

export const UpdateQcInspectionSchema = z.object({
  status: QcInspectionStatusSchema.optional(),
  inspectorId: uuid.optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  verdict: QcVerdictSchema.optional(),
  verdictNotes: z.string().trim().max(2000).optional(),
  sampleSize: z.number().int().positive().optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateQcInspection = z.infer<typeof UpdateQcInspectionSchema>;

export const QcInspectionListQuerySchema = PaginationQuerySchema.extend({
  kind: QcInspectionKindSchema.optional(),
  status: QcInspectionStatusSchema.optional(),
  sourceType: QcSourceTypeSchema.optional(),
  workOrderId: uuid.optional(),
  wipStageId: uuid.optional(),
  grnLineId: uuid.optional(),
  itemId: uuid.optional(),
  productId: uuid.optional(),
  inspectorId: uuid.optional(),
  verdict: QcVerdictSchema.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Findings mutations ─────────────────────────────────────────────────────

export const CreateQcFindingSchema = z.object({
  parameterId: uuid.optional(),
  sequenceNumber: z.number().int().positive().optional(),
  parameterName: z.string().trim().min(1).max(200),
  parameterType: QcParameterTypeSchema,
  expectedValue: measurementStr.optional(),
  minValue: measurementStr.optional(),
  maxValue: measurementStr.optional(),
  expectedText: z.string().trim().max(2000).optional(),
  uom: z.string().trim().max(32).optional(),
  isCritical: z.boolean().default(false),
  actualValue: z.string().trim().max(2000).optional(),
  actualNumeric: measurementStr.optional(),
  actualBoolean: z.boolean().optional(),
  result: QcFindingResultSchema.default("PENDING"),
  inspectorNotes: z.string().trim().max(2000).optional(),
});
export type CreateQcFinding = z.infer<typeof CreateQcFindingSchema>;

export const UpdateQcFindingSchema = z.object({
  actualValue: z.string().trim().max(2000).optional(),
  actualNumeric: measurementStr.optional(),
  actualBoolean: z.boolean().optional(),
  result: QcFindingResultSchema.optional(),
  inspectorNotes: z.string().trim().max(2000).optional(),
});
export type UpdateQcFinding = z.infer<typeof UpdateQcFindingSchema>;

/**
 * StartQcInspection — service transitions DRAFT → IN_PROGRESS, auto-seeds
 * findings from the template, sets startedAt, binds inspectorId.
 */
export const StartQcInspectionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  inspectorId: uuid.optional(),
});
export type StartQcInspection = z.infer<typeof StartQcInspectionSchema>;

/**
 * CompleteQcInspection — service transitions IN_PROGRESS → PASSED | FAILED
 * based on verdict, sets completedAt, locks findings.
 */
export const CompleteQcInspectionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  verdict: QcVerdictSchema,
  verdictNotes: z.string().trim().max(2000).optional(),
});
export type CompleteQcInspection = z.infer<typeof CompleteQcInspectionSchema>;

// ─── QC Certificates ────────────────────────────────────────────────────────

export const QcCertSchema = z.object({
  id: uuid,
  orgId: uuid,
  certNumber: z.string(),
  inspectionId: uuid,
  workOrderId: uuid.nullable(),
  productId: uuid.nullable(),
  productName: z.string().nullable(),
  woPid: z.string().nullable(),
  deviceSerials: z.array(z.string()),
  issuedAt: z.string(),
  signedBy: uuid.nullable(),
  signedByName: z.string().nullable(),
  signatureHash: z.string().nullable(),
  pdfMinioKey: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type QcCert = z.infer<typeof QcCertSchema>;

export const IssueQcCertSchema = z.object({
  inspectionId: uuid,
  /** Optional — service auto-generates QCC-YYYY-NNNN via qc_number_sequences if absent. */
  certNumber: z.string().trim().min(1).max(32).optional(),
  signedBy: uuid.optional(),
  signedByName: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type IssueQcCert = z.infer<typeof IssueQcCertSchema>;

export const QcCertListQuerySchema = PaginationQuerySchema.extend({
  workOrderId: uuid.optional(),
  productId: uuid.optional(),
  inspectionId: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
