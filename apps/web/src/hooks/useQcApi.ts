/**
 * Real-API React Query hooks for the QC module.
 *
 * Mirrors useProductionApi — namespaced query keys (`["qc-api", entity, ...]`),
 * template/inspection header reads return the `*WithParameters` /
 * `*WithFindings` shape, and line-ish child mutations invalidate the parent
 * header cache so the embedded array refreshes in one shot.
 *
 * Cross-cache fan-out:
 *  - Parameter mutations bump template.version → invalidate template detail.
 *  - Finding mutations bump inspection.version → invalidate inspection detail.
 *  - Inspection complete() → may trigger cert issuance elsewhere; we
 *    invalidate certs cache on complete too so the list refreshes if the
 *    downstream client issues a cert immediately.
 *  - Cert issue() → no side-effect on inspection, but the per-inspection cert
 *    lookup (inspectionCert) stops returning null so we invalidate that key.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  // Templates
  apiListInspectionTemplates,
  apiGetInspectionTemplate,
  apiCreateInspectionTemplate,
  apiUpdateInspectionTemplate,
  apiDeleteInspectionTemplate,
  apiListInspectionParameters,
  apiAddInspectionParameter,
  apiUpdateInspectionParameter,
  apiDeleteInspectionParameter,
  // Inspections
  apiListQcInspections,
  apiGetQcInspection,
  apiCreateQcInspection,
  apiUpdateQcInspection,
  apiDeleteQcInspection,
  apiStartQcInspection,
  apiCompleteQcInspection,
  apiListQcFindings,
  apiAddQcFinding,
  apiUpdateQcFinding,
  apiDeleteQcFinding,
  apiGetQcInspectionCert,
  // Certs
  apiListQcCerts,
  apiGetQcCert,
  apiIssueQcCert,
  apiRecallQcCert,
  // Equipment + CAPA (Phase 5)
  apiListQcEquipment,
  apiGetQcEquipment,
  apiListQcCapaActions,
  apiGetQcCapaAction,
  // Reports
  apiGetQcReports,
  type InspectionTemplateListQuery,
  type QcInspectionListQuery,
  type QcCertListQuery,
  type QcEquipmentListQuery,
  type QcCapaActionListQuery,
  type QcReportsQuery,
} from "@/lib/api/qc";

import type {
  InspectionTemplate,
  InspectionTemplateWithParameters,
  InspectionParameter,
  CreateInspectionTemplate,
  UpdateInspectionTemplate,
  CreateInspectionParameter,
  UpdateInspectionParameter,
  QcInspection,
  QcInspectionWithFindings,
  QcFinding,
  CreateQcInspection,
  UpdateQcInspection,
  StartQcInspection,
  CompleteQcInspection,
  CreateQcFinding,
  UpdateQcFinding,
  QcCert,
  IssueQcCert,
  QcReports,
} from "@instigenie/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────
//
// Namespaced `["qc-api", entity, ...]`. Every entity uses `all | list(q) |
// detail(id)`; header entities with children expose `parameters(id)` /
// `findings(id)` sub-keys.

export const qcApiKeys = {
  all: ["qc-api"] as const,
  templates: {
    all: ["qc-api", "templates"] as const,
    list: (q: InspectionTemplateListQuery) =>
      ["qc-api", "templates", "list", q] as const,
    detail: (id: string) =>
      ["qc-api", "templates", "detail", id] as const,
    parameters: (id: string) =>
      ["qc-api", "templates", "parameters", id] as const,
  },
  inspections: {
    all: ["qc-api", "inspections"] as const,
    list: (q: QcInspectionListQuery) =>
      ["qc-api", "inspections", "list", q] as const,
    detail: (id: string) =>
      ["qc-api", "inspections", "detail", id] as const,
    findings: (id: string) =>
      ["qc-api", "inspections", "findings", id] as const,
    cert: (id: string) =>
      ["qc-api", "inspections", "cert", id] as const,
  },
  certs: {
    all: ["qc-api", "certs"] as const,
    list: (q: QcCertListQuery) => ["qc-api", "certs", "list", q] as const,
    detail: (id: string) => ["qc-api", "certs", "detail", id] as const,
  },
  equipment: {
    all: ["qc-api", "equipment"] as const,
    list: (q: QcEquipmentListQuery) =>
      ["qc-api", "equipment", "list", q] as const,
    detail: (id: string) => ["qc-api", "equipment", "detail", id] as const,
  },
  capa: {
    all: ["qc-api", "capa"] as const,
    list: (q: QcCapaActionListQuery) =>
      ["qc-api", "capa", "list", q] as const,
    detail: (id: string) => ["qc-api", "capa", "detail", id] as const,
  },
  reports: {
    all: ["qc-api", "reports"] as const,
    summary: (q: QcReportsQuery) =>
      ["qc-api", "reports", "summary", q] as const,
  },
};

// ─── Templates: reads ──────────────────────────────────────────────────────

export function useApiInspectionTemplates(
  query: InspectionTemplateListQuery = {},
) {
  return useQuery({
    queryKey: qcApiKeys.templates.list(query),
    queryFn: () => apiListInspectionTemplates(query),
    // Templates are relatively static — authoring lives in admin UI.
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `InspectionTemplateWithParameters` — header + embedded `parameters[]`. */
export function useApiInspectionTemplate(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.templates.detail(id)
      : ["qc-api", "templates", "detail", "__none__"],
    queryFn: () => apiGetInspectionTemplate(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useApiInspectionParameters(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.templates.parameters(id)
      : ["qc-api", "templates", "parameters", "__none__"],
    queryFn: () => apiListInspectionParameters(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Templates: writes ─────────────────────────────────────────────────────

export function useApiCreateInspectionTemplate() {
  const qc = useQueryClient();
  return useMutation<
    InspectionTemplateWithParameters,
    Error,
    CreateInspectionTemplate
  >({
    mutationFn: (body) => apiCreateInspectionTemplate(body),
    onSuccess: (template) => {
      qc.setQueryData(qcApiKeys.templates.detail(template.id), template);
      qc.invalidateQueries({ queryKey: qcApiKeys.templates.all });
    },
  });
}

export function useApiUpdateInspectionTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation<InspectionTemplate, Error, UpdateInspectionTemplate>({
    mutationFn: (body) => apiUpdateInspectionTemplate(id, body),
    onSuccess: () => {
      // Header update strips parameters[]; invalidate to refetch WithParameters.
      qc.invalidateQueries({ queryKey: qcApiKeys.templates.all });
    },
  });
}

export function useApiDeleteInspectionTemplate() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteInspectionTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qcApiKeys.templates.all });
    },
  });
}

/**
 * Parameter mutations bump the parent template's version via service-layer
 * touchHeader. Invalidate the detail query so the embedded parameters[]
 * and header version refresh in one shot.
 */
export function useApiAddInspectionParameter(templateId: string) {
  const qc = useQueryClient();
  return useMutation<InspectionParameter, Error, CreateInspectionParameter>({
    mutationFn: (body) => apiAddInspectionParameter(templateId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qcApiKeys.templates.detail(templateId),
      });
      qc.invalidateQueries({
        queryKey: qcApiKeys.templates.parameters(templateId),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.templates.all });
    },
  });
}

export function useApiUpdateInspectionParameter(templateId: string) {
  const qc = useQueryClient();
  return useMutation<
    InspectionParameter,
    Error,
    { parameterId: string; body: UpdateInspectionParameter }
  >({
    mutationFn: ({ parameterId, body }) =>
      apiUpdateInspectionParameter(templateId, parameterId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qcApiKeys.templates.detail(templateId),
      });
      qc.invalidateQueries({
        queryKey: qcApiKeys.templates.parameters(templateId),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.templates.all });
    },
  });
}

export function useApiDeleteInspectionParameter(templateId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (parameterId) =>
      apiDeleteInspectionParameter(templateId, parameterId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qcApiKeys.templates.detail(templateId),
      });
      qc.invalidateQueries({
        queryKey: qcApiKeys.templates.parameters(templateId),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.templates.all });
    },
  });
}

// ─── Inspections: reads ────────────────────────────────────────────────────

export function useApiQcInspections(query: QcInspectionListQuery = {}) {
  return useQuery({
    queryKey: qcApiKeys.inspections.list(query),
    queryFn: () => apiListQcInspections(query),
    // Inspections flip status (DRAFT → IN_PROGRESS → PASSED/FAILED) —
    // 20s staleTime keeps the board snappy under concurrent inspector work.
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
}

/** Returns `QcInspectionWithFindings` — header + embedded `findings[]`. */
export function useApiQcInspection(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.inspections.detail(id)
      : ["qc-api", "inspections", "detail", "__none__"],
    queryFn: () => apiGetQcInspection(id!),
    enabled: Boolean(id),
    // Findings change under each inspector — keep tight.
    staleTime: 15_000,
  });
}

/** Fetch just the findings — useful when header is already in cache. */
export function useApiQcFindings(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.inspections.findings(id)
      : ["qc-api", "inspections", "findings", "__none__"],
    queryFn: () => apiListQcFindings(id!),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

/** Fetch the cert linked to an inspection (null if not yet issued). */
export function useApiQcInspectionCert(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.inspections.cert(id)
      : ["qc-api", "inspections", "cert", "__none__"],
    queryFn: () => apiGetQcInspectionCert(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Inspections: writes ───────────────────────────────────────────────────

export function useApiCreateQcInspection() {
  const qc = useQueryClient();
  return useMutation<QcInspectionWithFindings, Error, CreateQcInspection>({
    mutationFn: (body) => apiCreateQcInspection(body),
    onSuccess: (inspection) => {
      qc.setQueryData(
        qcApiKeys.inspections.detail(inspection.id),
        inspection,
      );
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
    },
  });
}

export function useApiUpdateQcInspection(id: string) {
  const qc = useQueryClient();
  return useMutation<QcInspection, Error, UpdateQcInspection>({
    mutationFn: (body) => apiUpdateQcInspection(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
    },
  });
}

export function useApiDeleteQcInspection() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteQcInspection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
    },
  });
}

/**
 * Start inspection (DRAFT → IN_PROGRESS). Seeds findings from template
 * server-side. Invalidate detail so embedded findings[] refreshes.
 */
export function useApiStartQcInspection(id: string) {
  const qc = useQueryClient();
  return useMutation<QcInspectionWithFindings, Error, StartQcInspection>({
    mutationFn: (body) => apiStartQcInspection(id, body),
    onSuccess: (inspection) => {
      qc.setQueryData(qcApiKeys.inspections.detail(id), inspection);
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.findings(id),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
    },
  });
}

/**
 * Complete inspection (IN_PROGRESS → PASSED|FAILED). Server validates no
 * findings are PENDING and cross-checks verdict against finding state.
 */
export function useApiCompleteQcInspection(id: string) {
  const qc = useQueryClient();
  return useMutation<QcInspectionWithFindings, Error, CompleteQcInspection>({
    mutationFn: (body) => apiCompleteQcInspection(id, body),
    onSuccess: (inspection) => {
      qc.setQueryData(qcApiKeys.inspections.detail(id), inspection);
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.findings(id),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
      // Eligible for cert issuance now — invalidate certs list so any
      // cert dashboard sees the new row if the downstream UI issues it.
      qc.invalidateQueries({ queryKey: qcApiKeys.certs.all });
    },
  });
}

// Findings CRUD

export function useApiAddQcFinding(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation<QcFinding, Error, CreateQcFinding>({
    mutationFn: (body) => apiAddQcFinding(inspectionId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.detail(inspectionId),
      });
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.findings(inspectionId),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
    },
  });
}

export function useApiUpdateQcFinding(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation<
    QcFinding,
    Error,
    { findingId: string; body: UpdateQcFinding }
  >({
    mutationFn: ({ findingId, body }) =>
      apiUpdateQcFinding(inspectionId, findingId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.detail(inspectionId),
      });
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.findings(inspectionId),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
    },
  });
}

export function useApiDeleteQcFinding(inspectionId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (findingId) =>
      apiDeleteQcFinding(inspectionId, findingId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.detail(inspectionId),
      });
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.findings(inspectionId),
      });
      qc.invalidateQueries({ queryKey: qcApiKeys.inspections.all });
    },
  });
}

// ─── Certs: reads ──────────────────────────────────────────────────────────

export function useApiQcCerts(query: QcCertListQuery = {}) {
  return useQuery({
    queryKey: qcApiKeys.certs.list(query),
    queryFn: () => apiListQcCerts(query),
    // Certs are append-only — stable for a while.
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiQcCert(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.certs.detail(id)
      : ["qc-api", "certs", "detail", "__none__"],
    queryFn: () => apiGetQcCert(id!),
    enabled: Boolean(id),
    // Certs are immutable once issued.
    staleTime: 5 * 60_000,
  });
}

// ─── Certs: writes ─────────────────────────────────────────────────────────

/**
 * Issue a cert for a PASSED FINAL_QC inspection. Server auto-generates
 * QCC-YYYY-NNNN + snapshots product/WO/serials. Invalidate both the certs
 * list AND the per-inspection cert lookup (flipping null → cert).
 */
export function useApiIssueQcCert() {
  const qc = useQueryClient();
  return useMutation<QcCert, Error, IssueQcCert>({
    mutationFn: (body) => apiIssueQcCert(body),
    onSuccess: (cert) => {
      qc.setQueryData(qcApiKeys.certs.detail(cert.id), cert);
      qc.invalidateQueries({ queryKey: qcApiKeys.certs.all });
      qc.invalidateQueries({
        queryKey: qcApiKeys.inspections.cert(cert.inspectionId),
      });
    },
  });
}

export function useApiRecallQcCert() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiRecallQcCert(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qcApiKeys.certs.all });
      // The per-inspection cert lookup could now return null — we don't know
      // which inspection without refetching, so blanket-invalidate the cert
      // sub-key under inspections.
      qc.invalidateQueries({
        queryKey: ["qc-api", "inspections", "cert"],
      });
    },
  });
}

// ─── Equipment + CAPA (Phase 5, read-only) ─────────────────────────────────

export function useApiQcEquipment(query: QcEquipmentListQuery = {}) {
  return useQuery({
    queryKey: qcApiKeys.equipment.list(query),
    queryFn: () => apiListQcEquipment(query),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiQcEquipmentById(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.equipment.detail(id)
      : ["qc-api", "equipment", "detail", "__none__"],
    queryFn: () => apiGetQcEquipment(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useApiQcCapaActions(query: QcCapaActionListQuery = {}) {
  return useQuery({
    queryKey: qcApiKeys.capa.list(query),
    queryFn: () => apiListQcCapaActions(query),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiQcCapaAction(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? qcApiKeys.capa.detail(id)
      : ["qc-api", "capa", "detail", "__none__"],
    queryFn: () => apiGetQcCapaAction(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Reports ───────────────────────────────────────────────────────────────

/**
 * Date-windowed inspection counts + cycle time + cert rollup. Defaults to the
 * last 90 days when no range is passed.
 */
export function useApiQcReports(q: QcReportsQuery = {}) {
  return useQuery<QcReports, Error>({
    queryKey: qcApiKeys.reports.summary(q),
    queryFn: () => apiGetQcReports(q),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}
