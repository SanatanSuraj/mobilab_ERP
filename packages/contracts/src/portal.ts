/**
 * Customer Portal contracts. ARCHITECTURE.md §3.7 (Phase 3) + §13.9.
 *
 * The portal reuses most of the internal wire shapes (SalesOrder,
 * SalesInvoice, Ticket, …). Everything here is additive:
 *
 *   - PortalSummarySchema              — GET /portal/me landing page
 *   - PortalOrderListQuerySchema       — GET /portal/orders
 *   - PortalInvoiceListQuerySchema     — GET /portal/invoices
 *   - PortalTicketListQuerySchema      — GET /portal/tickets
 *   - CreatePortalTicketSchema         — POST /portal/tickets (portal-only,
 *                                        a narrower surface than internal's
 *                                        CreateTicketSchema — no account_id,
 *                                        no assigned_to, no sla_deadline,
 *                                        no device_serial)
 *   - AddPortalTicketCommentSchema     — POST /portal/tickets/:id/comments
 *                                        (always visibility=CUSTOMER)
 *
 * The portal list-query schemas deliberately omit `account_id` / `customer_id`
 * filters — those are set implicitly by the guard from the pivot row, so
 * exposing them as a query param would let a portal user try to query a
 * different customer's records (RLS still blocks, but we want to reject
 * at the contract layer first).
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";
import { SalesOrderStatusSchema } from "./crm.js";
import {
  TicketCategorySchema,
  TicketPrioritySchema,
  TicketStatusSchema,
} from "./crm.js";
import { InvoiceStatusSchema } from "./finance.js";

// ─── Landing / me ───────────────────────────────────────────────────────────

export const PortalSummarySchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  }),
  customer: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  counts: z.object({
    openOrders: z.number().int().nonnegative(),
    unpaidInvoices: z.number().int().nonnegative(),
    openTickets: z.number().int().nonnegative(),
  }),
});
export type PortalSummary = z.infer<typeof PortalSummarySchema>;

// ─── Orders (read-only) ─────────────────────────────────────────────────────

export const PortalOrderListQuerySchema = PaginationQuerySchema.extend({
  status: SalesOrderStatusSchema.optional(),
});
export type PortalOrderListQuery = z.infer<typeof PortalOrderListQuerySchema>;

// ─── Invoices (read-only) ───────────────────────────────────────────────────

export const PortalInvoiceListQuerySchema = PaginationQuerySchema.extend({
  status: InvoiceStatusSchema.optional(),
});
export type PortalInvoiceListQuery = z.infer<
  typeof PortalInvoiceListQuerySchema
>;

// ─── Tickets (read + write) ─────────────────────────────────────────────────

export const PortalTicketListQuerySchema = PaginationQuerySchema.extend({
  status: TicketStatusSchema.optional(),
});
export type PortalTicketListQuery = z.infer<typeof PortalTicketListQuerySchema>;

/**
 * Portal-side create-ticket. Narrower than CreateTicketSchema:
 *   - account_id is injected by the guard from the pivot row, not the body.
 *   - assigned_to, sla_deadline, device_serial are operational fields the
 *     portal user shouldn't see or set; they're owned by internal staff.
 */
export const CreatePortalTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(4000),
  category: TicketCategorySchema,
  priority: TicketPrioritySchema.default("MEDIUM"),
  contactId: z.string().uuid().optional(),
  productCode: z.string().trim().max(100).optional(),
});
export type CreatePortalTicket = z.infer<typeof CreatePortalTicketSchema>;

/**
 * Portal-side add-comment. Visibility is always CUSTOMER (implicit) —
 * portal users can't post internal notes. The server ignores any visibility
 * field the client sends.
 */
export const AddPortalTicketCommentSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});
export type AddPortalTicketComment = z.infer<
  typeof AddPortalTicketCommentSchema
>;
