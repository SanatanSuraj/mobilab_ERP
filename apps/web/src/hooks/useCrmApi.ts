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
  apiAddTicketComment,
  apiConvertLead,
  apiCreateLead,
  apiDeleteLead,
  apiGetAccount,
  apiGetContact,
  apiGetDeal,
  apiGetLead,
  apiGetTicket,
  apiListAccounts,
  apiListContacts,
  apiListDeals,
  apiListLeadActivities,
  apiListLeads,
  apiListTicketComments,
  apiListTickets,
  apiMarkLeadLost,
  apiTransitionDealStage,
  apiTransitionTicketStatus,
  apiUpdateLead,
  type AccountListQuery,
  type ContactListQuery,
  type ConvertLeadResponse,
  type DealListQuery,
  type LeadListQuery,
  type TicketListQuery,
} from "@/lib/api/crm";

import type {
  AddLeadActivity,
  AddTicketComment,
  ConvertLead,
  CreateLead,
  Deal,
  Lead,
  LeadActivity,
  MarkLeadLost,
  Ticket,
  TicketComment,
  TransitionDealStage,
  TransitionTicketStatus,
  UpdateLead,
} from "@mobilab/contracts";

// ─── Query Keys ────────────────────────────────────────────────────────────
//
// Namespaced `["crm-api", entity, ...]` so they never collide with the mock
// hooks in useCrm.ts (`["crm", ...]`). Every new entity added here should
// follow the `all | list(q) | detail(id)` triple so react-query invalidations
// can target either the whole entity or a specific row.

export const crmApiKeys = {
  all: ["crm-api"] as const,
  leads: {
    all: ["crm-api", "leads"] as const,
    list: (q: LeadListQuery) => ["crm-api", "leads", "list", q] as const,
    detail: (id: string) => ["crm-api", "leads", "detail", id] as const,
    activities: (id: string) =>
      ["crm-api", "leads", "activities", id] as const,
  },
  accounts: {
    all: ["crm-api", "accounts"] as const,
    list: (q: AccountListQuery) =>
      ["crm-api", "accounts", "list", q] as const,
    detail: (id: string) => ["crm-api", "accounts", "detail", id] as const,
  },
  contacts: {
    all: ["crm-api", "contacts"] as const,
    list: (q: ContactListQuery) =>
      ["crm-api", "contacts", "list", q] as const,
    detail: (id: string) => ["crm-api", "contacts", "detail", id] as const,
  },
  deals: {
    all: ["crm-api", "deals"] as const,
    list: (q: DealListQuery) => ["crm-api", "deals", "list", q] as const,
    detail: (id: string) => ["crm-api", "deals", "detail", id] as const,
  },
  tickets: {
    all: ["crm-api", "tickets"] as const,
    list: (q: TicketListQuery) =>
      ["crm-api", "tickets", "list", q] as const,
    detail: (id: string) => ["crm-api", "tickets", "detail", id] as const,
    comments: (id: string) =>
      ["crm-api", "tickets", "comments", id] as const,
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

// ─── Accounts: reads ───────────────────────────────────────────────────────
//
// List pages just need read paths for now — create/update/delete flows
// will arrive with the account-detail pages. Staleness of 30s matches the
// cadence a CRM list view actually needs (not super hot), while
// `placeholderData: prev` keeps the old page visible while filters churn.

export function useApiAccounts(query: AccountListQuery = {}) {
  return useQuery({
    queryKey: crmApiKeys.accounts.list(query),
    queryFn: () => apiListAccounts(query),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiAccount(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.accounts.detail(id)
      : ["crm-api", "accounts", "detail", "__none__"],
    queryFn: () => apiGetAccount(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Contacts: reads ───────────────────────────────────────────────────────

export function useApiContacts(query: ContactListQuery = {}) {
  return useQuery({
    queryKey: crmApiKeys.contacts.list(query),
    queryFn: () => apiListContacts(query),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiContact(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.contacts.detail(id)
      : ["crm-api", "contacts", "detail", "__none__"],
    queryFn: () => apiGetContact(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ─── Deals: reads ──────────────────────────────────────────────────────────

export function useApiDeals(query: DealListQuery = {}) {
  return useQuery({
    queryKey: crmApiKeys.deals.list(query),
    queryFn: () => apiListDeals(query),
    // Deals move around; keep fresher than accounts.
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiDeal(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.deals.detail(id)
      : ["crm-api", "deals", "detail", "__none__"],
    queryFn: () => apiGetDeal(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Tickets: reads ────────────────────────────────────────────────────────

export function useApiTickets(query: TicketListQuery = {}) {
  return useQuery({
    queryKey: crmApiKeys.tickets.list(query),
    queryFn: () => apiListTickets(query),
    // SLA countdowns + inbox churn — keep fresh.
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiTicket(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.tickets.detail(id)
      : ["crm-api", "tickets", "detail", "__none__"],
    queryFn: () => apiGetTicket(id!),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useApiTicketComments(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.tickets.comments(id)
      : ["crm-api", "tickets", "comments", "__none__"],
    queryFn: () => apiListTicketComments(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

// ─── Deals: writes ─────────────────────────────────────────────────────────
//
// Only the stage transition is wired so far — the detail page's primary
// mutation is stage flow. Inline edits (title/value/probability) will land
// with the edit-panel work; they need UpdateDeal + expectedVersion plumbing
// that isn't used anywhere yet.

/**
 * Transition a deal to a new stage. `expectedVersion` is mandatory — the
 * backend 409s if the deal has moved since the caller read it. We refresh
 * the cached detail with the returned row (which has version+1) and
 * invalidate every deals list so stage-filtered views resync.
 */
export function useApiTransitionDealStage(id: string) {
  const qc = useQueryClient();
  return useMutation<Deal, Error, TransitionDealStage>({
    mutationFn: (body) => apiTransitionDealStage(id, body),
    onSuccess: (deal) => {
      qc.setQueryData(crmApiKeys.deals.detail(id), deal);
      qc.invalidateQueries({ queryKey: crmApiKeys.deals.all });
    },
  });
}

// ─── Tickets: writes ───────────────────────────────────────────────────────

export function useApiTransitionTicketStatus(id: string) {
  const qc = useQueryClient();
  return useMutation<Ticket, Error, TransitionTicketStatus>({
    mutationFn: (body) => apiTransitionTicketStatus(id, body),
    onSuccess: (ticket) => {
      qc.setQueryData(crmApiKeys.tickets.detail(id), ticket);
      qc.invalidateQueries({ queryKey: crmApiKeys.tickets.all });
    },
  });
}

export function useApiAddTicketComment(id: string) {
  const qc = useQueryClient();
  return useMutation<TicketComment, Error, AddTicketComment>({
    mutationFn: (body) => apiAddTicketComment(id, body),
    onSuccess: () => {
      // Comment-list is the only cache affected; ticket detail doesn't
      // embed comment counts, so we skip invalidating it.
      qc.invalidateQueries({ queryKey: crmApiKeys.tickets.comments(id) });
    },
  });
}
