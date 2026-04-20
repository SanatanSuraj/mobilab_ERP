/**
 * CRM React Query hooks.
 *
 * Components use these hooks — never crmService directly.
 * This is the "view model" layer: hook = service call + cache config + types.
 *
 * When mock is replaced with a real API:
 *   1. Update crmService methods to call apiFetch()
 *   2. These hooks need ZERO changes
 *   3. Loading/error/stale states already work
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  crmService,
  type LeadFilters,
  type DealFilters,
  type CreateLeadInput,
  type AddActivityInput,
  type ConvertLeadInput,
  type MarkLostInput,
} from "@/services/crm.service";
import { eventBus } from "@/lib/events";
import { getOrgId } from "@/lib/api-client";
import { useAuthStore } from "@/store/auth.store";

// ─── Query Keys ────────────────────────────────────────────────────────────
export const crmKeys = {
  all: ["crm"] as const,
  leads: (filters?: LeadFilters) => ["crm", "leads", filters] as const,
  lead: (id: string) => ["crm", "leads", id] as const,
  deals: (filters?: DealFilters) => ["crm", "deals", filters] as const,
  deal: (id: string) => ["crm", "deals", id] as const,
  accounts: () => ["crm", "accounts"] as const,
  account: (id: string) => ["crm", "accounts", id] as const,
  contacts: (accountId?: string) => ["crm", "contacts", accountId] as const,
  quotations: () => ["crm", "quotations"] as const,
  orders: () => ["crm", "orders"] as const,
  tickets: (filters?: object) => ["crm", "tickets", filters] as const,
  users: () => ["crm", "users"] as const,
};

// ─── Lead Hooks ────────────────────────────────────────────────────────────

export function useLeads(filters?: LeadFilters) {
  return useQuery({
    queryKey: crmKeys.leads(filters),
    queryFn: () => crmService.getLeads(filters),
    staleTime: 30_000,
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: crmKeys.lead(id),
    queryFn: () => crmService.getLead(id),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? "u1");

  return useMutation({
    mutationFn: (input: CreateLeadInput) => crmService.createLead({ ...input, assignedTo: input.assignedTo || userId }),
    onSuccess: (lead) => {
      queryClient.invalidateQueries({ queryKey: crmKeys.leads() });
      // Fire domain event
      try {
        eventBus.emit("lead.created" as never, getOrgId(), { leadId: lead.id, lead });
      } catch { /* store not yet hydrated */ }
    },
  });
}

export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: import("@/data/crm-mock").EnhancedLeadStatus }) =>
      crmService.updateLeadStatus(id, status),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: crmKeys.leads() });
      queryClient.invalidateQueries({ queryKey: crmKeys.lead(id) });
    },
  });
}

export function useAddLeadActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, input }: { leadId: string; input: AddActivityInput }) =>
      crmService.addLeadActivity(leadId, input),
    onSuccess: (_, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: crmKeys.lead(leadId) });
      queryClient.invalidateQueries({ queryKey: crmKeys.leads() });
    },
  });
}

export function useMarkLeadLost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, input }: { leadId: string; input: MarkLostInput }) =>
      crmService.markLeadLost(leadId, input),
    onSuccess: (_, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: crmKeys.lead(leadId) });
      queryClient.invalidateQueries({ queryKey: crmKeys.leads() });
    },
  });
}

export function useConvertLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, input }: { leadId: string; input: ConvertLeadInput }) =>
      crmService.convertLead(leadId, input),
    onSuccess: (result, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: crmKeys.lead(leadId) });
      queryClient.invalidateQueries({ queryKey: crmKeys.leads() });
      queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
      queryClient.invalidateQueries({ queryKey: crmKeys.accounts() });
      // lead.converted event
      try {
        eventBus.emit("lead.converted" as never, getOrgId(), {
          leadId,
          accountId: result.account.id,
          dealId: result.deal.id,
        });
      } catch { /* store not yet hydrated */ }
    },
  });
}

export function useImportLeads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rows: CreateLeadInput[]) => crmService.importLeads(rows),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: crmKeys.leads() });
    },
  });
}

// ─── Deal Hooks ─────────────────────────────────────────────────────────────

export function useDeals(filters?: DealFilters) {
  return useQuery({
    queryKey: crmKeys.deals(filters),
    queryFn: () => crmService.getDeals(filters),
    staleTime: 30_000,
  });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: crmKeys.deal(id),
    queryFn: () => crmService.getDeal(id),
    enabled: Boolean(id),
  });
}

export function useUpdateDealStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage }: Parameters<typeof crmService.updateDealStage>[1] extends infer S
      ? { id: string; stage: S }
      : never) =>
      crmService.updateDealStage(id, stage as never),
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: crmKeys.deals() });
      const previous = queryClient.getQueryData(crmKeys.deals());
      queryClient.setQueryData(crmKeys.deals(), (old: Awaited<ReturnType<typeof crmService.getDeals>> | undefined) =>
        old?.map((d) => (d.id === id ? { ...d, stage } : d)) ?? []
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(crmKeys.deals(), ctx.previous);
    },
    onSuccess: (deal, { stage }) => {
      if ((stage as string) === "closed_won") {
        try {
          eventBus.emit("deal.won", getOrgId(), { dealId: deal.id, deal });
        } catch { /* store not yet hydrated */ }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: crmKeys.deals() });
    },
  });
}

// ─── Account & Contact Hooks ────────────────────────────────────────────────

export function useAccounts() {
  return useQuery({
    queryKey: crmKeys.accounts(),
    queryFn: () => crmService.getAccounts(),
    staleTime: 60_000,
  });
}

export function useAccount(id: string) {
  return useQuery({
    queryKey: crmKeys.account(id),
    queryFn: () => crmService.getAccount(id),
    enabled: Boolean(id),
  });
}

export function useContacts(accountId?: string) {
  return useQuery({
    queryKey: crmKeys.contacts(accountId),
    queryFn: () => crmService.getContacts(accountId),
    staleTime: 60_000,
  });
}

// ─── Ticket Hooks ───────────────────────────────────────────────────────────

export function useTickets(filters?: Parameters<typeof crmService.getTickets>[0]) {
  return useQuery({
    queryKey: crmKeys.tickets(filters),
    queryFn: () => crmService.getTickets(filters),
    staleTime: 15_000,
  });
}

// ─── User Hooks ─────────────────────────────────────────────────────────────

export function useCrmUsers() {
  return useQuery({
    queryKey: crmKeys.users(),
    queryFn: () => crmService.getUsers(),
    staleTime: 5 * 60_000,
  });
}
