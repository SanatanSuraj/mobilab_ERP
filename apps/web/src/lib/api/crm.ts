/**
 * Typed wrappers for the real /crm/* surface exposed by apps/api.
 *
 * Every function:
 *   - Routes through tenantFetch, which handles Bearer + X-Org-Id + silent
 *     refresh.
 *   - Uses the real contract types from @instigenie/contracts — NOT the
 *     prototype shapes under src/data/crm-mock.ts. Pages that still
 *     consume mock shapes must adapt or be rewritten before calling these.
 *
 * 34 endpoints across 5 entities (accounts, contacts, leads, deals, tickets).
 * List responses use the shared PaginatedResponse shape; sub-resources
 * (lead activities, ticket comments) come back as `{ data: [...] }` from the
 * backend — we unwrap for caller convenience.
 */

import type {
  // Accounts
  Account,
  CreateAccount,
  UpdateAccount,
  // Contacts
  Contact,
  CreateContact,
  UpdateContact,
  // Leads
  Lead,
  CreateLead,
  UpdateLead,
  LeadActivity,
  AddLeadActivity,
  MarkLeadLost,
  ConvertLead,
  BulkCreateLeads,
  BulkCreateLeadsResponse,
  // Deals
  Deal,
  CreateDeal,
  UpdateDeal,
  TransitionDealStage,
  // Tickets
  Ticket,
  CreateTicket,
  UpdateTicket,
  TransitionTicketStatus,
  TicketComment,
  AddTicketComment,
  // Quotations
  Quotation,
  CreateQuotation,
  UpdateQuotation,
  TransitionQuotationStatus,
  ApproveQuotation,
  ConvertQuotation,
  // Sales Orders
  SalesOrder,
  CreateSalesOrder,
  UpdateSalesOrder,
  TransitionSalesOrderStatus,
  FinanceApproveSalesOrder,
  // Reports
  CrmReports,
} from "@instigenie/contracts";

import {
  tenantDelete,
  tenantGet,
  tenantPatch,
  tenantPost,
} from "./tenant-fetch";

// ─── Shared pagination shape ────────────────────────────────────────────────

/**
 * Every `list*` endpoint returns this envelope. Matches
 * `listResponseSchema(EntitySchema)` in @instigenie/contracts/pagination.
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Shared pagination params accepted by every CRM list endpoint. */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

/** Ad-hoc sub-resource envelope: { data: T[] }. */
interface DataEnvelope<T> {
  data: T[];
}

// ─── URL helpers ────────────────────────────────────────────────────────────

/**
 * Build a querystring from a plain object. Undefined/null/"" values are
 * dropped. Value must be stringifiable; booleans → "true"/"false" via
 * String(). Callers pass their specific query interface (e.g. LeadListQuery);
 * we take `object` rather than a Record<string, ...> to dodge the open
 * index-signature check that named interfaces don't satisfy.
 */
function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// ─── Accounts ───────────────────────────────────────────────────────────────

export interface AccountListQuery extends PaginationParams {
  search?: string;
  industry?: string;
  ownerId?: string;
  isKeyAccount?: boolean;
}

export async function apiListAccounts(
  q: AccountListQuery = {}
): Promise<PaginatedResponse<Account>> {
  return tenantGet(`/crm/accounts${qs(q)}`);
}

export async function apiGetAccount(id: string): Promise<Account> {
  return tenantGet(`/crm/accounts/${id}`);
}

export async function apiCreateAccount(body: CreateAccount): Promise<Account> {
  return tenantPost(`/crm/accounts`, body);
}

export async function apiUpdateAccount(
  id: string,
  body: UpdateAccount
): Promise<Account> {
  return tenantPatch(`/crm/accounts/${id}`, body);
}

export async function apiDeleteAccount(id: string): Promise<void> {
  return tenantDelete(`/crm/accounts/${id}`);
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export interface ContactListQuery extends PaginationParams {
  accountId?: string;
  search?: string;
}

export async function apiListContacts(
  q: ContactListQuery = {}
): Promise<PaginatedResponse<Contact>> {
  return tenantGet(`/crm/contacts${qs(q)}`);
}

export async function apiGetContact(id: string): Promise<Contact> {
  return tenantGet(`/crm/contacts/${id}`);
}

export async function apiCreateContact(body: CreateContact): Promise<Contact> {
  return tenantPost(`/crm/contacts`, body);
}

export async function apiUpdateContact(
  id: string,
  body: UpdateContact
): Promise<Contact> {
  return tenantPatch(`/crm/contacts/${id}`, body);
}

export async function apiDeleteContact(id: string): Promise<void> {
  return tenantDelete(`/crm/contacts/${id}`);
}

// ─── Leads ──────────────────────────────────────────────────────────────────

export interface LeadListQuery extends PaginationParams {
  status?: Lead["status"];
  assignedTo?: string;
  search?: string;
}

export async function apiListLeads(
  q: LeadListQuery = {}
): Promise<PaginatedResponse<Lead>> {
  return tenantGet(`/crm/leads${qs(q)}`);
}

export async function apiGetLead(id: string): Promise<Lead> {
  return tenantGet(`/crm/leads/${id}`);
}

export async function apiCreateLead(body: CreateLead): Promise<Lead> {
  return tenantPost(`/crm/leads`, body);
}

/**
 * POST /crm/leads/bulk — spreadsheet import. Returns per-row statuses so the
 * UI can render a row-by-row report (created / duplicate_skipped / failed).
 * Zod on the backend caps each request at BULK_LEADS_MAX rows; chunk
 * larger uploads client-side.
 */
export async function apiBulkCreateLeads(
  body: BulkCreateLeads
): Promise<BulkCreateLeadsResponse> {
  return tenantPost(`/crm/leads/bulk`, body);
}

export async function apiUpdateLead(
  id: string,
  body: UpdateLead
): Promise<Lead> {
  return tenantPatch(`/crm/leads/${id}`, body);
}

export async function apiDeleteLead(id: string): Promise<void> {
  return tenantDelete(`/crm/leads/${id}`);
}

/** GET /crm/leads/:id/activities — returns `{data: [...]}`, we unwrap. */
export async function apiListLeadActivities(
  id: string
): Promise<LeadActivity[]> {
  const res = await tenantGet<DataEnvelope<LeadActivity>>(
    `/crm/leads/${id}/activities`
  );
  return res.data;
}

export async function apiAddLeadActivity(
  id: string,
  body: AddLeadActivity
): Promise<LeadActivity> {
  return tenantPost(`/crm/leads/${id}/activities`, body);
}

export async function apiMarkLeadLost(
  id: string,
  body: MarkLeadLost
): Promise<Lead> {
  return tenantPost(`/crm/leads/${id}/lose`, body);
}

/**
 * Convert a qualified lead → account + deal. Backend atomically creates
 * both inside a single transaction and returns the lead/deal plus the
 * minted account's id (not the full Account — the detail page fetches it
 * via /crm/accounts/:id if it needs to render one).
 */
export interface ConvertLeadResponse {
  lead: Lead;
  deal: Deal;
  accountId: string | null;
}

export async function apiConvertLead(
  id: string,
  body: ConvertLead
): Promise<ConvertLeadResponse> {
  return tenantPost(`/crm/leads/${id}/convert`, body);
}

// ─── Deals ──────────────────────────────────────────────────────────────────

export interface DealListQuery extends PaginationParams {
  stage?: Deal["stage"];
  assignedTo?: string;
  accountId?: string;
  search?: string;
}

export async function apiListDeals(
  q: DealListQuery = {}
): Promise<PaginatedResponse<Deal>> {
  return tenantGet(`/crm/deals${qs(q)}`);
}

export async function apiGetDeal(id: string): Promise<Deal> {
  return tenantGet(`/crm/deals/${id}`);
}

export async function apiCreateDeal(body: CreateDeal): Promise<Deal> {
  return tenantPost(`/crm/deals`, body);
}

export async function apiUpdateDeal(
  id: string,
  body: UpdateDeal
): Promise<Deal> {
  return tenantPatch(`/crm/deals/${id}`, body);
}

export async function apiDeleteDeal(id: string): Promise<void> {
  return tenantDelete(`/crm/deals/${id}`);
}

export async function apiTransitionDealStage(
  id: string,
  body: TransitionDealStage
): Promise<Deal> {
  return tenantPost(`/crm/deals/${id}/transition`, body);
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export interface TicketListQuery extends PaginationParams {
  status?: Ticket["status"];
  priority?: Ticket["priority"];
  assignedTo?: string;
  accountId?: string;
  search?: string;
}

export async function apiListTickets(
  q: TicketListQuery = {}
): Promise<PaginatedResponse<Ticket>> {
  return tenantGet(`/crm/tickets${qs(q)}`);
}

export async function apiGetTicket(id: string): Promise<Ticket> {
  return tenantGet(`/crm/tickets/${id}`);
}

export async function apiCreateTicket(body: CreateTicket): Promise<Ticket> {
  return tenantPost(`/crm/tickets`, body);
}

export async function apiUpdateTicket(
  id: string,
  body: UpdateTicket
): Promise<Ticket> {
  return tenantPatch(`/crm/tickets/${id}`, body);
}

export async function apiDeleteTicket(id: string): Promise<void> {
  return tenantDelete(`/crm/tickets/${id}`);
}

export async function apiTransitionTicketStatus(
  id: string,
  body: TransitionTicketStatus
): Promise<Ticket> {
  return tenantPost(`/crm/tickets/${id}/transition`, body);
}

export async function apiListTicketComments(
  id: string
): Promise<TicketComment[]> {
  const res = await tenantGet<DataEnvelope<TicketComment>>(
    `/crm/tickets/${id}/comments`
  );
  return res.data;
}

export async function apiAddTicketComment(
  id: string,
  body: AddTicketComment
): Promise<TicketComment> {
  return tenantPost(`/crm/tickets/${id}/comments`, body);
}

// ─── Quotations ─────────────────────────────────────────────────────────────

export interface QuotationListQuery extends PaginationParams {
  status?: Quotation["status"];
  accountId?: string;
  dealId?: string;
  requiresApproval?: boolean;
  search?: string;
}

export async function apiListQuotations(
  q: QuotationListQuery = {}
): Promise<PaginatedResponse<Quotation>> {
  return tenantGet(`/crm/quotations${qs(q)}`);
}

export async function apiGetQuotation(id: string): Promise<Quotation> {
  return tenantGet(`/crm/quotations/${id}`);
}

export async function apiCreateQuotation(
  body: CreateQuotation
): Promise<Quotation> {
  return tenantPost(`/crm/quotations`, body);
}

export async function apiUpdateQuotation(
  id: string,
  body: UpdateQuotation
): Promise<Quotation> {
  return tenantPatch(`/crm/quotations/${id}`, body);
}

export async function apiDeleteQuotation(id: string): Promise<void> {
  return tenantDelete(`/crm/quotations/${id}`);
}

export async function apiTransitionQuotationStatus(
  id: string,
  body: TransitionQuotationStatus
): Promise<Quotation> {
  return tenantPost(`/crm/quotations/${id}/transition`, body);
}

export async function apiApproveQuotation(
  id: string,
  body: ApproveQuotation
): Promise<Quotation> {
  return tenantPost(`/crm/quotations/${id}/approve`, body);
}

/**
 * Convert an ACCEPTED quotation → SalesOrder. Backend creates the SO
 * atomically (same tx) with line items copied from the quotation, then
 * flips the quotation to CONVERTED. Returns both.
 */
export interface ConvertQuotationResponse {
  quotation: Quotation;
  salesOrder: SalesOrder;
}

export async function apiConvertQuotation(
  id: string,
  body: ConvertQuotation
): Promise<ConvertQuotationResponse> {
  return tenantPost(`/crm/quotations/${id}/convert`, body);
}

// ─── Sales Orders ───────────────────────────────────────────────────────────

export interface SalesOrderListQuery extends PaginationParams {
  status?: SalesOrder["status"];
  accountId?: string;
  quotationId?: string;
  search?: string;
}

export async function apiListSalesOrders(
  q: SalesOrderListQuery = {}
): Promise<PaginatedResponse<SalesOrder>> {
  return tenantGet(`/crm/sales-orders${qs(q)}`);
}

export async function apiGetSalesOrder(id: string): Promise<SalesOrder> {
  return tenantGet(`/crm/sales-orders/${id}`);
}

export async function apiCreateSalesOrder(
  body: CreateSalesOrder
): Promise<SalesOrder> {
  return tenantPost(`/crm/sales-orders`, body);
}

export async function apiUpdateSalesOrder(
  id: string,
  body: UpdateSalesOrder
): Promise<SalesOrder> {
  return tenantPatch(`/crm/sales-orders/${id}`, body);
}

export async function apiDeleteSalesOrder(id: string): Promise<void> {
  return tenantDelete(`/crm/sales-orders/${id}`);
}

export async function apiTransitionSalesOrderStatus(
  id: string,
  body: TransitionSalesOrderStatus
): Promise<SalesOrder> {
  return tenantPost(`/crm/sales-orders/${id}/transition`, body);
}

export async function apiFinanceApproveSalesOrder(
  id: string,
  body: FinanceApproveSalesOrder
): Promise<SalesOrder> {
  return tenantPost(`/crm/sales-orders/${id}/finance-approve`, body);
}

// ─── CRM reports ────────────────────────────────────────────────────────────

export interface CrmReportsQuery {
  /** Inclusive ISO-8601 date (YYYY-MM-DD). Defaults to 90 days ago. */
  from?: string;
  /** Inclusive ISO-8601 date (YYYY-MM-DD). Defaults to today. */
  to?: string;
}

export async function apiGetCrmReports(
  q: CrmReportsQuery = {}
): Promise<CrmReports> {
  return tenantGet(`/crm/reports${qs(q)}`);
}
