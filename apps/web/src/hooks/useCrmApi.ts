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
  apiApproveQuotation,
  apiBulkCreateLeads,
  apiConvertLead,
  apiConvertQuotation,
  apiCreateLead,
  apiCreateQuotation,
  apiCreateSalesOrder,
  apiDeleteLead,
  apiDeleteQuotation,
  apiDeleteSalesOrder,
  apiFinanceApproveSalesOrder,
  apiGetAccount,
  apiGetContact,
  apiGetDeal,
  apiGetLead,
  apiGetQuotation,
  apiGetSalesOrder,
  apiGetTicket,
  apiListAccounts,
  apiListContacts,
  apiListDeals,
  apiListLeadActivities,
  apiListLeads,
  apiListQuotations,
  apiListSalesOrders,
  apiListTicketComments,
  apiListTickets,
  apiMarkLeadLost,
  apiTransitionDealStage,
  apiTransitionQuotationStatus,
  apiTransitionSalesOrderStatus,
  apiTransitionTicketStatus,
  apiUpdateAccount,
  apiUpdateDeal,
  apiUpdateLead,
  apiUpdateQuotation,
  apiUpdateSalesOrder,
  apiUpdateTicket,
  type AccountListQuery,
  type ContactListQuery,
  type ConvertLeadResponse,
  type ConvertQuotationResponse,
  type DealListQuery,
  type LeadListQuery,
  type PaginatedResponse,
  type QuotationListQuery,
  type SalesOrderListQuery,
  type TicketListQuery,
} from "@/lib/api/crm";

import type {
  Account,
  AddLeadActivity,
  AddTicketComment,
  ApproveQuotation,
  BulkCreateLeads,
  BulkCreateLeadsResponse,
  ConvertLead,
  ConvertQuotation,
  CreateLead,
  CreateQuotation,
  CreateSalesOrder,
  Deal,
  FinanceApproveSalesOrder,
  Lead,
  LeadActivity,
  MarkLeadLost,
  Quotation,
  SalesOrder,
  Ticket,
  TicketComment,
  TransitionDealStage,
  TransitionQuotationStatus,
  TransitionSalesOrderStatus,
  TransitionTicketStatus,
  UpdateAccount,
  UpdateDeal,
  UpdateLead,
  UpdateQuotation,
  UpdateSalesOrder,
  UpdateTicket,
} from "@instigenie/contracts";

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
  quotations: {
    all: ["crm-api", "quotations"] as const,
    list: (q: QuotationListQuery) =>
      ["crm-api", "quotations", "list", q] as const,
    detail: (id: string) =>
      ["crm-api", "quotations", "detail", id] as const,
  },
  salesOrders: {
    all: ["crm-api", "sales-orders"] as const,
    list: (q: SalesOrderListQuery) =>
      ["crm-api", "sales-orders", "list", q] as const,
    detail: (id: string) =>
      ["crm-api", "sales-orders", "detail", id] as const,
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

/**
 * Bulk-import leads from a spreadsheet. Always invalidates the leads list
 * on success — even partial successes (some created + some failed) still
 * wrote rows that should show up in the table.
 */
export function useApiBulkCreateLeads() {
  const qc = useQueryClient();
  return useMutation<BulkCreateLeadsResponse, Error, BulkCreateLeads>({
    mutationFn: (body) => apiBulkCreateLeads(body),
    onSuccess: (res) => {
      if (res.created > 0) {
        qc.invalidateQueries({ queryKey: crmApiKeys.leads.all });
      }
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

/**
 * Generic per-call variant of useApiTransitionDealStage. Detail pages
 * pin the id at hook-creation time; the pipeline kanban moves many
 * different deals from one component, so it needs a mutation object
 * that takes `{id, body}` at call time.
 *
 * Optimistic update: when the user drops a card, we immediately patch
 * every cached deals list so the card shows up in the new column. On
 * mutation error (e.g. 409 stale version), we roll back by restoring
 * the cached list snapshot. On success, react-query re-fetches anyway
 * via the onSettled invalidate — which also gives us the new `version`
 * so the next move won't 409.
 */
export function useApiMoveDealStage() {
  const qc = useQueryClient();
  type Vars = { id: string; body: TransitionDealStage };
  type Ctx = {
    snapshots: Array<[readonly unknown[], PaginatedResponse<Deal> | undefined]>;
  };
  return useMutation<Deal, Error, Vars, Ctx>({
    mutationFn: ({ id, body }) => apiTransitionDealStage(id, body),
    onMutate: async ({ id, body }) => {
      // Freeze every in-flight deals query; we're about to lie to the
      // cache and don't want a late server response to overwrite the
      // optimistic state.
      await qc.cancelQueries({ queryKey: crmApiKeys.deals.all });

      // Grab a snapshot of every cached deals-list variant (different
      // filters can coexist) so we can roll back on error.
      const snapshots = qc.getQueriesData<PaginatedResponse<Deal>>({
        queryKey: ["crm-api", "deals", "list"],
      });

      for (const [key, cached] of snapshots) {
        if (!cached) continue;
        qc.setQueryData<PaginatedResponse<Deal>>(key, {
          ...cached,
          data: cached.data.map((d) =>
            d.id === id ? { ...d, stage: body.stage } : d
          ),
        });
      }

      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      // Restore every list we touched. Detail caches are untouched
      // because we didn't optimistically write there — the caller will
      // refetch via onSettled.
      for (const [key, value] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, value);
      }
    },
    onSuccess: (deal) => {
      // Write the authoritative server row into the detail cache so a
      // subsequent open of the detail page doesn't flash stale data.
      qc.setQueryData(crmApiKeys.deals.detail(deal.id), deal);
    },
    onSettled: () => {
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

// ─── Detail-page edit mutations ────────────────────────────────────────────
//
// Accounts / Deals / Tickets all follow the same optimistic-locking
// pattern: PATCH takes `expectedVersion`, server returns the new row
// (with version+1), we write it straight into the detail cache and
// invalidate the entity's list keys. 409 from the server bubbles up as
// an Error — callers are expected to toast + refetch (which gives them
// the new version for the next attempt).

export function useApiUpdateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation<Account, Error, UpdateAccount>({
    mutationFn: (body) => apiUpdateAccount(id, body),
    onSuccess: (account) => {
      qc.setQueryData(crmApiKeys.accounts.detail(id), account);
      qc.invalidateQueries({ queryKey: crmApiKeys.accounts.all });
    },
  });
}

export function useApiUpdateDeal(id: string) {
  const qc = useQueryClient();
  return useMutation<Deal, Error, UpdateDeal>({
    mutationFn: (body) => apiUpdateDeal(id, body),
    onSuccess: (deal) => {
      qc.setQueryData(crmApiKeys.deals.detail(id), deal);
      qc.invalidateQueries({ queryKey: crmApiKeys.deals.all });
    },
  });
}

export function useApiUpdateTicket(id: string) {
  const qc = useQueryClient();
  return useMutation<Ticket, Error, UpdateTicket>({
    mutationFn: (body) => apiUpdateTicket(id, body),
    onSuccess: (ticket) => {
      qc.setQueryData(crmApiKeys.tickets.detail(id), ticket);
      qc.invalidateQueries({ queryKey: crmApiKeys.tickets.all });
    },
  });
}

// ─── Quotations: reads ─────────────────────────────────────────────────────

export function useApiQuotations(query: QuotationListQuery = {}) {
  return useQuery({
    queryKey: crmApiKeys.quotations.list(query),
    queryFn: () => apiListQuotations(query),
    // Quotation lists don't churn fast — lifecycle state changes happen
    // at human cadence. 30s matches accounts/contacts.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiQuotation(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.quotations.detail(id)
      : ["crm-api", "quotations", "detail", "__none__"],
    queryFn: () => apiGetQuotation(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Quotations: writes ────────────────────────────────────────────────────

export function useApiCreateQuotation() {
  const qc = useQueryClient();
  return useMutation<Quotation, Error, CreateQuotation>({
    mutationFn: (body) => apiCreateQuotation(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmApiKeys.quotations.all });
    },
  });
}

export function useApiUpdateQuotation(id: string) {
  const qc = useQueryClient();
  return useMutation<Quotation, Error, UpdateQuotation>({
    mutationFn: (body) => apiUpdateQuotation(id, body),
    onSuccess: (q) => {
      qc.setQueryData(crmApiKeys.quotations.detail(id), q);
      qc.invalidateQueries({ queryKey: crmApiKeys.quotations.all });
    },
  });
}

export function useApiDeleteQuotation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteQuotation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmApiKeys.quotations.all });
    },
  });
}

export function useApiTransitionQuotationStatus(id: string) {
  const qc = useQueryClient();
  return useMutation<Quotation, Error, TransitionQuotationStatus>({
    mutationFn: (body) => apiTransitionQuotationStatus(id, body),
    onSuccess: (q) => {
      qc.setQueryData(crmApiKeys.quotations.detail(id), q);
      qc.invalidateQueries({ queryKey: crmApiKeys.quotations.all });
    },
  });
}

export function useApiApproveQuotation(id: string) {
  const qc = useQueryClient();
  return useMutation<Quotation, Error, ApproveQuotation>({
    mutationFn: (body) => apiApproveQuotation(id, body),
    onSuccess: (q) => {
      qc.setQueryData(crmApiKeys.quotations.detail(id), q);
      qc.invalidateQueries({ queryKey: crmApiKeys.quotations.all });
    },
  });
}

/**
 * Convert a quotation → sales order. The response contains both entities;
 * we update the quotation cache, then blow away the sales-orders cache so
 * the new SO appears in the orders list. Returning the full response lets
 * the caller navigate to the new SO on success.
 */
export function useApiConvertQuotation(id: string) {
  const qc = useQueryClient();
  return useMutation<ConvertQuotationResponse, Error, ConvertQuotation>({
    mutationFn: (body) => apiConvertQuotation(id, body),
    onSuccess: (res) => {
      qc.setQueryData(crmApiKeys.quotations.detail(id), res.quotation);
      qc.invalidateQueries({ queryKey: crmApiKeys.quotations.all });
      qc.invalidateQueries({ queryKey: crmApiKeys.salesOrders.all });
    },
  });
}

// ─── Sales Orders: reads ───────────────────────────────────────────────────

export function useApiSalesOrders(query: SalesOrderListQuery = {}) {
  return useQuery({
    queryKey: crmApiKeys.salesOrders.list(query),
    queryFn: () => apiListSalesOrders(query),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiSalesOrder(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? crmApiKeys.salesOrders.detail(id)
      : ["crm-api", "sales-orders", "detail", "__none__"],
    queryFn: () => apiGetSalesOrder(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Sales Orders: writes ──────────────────────────────────────────────────

export function useApiCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation<SalesOrder, Error, CreateSalesOrder>({
    mutationFn: (body) => apiCreateSalesOrder(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmApiKeys.salesOrders.all });
    },
  });
}

export function useApiUpdateSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<SalesOrder, Error, UpdateSalesOrder>({
    mutationFn: (body) => apiUpdateSalesOrder(id, body),
    onSuccess: (so) => {
      qc.setQueryData(crmApiKeys.salesOrders.detail(id), so);
      qc.invalidateQueries({ queryKey: crmApiKeys.salesOrders.all });
    },
  });
}

export function useApiDeleteSalesOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteSalesOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crmApiKeys.salesOrders.all });
    },
  });
}

export function useApiTransitionSalesOrderStatus(id: string) {
  const qc = useQueryClient();
  return useMutation<SalesOrder, Error, TransitionSalesOrderStatus>({
    mutationFn: (body) => apiTransitionSalesOrderStatus(id, body),
    onSuccess: (so) => {
      qc.setQueryData(crmApiKeys.salesOrders.detail(id), so);
      qc.invalidateQueries({ queryKey: crmApiKeys.salesOrders.all });
    },
  });
}

export function useApiFinanceApproveSalesOrder(id: string) {
  const qc = useQueryClient();
  return useMutation<SalesOrder, Error, FinanceApproveSalesOrder>({
    mutationFn: (body) => apiFinanceApproveSalesOrder(id, body),
    onSuccess: (so) => {
      qc.setQueryData(crmApiKeys.salesOrders.detail(id), so);
      qc.invalidateQueries({ queryKey: crmApiKeys.salesOrders.all });
    },
  });
}
