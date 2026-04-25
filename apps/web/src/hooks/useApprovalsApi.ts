/**
 * Real-API React Query hooks for the Approvals module.
 *
 * Mirrors useNotificationsApi — namespaced query keys (`["approvals-api", …]`),
 * paginated list queries with `placeholderData: (prev) => prev` for stable
 * filter UX, and cross-cache invalidation so list/inbox/detail stay in sync
 * after any act/cancel.
 *
 * Cache fan-out:
 *   - act / cancel   → invalidate `requests.all`, `inbox.all`, and the
 *                      single `requests.detail(id)` we just touched.
 *   - chain CUD      → invalidate `chains.all`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  apiActOnApproval,
  apiCancelApproval,
  apiCreateApprovalChain,
  apiCreateApprovalRequest,
  apiDeleteApprovalChain,
  apiGetApprovalChain,
  apiGetApprovalRequest,
  apiListApprovalChains,
  apiListApprovalInbox,
  apiListApprovalRequests,
  type ApprovalChainListParams,
  type ApprovalInboxParams,
  type ApprovalRequestListParams,
} from "@/lib/api/approvals";

import type {
  ApprovalActPayload,
  ApprovalChainDefinition,
  ApprovalRequest,
  ApprovalRequestDetail,
  CreateApprovalChainDefinition,
  CreateApprovalRequest,
} from "@instigenie/contracts";

// ─── Query keys ────────────────────────────────────────────────────────────

export const approvalsApiKeys = {
  all: ["approvals-api"] as const,
  requests: {
    all: ["approvals-api", "requests"] as const,
    list: (q: ApprovalRequestListParams) =>
      ["approvals-api", "requests", "list", q] as const,
    detail: (id: string) =>
      ["approvals-api", "requests", "detail", id] as const,
  },
  inbox: {
    all: ["approvals-api", "inbox"] as const,
    list: (q: ApprovalInboxParams) =>
      ["approvals-api", "inbox", "list", q] as const,
  },
  chains: {
    all: ["approvals-api", "chains"] as const,
    list: (q: ApprovalChainListParams) =>
      ["approvals-api", "chains", "list", q] as const,
    detail: (id: string) =>
      ["approvals-api", "chains", "detail", id] as const,
  },
};

// ─── Requests: reads ───────────────────────────────────────────────────────

export function useApiApprovalRequests(query: ApprovalRequestListParams = {}) {
  return useQuery({
    queryKey: approvalsApiKeys.requests.list(query),
    queryFn: () => apiListApprovalRequests(query),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiApprovalRequest(id: string | undefined) {
  return useQuery<ApprovalRequestDetail>({
    queryKey: id
      ? approvalsApiKeys.requests.detail(id)
      : ["approvals-api", "requests", "detail", "__none__"],
    queryFn: () => apiGetApprovalRequest(id!),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useApiApprovalInbox(query: ApprovalInboxParams = {}) {
  return useQuery({
    queryKey: approvalsApiKeys.inbox.list(query),
    queryFn: () => apiListApprovalInbox(query),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

// ─── Requests: writes ──────────────────────────────────────────────────────

export function useApiCreateApprovalRequest() {
  const qc = useQueryClient();
  return useMutation<ApprovalRequest, Error, CreateApprovalRequest>({
    mutationFn: (body) => apiCreateApprovalRequest(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: approvalsApiKeys.requests.all });
      qc.invalidateQueries({ queryKey: approvalsApiKeys.inbox.all });
    },
  });
}

/**
 * APPROVE / REJECT the current step of a request. The mutation is keyed on
 * `id` so callers can use it from a row-level button without parameterising
 * the hook.
 */
export function useApiActOnApproval() {
  const qc = useQueryClient();
  return useMutation<
    ApprovalRequestDetail,
    Error,
    { id: string; payload: ApprovalActPayload }
  >({
    mutationFn: ({ id, payload }) => apiActOnApproval(id, payload),
    onSuccess: (detail, vars) => {
      qc.setQueryData(approvalsApiKeys.requests.detail(vars.id), detail);
      qc.invalidateQueries({ queryKey: approvalsApiKeys.requests.all });
      qc.invalidateQueries({ queryKey: approvalsApiKeys.inbox.all });
    },
  });
}

export function useApiCancelApproval() {
  const qc = useQueryClient();
  return useMutation<
    ApprovalRequestDetail,
    Error,
    { id: string; reason: string }
  >({
    mutationFn: ({ id, reason }) => apiCancelApproval(id, reason),
    onSuccess: (detail, vars) => {
      qc.setQueryData(approvalsApiKeys.requests.detail(vars.id), detail);
      qc.invalidateQueries({ queryKey: approvalsApiKeys.requests.all });
      qc.invalidateQueries({ queryKey: approvalsApiKeys.inbox.all });
    },
  });
}

// ─── Chains ─────────────────────────────────────────────────────────────────

export function useApiApprovalChains(query: ApprovalChainListParams = {}) {
  return useQuery({
    queryKey: approvalsApiKeys.chains.list(query),
    queryFn: () => apiListApprovalChains(query),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useApiApprovalChain(id: string | undefined) {
  return useQuery<ApprovalChainDefinition>({
    queryKey: id
      ? approvalsApiKeys.chains.detail(id)
      : ["approvals-api", "chains", "detail", "__none__"],
    queryFn: () => apiGetApprovalChain(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useApiCreateApprovalChain() {
  const qc = useQueryClient();
  return useMutation<
    ApprovalChainDefinition,
    Error,
    CreateApprovalChainDefinition
  >({
    mutationFn: (body) => apiCreateApprovalChain(body),
    onSuccess: (chain) => {
      qc.setQueryData(approvalsApiKeys.chains.detail(chain.id), chain);
      qc.invalidateQueries({ queryKey: approvalsApiKeys.chains.all });
    },
  });
}

export function useApiDeleteApprovalChain() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => apiDeleteApprovalChain(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: approvalsApiKeys.chains.detail(id) });
      qc.invalidateQueries({ queryKey: approvalsApiKeys.chains.all });
    },
  });
}
