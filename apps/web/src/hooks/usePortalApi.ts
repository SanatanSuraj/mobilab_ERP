/**
 * Real-API React Query hooks for the customer Portal surface.
 *
 * Mirrors useNotificationsApi / useApprovalsApi: namespaced query
 * keys (`["portal-api", …]`), `placeholderData: (prev) => prev` on
 * lists for a stable filter UX, and explicit cache fan-out so the
 * landing summary, list, and detail panes all update after a write.
 *
 * Cache fan-out:
 *   - createTicket   → invalidate `tickets.all` + `summary`
 *   - addComment(id) → invalidate the single `tickets.detail(id)` so
 *                      the new comment shows up; counts on `summary`
 *                      don't change.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiAddPortalTicketComment,
  apiCreatePortalTicket,
  apiGetPortalInvoice,
  apiGetPortalOrder,
  apiGetPortalSummary,
  apiGetPortalTicket,
  apiListPortalInvoices,
  apiListPortalOrders,
  apiListPortalTickets,
  type PortalInvoiceListQuery,
  type PortalOrderListQuery,
  type PortalTicketListQuery,
} from "@/lib/api/portal";

import type {
  AddPortalTicketComment,
  CreatePortalTicket,
} from "@instigenie/contracts";

// ─── Query keys ────────────────────────────────────────────────────────────

export const portalApiKeys = {
  all: ["portal-api"] as const,
  summary: ["portal-api", "summary"] as const,
  orders: {
    all: ["portal-api", "orders"] as const,
    list: (q: PortalOrderListQuery) =>
      ["portal-api", "orders", "list", q] as const,
    detail: (id: string) => ["portal-api", "orders", "detail", id] as const,
  },
  invoices: {
    all: ["portal-api", "invoices"] as const,
    list: (q: PortalInvoiceListQuery) =>
      ["portal-api", "invoices", "list", q] as const,
    detail: (id: string) =>
      ["portal-api", "invoices", "detail", id] as const,
  },
  tickets: {
    all: ["portal-api", "tickets"] as const,
    list: (q: PortalTicketListQuery) =>
      ["portal-api", "tickets", "list", q] as const,
    detail: (id: string) =>
      ["portal-api", "tickets", "detail", id] as const,
  },
};

// ─── Summary ───────────────────────────────────────────────────────────────

export function useApiPortalSummary() {
  return useQuery({
    queryKey: portalApiKeys.summary,
    queryFn: () => apiGetPortalSummary(),
    staleTime: 30_000,
  });
}

// ─── Orders ────────────────────────────────────────────────────────────────

export function useApiPortalOrders(query: PortalOrderListQuery = {}) {
  return useQuery({
    queryKey: portalApiKeys.orders.list(query),
    queryFn: () => apiListPortalOrders(query),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiPortalOrder(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? portalApiKeys.orders.detail(id)
      : ["portal-api", "orders", "detail", "__none__"],
    queryFn: () => apiGetPortalOrder(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Invoices ──────────────────────────────────────────────────────────────

export function useApiPortalInvoices(query: PortalInvoiceListQuery = {}) {
  return useQuery({
    queryKey: portalApiKeys.invoices.list(query),
    queryFn: () => apiListPortalInvoices(query),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiPortalInvoice(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? portalApiKeys.invoices.detail(id)
      : ["portal-api", "invoices", "detail", "__none__"],
    queryFn: () => apiGetPortalInvoice(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── Tickets: reads ────────────────────────────────────────────────────────

export function useApiPortalTickets(query: PortalTicketListQuery = {}) {
  return useQuery({
    queryKey: portalApiKeys.tickets.list(query),
    queryFn: () => apiListPortalTickets(query),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiPortalTicket(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? portalApiKeys.tickets.detail(id)
      : ["portal-api", "tickets", "detail", "__none__"],
    queryFn: () => apiGetPortalTicket(id!),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

// ─── Tickets: writes ───────────────────────────────────────────────────────

export function useApiCreatePortalTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePortalTicket) => apiCreatePortalTicket(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalApiKeys.tickets.all });
      qc.invalidateQueries({ queryKey: portalApiKeys.summary });
    },
  });
}

export function useApiAddPortalTicketComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: AddPortalTicketComment;
    }) => apiAddPortalTicketComment(id, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: portalApiKeys.tickets.detail(vars.id),
      });
    },
  });
}
