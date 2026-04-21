/**
 * CRM contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §13.1. Matches ops/sql/init/02-crm.sql.
 *
 * Rules:
 *   - Money is a decimal-string ("12345.67"), never a `number`. The web
 *     app parses with decimal.js too. NEVER call Number() on these fields.
 *   - Enums here are UPPER_SNAKE_CASE to match the DB's CHECK constraints
 *     and the outbox event catalogue.
 *   - Every list response uses `listResponseSchema(EntitySchema)` so the
 *     frontend's React Query `data` shape is uniform.
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Decimal string for money / quantities. Matches NUMERIC(18,2) round-trip.
 * Accepts e.g. "1000", "1000.5", "1000.50" — rejects Number-produced junk.
 * Frontend passes the raw string from forms; no Number coercion needed.
 */
const decimalStr = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/u, "must be a decimal string like \"1000.50\"");

const uuid = z.string().uuid();

// ─── Common enums ────────────────────────────────────────────────────────────

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "CONVERTED",
  "LOST",
] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LEAD_ACTIVITY_TYPES = [
  "CALL",
  "EMAIL",
  "WHATSAPP",
  "NOTE",
  "MEETING",
  "STATUS_CHANGE",
] as const;
export const LeadActivityTypeSchema = z.enum(LEAD_ACTIVITY_TYPES);
export type LeadActivityType = z.infer<typeof LeadActivityTypeSchema>;

export const DEAL_STAGES = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;
export const DealStageSchema = z.enum(DEAL_STAGES);
export type DealStage = z.infer<typeof DealStageSchema>;

export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TICKET_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export const TicketPrioritySchema = z.enum(TICKET_PRIORITIES);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const TICKET_CATEGORIES = [
  "HARDWARE_DEFECT",
  "CALIBRATION",
  "SOFTWARE_BUG",
  "TRAINING",
  "WARRANTY_CLAIM",
  "GENERAL_INQUIRY",
] as const;
export const TicketCategorySchema = z.enum(TICKET_CATEGORIES);
export type TicketCategory = z.infer<typeof TicketCategorySchema>;

export const TICKET_COMMENT_VISIBILITIES = ["INTERNAL", "CUSTOMER"] as const;
export const TicketCommentVisibilitySchema = z.enum(
  TICKET_COMMENT_VISIBILITIES
);
export type TicketCommentVisibility = z.infer<
  typeof TicketCommentVisibilitySchema
>;

// ─── Accounts ────────────────────────────────────────────────────────────────

export const AccountSchema = z.object({
  id: uuid,
  orgId: uuid,
  name: z.string(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string(),
  postalCode: z.string().nullable(),
  gstin: z.string().nullable(),
  healthScore: z.number().int().min(0).max(100),
  isKeyAccount: z.boolean(),
  annualRevenue: decimalStr.nullable(),
  employeeCount: z.number().int().nullable(),
  ownerId: uuid.nullable(),
  createdAt: z.string(), // ISO8601; DB returns Date but wire is string
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;

export const CreateAccountSchema = z.object({
  name: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  country: z.string().trim().length(2).default("IN"),
  postalCode: z.string().trim().max(20).optional(),
  gstin: z.string().trim().max(32).optional(),
  healthScore: z.number().int().min(0).max(100).default(50),
  isKeyAccount: z.boolean().default(false),
  annualRevenue: decimalStr.optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  ownerId: uuid.optional(),
});
export type CreateAccount = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = CreateAccountSchema.partial();
export type UpdateAccount = z.infer<typeof UpdateAccountSchema>;

export const AccountListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().min(1).max(200).optional(),
  industry: z.string().trim().min(1).max(80).optional(),
  ownerId: uuid.optional(),
  isKeyAccount: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

// ─── Contacts ────────────────────────────────────────────────────────────────

export const ContactSchema = z.object({
  id: uuid,
  orgId: uuid,
  accountId: uuid,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  designation: z.string().nullable(),
  department: z.string().nullable(),
  isPrimary: z.boolean(),
  linkedinUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const CreateContactSchema = z.object({
  accountId: uuid,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).optional(),
  designation: z.string().trim().max(120).optional(),
  department: z.string().trim().max(80).optional(),
  isPrimary: z.boolean().default(false),
  linkedinUrl: z.string().trim().url().optional(),
});
export type CreateContact = z.infer<typeof CreateContactSchema>;

export const UpdateContactSchema = CreateContactSchema.partial();
export type UpdateContact = z.infer<typeof UpdateContactSchema>;

export const ContactListQuerySchema = PaginationQuerySchema.extend({
  accountId: uuid.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

// ─── Leads ───────────────────────────────────────────────────────────────────

export const LeadSchema = z.object({
  id: uuid,
  orgId: uuid,
  name: z.string(),
  company: z.string(),
  email: z.string(),
  phone: z.string(),
  status: LeadStatusSchema,
  source: z.string().nullable(),
  assignedTo: uuid.nullable(),
  estimatedValue: decimalStr,
  isDuplicate: z.boolean(),
  duplicateOfLeadId: uuid.nullable(),
  convertedToAccountId: uuid.nullable(),
  convertedToDealId: uuid.nullable(),
  lostReason: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const CreateLeadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1).max(40),
  source: z.string().trim().max(80).optional(),
  assignedTo: uuid.optional(),
  estimatedValue: decimalStr.default("0"),
});
export type CreateLead = z.infer<typeof CreateLeadSchema>;

export const UpdateLeadSchema = CreateLeadSchema.partial();
export type UpdateLead = z.infer<typeof UpdateLeadSchema>;

export const LeadListQuerySchema = PaginationQuerySchema.extend({
  status: LeadStatusSchema.optional(),
  assignedTo: uuid.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const AddLeadActivitySchema = z.object({
  type: LeadActivityTypeSchema,
  content: z.string().trim().min(1).max(2000),
});
export type AddLeadActivity = z.infer<typeof AddLeadActivitySchema>;

export const LeadActivitySchema = z.object({
  id: uuid,
  orgId: uuid,
  leadId: uuid,
  type: LeadActivityTypeSchema,
  content: z.string(),
  actorId: uuid.nullable(),
  createdAt: z.string(),
});
export type LeadActivity = z.infer<typeof LeadActivitySchema>;

export const MarkLeadLostSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type MarkLeadLost = z.infer<typeof MarkLeadLostSchema>;

export const ConvertLeadSchema = z.object({
  dealTitle: z.string().trim().min(1).max(200),
  dealValue: decimalStr,
  dealStage: DealStageSchema.default("DISCOVERY"),
  expectedClose: z.string().date().optional(),
});
export type ConvertLead = z.infer<typeof ConvertLeadSchema>;

// ─── Deals ───────────────────────────────────────────────────────────────────

export const DealSchema = z.object({
  id: uuid,
  orgId: uuid,
  dealNumber: z.string(),
  title: z.string(),
  accountId: uuid.nullable(),
  contactId: uuid.nullable(),
  company: z.string(),
  contactName: z.string(),
  stage: DealStageSchema,
  value: decimalStr,
  probability: z.number().int().min(0).max(100),
  assignedTo: uuid.nullable(),
  expectedClose: z.string().nullable(),
  closedAt: z.string().nullable(),
  lostReason: z.string().nullable(),
  leadId: uuid.nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Deal = z.infer<typeof DealSchema>;

export const CreateDealSchema = z.object({
  title: z.string().trim().min(1).max(200),
  accountId: uuid.optional(),
  contactId: uuid.optional(),
  company: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  stage: DealStageSchema.default("DISCOVERY"),
  value: decimalStr.default("0"),
  probability: z.number().int().min(0).max(100).default(20),
  assignedTo: uuid.optional(),
  expectedClose: z.string().date().optional(),
  leadId: uuid.optional(),
});
export type CreateDeal = z.infer<typeof CreateDealSchema>;

export const UpdateDealSchema = CreateDealSchema.partial().extend({
  // Optimistic lock: clients pass the version they read. If it moved, we 409.
  expectedVersion: z.number().int().positive(),
});
export type UpdateDeal = z.infer<typeof UpdateDealSchema>;

export const DealListQuerySchema = PaginationQuerySchema.extend({
  stage: DealStageSchema.optional(),
  assignedTo: uuid.optional(),
  accountId: uuid.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const TransitionDealStageSchema = z.object({
  stage: DealStageSchema,
  expectedVersion: z.number().int().positive(),
  // Required on CLOSED_LOST.
  lostReason: z.string().trim().max(500).optional(),
});
export type TransitionDealStage = z.infer<typeof TransitionDealStageSchema>;

// ─── Tickets ─────────────────────────────────────────────────────────────────

export const TicketSchema = z.object({
  id: uuid,
  orgId: uuid,
  ticketNumber: z.string(),
  accountId: uuid.nullable(),
  contactId: uuid.nullable(),
  subject: z.string(),
  description: z.string(),
  category: TicketCategorySchema,
  priority: TicketPrioritySchema,
  status: TicketStatusSchema,
  deviceSerial: z.string().nullable(),
  productCode: z.string().nullable(),
  assignedTo: uuid.nullable(),
  slaDeadline: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const CreateTicketSchema = z.object({
  accountId: uuid.optional(),
  contactId: uuid.optional(),
  subject: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
  category: TicketCategorySchema,
  priority: TicketPrioritySchema.default("MEDIUM"),
  deviceSerial: z.string().trim().max(120).optional(),
  productCode: z.string().trim().max(80).optional(),
  assignedTo: uuid.optional(),
  slaDeadline: z.string().datetime().optional(),
});
export type CreateTicket = z.infer<typeof CreateTicketSchema>;

export const UpdateTicketSchema = CreateTicketSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateTicket = z.infer<typeof UpdateTicketSchema>;

export const TicketListQuerySchema = PaginationQuerySchema.extend({
  status: TicketStatusSchema.optional(),
  priority: TicketPrioritySchema.optional(),
  assignedTo: uuid.optional(),
  accountId: uuid.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const TransitionTicketStatusSchema = z.object({
  status: TicketStatusSchema,
  expectedVersion: z.number().int().positive(),
});
export type TransitionTicketStatus = z.infer<
  typeof TransitionTicketStatusSchema
>;

export const TicketCommentSchema = z.object({
  id: uuid,
  orgId: uuid,
  ticketId: uuid,
  visibility: TicketCommentVisibilitySchema,
  actorId: uuid.nullable(),
  content: z.string(),
  createdAt: z.string(),
});
export type TicketComment = z.infer<typeof TicketCommentSchema>;

export const AddTicketCommentSchema = z.object({
  visibility: TicketCommentVisibilitySchema.default("INTERNAL"),
  content: z.string().trim().min(1).max(4000),
});
export type AddTicketComment = z.infer<typeof AddTicketCommentSchema>;
