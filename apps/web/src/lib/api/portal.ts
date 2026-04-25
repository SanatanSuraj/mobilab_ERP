/**
 * Typed wrappers for the customer-portal `/portal/*` surface.
 *
 * The portal endpoints sit behind the same `tenantFetch` plumbing
 * (Bearer + X-Org-Id + silent refresh) the internal CRM uses; what
 * makes them portal-specific is server-side — the portal token has
 * audience=`instigenie-portal`, the guard pulls the `account_id`
 * from the `account_portal_users` pivot, and a per-user 60-rpm
 * rate-limit applies. The shapes returned here are deliberately
 * narrower than the internal counterparts (see `PortalInvoiceSummary`
 * vs `SalesInvoice`).
 *
 * Surface (Phase 3):
 *   - GET    /portal/me                        — landing summary
 *   - GET    /portal/orders                    — order list (read-only)
 *   - GET    /portal/orders/:id                — single order
 *   - GET    /portal/invoices                  — invoice list (read-only)
 *   - GET    /portal/invoices/:id              — single invoice
 *   - GET    /portal/tickets                   — ticket list
 *   - GET    /portal/tickets/:id               — ticket + comments
 *   - POST   /portal/tickets                   — open a new ticket
 *   - POST   /portal/tickets/:id/comments      — add a customer comment
 *
 * Note on list-query types: the contract list schemas produce zod
 * output types where `page` / `limit` / `sortDir` are required (zod
 * applies defaults on parse). The client only needs to *send* a
 * subset, so we mirror the CRM pattern and define local
 * `Portal*ListQuery` interfaces extending `PaginationParams` (all
 * optional). This keeps `useApiPortalOrders({ status: "DELIVERED" })`
 * compiling without needing to spell out page/limit/sortDir.
 */

import type {
  AddPortalTicketComment,
  CreatePortalTicket,
  InvoiceStatus,
  PortalInvoiceSummary,
  PortalSummary,
  SalesOrder,
  SalesOrderStatus,
  Ticket,
  TicketComment,
  TicketStatus,
} from "@instigenie/contracts";

import type { PaginationParams } from "./crm";
import { tenantGet, tenantPost } from "./tenant-fetch";

function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

/**
 * The portal repository returns `{ data, total, page, limit }` (bare
 * keys, not the `data/meta` envelope used by the internal CRM lists).
 * This type captures that shape — keep it in sync if the server ever
 * normalises onto the meta envelope.
 */
export interface PortalListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── List query types (client-side) ─────────────────────────────────────────

export interface PortalOrderListQuery extends PaginationParams {
  status?: SalesOrderStatus;
}

export interface PortalInvoiceListQuery extends PaginationParams {
  status?: InvoiceStatus;
}

export interface PortalTicketListQuery extends PaginationParams {
  status?: TicketStatus;
}

// ─── Me / landing ───────────────────────────────────────────────────────────

export async function apiGetPortalSummary(): Promise<PortalSummary> {
  return tenantGet(`/portal/me`);
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export async function apiListPortalOrders(
  q: PortalOrderListQuery = {},
): Promise<PortalListResponse<SalesOrder>> {
  return tenantGet(`/portal/orders${qs(q)}`);
}

export async function apiGetPortalOrder(id: string): Promise<SalesOrder> {
  return tenantGet(`/portal/orders/${id}`);
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export async function apiListPortalInvoices(
  q: PortalInvoiceListQuery = {},
): Promise<PortalListResponse<PortalInvoiceSummary>> {
  return tenantGet(`/portal/invoices${qs(q)}`);
}

export async function apiGetPortalInvoice(
  id: string,
): Promise<PortalInvoiceSummary> {
  return tenantGet(`/portal/invoices/${id}`);
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export async function apiListPortalTickets(
  q: PortalTicketListQuery = {},
): Promise<PortalListResponse<Ticket>> {
  return tenantGet(`/portal/tickets${qs(q)}`);
}

export async function apiGetPortalTicket(
  id: string,
): Promise<{ ticket: Ticket; comments: TicketComment[] }> {
  return tenantGet(`/portal/tickets/${id}`);
}

export async function apiCreatePortalTicket(
  body: CreatePortalTicket,
): Promise<Ticket> {
  return tenantPost(`/portal/tickets`, body);
}

export async function apiAddPortalTicketComment(
  id: string,
  body: AddPortalTicketComment,
): Promise<TicketComment> {
  return tenantPost(`/portal/tickets/${id}/comments`, body);
}

// Re-exports kept here so callers can pull params + types from one module.
export type {
  AddPortalTicketComment,
  CreatePortalTicket,
  PortalInvoiceSummary,
  PortalSummary,
};
