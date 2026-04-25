/**
 * Typed wrappers for the real /approvals/* surface exposed by apps/api.
 *
 * Mirrors lib/api/notifications.ts: every function routes through tenantFetch
 * (Bearer + X-Org-Id + silent refresh) and uses the real contract types from
 * @instigenie/contracts.
 *
 * Surface (Phase 3):
 *   - GET    /approvals                       cross-module request list
 *   - GET    /approvals/inbox                  pending steps for current roles
 *   - GET    /approvals/:id                    request + steps + transitions
 *   - POST   /approvals                        create request (rare from UI)
 *   - POST   /approvals/:id/act                APPROVE | REJECT
 *   - POST   /approvals/:id/cancel             cancel pending request
 *   - GET    /approvals/chains                 chain library
 *   - GET    /approvals/chains/:id             one chain def
 *   - POST   /approvals/chains                 create chain def
 *   - DELETE /approvals/chains/:id             soft-delete chain def
 */

import type {
  ApprovalActPayload,
  ApprovalChainDefinition,
  ApprovalChainListQuery,
  ApprovalEntityType,
  ApprovalInboxItem,
  ApprovalInboxQuery,
  ApprovalRequest,
  ApprovalRequestDetail,
  ApprovalRequestListQuery,
  ApprovalRequestStatus,
  CreateApprovalChainDefinition,
  CreateApprovalRequest,
} from "@instigenie/contracts";

import type { PaginatedResponse, PaginationParams } from "./crm";
import {
  tenantDelete,
  tenantGet,
  tenantPost,
} from "./tenant-fetch";

export type { PaginatedResponse, PaginationParams } from "./crm";

function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// ─── Requests ────────────────────────────────────────────────────────────────

export interface ApprovalRequestListParams extends PaginationParams {
  entityType?: ApprovalEntityType;
  entityId?: string;
  status?: ApprovalRequestStatus;
  requestedBy?: string;
  /** ISO-8601 datetime inclusive lower bound. */
  from?: string;
  /** ISO-8601 datetime inclusive upper bound. */
  to?: string;
}

export async function apiListApprovalRequests(
  q: ApprovalRequestListParams = {},
): Promise<PaginatedResponse<ApprovalRequest>> {
  return tenantGet(`/approvals${qs(q)}`);
}

export async function apiGetApprovalRequest(
  id: string,
): Promise<ApprovalRequestDetail> {
  return tenantGet(`/approvals/${id}`);
}

export async function apiCreateApprovalRequest(
  body: CreateApprovalRequest,
): Promise<ApprovalRequest> {
  return tenantPost(`/approvals`, body);
}

export async function apiActOnApproval(
  id: string,
  body: ApprovalActPayload,
): Promise<ApprovalRequestDetail> {
  return tenantPost(`/approvals/${id}/act`, body);
}

export async function apiCancelApproval(
  id: string,
  reason: string,
): Promise<ApprovalRequestDetail> {
  return tenantPost(`/approvals/${id}/cancel`, { reason });
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

export interface ApprovalInboxParams extends PaginationParams {
  entityType?: ApprovalEntityType;
}

export async function apiListApprovalInbox(
  q: ApprovalInboxParams = {},
): Promise<PaginatedResponse<ApprovalInboxItem>> {
  return tenantGet(`/approvals/inbox${qs(q)}`);
}

// ─── Chains ──────────────────────────────────────────────────────────────────

export interface ApprovalChainListParams extends PaginationParams {
  entityType?: ApprovalEntityType;
  isActive?: boolean;
  search?: string;
}

export async function apiListApprovalChains(
  q: ApprovalChainListParams = {},
): Promise<PaginatedResponse<ApprovalChainDefinition>> {
  return tenantGet(`/approvals/chains${qs(q)}`);
}

export async function apiGetApprovalChain(
  id: string,
): Promise<ApprovalChainDefinition> {
  return tenantGet(`/approvals/chains/${id}`);
}

export async function apiCreateApprovalChain(
  body: CreateApprovalChainDefinition,
): Promise<ApprovalChainDefinition> {
  return tenantPost(`/approvals/chains`, body);
}

export async function apiDeleteApprovalChain(id: string): Promise<void> {
  return tenantDelete(`/approvals/chains/${id}`);
}

// Re-exports kept here so callers can pull params + types from one module.
export type {
  ApprovalActPayload,
  ApprovalChainDefinition,
  ApprovalChainListQuery,
  ApprovalEntityType,
  ApprovalInboxItem,
  ApprovalInboxQuery,
  ApprovalRequest,
  ApprovalRequestDetail,
  ApprovalRequestListQuery,
  ApprovalRequestStatus,
  CreateApprovalChainDefinition,
  CreateApprovalRequest,
};
