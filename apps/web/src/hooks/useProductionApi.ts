/**
 * Real-API React Query hooks for the Production module.
 *
 * Deliberately separate from the mock-backed `useManufacturing.ts` /
 * `useProduction.ts` (if any exist) so migrated pages can flip imports one
 * at a time. The mock hooks may still power older prototype screens and
 * their shapes diverge from the real contract.
 *
 * Query-key namespace: `["prod-api", entity, ...]`. No collision with the
 * mock side.
 *
 * Header/line caching strategy — BOM line mutations invalidate the parent
 * BOM detail cache because `getById` returns `BomVersionWithLines` (embedded
 * lines[]) and the embedded copy + recomputed `total_std_cost` go stale
 * after each mutation. Same story for WIP stage advances and the parent
 * work-order detail.
 *
 * Cross-cache fan-out:
 *  - BOM activation flips `products.active_bom_id` → invalidate products.
 *  - WIP stage advance can flip WO.status (COMPLETED / QC_HOLD / REWORK) →
 *    invalidate the work-order detail.
 *
 * When a page is migrated, flip its imports from
 * `@/hooks/useManufacturing` → `@/hooks/useProductionApi` and adjust type
 * usage.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiActivateBom,
  apiAddBomLine,
  apiAdvanceWipStage,
  apiCreateBom,
  apiCreateProduct,
  apiCreateWorkOrder,
  apiDeleteBom,
  apiDeleteBomLine,
  apiDeleteProduct,
  apiDeleteWorkOrder,
  apiGetBom,
  apiGetProduct,
  apiGetWorkOrder,
  apiListBomLines,
  apiListBoms,
  apiListProducts,
  apiListWipStageTemplates,
  apiListWipStages,
  apiListWorkOrders,
  apiUpdateBom,
  apiUpdateBomLine,
  apiUpdateProduct,
  apiUpdateWorkOrder,
  type BomListQuery,
  type ProductListQuery,
  type WipStageTemplateListQuery,
  type WorkOrderListQuery,
} from "@/lib/api/production";

import type {
  ActivateBom,
  AdvanceWipStage,
  BomLine,
  BomVersion,
  BomVersionWithLines,
  CreateBomLine,
  CreateBomVersion,
  CreateProduct,
  CreateWorkOrder,
  Product,
  ProductFamily,
  UpdateBomLine,
  UpdateBomVersion,
  UpdateProduct,
  UpdateWorkOrder,
  WipStage,
  WipStageTemplate,
  WorkOrder,
  WorkOrderWithStages,
} from "@mobilab/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────
//
// Namespaced `["prod-api", entity, ...]`. Every entity uses the
// `all | list(q) | detail(id)` triple; header entities with children expose
// a `lines(id)` / `stages(id)` sub-key for callers that fetch children alone.

export const productionApiKeys = {
  all: ["prod-api"] as const,
  products: {
    all: ["prod-api", "products"] as const,
    list: (q: ProductListQuery) =>
      ["prod-api", "products", "list", q] as const,
    detail: (id: string) => ["prod-api", "products", "detail", id] as const,
  },
  boms: {
    all: ["prod-api", "boms"] as const,
    list: (q: BomListQuery) => ["prod-api", "boms", "list", q] as const,
    detail: (id: string) => ["prod-api", "boms", "detail", id] as const,
    lines: (id: string) => ["prod-api", "boms", "lines", id] as const,
  },
  workOrders: {
    all: ["prod-api", "work-orders"] as const,
    list: (q: WorkOrderListQuery) =>
      ["prod-api", "work-orders", "list", q] as const,
    detail: (id: string) =>
      ["prod-api", "work-orders", "detail", id] as const,
    stages: (id: string) =>
      ["prod-api", "work-orders", "stages", id] as const,
  },
  wipStageTemplates: {
    all: ["prod-api", "wip-stage-templates"] as const,
    list: (q: WipStageTemplateListQuery) =>
      ["prod-api", "wip-stage-templates", "list", q] as const,
  },
};

// ─── Products: reads ───────────────────────────────────────────────────────

export function useApiProducts(query: ProductListQuery = {}) {
  return useQuery({
    queryKey: productionApiKeys.products.list(query),
    queryFn: () => apiListProducts(query),
    // Products master is relatively static; match warehouses/vendors.
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiProduct(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? productionApiKeys.products.detail(id)
      : ["prod-api", "products", "detail", "__none__"],
    queryFn: () => apiGetProduct(id!),
    enabled: Boolean(id),
    // Detail can change when BOM activation flips active_bom_id.
    staleTime: 60_000,
  });
}

// ─── Products: writes ──────────────────────────────────────────────────────

export function useApiCreateProduct() {
  const qc = useQueryClient();
  return useMutation<Product, Error, CreateProduct>({
    mutationFn: (body) => apiCreateProduct(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productionApiKeys.products.all });
    },
  });
}

export function useApiUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation<Product, Error, UpdateProduct>({
    mutationFn: (body) => apiUpdateProduct(id, body),
    onSuccess: (product) => {
      qc.setQueryData(productionApiKeys.products.detail(id), product);
      qc.invalidateQueries({ queryKey: productionApiKeys.products.all });
    },
  });
}

export function useApiDeleteProduct() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productionApiKeys.products.all });
    },
  });
}

// ─── BOMs: reads ───────────────────────────────────────────────────────────

export function useApiBoms(query: BomListQuery = {}) {
  return useQuery({
    queryKey: productionApiKeys.boms.list(query),
    queryFn: () => apiListBoms(query),
    // Activation + line edits flow through here; 30s keeps the list snappy.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `BomVersionWithLines` — header + embedded `lines[]`. */
export function useApiBom(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? productionApiKeys.boms.detail(id)
      : ["prod-api", "boms", "detail", "__none__"],
    queryFn: () => apiGetBom(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Fetch just the lines — useful when the header is already in cache. */
export function useApiBomLines(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? productionApiKeys.boms.lines(id)
      : ["prod-api", "boms", "lines", "__none__"],
    queryFn: () => apiListBomLines(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── BOMs: writes ──────────────────────────────────────────────────────────

export function useApiCreateBom() {
  const qc = useQueryClient();
  return useMutation<BomVersionWithLines, Error, CreateBomVersion>({
    mutationFn: (body) => apiCreateBom(body),
    onSuccess: (bom) => {
      qc.setQueryData(productionApiKeys.boms.detail(bom.id), bom);
      qc.invalidateQueries({ queryKey: productionApiKeys.boms.all });
    },
  });
}

export function useApiUpdateBom(id: string) {
  const qc = useQueryClient();
  return useMutation<BomVersion, Error, UpdateBomVersion>({
    mutationFn: (body) => apiUpdateBom(id, body),
    onSuccess: () => {
      // Update drops `lines[]` from the response, so don't setQueryData —
      // invalidate so the next read refetches WithLines.
      qc.invalidateQueries({ queryKey: productionApiKeys.boms.all });
    },
  });
}

export function useApiDeleteBom() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteBom(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productionApiKeys.boms.all });
    },
  });
}

/**
 * Promote DRAFT → ACTIVE. Atomic server-side: supersedes the prior ACTIVE
 * BOM for the product, flips status, stamps approved_by/approved_at, and
 * updates products.active_bom_id. Invalidate both the BOM cache (status +
 * new supersededBy on the prior BOM) AND the products cache
 * (active_bom_id).
 */
export function useApiActivateBom(id: string) {
  const qc = useQueryClient();
  return useMutation<BomVersionWithLines, Error, ActivateBom>({
    mutationFn: (body) => apiActivateBom(id, body),
    onSuccess: (bom) => {
      qc.setQueryData(productionApiKeys.boms.detail(id), bom);
      qc.invalidateQueries({ queryKey: productionApiKeys.boms.all });
      // products.active_bom_id flipped.
      qc.invalidateQueries({ queryKey: productionApiKeys.products.all });
    },
  });
}

/**
 * Line mutations bump the parent header's version AND recompute
 * `total_std_cost`. Invalidate the detail query so the embedded lines[]
 * and header total refresh in one shot.
 */
export function useApiAddBomLine(bomId: string) {
  const qc = useQueryClient();
  return useMutation<BomLine, Error, CreateBomLine>({
    mutationFn: (body) => apiAddBomLine(bomId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: productionApiKeys.boms.detail(bomId),
      });
      qc.invalidateQueries({
        queryKey: productionApiKeys.boms.lines(bomId),
      });
      qc.invalidateQueries({ queryKey: productionApiKeys.boms.all });
    },
  });
}

export function useApiUpdateBomLine(bomId: string) {
  const qc = useQueryClient();
  return useMutation<
    BomLine,
    Error,
    { lineId: string; body: UpdateBomLine }
  >({
    mutationFn: ({ lineId, body }) =>
      apiUpdateBomLine(bomId, lineId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: productionApiKeys.boms.detail(bomId),
      });
      qc.invalidateQueries({
        queryKey: productionApiKeys.boms.lines(bomId),
      });
      qc.invalidateQueries({ queryKey: productionApiKeys.boms.all });
    },
  });
}

export function useApiDeleteBomLine(bomId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (lineId) => apiDeleteBomLine(bomId, lineId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: productionApiKeys.boms.detail(bomId),
      });
      qc.invalidateQueries({
        queryKey: productionApiKeys.boms.lines(bomId),
      });
      qc.invalidateQueries({ queryKey: productionApiKeys.boms.all });
    },
  });
}

// ─── Work Orders: reads ────────────────────────────────────────────────────

export function useApiWorkOrders(query: WorkOrderListQuery = {}) {
  return useQuery({
    queryKey: productionApiKeys.workOrders.list(query),
    queryFn: () => apiListWorkOrders(query),
    // WIP stages shift WO status underneath us — 20s matches PO cadence.
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `WorkOrderWithStages` — header + embedded `stages[]`. */
export function useApiWorkOrder(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? productionApiKeys.workOrders.detail(id)
      : ["prod-api", "work-orders", "detail", "__none__"],
    queryFn: () => apiGetWorkOrder(id!),
    enabled: Boolean(id),
    // Detail changes on every stage advance — keep tight.
    staleTime: 15_000,
  });
}

export function useApiWipStages(workOrderId: string | undefined) {
  return useQuery({
    queryKey: workOrderId
      ? productionApiKeys.workOrders.stages(workOrderId)
      : ["prod-api", "work-orders", "stages", "__none__"],
    queryFn: () => apiListWipStages(workOrderId!),
    enabled: Boolean(workOrderId),
    staleTime: 15_000,
  });
}

// ─── Work Orders: writes ───────────────────────────────────────────────────

export function useApiCreateWorkOrder() {
  const qc = useQueryClient();
  return useMutation<WorkOrderWithStages, Error, CreateWorkOrder>({
    mutationFn: (body) => apiCreateWorkOrder(body),
    onSuccess: (wo) => {
      qc.setQueryData(productionApiKeys.workOrders.detail(wo.id), wo);
      qc.invalidateQueries({ queryKey: productionApiKeys.workOrders.all });
    },
  });
}

export function useApiUpdateWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<WorkOrder, Error, UpdateWorkOrder>({
    mutationFn: (body) => apiUpdateWorkOrder(id, body),
    onSuccess: () => {
      // Update drops stages[] — invalidate so the next read refetches
      // WithStages.
      qc.invalidateQueries({ queryKey: productionApiKeys.workOrders.all });
    },
  });
}

export function useApiDeleteWorkOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteWorkOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productionApiKeys.workOrders.all });
    },
  });
}

/**
 * Advance a WIP stage. Server enforces sequential ordering, QC gate, and
 * auto-flips the parent WO status + current_stage_index atomically.
 * Returns the updated `WorkOrderWithStages` so the UI can refresh in one
 * shot — we write it into the detail cache and invalidate the stages
 * sub-key + the list (status transitions affect list rows).
 */
export function useApiAdvanceWipStage(workOrderId: string) {
  const qc = useQueryClient();
  return useMutation<
    WorkOrderWithStages,
    Error,
    { stageId: string; body: AdvanceWipStage }
  >({
    mutationFn: ({ stageId, body }) =>
      apiAdvanceWipStage(workOrderId, stageId, body),
    onSuccess: (wo) => {
      qc.setQueryData(productionApiKeys.workOrders.detail(workOrderId), wo);
      qc.invalidateQueries({
        queryKey: productionApiKeys.workOrders.stages(workOrderId),
      });
      qc.invalidateQueries({ queryKey: productionApiKeys.workOrders.all });
    },
  });
}

// ─── WIP Stage Templates ───────────────────────────────────────────────────

/**
 * Per-family templates used to seed wip_stages on WO creation. Filterable
 * by productFamily. Barely change — long staleTime.
 */
export function useApiWipStageTemplates(productFamily?: ProductFamily) {
  const query: WipStageTemplateListQuery = productFamily
    ? { productFamily }
    : {};
  return useQuery({
    queryKey: productionApiKeys.wipStageTemplates.list(query),
    queryFn: () => apiListWipStageTemplates(query),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

// Re-export WipStage type consumers might need alongside the hooks.
export type { WipStage };
