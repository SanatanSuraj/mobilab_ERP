/**
 * CRM Service — Data Access Layer
 *
 * ALL CRM data access goes through this file.
 * Pages and components NEVER import from src/data/*.ts directly.
 *
 * Today  → in-memory mutable store on top of mock data.
 *           Mutations survive React Query cache invalidation.
 *           State resets on page reload (prototype behaviour).
 * Tomorrow → replace function bodies with apiFetch('/api/crm/...') calls.
 *            Signatures stay identical — zero page-level changes required.
 *
 * org_id: every real API call MUST pass X-Org-Id via apiFetch().
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getOrgId } from "@/lib/api-client";
import type { Deal, User } from "@/data/mock";
import type {
  EnhancedLead,
  LeadActivity,
  Account,
  Contact,
  EnhancedQuotation,
  Order,
  SupportTicket,
  EnhancedLeadStatus,
} from "@/data/crm-mock";

import {
  enhancedLeads as _seedLeads,
  accounts as _seedAccounts,
  contacts,
  enhancedQuotations,
  orders,
  supportTickets,
} from "@/data/crm-mock";
import { deals as _seedDeals, users, getUserById } from "@/data/mock";

// ─── In-Memory Mutable Stores ────────────────────────────────────────────────
// Initialised from mock seed data. Mutations write here so React Query
// invalidations re-fetch updated data without a page reload.
// Replace with real API calls to remove these entirely.

let _leads: EnhancedLead[] = _seedLeads.map((l) => ({ ...l, activities: [...l.activities] }));
let _accounts: Account[] = [..._seedAccounts];
let _deals: Deal[] = [..._seedDeals];

// ─── ID Generators ───────────────────────────────────────────────────────────

function nextLeadId(): string {
  return `el${Date.now()}`;
}
function nextActivityId(): string {
  return `la${Date.now()}`;
}
function nextAccountId(): string {
  return `acc${Date.now()}`;
}
function nextDealId(): string {
  return `d${Date.now()}`;
}

// ─── Dedup Helper ─────────────────────────────────────────────────────────────

function findDuplicate(email: string, phone: string, excludeId?: string): EnhancedLead | null {
  const e = email.trim().toLowerCase();
  const p = phone.replace(/\s+/g, "");
  return _leads.find((l) =>
    l.id !== excludeId &&
    (l.email.toLowerCase() === e || l.phone.replace(/\s+/g, "") === p)
  ) ?? null;
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface LeadFilters {
  status?: string;
  assignedTo?: string;
  search?: string;
}

export interface DealFilters {
  stage?: string;
  assignedTo?: string;
  search?: string;
}

export interface TicketFilters {
  status?: string;
  priority?: string;
}

export interface CreateLeadInput {
  name: string;
  company: string;
  email: string;
  phone: string;
  source: string;
  assignedTo: string;
  estimatedValue: number;
  note?: string;          // optional first activity
}

export interface AddActivityInput {
  type: LeadActivity["type"];
  content: string;
  userId: string;
}

export interface ConvertLeadInput {
  /** Deal title, defaults to "<company> – <product interest>" */
  dealTitle: string;
  dealValue: number;
  dealStage: Deal["stage"];
  expectedClose: string;  // ISO date string
  assignedTo: string;
}

export interface MarkLostInput {
  reason: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const crmService = {

  // ── Leads — Reads ──────────────────────────────────────────────────────────

  async getLeads(filters?: LeadFilters): Promise<EnhancedLead[]> {
    // API: return apiFetch(`/api/crm/leads?${qs}`).then(r => r.json())
    let result = [..._leads];
    if (filters?.status && filters.status !== "ALL") {
      result = result.filter((l) => l.status === filters.status);
    }
    if (filters?.assignedTo) {
      result = result.filter((l) => l.assignedTo === filters.assignedTo);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.company.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q)
      );
    }
    // Sort: newest first
    return Promise.resolve(result.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ));
  },

  async getLead(id: string): Promise<EnhancedLead | null> {
    // API: return apiFetch(`/api/crm/leads/${id}`).then(r => r.json())
    return Promise.resolve(_leads.find((l) => l.id === id) ?? null);
  },

  // ── Leads — Mutations ─────────────────────────────────────────────────────

  async createLead(input: CreateLeadInput): Promise<EnhancedLead> {
    // API: return apiFetch('/api/crm/leads', { method: 'POST', body: JSON.stringify(input) }).then(r => r.json())
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Dedup check
    const dup = findDuplicate(input.email, input.phone);
    const isDuplicate = Boolean(dup);

    const activities: LeadActivity[] = input.note
      ? [{
          id: nextActivityId(),
          type: "note",
          content: input.note,
          timestamp: now,
          user: input.assignedTo,
        }]
      : [];

    const lead: EnhancedLead = {
      id: nextLeadId(),
      name: input.name.trim(),
      company: input.company.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      status: "new",
      source: input.source,
      assignedTo: input.assignedTo,
      estimatedValue: input.estimatedValue,
      createdAt: today,
      lastActivity: today,
      isDuplicate,
      duplicateOf: dup?.id,
      activities,
    };

    _leads = [lead, ..._leads];
    return Promise.resolve(lead);
  },

  async updateLeadStatus(id: string, status: EnhancedLeadStatus): Promise<EnhancedLead> {
    // API: return apiFetch(`/api/crm/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }).then(r => r.json())
    const idx = _leads.findIndex((l) => l.id === id);
    if (idx === -1) throw new Error(`Lead ${id} not found`);
    const now = new Date().toISOString();
    const activity: LeadActivity = {
      id: nextActivityId(),
      type: "status_change",
      content: `Status changed to ${status.replace(/_/g, " ")}.`,
      timestamp: now,
      user: "system",
    };
    const updated = {
      ..._leads[idx],
      status,
      lastActivity: now.slice(0, 10),
      activities: [..._leads[idx].activities, activity],
    };
    _leads = _leads.map((l) => l.id === id ? updated : l);
    return Promise.resolve(updated);
  },

  async addLeadActivity(leadId: string, input: AddActivityInput): Promise<EnhancedLead> {
    // API: return apiFetch(`/api/crm/leads/${leadId}/activities`, { method: 'POST', body: JSON.stringify(input) }).then(r => r.json())
    const idx = _leads.findIndex((l) => l.id === leadId);
    if (idx === -1) throw new Error(`Lead ${leadId} not found`);
    const now = new Date().toISOString();
    const activity: LeadActivity = {
      id: nextActivityId(),
      type: input.type,
      content: input.content.trim(),
      timestamp: now,
      user: input.userId,
    };
    // Status auto-advance: first contact moves new → contacted
    const lead = _leads[idx];
    const newStatus: EnhancedLeadStatus =
      lead.status === "new" &&
      (input.type === "call" || input.type === "email" || input.type === "whatsapp" || input.type === "meeting")
        ? "contacted"
        : lead.status;

    const updated: EnhancedLead = {
      ...lead,
      status: newStatus,
      lastActivity: now.slice(0, 10),
      activities: [...lead.activities, activity],
    };
    _leads = _leads.map((l) => l.id === leadId ? updated : l);
    return Promise.resolve(updated);
  },

  async markLeadLost(leadId: string, input: MarkLostInput): Promise<EnhancedLead> {
    // API: return apiFetch(`/api/crm/leads/${leadId}/lost`, { method: 'PATCH', body: JSON.stringify(input) }).then(r => r.json())
    const idx = _leads.findIndex((l) => l.id === leadId);
    if (idx === -1) throw new Error(`Lead ${leadId} not found`);
    const now = new Date().toISOString();
    const activity: LeadActivity = {
      id: nextActivityId(),
      type: "status_change",
      content: `Lead marked as lost. Reason: ${input.reason}`,
      timestamp: now,
      user: "system",
    };
    const updated: EnhancedLead = {
      ..._leads[idx],
      status: "lost",
      lostReason: input.reason,
      lastActivity: now.slice(0, 10),
      activities: [..._leads[idx].activities, activity],
    };
    _leads = _leads.map((l) => l.id === leadId ? updated : l);
    return Promise.resolve(updated);
  },

  async convertLead(leadId: string, input: ConvertLeadInput): Promise<{
    lead: EnhancedLead;
    account: Account;
    deal: Deal;
  }> {
    // API: return apiFetch(`/api/crm/leads/${leadId}/convert`, { method: 'POST', body: JSON.stringify(input) }).then(r => r.json())
    const idx = _leads.findIndex((l) => l.id === leadId);
    if (idx === -1) throw new Error(`Lead ${leadId} not found`);
    const lead = _leads[idx];
    if (lead.status === "converted") throw new Error("Lead is already converted");

    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    // Create Account from lead
    const account: Account = {
      id: nextAccountId(),
      name: lead.company,
      industry: "Healthcare",  // default — sales rep can update on account page
      website: "",
      phone: lead.phone,
      address: "",
      city: "",
      state: "",
      gstin: "",
      healthScore: 50,
      isKeyAccount: false,
      annualRevenue: 0,
      employeeCount: 0,
      createdAt: today,
      ownerId: input.assignedTo,
    };
    _accounts = [account, ..._accounts];

    // Create Deal from lead
    const deal: Deal = {
      id: nextDealId(),
      title: input.dealTitle,
      company: lead.company,
      contactName: lead.name,
      stage: input.dealStage,
      value: input.dealValue,
      probability: input.dealStage === "discovery" ? 20 : input.dealStage === "proposal" ? 50 : 70,
      assignedTo: input.assignedTo,
      expectedClose: input.expectedClose,
      createdAt: today,
      leadId,
      products: [],
    };
    _deals = [deal, ..._deals];

    // Update lead
    const activity: LeadActivity = {
      id: nextActivityId(),
      type: "status_change",
      content: `Lead converted. Account "${account.name}" and Deal "${deal.title}" created.`,
      timestamp: now,
      user: input.assignedTo,
    };
    const updatedLead: EnhancedLead = {
      ...lead,
      status: "converted",
      convertedToAccountId: account.id,
      convertedToDealId: deal.id,
      lastActivity: today,
      activities: [...lead.activities, activity],
    };
    _leads = _leads.map((l) => l.id === leadId ? updatedLead : l);

    return Promise.resolve({ lead: updatedLead, account, deal });
  },

  async importLeads(rows: CreateLeadInput[]): Promise<{ created: number; duplicates: number }> {
    // API: return apiFetch('/api/crm/leads/import', { method: 'POST', body: JSON.stringify({ rows }) }).then(r => r.json())
    let created = 0;
    let duplicates = 0;
    for (const row of rows) {
      const dup = findDuplicate(row.email, row.phone);
      if (dup) {
        // Mark existing as duplicate but still import
        duplicates++;
      }
      await crmService.createLead(row);
      created++;
    }
    return Promise.resolve({ created, duplicates });
  },

  // ── Deals ─────────────────────────────────────────────────────────────────

  async getDeals(filters?: DealFilters): Promise<Deal[]> {
    // API: return apiFetch(`/api/crm/deals?${qs}`).then(r => r.json())
    let result = [..._deals];
    if (filters?.stage && filters.stage !== "ALL") {
      result = result.filter((d) => d.stage === filters.stage);
    }
    if (filters?.assignedTo) {
      result = result.filter((d) => d.assignedTo === filters.assignedTo);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.company.toLowerCase().includes(q)
      );
    }
    return Promise.resolve(result);
  },

  async getDeal(id: string): Promise<Deal | null> {
    // API: return apiFetch(`/api/crm/deals/${id}`).then(r => r.json())
    return Promise.resolve(_deals.find((d) => d.id === id) ?? null);
  },

  async updateDealStage(id: string, stage: Deal["stage"]): Promise<Deal> {
    // API: return apiFetch(`/api/crm/deals/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage }) }).then(r => r.json())
    const idx = _deals.findIndex((d) => d.id === id);
    if (idx === -1) throw new Error(`Deal ${id} not found`);
    const updated = { ..._deals[idx], stage };
    _deals = _deals.map((d) => d.id === id ? updated : d);
    return Promise.resolve(updated);
  },

  // ── Accounts ──────────────────────────────────────────────────────────────

  async getAccounts(): Promise<Account[]> {
    // API: return apiFetch('/api/crm/accounts').then(r => r.json())
    return Promise.resolve([..._accounts]);
  },

  async getAccount(id: string): Promise<Account | null> {
    // API: return apiFetch(`/api/crm/accounts/${id}`).then(r => r.json())
    return Promise.resolve(_accounts.find((a) => a.id === id) ?? null);
  },

  // ── Contacts ──────────────────────────────────────────────────────────────

  async getContacts(accountId?: string): Promise<Contact[]> {
    // API: return apiFetch(`/api/crm/contacts?accountId=${accountId}`).then(r => r.json())
    let result = [...contacts];
    if (accountId) result = result.filter((c) => c.accountId === accountId);
    return Promise.resolve(result);
  },

  // ── Quotations ────────────────────────────────────────────────────────────

  async getQuotations(): Promise<EnhancedQuotation[]> {
    return Promise.resolve(enhancedQuotations);
  },

  // ── Orders ────────────────────────────────────────────────────────────────

  async getOrders(): Promise<Order[]> {
    return Promise.resolve(orders);
  },

  // ── Tickets ───────────────────────────────────────────────────────────────

  async getTickets(filters?: TicketFilters): Promise<SupportTicket[]> {
    // API: return apiFetch(`/api/crm/tickets?${qs}`).then(r => r.json())
    let result = [...supportTickets];
    if (filters?.status) result = result.filter((t) => t.status === filters.status);
    if (filters?.priority) result = result.filter((t) => t.priority === filters.priority);
    return Promise.resolve(result);
  },

  // ── Users ─────────────────────────────────────────────────────────────────

  async getUsers(): Promise<User[]> {
    return Promise.resolve(users);
  },

  getUserById(id: string): User | undefined {
    return getUserById(id);
  },
};
