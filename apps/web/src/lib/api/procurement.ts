/**
 * Typed wrappers for the real /procurement/* surface exposed by apps/api.
 *
 * Mirrors lib/api/crm.ts + lib/api/inventory.ts: every function routes through
 * tenantFetch (Bearer + X-Org-Id + silent refresh), uses the real contract
 * types from @instigenie/contracts, and returns the shared PaginatedResponse
 * envelope for list endpoints.
 *
 * ~25 endpoints across 4 resources:
 *   - vendors          (GET list, GET by id, POST, PATCH, DELETE)
 *   - indents          (GET list, GET by id, POST, PATCH, DELETE)
 *     └─ lines         (GET list, POST add, PATCH line, DELETE line)
 *   - purchase-orders  (GET list, GET by id, POST, PATCH, DELETE)
 *     └─ lines         (GET list, POST add, PATCH line, DELETE line)
 *   - grns             (GET list, GET by id, POST, PATCH, DELETE)
 *     └─ lines         (GET list, POST add, PATCH line, DELETE line)
 *     └─ post          (POST /grns/:id/post — writes stock_ledger + bumps PO)
 *
 * Header getById returns `*WithLines` (header + embedded lines[]). Sub-resource
 * line lists come back as `{ data: [...] }` envelopes — we unwrap for caller
 * convenience, matching the lead-activity / ticket-comment pattern in crm.ts.
 */

import type {
  // Vendors
  Vendor,
  CreateVendor,
  UpdateVendor,
  VendorType,
  // Indents
  Indent,
  IndentLine,
  IndentWithLines,
  CreateIndent,
  UpdateIndent,
  CreateIndentLine,
  UpdateIndentLine,
  IndentStatus,
  IndentPriority,
  // Purchase orders
  PurchaseOrder,
  PoLine,
  PurchaseOrderWithLines,
  CreatePurchaseOrder,
  UpdatePurchaseOrder,
  CreatePoLine,
  UpdatePoLine,
  PoStatus,
  // GRNs
  Grn,
  GrnLine,
  GrnWithLines,
  CreateGrn,
  UpdateGrn,
  CreateGrnLine,
  UpdateGrnLine,
  PostGrn,
  GrnStatus,
} from "@instigenie/contracts";

import type { PaginatedResponse, PaginationParams } from "./crm";
import {
  tenantDelete,
  tenantGet,
  tenantPatch,
  tenantPost,
} from "./tenant-fetch";

// Re-export the shared types so procurement callers don't need to import from
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

// ─── Vendors ────────────────────────────────────────────────────────────────

export interface VendorListQuery extends PaginationParams {
  vendorType?: VendorType;
  isActive?: boolean;
  isMsme?: boolean;
  search?: string;
}

export async function apiListVendors(
  q: VendorListQuery = {}
): Promise<PaginatedResponse<Vendor>> {
  return tenantGet(`/procurement/vendors${qs(q)}`);
}

export async function apiGetVendor(id: string): Promise<Vendor> {
  return tenantGet(`/procurement/vendors/${id}`);
}

export async function apiCreateVendor(body: CreateVendor): Promise<Vendor> {
  return tenantPost(`/procurement/vendors`, body);
}

export async function apiUpdateVendor(
  id: string,
  body: UpdateVendor
): Promise<Vendor> {
  return tenantPatch(`/procurement/vendors/${id}`, body);
}

export async function apiDeleteVendor(id: string): Promise<void> {
  return tenantDelete(`/procurement/vendors/${id}`);
}

// ─── Indents ────────────────────────────────────────────────────────────────

export interface IndentListQuery extends PaginationParams {
  status?: IndentStatus;
  priority?: IndentPriority;
  department?: string;
  requestedBy?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
  search?: string;
}

export async function apiListIndents(
  q: IndentListQuery = {}
): Promise<PaginatedResponse<Indent>> {
  return tenantGet(`/procurement/indents${qs(q)}`);
}

/** GET returns `IndentWithLines` — header + embedded `lines[]`. */
export async function apiGetIndent(id: string): Promise<IndentWithLines> {
  return tenantGet(`/procurement/indents/${id}`);
}

/**
 * POST with `lines: [...]` — service auto-generates IND-YYYY-NNNN if
 * `indentNumber` is omitted, and creates header + all lines in one txn.
 */
export async function apiCreateIndent(
  body: CreateIndent
): Promise<IndentWithLines> {
  return tenantPost(`/procurement/indents`, body);
}

/** Header-only update. `expectedVersion` required — 409 on stale. */
export async function apiUpdateIndent(
  id: string,
  body: UpdateIndent
): Promise<Indent> {
  return tenantPatch(`/procurement/indents/${id}`, body);
}

export async function apiDeleteIndent(id: string): Promise<void> {
  return tenantDelete(`/procurement/indents/${id}`);
}

// Lines

export async function apiListIndentLines(
  id: string
): Promise<IndentLine[]> {
  const res = await tenantGet<DataEnvelope<IndentLine>>(
    `/procurement/indents/${id}/lines`
  );
  return res.data;
}

export async function apiAddIndentLine(
  id: string,
  body: CreateIndentLine
): Promise<IndentLine> {
  return tenantPost(`/procurement/indents/${id}/lines`, body);
}

export async function apiUpdateIndentLine(
  id: string,
  lineId: string,
  body: UpdateIndentLine
): Promise<IndentLine> {
  return tenantPatch(`/procurement/indents/${id}/lines/${lineId}`, body);
}

export async function apiDeleteIndentLine(
  id: string,
  lineId: string
): Promise<void> {
  return tenantDelete(`/procurement/indents/${id}/lines/${lineId}`);
}

// ─── Purchase Orders ────────────────────────────────────────────────────────

export interface PurchaseOrderListQuery extends PaginationParams {
  status?: PoStatus;
  vendorId?: string;
  indentId?: string;
  deliveryWarehouseId?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
  search?: string;
}

export async function apiListPurchaseOrders(
  q: PurchaseOrderListQuery = {}
): Promise<PaginatedResponse<PurchaseOrder>> {
  return tenantGet(`/procurement/purchase-orders${qs(q)}`);
}

/** GET returns `PurchaseOrderWithLines` — header + embedded `lines[]`. */
export async function apiGetPurchaseOrder(
  id: string
): Promise<PurchaseOrderWithLines> {
  return tenantGet(`/procurement/purchase-orders/${id}`);
}

/**
 * POST with `lines: [...]` — service auto-generates PO-YYYY-NNNN if
 * `poNumber` is omitted, stamps line totals (subtotal/tax/total), and
 * recomputes header totals from the sum of lines.
 */
export async function apiCreatePurchaseOrder(
  body: CreatePurchaseOrder
): Promise<PurchaseOrderWithLines> {
  return tenantPost(`/procurement/purchase-orders`, body);
}

/**
 * Header update. Setting `status: "CANCELLED"` or `"SENT"` triggers
 * service-side side-effects (stamps cancelled_at / sent_at).
 * `expectedVersion` required — 409 on stale.
 */
export async function apiUpdatePurchaseOrder(
  id: string,
  body: UpdatePurchaseOrder
): Promise<PurchaseOrder> {
  return tenantPatch(`/procurement/purchase-orders/${id}`, body);
}

export async function apiDeletePurchaseOrder(id: string): Promise<void> {
  return tenantDelete(`/procurement/purchase-orders/${id}`);
}

// Lines

export async function apiListPoLines(id: string): Promise<PoLine[]> {
  const res = await tenantGet<DataEnvelope<PoLine>>(
    `/procurement/purchase-orders/${id}/lines`
  );
  return res.data;
}

export async function apiAddPoLine(
  id: string,
  body: CreatePoLine
): Promise<PoLine> {
  return tenantPost(`/procurement/purchase-orders/${id}/lines`, body);
}

export async function apiUpdatePoLine(
  id: string,
  lineId: string,
  body: UpdatePoLine
): Promise<PoLine> {
  return tenantPatch(
    `/procurement/purchase-orders/${id}/lines/${lineId}`,
    body
  );
}

export async function apiDeletePoLine(
  id: string,
  lineId: string
): Promise<void> {
  return tenantDelete(`/procurement/purchase-orders/${id}/lines/${lineId}`);
}

// ─── GRNs ───────────────────────────────────────────────────────────────────

export interface GrnListQuery extends PaginationParams {
  status?: GrnStatus;
  poId?: string;
  vendorId?: string;
  warehouseId?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
  search?: string;
}

export async function apiListGrns(
  q: GrnListQuery = {}
): Promise<PaginatedResponse<Grn>> {
  return tenantGet(`/procurement/grns${qs(q)}`);
}

/** GET returns `GrnWithLines` — header + embedded `lines[]`. */
export async function apiGetGrn(id: string): Promise<GrnWithLines> {
  return tenantGet(`/procurement/grns/${id}`);
}

/**
 * POST with `lines: [...]`. Creates GRN in DRAFT status — POST to
 * `/procurement/grns/:id/post` to actually commit the receipt (write
 * stock_ledger, bump PO received_qty, flip status to POSTED).
 *
 * Service validates parent PO status ∈ {APPROVED, SENT, PARTIALLY_RECEIVED}.
 */
export async function apiCreateGrn(body: CreateGrn): Promise<GrnWithLines> {
  return tenantPost(`/procurement/grns`, body);
}

/**
 * Update DRAFT GRN header. Rejects if GRN is already POSTED.
 * `expectedVersion` required — 409 on stale.
 */
export async function apiUpdateGrn(
  id: string,
  body: UpdateGrn
): Promise<Grn> {
  return tenantPatch(`/procurement/grns/${id}`, body);
}

export async function apiDeleteGrn(id: string): Promise<void> {
  return tenantDelete(`/procurement/grns/${id}`);
}

// Lines

export async function apiListGrnLines(id: string): Promise<GrnLine[]> {
  const res = await tenantGet<DataEnvelope<GrnLine>>(
    `/procurement/grns/${id}/lines`
  );
  return res.data;
}

export async function apiAddGrnLine(
  id: string,
  body: CreateGrnLine
): Promise<GrnLine> {
  return tenantPost(`/procurement/grns/${id}/lines`, body);
}

export async function apiUpdateGrnLine(
  id: string,
  lineId: string,
  body: UpdateGrnLine
): Promise<GrnLine> {
  return tenantPatch(`/procurement/grns/${id}/lines/${lineId}`, body);
}

export async function apiDeleteGrnLine(
  id: string,
  lineId: string
): Promise<void> {
  return tenantDelete(`/procurement/grns/${id}/lines/${lineId}`);
}

/**
 * Commit a DRAFT GRN. Atomic multi-table write:
 *   1. One stock_ledger row per grn_line (txn_type = "GRN_RECEIPT", signed
 *      quantity = line.quantity - line.qcRejectedQty). Lines with zero
 *      accepted quantity are rejected at the service layer.
 *   2. Bumps `po_lines.received_qty` on the parent PO.
 *   3. Recomputes parent PO status → PARTIALLY_RECEIVED or RECEIVED.
 *   4. Flips this GRN's status DRAFT → POSTED, stamps postedAt/postedBy.
 *
 * Server returns the updated `GrnWithLines`. 409 on stale `expectedVersion`.
 * Throws via ApiProblem on any posting-precondition violation (GRN already
 * POSTED, line mismatch, zero accepted quantity, etc.).
 */
export async function apiPostGrn(
  id: string,
  body: PostGrn
): Promise<GrnWithLines> {
  return tenantPost(`/procurement/grns/${id}/post`, body);
}
