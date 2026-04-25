/**
 * Typed wrappers for the real /production/* surface exposed by apps/api.
 *
 * Mirrors lib/api/procurement.ts: every function routes through tenantFetch
 * (Bearer + X-Org-Id + silent refresh), uses the real contract types from
 * @instigenie/contracts, and returns the shared PaginatedResponse envelope for
 * list endpoints.
 *
 * Endpoints:
 *   - products            (GET list, GET by id, POST, PATCH, DELETE)
 *   - boms                (GET list, GET by id, POST, PATCH, DELETE, POST activate)
 *     └─ lines            (GET list, POST add, PATCH line, DELETE line)
 *   - work-orders         (GET list, GET by id, POST, PATCH, DELETE)
 *     └─ stages           (GET list, POST /:stageId/advance)
 *   - wip-stage-templates (GET list, filterable by productFamily)
 *
 * Header getById returns `*WithLines` / `*WithStages` (header + embedded
 * children). Sub-resource child lists come back as `{ data: [...] }`
 * envelopes — we unwrap for caller convenience.
 */

import type {
  // Products
  Product,
  CreateProduct,
  UpdateProduct,
  ProductFamily,
  // BOMs
  BomVersion,
  BomLine,
  BomVersionWithLines,
  CreateBomVersion,
  UpdateBomVersion,
  CreateBomLine,
  UpdateBomLine,
  ActivateBom,
  BomStatus,
  // Work orders
  WorkOrder,
  WorkOrderListItem,
  WipStage,
  WipBoardCard,
  WorkOrderWithStages,
  CreateWorkOrder,
  UpdateWorkOrder,
  AdvanceWipStage,
  WoStatus,
  WoPriority,
  // Templates
  WipStageTemplate,
  // Device instances
  DeviceInstance,
  DeviceInstanceStatus,
  MobicaseProductCode,
  AssemblyLine,
  // MRP / reports / ECN
  MrpRow,
  ProductionReports,
  EngineeringChangeNotice,
  EcnStatus,
  EcnSeverity,
  EcnChangeType,
  CreateEcn,
  UpdateEcn,
  EcnTransition,
} from "@instigenie/contracts";

import type { PaginatedResponse, PaginationParams } from "./crm";
import {
  tenantDelete,
  tenantGet,
  tenantPatch,
  tenantPost,
} from "./tenant-fetch";

// Re-export the shared types so production callers don't need to import from
// ./crm — keeps the module boundary clean.
export type { PaginatedResponse, PaginationParams } from "./crm";

/** Ad-hoc sub-resource envelope: `{ data: T[] }`. */
interface DataEnvelope<T> {
  data: T[];
}

/**
 * Build a querystring from a plain object. Local copy so this module has no
 * runtime coupling to ./crm. Drops undefined/null/""; booleans are stringified
 * as "true"/"false" (matches the zod coercion on the server).
 */
function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface ProductListQuery extends PaginationParams {
  family?: ProductFamily;
  isActive?: boolean;
  search?: string;
}

export async function apiListProducts(
  q: ProductListQuery = {}
): Promise<PaginatedResponse<Product>> {
  return tenantGet(`/production/products${qs(q)}`);
}

export async function apiGetProduct(id: string): Promise<Product> {
  return tenantGet(`/production/products/${id}`);
}

export async function apiCreateProduct(
  body: CreateProduct
): Promise<Product> {
  return tenantPost(`/production/products`, body);
}

export async function apiUpdateProduct(
  id: string,
  body: UpdateProduct
): Promise<Product> {
  return tenantPatch(`/production/products/${id}`, body);
}

export async function apiDeleteProduct(id: string): Promise<void> {
  return tenantDelete(`/production/products/${id}`);
}

// ─── BOMs ────────────────────────────────────────────────────────────────────

export interface BomListQuery extends PaginationParams {
  productId?: string;
  status?: BomStatus;
  search?: string;
}

export async function apiListBoms(
  q: BomListQuery = {}
): Promise<PaginatedResponse<BomVersion>> {
  return tenantGet(`/production/boms${qs(q)}`);
}

/** GET returns `BomVersionWithLines` — header + embedded `lines[]`. */
export async function apiGetBom(id: string): Promise<BomVersionWithLines> {
  return tenantGet(`/production/boms/${id}`);
}

/**
 * POST with `lines: [...]` — creates a DRAFT BOM plus all lines in one txn
 * and recomputes total_std_cost.
 */
export async function apiCreateBom(
  body: CreateBomVersion
): Promise<BomVersionWithLines> {
  return tenantPost(`/production/boms`, body);
}

/** Header-only update. `expectedVersion` required — 409 on stale. */
export async function apiUpdateBom(
  id: string,
  body: UpdateBomVersion
): Promise<BomVersion> {
  return tenantPatch(`/production/boms/${id}`, body);
}

/** Soft-delete — rejected by server if BOM is ACTIVE (supersede first). */
export async function apiDeleteBom(id: string): Promise<void> {
  return tenantDelete(`/production/boms/${id}`);
}

/**
 * Promote a DRAFT BOM to ACTIVE. Atomically:
 *   1. Supersedes any prior ACTIVE BOM for the same product
 *   2. Flips status DRAFT → ACTIVE + stamps approvedBy/approvedAt
 *   3. Updates products.active_bom_id to this BOM
 * Returns the activated `BomVersionWithLines`.
 */
export async function apiActivateBom(
  id: string,
  body: ActivateBom
): Promise<BomVersionWithLines> {
  return tenantPost(`/production/boms/${id}/activate`, body);
}

// BOM lines

export async function apiListBomLines(id: string): Promise<BomLine[]> {
  const res = await tenantGet<DataEnvelope<BomLine>>(
    `/production/boms/${id}/lines`
  );
  return res.data;
}

export async function apiAddBomLine(
  id: string,
  body: CreateBomLine
): Promise<BomLine> {
  return tenantPost(`/production/boms/${id}/lines`, body);
}

export async function apiUpdateBomLine(
  id: string,
  lineId: string,
  body: UpdateBomLine
): Promise<BomLine> {
  return tenantPatch(`/production/boms/${id}/lines/${lineId}`, body);
}

export async function apiDeleteBomLine(
  id: string,
  lineId: string
): Promise<void> {
  return tenantDelete(`/production/boms/${id}/lines/${lineId}`);
}

// ─── Work Orders ─────────────────────────────────────────────────────────────

export interface WorkOrderListQuery extends PaginationParams {
  status?: WoStatus;
  priority?: WoPriority;
  productId?: string;
  assignedTo?: string;
  dealId?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
  search?: string;
}

export async function apiListWorkOrders(
  q: WorkOrderListQuery = {}
): Promise<PaginatedResponse<WorkOrderListItem>> {
  return tenantGet(`/production/work-orders${qs(q)}`);
}

/** GET returns `WorkOrderWithStages` — header + embedded `stages[]`. */
export async function apiGetWorkOrder(
  id: string
): Promise<WorkOrderWithStages> {
  return tenantGet(`/production/work-orders/${id}`);
}

/**
 * POST — service auto-generates PID-YYYY-NNNN if `pid` is omitted, defaults
 * `bomId` to product's activeBomId, and copies the per-family wip_stage_templates
 * into per-WO wip_stages. If the product has hasSerialTracking and
 * `deviceSerials` is omitted, service generates them as
 * {productCode}-YYYY-NNNN (one per unit of quantity).
 */
export async function apiCreateWorkOrder(
  body: CreateWorkOrder
): Promise<WorkOrderWithStages> {
  return tenantPost(`/production/work-orders`, body);
}

/**
 * Header update. Setting `status: "IN_PROGRESS"` stamps `startedAt` on first
 * transition; `status: "COMPLETED"` stamps `completedAt`.
 * `expectedVersion` required — 409 on stale.
 */
export async function apiUpdateWorkOrder(
  id: string,
  body: UpdateWorkOrder
): Promise<WorkOrder> {
  return tenantPatch(`/production/work-orders/${id}`, body);
}

export async function apiDeleteWorkOrder(id: string): Promise<void> {
  return tenantDelete(`/production/work-orders/${id}`);
}

// WIP stages

export async function apiListWipStages(
  workOrderId: string
): Promise<WipStage[]> {
  const res = await tenantGet<DataEnvelope<WipStage>>(
    `/production/work-orders/${workOrderId}/stages`
  );
  return res.data;
}

/**
 * Kanban-board projection — every active WO with its product + stages embedded.
 * Sorted server-side by priority then target_date so the page can stream lanes
 * without client-side rework.
 */
export async function apiGetWipBoard(): Promise<WipBoardCard[]> {
  const res = await tenantGet<DataEnvelope<WipBoardCard>>(
    `/production/wip-board`
  );
  return res.data;
}

/**
 * Advance a WIP stage through its mini-lifecycle. Server enforces:
 *   - sequential ordering (earlier stages must complete before next starts)
 *   - QC gate (if requiresQcSignoff, COMPLETE → QC_HOLD; else → COMPLETED)
 *   - auto-advance (COMPLETED on last stage → WO COMPLETED; otherwise next
 *     PENDING stage → IN_PROGRESS)
 *   - WO status bubbles up (IN_PROGRESS / QC_HOLD / REWORK)
 *
 * Returns the updated `WorkOrderWithStages` so the UI can refresh in one shot.
 */
export async function apiAdvanceWipStage(
  workOrderId: string,
  stageId: string,
  body: AdvanceWipStage
): Promise<WorkOrderWithStages> {
  return tenantPost(
    `/production/work-orders/${workOrderId}/stages/${stageId}/advance`,
    body
  );
}

// ─── WIP Stage Templates ─────────────────────────────────────────────────────

export interface WipStageTemplateListQuery {
  productFamily?: ProductFamily;
}

export async function apiListWipStageTemplates(
  q: WipStageTemplateListQuery = {}
): Promise<WipStageTemplate[]> {
  const res = await tenantGet<DataEnvelope<WipStageTemplate>>(
    `/production/wip-stage-templates${qs(q)}`
  );
  return res.data;
}

// ─── Device Instances (Phase 5 Mobicase slice) ───────────────────────────────

export interface DeviceInstanceListQuery extends PaginationParams {
  productCode?: MobicaseProductCode;
  status?: DeviceInstanceStatus;
  workOrderRef?: string;
  assignedLine?: AssemblyLine;
  search?: string;
}

export async function apiListDeviceInstances(
  q: DeviceInstanceListQuery = {}
): Promise<PaginatedResponse<DeviceInstance>> {
  return tenantGet(`/production/device-instances${qs(q)}`);
}

export async function apiGetDeviceInstance(
  id: string
): Promise<DeviceInstance> {
  return tenantGet(`/production/device-instances/${id}`);
}

// ─── MRP ─────────────────────────────────────────────────────────────────────

/**
 * Per-component shortage rollup driven by SQL CTEs over open WOs × bom_lines ×
 * stock_summary × open POs. Sorted shortage-DESC by the server.
 */
export async function apiGetMrp(): Promise<MrpRow[]> {
  const res = await tenantGet<DataEnvelope<MrpRow>>(`/production/mrp`);
  return res.data;
}

// ─── Production reports ──────────────────────────────────────────────────────

export interface ProductionReportsQuery {
  /** Inclusive ISO-8601 date (YYYY-MM-DD). Defaults to 90 days ago. */
  from?: string;
  /** Inclusive ISO-8601 date (YYYY-MM-DD). Defaults to today. */
  to?: string;
}

export async function apiGetProductionReports(
  q: ProductionReportsQuery = {}
): Promise<ProductionReports> {
  return tenantGet(`/production/reports${qs(q)}`);
}

// ─── ECN — Engineering Change Notices ────────────────────────────────────────

export interface EcnListQuery extends PaginationParams {
  status?: EcnStatus;
  severity?: EcnSeverity;
  changeType?: EcnChangeType;
  affectedProductId?: string;
  search?: string;
}

export async function apiListEcns(
  q: EcnListQuery = {}
): Promise<PaginatedResponse<EngineeringChangeNotice>> {
  return tenantGet(`/production/ecns${qs(q)}`);
}

export async function apiGetEcn(
  id: string
): Promise<EngineeringChangeNotice> {
  return tenantGet(`/production/ecns/${id}`);
}

export async function apiCreateEcn(
  body: CreateEcn
): Promise<EngineeringChangeNotice> {
  return tenantPost(`/production/ecns`, body);
}

export async function apiUpdateEcn(
  id: string,
  body: UpdateEcn
): Promise<EngineeringChangeNotice> {
  return tenantPatch(`/production/ecns/${id}`, body);
}

export async function apiTransitionEcn(
  id: string,
  body: EcnTransition
): Promise<EngineeringChangeNotice> {
  return tenantPost(`/production/ecns/${id}/transition`, body);
}
