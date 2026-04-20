/**
 * Real-API React Query hooks for the CRM module.
 *
 * Deliberately kept separate from the mock-backed `useCrm.ts`: the mock
 * hooks still power the older prototype pages (accounts, contacts, deals,
 * tickets, dashboards), and their query keys, types, and shapes diverge
 * from the real contract. Colocating the two in one file invited bugs
 * during early migration experiments — every mutation touched both caches
 * and state got mixed up.
 *
 * Query-key namespace: `["crm-api", entity, ...]`. The mock hooks use
 * `["crm", ...]`, so there is zero overlap and both sets can coexist
 * without cross-invalidation.
 *
 * When a page is migrated, flip its imports from `@/hooks/useCrm` →
 * `@/hooks/useCrmApi` and adjust type usage. No cache cleanup needed —
 * unused keys age out naturally.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiAddLeadActivity,
  apiConvertLead,
  apiCreateLead,
  apiDeleteLead,
  apiGetLead,
  apiListLeadActivities,
  apiListLeads,
  apiMarkLeadLost,
  apiUpdateLead,
  type ConvertLeadResponse,
  type LeadListQuery,
} from "@/lib/api/crm";

import type {
  AddLeadActivity,
  ConvertLead,
  CreateLead,
  Lead,
  LeadActivity,
  MarkLeadLost,
  UpdateLead,
} from "@mobilab/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────

export const crmApiKeys = {
  all: ["crm-api"] as const,
  leads: {
    all: ["crm-api", "leads"] as const,
    list: (q: LeadListQuery) => ["crm-api", "leads", "list", q] as const,
    detail: (id: string) => ["crm-api", "leads", "detail", id] as const,
    activities: (id: string) =>
      ["crm-api", "leads", "activities", id] as const,
  },
};

// ─── Leads: reads ──────────────────────────────────────────────────────────

/**
 * Paginated leads list. The full `PaginatedResponse<Lead>` envelope is
 * returned so the caller can render the meta (total, page, etc.). Use a
 * stable reference for `query` to avoid cache thrash — pass the search
 * state object directly from useState rather than reconstructing it
 * every render.
 */
export function useApiLeads(query: LeadListQuery = {}) {
  return useQuery({
    queryKey: crmApiKeys.leads.list(query),
    queryFn: () => apiListLeads(query),
    // List data churns fast; 15s is a sweet spot between freshness and
    // hammering the API on every tab switch.
    staleTime: 15_000,
    placeholderData: (prev) => prev, // keep last page visible while new page loads
  });
}

export function useApiLead(id: string | undefined) {
  return useQuery({
    queryKey: id ? crmApiKeys.leads.detail(id) : ["crm-api", "leads", "detail", "__none__"],
    queryFn: () => apiGetLead(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useApiLeadActivities(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.leads.activities(id)
      : ["crm-api", "leads", "activities", "__none__"],
    queryFn: () => apiListLeadActivities(id!),
    enabled: Boolean(id),
    // Activities are the part that actually moves; keep them fresh.
    staleTime: 10_000,
  });
}

// ─── Leads: writes ─────────────────────────────────────────────────────────

export function useApiCreateLead() {
  const qc = useQueryClient();
  return useMutation<Lead, Error, CreateLead>({
    mutationFn: (body) => apiCreateLead(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.all });
    },
  });
}

export function useApiUpdateLead(id: string) {
  const qc = useQueryClient();
  return useMutation<Lead, Error, UpdateLead>({
    mutationFn: (body) => apiUpdateLead(id, body),
    onSuccess: (lead) => {
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.all });
      qc.setQueryData(crmApiKeys.leads.detail(id), lead);
    },
  });
}

export function useApiDeleteLead() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteLead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.all });
    },
  });
}

export function useApiAddLeadActivity(id: string) {
  const qc = useQueryClient();
  return useMutation<LeadActivity, Error, AddLeadActivity>({
    mutationFn: (body) => apiAddLeadActivity(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.activities(id) });
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.detail(id) });
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.all });
    },
  });
}

export function useApiMarkLeadLost(id: string) {
  const qc = useQueryClient();
  return useMutation<Lead, Error, MarkLeadLost>({
    mutationFn: (body) => apiMarkLeadLost(id, body),
    onSuccess: (lead) => {
      qc.setQueryData(crmApiKeys.leads.detail(id), lead);
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.activities(id) });
      qc.invalidateQueries({ queryKey: crmApiKeys.leads.all });
    },
  });
}

export function useApiConvertLead(id: string) {
  const qc = useQueryClient();
  return useMutation<ConvertLeadResponse, Error, ConvertLead>({
    mutationFn: (body) => apiConvertLead(id, body),
    onSuccess: (res) => {
      // Conversion mints an account + deal in one transaction; blow
      // away every CRM-API cache so stale lists re-fetch.
      qc.setQueryData(crmApiKeys.leads.detail(id), res.lead);
      qc.invalidateQueries({ queryKey: crmApiKeys.all });
    },
  });
}
