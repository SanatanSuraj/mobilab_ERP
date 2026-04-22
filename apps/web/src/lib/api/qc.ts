/**
 * Typed wrappers for the real /qc/* surface exposed by apps/api.
 *
 * Mirrors lib/api/production.ts: every function routes through tenantFetch
 * (Bearer + X-Org-Id + silent refresh), uses the real contract types from
 * @instigenie/contracts, and returns the shared PaginatedResponse envelope for
 * list endpoints.
 *
 * Endpoints:
 *   - inspection templates (GET list, GET by id, POST, PATCH, DELETE)
 *     └─ parameters        (GET list, POST, PATCH, DELETE)
 *   - qc inspections       (GET list, GET by id, POST, PATCH, DELETE)
 *     └─ start / complete  (POST lifecycle)
 *     └─ findings          (GET list, POST, PATCH, DELETE)
 *     └─ cert              (GET by inspection — returns null if none)
 *   - qc certs             (GET list, GET by id, POST issue, DELETE recall)
 *
 * Inspection getById returns `QcInspectionWithFindings` (header + embedded
 * findings). Template getById returns `InspectionTemplateWithParameters`.
 * Sub-resource child lists come back as `{ data: [...] }` envelopes —
 * we unwrap for caller convenience.
 */

import type {
  // Templates
  InspectionTemplate,
  InspectionTemplateWithParameters,
  InspectionParameter,
  CreateInspectionTemplate,
  UpdateInspectionTemplate,
  CreateInspectionParameter,
  UpdateInspectionParameter,
  // Inspections
  QcInspection,
  QcInspectionWithFindings,
  QcFinding,
  CreateQcInspection,
  UpdateQcInspection,
  StartQcInspection,
  CompleteQcInspection,
  CreateQcFinding,
  UpdateQcFinding,
  QcInspectionKind,
  QcInspectionStatus,
  QcSourceType,
  QcVerdict,
  // Certs
  QcCert,
  IssueQcCert,
  // Shared
  ProductFamily,
} from "@instigenie/contracts";

import type { PaginatedResponse, PaginationParams } from "./crm";
import {
  tenantDelete,
  tenantGet,
  tenantPatch,
  tenantPost,
} from "./tenant-fetch";

// Re-export the shared types so qc callers don't need to import from ./crm.
export type { PaginatedResponse, PaginationParams } from "./crm";

/** Ad-hoc sub-resource envelope: `{ data: T[] }`. */
interface DataEnvelope<T> {
  data: T[];
}

/** Sub-resource that may be null: `{ data: T | null }`. */
interface NullableEnvelope<T> {
  data: T | null;
}

function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// ─── Inspection Templates ────────────────────────────────────────────────────

export interface InspectionTemplateListQuery extends PaginationParams {
  kind?: QcInspectionKind;
  productFamily?: ProductFamily;
  itemId?: string;
  productId?: string;
  wipStageTemplateId?: string;
  isActive?: boolean;
  search?: string;
}

export async function apiListInspectionTemplates(
  q: InspectionTemplateListQuery = {}
): Promise<PaginatedResponse<InspectionTemplate>> {
  return tenantGet(`/qc/templates${qs(q)}`);
}

/** GET returns `InspectionTemplateWithParameters` — header + embedded `parameters[]`. */
export async function apiGetInspectionTemplate(
  id: string
): Promise<InspectionTemplateWithParameters> {
  return tenantGet(`/qc/templates/${id}`);
}

/**
 * POST with `parameters: [...]` — creates a template plus its parameters in
 * one txn. Service auto-assigns sequenceNumber if omitted.
 */
export async function apiCreateInspectionTemplate(
  body: CreateInspectionTemplate
): Promise<InspectionTemplateWithParameters> {
  return tenantPost(`/qc/templates`, body);
}

/** Header-only update. `expectedVersion` required — 409 on stale. */
export async function apiUpdateInspectionTemplate(
  id: string,
  body: UpdateInspectionTemplate
): Promise<InspectionTemplate> {
  return tenantPatch(`/qc/templates/${id}`, body);
}

export async function apiDeleteInspectionTemplate(id: string): Promise<void> {
  return tenantDelete(`/qc/templates/${id}`);
}

// Inspection parameters (sibling of template)

export async function apiListInspectionParameters(
  templateId: string
): Promise<InspectionParameter[]> {
  const res = await tenantGet<DataEnvelope<InspectionParameter>>(
    `/qc/templates/${templateId}/parameters`
  );
  return res.data;
}

export async function apiAddInspectionParameter(
  templateId: string,
  body: CreateInspectionParameter
): Promise<InspectionParameter> {
  return tenantPost(`/qc/templates/${templateId}/parameters`, body);
}

export async function apiUpdateInspectionParameter(
  templateId: string,
  parameterId: string,
  body: UpdateInspectionParameter
): Promise<InspectionParameter> {
  return tenantPatch(
    `/qc/templates/${templateId}/parameters/${parameterId}`,
    body
  );
}

export async function apiDeleteInspectionParameter(
  templateId: string,
  parameterId: string
): Promise<void> {
  return tenantDelete(`/qc/templates/${templateId}/parameters/${parameterId}`);
}

// ─── QC Inspections ──────────────────────────────────────────────────────────

export interface QcInspectionListQuery extends PaginationParams {
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
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
  search?: string;
}

export async function apiListQcInspections(
  q: QcInspectionListQuery = {}
): Promise<PaginatedResponse<QcInspection>> {
  return tenantGet(`/qc/inspections${qs(q)}`);
}

/** GET returns `QcInspectionWithFindings` — header + embedded `findings[]`. */
export async function apiGetQcInspection(
  id: string
): Promise<QcInspectionWithFindings> {
  return tenantGet(`/qc/inspections/${id}`);
}

/**
 * POST — service auto-generates QC-YYYY-NNNN if `inspectionNumber` is
 * omitted. Validates that the declared sourceType has the matching typed
 * FK set (GRN_LINE → grnLineId, WIP_STAGE → wipStageId, WO → workOrderId).
 * If templateId is supplied, kinds must match.
 */
export async function apiCreateQcInspection(
  body: CreateQcInspection
): Promise<QcInspectionWithFindings> {
  return tenantPost(`/qc/inspections`, body);
}

/**
 * Header update. Locked after PASSED/FAILED. `expectedVersion` required.
 */
export async function apiUpdateQcInspection(
  id: string,
  body: UpdateQcInspection
): Promise<QcInspection> {
  return tenantPatch(`/qc/inspections/${id}`, body);
}

export async function apiDeleteQcInspection(id: string): Promise<void> {
  return tenantDelete(`/qc/inspections/${id}`);
}

// Inspection lifecycle

/**
 * Start an inspection (DRAFT → IN_PROGRESS). If the inspection has a
 * templateId and no findings yet, the server seeds findings from the
 * template's parameters. Stamps startedAt + inspectorId.
 */
export async function apiStartQcInspection(
  id: string,
  body: StartQcInspection
): Promise<QcInspectionWithFindings> {
  return tenantPost(`/qc/inspections/${id}/start`, body);
}

/**
 * Complete an inspection (IN_PROGRESS → PASSED|FAILED) based on verdict.
 * Rejects if any finding is PENDING or if verdict=PASS but any finding
 * failed (or any critical finding failed).
 */
export async function apiCompleteQcInspection(
  id: string,
  body: CompleteQcInspection
): Promise<QcInspectionWithFindings> {
  return tenantPost(`/qc/inspections/${id}/complete`, body);
}

// Findings (sibling of inspection)

export async function apiListQcFindings(
  inspectionId: string
): Promise<QcFinding[]> {
  const res = await tenantGet<DataEnvelope<QcFinding>>(
    `/qc/inspections/${inspectionId}/findings`
  );
  return res.data;
}

export async function apiAddQcFinding(
  inspectionId: string,
  body: CreateQcFinding
): Promise<QcFinding> {
  return tenantPost(`/qc/inspections/${inspectionId}/findings`, body);
}

export async function apiUpdateQcFinding(
  inspectionId: string,
  findingId: string,
  body: UpdateQcFinding
): Promise<QcFinding> {
  return tenantPatch(
    `/qc/inspections/${inspectionId}/findings/${findingId}`,
    body
  );
}

export async function apiDeleteQcFinding(
  inspectionId: string,
  findingId: string
): Promise<void> {
  return tenantDelete(
    `/qc/inspections/${inspectionId}/findings/${findingId}`
  );
}

/** Fetch the cert for an inspection — returns null if none has been issued. */
export async function apiGetQcInspectionCert(
  inspectionId: string
): Promise<QcCert | null> {
  const res = await tenantGet<NullableEnvelope<QcCert>>(
    `/qc/inspections/${inspectionId}/cert`
  );
  return res.data;
}

// ─── QC Certificates ─────────────────────────────────────────────────────────

export interface QcCertListQuery extends PaginationParams {
  workOrderId?: string;
  productId?: string;
  inspectionId?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  from?: string;
  /** Inclusive. ISO-8601 date (YYYY-MM-DD). */
  to?: string;
  search?: string;
}

export async function apiListQcCerts(
  q: QcCertListQuery = {}
): Promise<PaginatedResponse<QcCert>> {
  return tenantGet(`/qc/certs${qs(q)}`);
}

export async function apiGetQcCert(id: string): Promise<QcCert> {
  return tenantGet(`/qc/certs/${id}`);
}

/**
 * Issue a certificate. Inspection must be kind=FINAL_QC + status=PASSED +
 * verdict=PASS. Service auto-generates QCC-YYYY-NNNN + snapshots
 * product_name/wo_pid/device_serials/signer-name at issuance time.
 */
export async function apiIssueQcCert(body: IssueQcCert): Promise<QcCert> {
  return tenantPost(`/qc/certs`, body);
}

/** Soft-delete ("recall") a certificate. Admin action. */
export async function apiRecallQcCert(id: string): Promise<void> {
  return tenantDelete(`/qc/certs/${id}`);
}
