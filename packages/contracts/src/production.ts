/**
 * Production contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §13.2. Matches ops/sql/init/05-production.sql.
 *
 * Scope (Phase 2):
 *   - products (master)
 *   - bom_versions (+ bom_lines)
 *   - wip_stage_templates (per product_family)
 *   - work_orders (+ wip_stages)
 *
 * Explicitly deferred to Phase 3: ECN workflow, BMR dual-sign, scrap, downtime,
 * OEE, MRP atomic reservation, shop-floor live view, operator capability,
 * assembly lines L1-L5, dedicated device_ids 13-state lifecycle.
 *
 * Rules (same as crm.ts / inventory.ts / procurement.ts):
 *   - Money + quantities are decimal-strings. NEVER Number().
 *   - Enums are UPPER_SNAKE to match DB CHECK constraints.
 *   - Headers have optimistic concurrency via expectedVersion.
 *   - Line CRUD is siblings-of-header: separate endpoints, bumps header.version
 *     via service-layer side-effects.
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** NUMERIC(18,2) money-style. */
const decimalStr = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/u, 'must be a decimal string like "1000.50"');

/** NUMERIC(18,3) quantity — three decimals for metres / grams. */
const qtyStr = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,3})?$/u, 'must be a quantity string like "12.500"');

/** NUMERIC(10,2) duration in hours. */
const hoursStr = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/u, 'must be a non-negative hours string like "4.50"');

const uuid = z.string().uuid();

// ─── Enums ───────────────────────────────────────────────────────────────────

export const PRODUCT_FAMILIES = [
  "MODULE",
  "DEVICE",
  "REAGENT",
  "CONSUMABLE",
] as const;
export const ProductFamilySchema = z.enum(PRODUCT_FAMILIES);
export type ProductFamily = z.infer<typeof ProductFamilySchema>;

export const BOM_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "SUPERSEDED",
  "OBSOLETE",
] as const;
export const BomStatusSchema = z.enum(BOM_STATUSES);
export type BomStatus = z.infer<typeof BomStatusSchema>;

export const BOM_LINE_TRACKING_TYPES = ["SERIAL", "BATCH", "NONE"] as const;
export const BomLineTrackingTypeSchema = z.enum(BOM_LINE_TRACKING_TYPES);
export type BomLineTrackingType = z.infer<typeof BomLineTrackingTypeSchema>;

export const WO_STATUSES = [
  "PLANNED",
  "MATERIAL_CHECK",
  "IN_PROGRESS",
  "QC_HOLD",
  "REWORK",
  "COMPLETED",
  "CANCELLED",
] as const;
export const WoStatusSchema = z.enum(WO_STATUSES);
export type WoStatus = z.infer<typeof WoStatusSchema>;

export const WO_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export const WoPrioritySchema = z.enum(WO_PRIORITIES);
export type WoPriority = z.infer<typeof WoPrioritySchema>;

export const WIP_STAGE_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "QC_HOLD",
  "REWORK",
  "COMPLETED",
] as const;
export const WipStageStatusSchema = z.enum(WIP_STAGE_STATUSES);
export type WipStageStatus = z.infer<typeof WipStageStatusSchema>;

export const WIP_STAGE_QC_RESULTS = ["PASS", "FAIL"] as const;
export const WipStageQcResultSchema = z.enum(WIP_STAGE_QC_RESULTS);
export type WipStageQcResult = z.infer<typeof WipStageQcResultSchema>;

export const PRODUCTION_NUMBER_KINDS = ["WO", "ECN"] as const;
export const ProductionNumberKindSchema = z.enum(PRODUCTION_NUMBER_KINDS);
export type ProductionNumberKind = z.infer<typeof ProductionNumberKindSchema>;

// ─── Products ────────────────────────────────────────────────────────────────

export const ProductSchema = z.object({
  id: uuid,
  orgId: uuid,
  productCode: z.string(),
  name: z.string(),
  family: ProductFamilySchema,
  description: z.string().nullable(),
  uom: z.string(),
  standardCycleDays: z.number().int().nonnegative(),
  hasSerialTracking: z.boolean(),
  reworkLimit: z.number().int().nonnegative(),
  activeBomId: uuid.nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductSchema = z.object({
  productCode: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  family: ProductFamilySchema.default("MODULE"),
  description: z.string().trim().max(2000).optional(),
  uom: z.string().trim().min(1).max(16).default("PCS"),
  standardCycleDays: z.number().int().nonnegative().default(0),
  hasSerialTracking: z.boolean().default(true),
  reworkLimit: z.number().int().nonnegative().default(2),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
});
export type CreateProduct = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateProduct = z.infer<typeof UpdateProductSchema>;

export const ProductListQuerySchema = PaginationQuerySchema.extend({
  family: ProductFamilySchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── BOM Versions + Lines ───────────────────────────────────────────────────

export const BomVersionSchema = z.object({
  id: uuid,
  orgId: uuid,
  productId: uuid,
  versionLabel: z.string(),
  status: BomStatusSchema,
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  totalStdCost: decimalStr,
  ecnRef: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: uuid.nullable(),
  approvedBy: uuid.nullable(),
  approvedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type BomVersion = z.infer<typeof BomVersionSchema>;

export const BomLineSchema = z.object({
  id: uuid,
  orgId: uuid,
  bomId: uuid,
  lineNo: z.number().int().positive(),
  componentItemId: uuid,
  qtyPerUnit: qtyStr,
  uom: z.string(),
  referenceDesignator: z.string().nullable(),
  isCritical: z.boolean(),
  trackingType: BomLineTrackingTypeSchema,
  leadTimeDays: z.number().int().nonnegative(),
  stdUnitCost: decimalStr,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BomLine = z.infer<typeof BomLineSchema>;

export const BomVersionWithLinesSchema = BomVersionSchema.extend({
  lines: z.array(BomLineSchema),
});
export type BomVersionWithLines = z.infer<typeof BomVersionWithLinesSchema>;

export const CreateBomLineSchema = z.object({
  componentItemId: uuid,
  lineNo: z.number().int().positive().optional(),
  qtyPerUnit: qtyStr,
  uom: z.string().trim().min(1).max(16),
  referenceDesignator: z.string().trim().max(120).optional(),
  isCritical: z.boolean().default(false),
  trackingType: BomLineTrackingTypeSchema.default("NONE"),
  leadTimeDays: z.number().int().nonnegative().default(0),
  stdUnitCost: decimalStr.default("0"),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateBomLine = z.infer<typeof CreateBomLineSchema>;

export const UpdateBomLineSchema = CreateBomLineSchema.partial();
export type UpdateBomLine = z.infer<typeof UpdateBomLineSchema>;

export const CreateBomVersionSchema = z.object({
  productId: uuid,
  versionLabel: z.string().trim().min(1).max(32),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
  ecnRef: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(CreateBomLineSchema).default([]),
});
export type CreateBomVersion = z.infer<typeof CreateBomVersionSchema>;

export const UpdateBomVersionSchema = z.object({
  versionLabel: z.string().trim().min(1).max(32).optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
  status: BomStatusSchema.optional(),
  ecnRef: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateBomVersion = z.infer<typeof UpdateBomVersionSchema>;

export const BomListQuerySchema = PaginationQuerySchema.extend({
  productId: uuid.optional(),
  status: BomStatusSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

/**
 * ActivateBom — promotes a BOM to ACTIVE, transitioning any prior ACTIVE
 * BOM on the same product to SUPERSEDED. Atomic.
 */
export const ActivateBomSchema = z.object({
  expectedVersion: z.number().int().positive(),
  effectiveFrom: z.string().date().optional(),
});
export type ActivateBom = z.infer<typeof ActivateBomSchema>;

// ─── WIP Stage Templates ────────────────────────────────────────────────────

export const WipStageTemplateSchema = z.object({
  id: uuid,
  orgId: uuid,
  productFamily: ProductFamilySchema,
  sequenceNumber: z.number().int().positive(),
  stageName: z.string(),
  requiresQcSignoff: z.boolean(),
  expectedDurationHours: hoursStr,
  responsibleRole: z.string(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WipStageTemplate = z.infer<typeof WipStageTemplateSchema>;

export const WipStageTemplateListQuerySchema = z.object({
  productFamily: ProductFamilySchema.optional(),
});

// ─── Work Orders + WIP Stages ───────────────────────────────────────────────

export const WorkOrderSchema = z.object({
  id: uuid,
  orgId: uuid,
  pid: z.string(),
  productId: uuid,
  bomId: uuid,
  bomVersionLabel: z.string(),
  quantity: qtyStr,
  status: WoStatusSchema,
  priority: WoPrioritySchema,
  targetDate: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  dealId: uuid.nullable(),
  assignedTo: uuid.nullable(),
  createdBy: uuid.nullable(),
  currentStageIndex: z.number().int().nonnegative(),
  reworkCount: z.number().int().nonnegative(),
  lotNumber: z.string().nullable(),
  deviceSerials: z.array(z.string()),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type WorkOrder = z.infer<typeof WorkOrderSchema>;

export const WipStageSchema = z.object({
  id: uuid,
  orgId: uuid,
  woId: uuid,
  templateId: uuid.nullable(),
  sequenceNumber: z.number().int().positive(),
  stageName: z.string(),
  requiresQcSignoff: z.boolean(),
  expectedDurationHours: hoursStr,
  status: WipStageStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  qcResult: WipStageQcResultSchema.nullable(),
  qcNotes: z.string().nullable(),
  reworkCount: z.number().int().nonnegative(),
  assignedTo: uuid.nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WipStage = z.infer<typeof WipStageSchema>;

export const WorkOrderWithStagesSchema = WorkOrderSchema.extend({
  stages: z.array(WipStageSchema),
});
export type WorkOrderWithStages = z.infer<typeof WorkOrderWithStagesSchema>;

/**
 * WIP kanban card — non-cancelled WO joined with its product master + embedded
 * stages[] in one round trip. Used by GET /production/wip-board.
 */
export const WipBoardCardSchema = WorkOrderSchema.extend({
  productName: z.string(),
  productCode: z.string(),
  productFamily: ProductFamilySchema,
  stages: z.array(WipStageSchema),
});
export type WipBoardCard = z.infer<typeof WipBoardCardSchema>;

/**
 * Enriched WO list row — header fields plus product master and embedded
 * stages[] so the work-orders page never needs a second products lookup.
 * Used by GET /production/work-orders.
 */
export const WorkOrderListItemSchema = WorkOrderSchema.extend({
  productName: z.string(),
  productCode: z.string(),
  productFamily: ProductFamilySchema,
  stages: z.array(WipStageSchema),
});
export type WorkOrderListItem = z.infer<typeof WorkOrderListItemSchema>;

// ─── MRP — Material Requirements Planning ───────────────────────────────────

/**
 * One row per component item rolled up across every non-completed work order.
 * Server-side aggregation joins open WOs × bom_lines × stock_summary × open
 * po_lines so the page can highlight shortages without doing math.
 */
export const MrpRowSchema = z.object({
  itemId: uuid,
  sku: z.string(),
  name: z.string(),
  uom: z.string(),
  category: z.string(),
  requiredQty: qtyStr,
  onHand: qtyStr,
  reserved: qtyStr,
  available: qtyStr,
  onOrder: qtyStr,
  shortage: qtyStr,
  woCount: z.number().int().nonnegative(),
});
export type MrpRow = z.infer<typeof MrpRowSchema>;

// ─── Production overview (manufacturing dashboard) ──────────────────────────
//
// One-shot KPI payload for /production/overview. Backed by counts over the
// `work_orders` table. OEE / scrap / machine-utilization fields are returned
// as `null` because the backing tables (oee_records, scrap_entries,
// machine_utilization) do not exist yet — `notImplemented[]` lists the
// fields that are not yet wired so the UI can show a proper "needs backend"
// hint instead of a fake zero.

export const ProductionOverviewSchema = z.object({
  totalWorkOrders: z.number().int().nonnegative(),
  activeWip: z.number().int().nonnegative(),
  completedToday: z.number().int().nonnegative(),
  /** OEE % across machines today. Null until oee_records exists. */
  oee: z.number().nullable(),
  /** Scrap % of completed units today. Null until scrap_entries exists. */
  scrapRate: z.number().nullable(),
  /** Avg machine utilization %. Null until machine_utilization exists. */
  machineUtilization: z.number().nullable(),
  /** Names of fields that are not yet wired to a real source. */
  notImplemented: z.array(z.string()),
});
export type ProductionOverview = z.infer<typeof ProductionOverviewSchema>;

// ─── Production reports ──────────────────────────────────────────────────────

export const ProductionReportsQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ProductionReportsQuery = z.infer<typeof ProductionReportsQuerySchema>;

export const ProductionReportsSchema = z.object({
  /** Inclusive window — defaults to last 90 days when caller omits range. */
  from: z.string(),
  to: z.string(),
  /** WO throughput across the window. */
  throughput: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    qcHold: z.number().int().nonnegative(),
    rework: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    completionRatePct: z.number(),
  }),
  /** Cycle time — only completed WOs in the window. */
  cycleTime: z.object({
    completedCount: z.number().int().nonnegative(),
    avgHours: z.number().nullable(),
    p50Hours: z.number().nullable(),
    p90Hours: z.number().nullable(),
  }),
  /** Per-stage QC pass / fail / rework counters. */
  qc: z.object({
    totalQcStages: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    reworkLoops: z.number().int().nonnegative(),
    passRatePct: z.number(),
  }),
  /** Top products by completed-WO count. */
  topProducts: z.array(
    z.object({
      productId: uuid,
      productCode: z.string(),
      name: z.string(),
      completed: z.number().int().nonnegative(),
      totalQty: qtyStr,
    }),
  ),
});
export type ProductionReports = z.infer<typeof ProductionReportsSchema>;

// ─── ECN — Engineering Change Notices ────────────────────────────────────────

export const ECN_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "IMPLEMENTED",
  "CANCELLED",
] as const;
export const EcnStatusSchema = z.enum(ECN_STATUSES);
export type EcnStatus = z.infer<typeof EcnStatusSchema>;

export const ECN_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const EcnSeveritySchema = z.enum(ECN_SEVERITIES);
export type EcnSeverity = z.infer<typeof EcnSeveritySchema>;

export const ECN_CHANGE_TYPES = [
  "DESIGN",
  "MATERIAL",
  "PROCESS",
  "DOCUMENTATION",
  "OTHER",
] as const;
export const EcnChangeTypeSchema = z.enum(ECN_CHANGE_TYPES);
export type EcnChangeType = z.infer<typeof EcnChangeTypeSchema>;

export const EngineeringChangeNoticeSchema = z.object({
  id: uuid,
  orgId: uuid,
  ecnNumber: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  changeType: EcnChangeTypeSchema,
  severity: EcnSeveritySchema,
  status: EcnStatusSchema,
  affectedProductId: uuid.nullable(),
  affectedProductCode: z.string().nullable(),
  affectedProductName: z.string().nullable(),
  affectedBomId: uuid.nullable(),
  affectedBomVersionLabel: z.string().nullable(),
  reason: z.string().nullable(),
  proposedChange: z.string().nullable(),
  impactSummary: z.string().nullable(),
  raisedBy: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  implementedAt: z.string().nullable(),
  targetImplementationDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EngineeringChangeNotice = z.infer<
  typeof EngineeringChangeNoticeSchema
>;

export const EcnListQuerySchema = PaginationQuerySchema.extend({
  status: EcnStatusSchema.optional(),
  severity: EcnSeveritySchema.optional(),
  changeType: EcnChangeTypeSchema.optional(),
  affectedProductId: uuid.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type EcnListQuery = z.infer<typeof EcnListQuerySchema>;

/**
 * Create an ECN. New ECNs always land in DRAFT status — callers move them
 * forward via the transition endpoint. `ecnNumber` is optional; the service
 * auto-generates `ECN-YYYY-NNNN` from production_number_sequences when absent.
 */
export const CreateEcnSchema = z.object({
  ecnNumber: z.string().trim().min(1).max(32).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  changeType: EcnChangeTypeSchema,
  severity: EcnSeveritySchema.default("MEDIUM"),
  affectedProductId: uuid.optional(),
  affectedBomId: uuid.optional(),
  reason: z.string().trim().max(2000).optional(),
  proposedChange: z.string().trim().max(2000).optional(),
  impactSummary: z.string().trim().max(2000).optional(),
  raisedBy: z.string().trim().max(120).optional(),
  targetImplementationDate: z.string().date().optional(),
});
export type CreateEcn = z.infer<typeof CreateEcnSchema>;

/**
 * Patch an existing ECN. Status changes are NOT allowed here — use the
 * dedicated transition endpoint so we can enforce the workflow and stamp
 * approved_at / implemented_at consistently.
 */
export const UpdateEcnSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  changeType: EcnChangeTypeSchema.optional(),
  severity: EcnSeveritySchema.optional(),
  affectedProductId: uuid.nullable().optional(),
  affectedBomId: uuid.nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  proposedChange: z.string().trim().max(2000).nullable().optional(),
  impactSummary: z.string().trim().max(2000).nullable().optional(),
  raisedBy: z.string().trim().max(120).nullable().optional(),
  targetImplementationDate: z.string().date().nullable().optional(),
});
export type UpdateEcn = z.infer<typeof UpdateEcnSchema>;

/**
 * Workflow transition. Allowed moves are enforced server-side:
 *   DRAFT          → PENDING_REVIEW | CANCELLED
 *   PENDING_REVIEW → APPROVED       | REJECTED | CANCELLED
 *   APPROVED       → IMPLEMENTED    | CANCELLED
 *
 * `approvedBy` is required when moving to APPROVED so the audit row is
 * meaningful. The service stamps `approved_at` / `implemented_at`
 * automatically — clients never send timestamps.
 */
export const EcnTransitionSchema = z.object({
  toStatus: EcnStatusSchema,
  approvedBy: z.string().trim().max(120).optional(),
});
export type EcnTransition = z.infer<typeof EcnTransitionSchema>;

export const CreateWorkOrderSchema = z.object({
  /** Optional — service auto-generates PID-YYYY-NNNN via production_number_sequences if absent. */
  pid: z.string().trim().min(1).max(32).optional(),
  productId: uuid,
  /** Optional — defaults to product's activeBomId if absent. Must be ACTIVE or DRAFT BOM. */
  bomId: uuid.optional(),
  quantity: qtyStr,
  priority: WoPrioritySchema.default("NORMAL"),
  targetDate: z.string().date().optional(),
  dealId: uuid.optional(),
  assignedTo: uuid.optional(),
  lotNumber: z.string().trim().max(64).optional(),
  /** Optional — service generates {productCode}-YYYY-NNNN if product.hasSerialTracking. */
  deviceSerials: z.array(z.string().trim().min(1).max(64)).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateWorkOrder = z.infer<typeof CreateWorkOrderSchema>;

export const UpdateWorkOrderSchema = z.object({
  status: WoStatusSchema.optional(),
  priority: WoPrioritySchema.optional(),
  targetDate: z.string().date().optional(),
  assignedTo: uuid.optional(),
  lotNumber: z.string().trim().max(64).optional(),
  deviceSerials: z.array(z.string().trim().min(1).max(64)).optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateWorkOrder = z.infer<typeof UpdateWorkOrderSchema>;

export const WorkOrderListQuerySchema = PaginationQuerySchema.extend({
  status: WoStatusSchema.optional(),
  priority: WoPrioritySchema.optional(),
  productId: uuid.optional(),
  assignedTo: uuid.optional(),
  dealId: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── WIP Stage mutations ────────────────────────────────────────────────────

export const AdvanceWipStageSchema = z.object({
  /** Transition to IN_PROGRESS (must be PENDING). */
  action: z.enum(["START", "COMPLETE", "QC_PASS", "QC_FAIL", "REWORK_DONE"]),
  qcNotes: z.string().trim().max(2000).optional(),
  assignedTo: uuid.optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedStageVersion: z.number().int().nonnegative().optional(),
});
export type AdvanceWipStage = z.infer<typeof AdvanceWipStageSchema>;

// ─── Device Instances (Phase 5 Mobicase slice) ──────────────────────────────

export const MOBICASE_PRODUCT_CODES = [
  "MBA",
  "MBM",
  "MBC",
  "MCC",
  "CFG",
] as const;
export const MobicaseProductCodeSchema = z.enum(MOBICASE_PRODUCT_CODES);
export type MobicaseProductCode = z.infer<typeof MobicaseProductCodeSchema>;

export const DEVICE_INSTANCE_STATUSES = [
  "CREATED",
  "IN_PRODUCTION",
  "SUB_QC_PASS",
  "SUB_QC_FAIL",
  "IN_REWORK",
  "REWORK_LIMIT_EXCEEDED",
  "FINAL_ASSEMBLY",
  "FINAL_QC_PASS",
  "FINAL_QC_FAIL",
  "RELEASED",
  "DISPATCHED",
  "SCRAPPED",
  "RECALLED",
] as const;
export const DeviceInstanceStatusSchema = z.enum(DEVICE_INSTANCE_STATUSES);
export type DeviceInstanceStatus = z.infer<typeof DeviceInstanceStatusSchema>;

export const ASSEMBLY_LINES = ["L1", "L2", "L3", "L4", "L5"] as const;
export const AssemblyLineSchema = z.enum(ASSEMBLY_LINES);
export type AssemblyLine = z.infer<typeof AssemblyLineSchema>;

export const DeviceInstanceSchema = z.object({
  id: uuid,
  orgId: uuid,
  deviceCode: z.string(),
  productCode: MobicaseProductCodeSchema,
  workOrderRef: z.string(),
  status: DeviceInstanceStatusSchema,
  reworkCount: z.number().int().nonnegative(),
  maxReworkLimit: z.number().int().nonnegative(),
  assignedLine: AssemblyLineSchema.nullable(),

  // Standalone module components (MBA/MBM/MBC/CFG)
  pcbId: z.string().nullable(),
  sensorId: z.string().nullable(),
  detectorId: z.string().nullable(),
  machineId: z.string().nullable(),
  cfgVendorId: z.string().nullable(),
  cfgSerialNo: z.string().nullable(),

  // MCC aggregated sub-assembly component IDs
  analyzerPcbId: z.string().nullable(),
  analyzerSensorId: z.string().nullable(),
  analyzerDetectorId: z.string().nullable(),
  mixerMachineId: z.string().nullable(),
  mixerPcbId: z.string().nullable(),
  incubatorPcbId: z.string().nullable(),

  // Unit-level accessories
  micropipetteId: z.string().nullable(),
  centrifugeId: z.string().nullable(),

  // Dispatch
  finishedGoodsRef: z.string().nullable(),
  invoiceRef: z.string().nullable(),
  deliveryChallanRef: z.string().nullable(),
  salesOrderRef: z.string().nullable(),
  dispatchedAt: z.string().nullable(),

  // Scrap
  scrappedAt: z.string().nullable(),
  scrappedReason: z.string().nullable(),

  notes: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type DeviceInstance = z.infer<typeof DeviceInstanceSchema>;

export const DeviceInstanceListQuerySchema = PaginationQuerySchema.extend({
  productCode: MobicaseProductCodeSchema.optional(),
  status: DeviceInstanceStatusSchema.optional(),
  workOrderRef: z.string().trim().min(1).max(64).optional(),
  assignedLine: AssemblyLineSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
