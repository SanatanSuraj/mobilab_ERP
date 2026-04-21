/**
 * CRM Drizzle schema. Mirrors ops/sql/init/02-crm.sql.
 *
 * ARCHITECTURE.md §13.1. Every tenant-scoped table has `org_id` and lives
 * under RLS (ops/sql/rls/02-crm-rls.sql). Money/quantities use numeric(18,2)
 * and are parsed as strings via installNumericTypeParser.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./core.js";

// Drizzle doesn't have a built-in citext column type, but the DB-side type
// already is citext — we just declare it as text on this side so Drizzle
// emits a comparable SQL type. Case-insensitive matching happens at the
// column level.
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "citext";
  },
});

// ─── Accounts ────────────────────────────────────────────────────────────────

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    industry: text("industry"),
    website: text("website"),
    phone: text("phone"),
    email: citext("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    country: text("country").notNull().default("IN"),
    postalCode: text("postal_code"),
    gstin: text("gstin"),
    healthScore: integer("health_score").notNull().default(50),
    isKeyAccount: boolean("is_key_account").notNull().default(false),
    annualRevenue: numeric("annual_revenue", { precision: 18, scale: 2 }),
    employeeCount: integer("employee_count"),
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("accounts_org_idx").on(t.orgId),
    ownerIdx: index("accounts_owner_idx").on(t.orgId, t.ownerId),
    nameUnique: uniqueIndex("accounts_name_org_unique").on(
      t.orgId,
      sql`lower(${t.name})`
    ),
  })
);

// ─── Contacts ────────────────────────────────────────────────────────────────

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: citext("email"),
    phone: text("phone"),
    designation: text("designation"),
    department: text("department"),
    isPrimary: boolean("is_primary").notNull().default(false),
    linkedinUrl: text("linkedin_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("contacts_org_idx").on(t.orgId),
    accountIdx: index("contacts_account_idx").on(t.orgId, t.accountId),
  })
);

// ─── Leads ───────────────────────────────────────────────────────────────────

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    company: text("company").notNull(),
    email: citext("email").notNull(),
    phone: text("phone").notNull(),
    // CHECK-constrained enum. We type it as string here; the Zod contract
    // narrows it for the API boundary.
    status: text("status").notNull().default("NEW"),
    source: text("source"),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    estimatedValue: numeric("estimated_value", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    isDuplicate: boolean("is_duplicate").notNull().default(false),
    duplicateOfLeadId: uuid("duplicate_of_lead_id"),
    convertedToAccountId: uuid("converted_to_account_id").references(
      () => accounts.id,
      { onDelete: "set null" }
    ),
    // deal FK is added server-side via deferred ALTER (see SQL). Drizzle
    // models it as a plain uuid to avoid circular imports.
    convertedToDealId: uuid("converted_to_deal_id"),
    lostReason: text("lost_reason"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("leads_org_idx").on(t.orgId),
    statusIdx: index("leads_status_idx").on(t.orgId, t.status),
    assignedIdx: index("leads_assigned_idx").on(t.orgId, t.assignedTo),
    emailIdx: index("leads_email_idx").on(t.orgId, t.email),
  })
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    content: text("content").notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("lead_activities_org_idx").on(t.orgId),
    leadIdx: index("lead_activities_lead_idx").on(t.leadId, t.createdAt),
  })
);

// ─── Deals ───────────────────────────────────────────────────────────────────

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    dealNumber: text("deal_number").notNull(),
    title: text("title").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    company: text("company").notNull(),
    contactName: text("contact_name").notNull(),
    stage: text("stage").notNull().default("DISCOVERY"),
    value: numeric("value", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    probability: integer("probability").notNull().default(20),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    expectedClose: date("expected_close"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    leadId: uuid("lead_id").references(() => leads.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("deals_org_idx").on(t.orgId),
    stageIdx: index("deals_stage_idx").on(t.orgId, t.stage),
    assignedIdx: index("deals_assigned_idx").on(t.orgId, t.assignedTo),
    accountIdx: index("deals_account_idx").on(t.orgId, t.accountId),
    dealNumberUnique: uniqueIndex("deals_number_org_unique").on(
      t.orgId,
      t.dealNumber
    ),
  })
);

export const dealLineItems = pgTable(
  "deal_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("deal_line_items_org_idx").on(t.orgId),
    dealIdx: index("deal_line_items_deal_idx").on(t.dealId),
  })
);

// ─── Tickets ─────────────────────────────────────────────────────────────────

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ticketNumber: text("ticket_number").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    priority: text("priority").notNull().default("MEDIUM"),
    status: text("status").notNull().default("OPEN"),
    deviceSerial: text("device_serial"),
    productCode: text("product_code"),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    slaDeadline: timestamp("sla_deadline", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("tickets_org_idx").on(t.orgId),
    statusIdx: index("tickets_status_idx").on(t.orgId, t.status),
    priorityIdx: index("tickets_priority_idx").on(t.orgId, t.priority),
    assignedIdx: index("tickets_assigned_idx").on(t.orgId, t.assignedTo),
    accountIdx: index("tickets_account_idx").on(t.orgId, t.accountId),
    numberUnique: uniqueIndex("tickets_number_org_unique").on(
      t.orgId,
      t.ticketNumber
    ),
  })
);

export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    visibility: text("visibility").notNull().default("INTERNAL"),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("ticket_comments_org_idx").on(t.orgId),
    ticketIdx: index("ticket_comments_ticket_idx").on(
      t.ticketId,
      t.createdAt
    ),
  })
);

// ─── Number sequences ────────────────────────────────────────────────────────
// Used by the deal + ticket + quotation + sales-order services to produce
// per-org, per-year identifiers.

export const crmNumberSequences = pgTable(
  "crm_number_sequences",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    year: integer("year").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex("crm_number_sequences_pk").on(t.orgId, t.kind, t.year),
  })
);

// ─── Quotations ──────────────────────────────────────────────────────────────

export const quotations = pgTable(
  "quotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quotationNumber: text("quotation_number").notNull(),
    dealId: uuid("deal_id").references(() => deals.id, {
      onDelete: "set null",
    }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    company: text("company").notNull(),
    contactName: text("contact_name").notNull(),
    status: text("status").notNull().default("DRAFT"),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    grandTotal: numeric("grand_total", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    validUntil: date("valid_until"),
    notes: text("notes"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // FK to sales_orders.id — modeled as a bare uuid to avoid a circular
    // import (sales_orders is defined below).
    convertedToOrderId: uuid("converted_to_order_id"),
    rejectedReason: text("rejected_reason"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("quotations_org_idx").on(t.orgId),
    statusIdx: index("quotations_status_idx").on(t.orgId, t.status),
    accountIdx: index("quotations_account_idx").on(t.orgId, t.accountId),
    dealIdx: index("quotations_deal_idx").on(t.orgId, t.dealId),
    numberUnique: uniqueIndex("quotations_number_org_unique").on(
      t.orgId,
      t.quotationNumber
    ),
  })
);

export const quotationLineItems = pgTable(
  "quotation_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    taxPct: numeric("tax_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("quotation_line_items_org_idx").on(t.orgId),
    quotationIdx: index("quotation_line_items_quotation_idx").on(t.quotationId),
  })
);

// ─── Sales Orders ────────────────────────────────────────────────────────────

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    orderNumber: text("order_number").notNull(),
    quotationId: uuid("quotation_id").references(() => quotations.id, {
      onDelete: "set null",
    }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    company: text("company").notNull(),
    contactName: text("contact_name").notNull(),
    status: text("status").notNull().default("DRAFT"),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    grandTotal: numeric("grand_total", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    expectedDelivery: date("expected_delivery"),
    financeApprovedBy: uuid("finance_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    financeApprovedAt: timestamp("finance_approved_at", {
      withTimezone: true,
    }),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("sales_orders_org_idx").on(t.orgId),
    statusIdx: index("sales_orders_status_idx").on(t.orgId, t.status),
    accountIdx: index("sales_orders_account_idx").on(t.orgId, t.accountId),
    quotationIdx: index("sales_orders_quotation_idx").on(
      t.orgId,
      t.quotationId
    ),
    numberUnique: uniqueIndex("sales_orders_number_org_unique").on(
      t.orgId,
      t.orderNumber
    ),
  })
);

export const salesOrderLineItems = pgTable(
  "sales_order_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    taxPct: numeric("tax_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("sales_order_line_items_org_idx").on(t.orgId),
    orderIdx: index("sales_order_line_items_order_idx").on(t.orderId),
  })
);
