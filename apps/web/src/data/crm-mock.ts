// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

export interface Account {
  id: string;
  name: string;
  industry: string;
  website: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
  healthScore: number;
  isKeyAccount: boolean;
  annualRevenue: number;
  employeeCount: number;
  createdAt: string;
  ownerId: string;
}

export interface Contact {
  id: string;
  accountId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  isPrimary: boolean;
  linkedIn?: string;
}

export type EnhancedLeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";

export interface LeadActivity {
  id: string;
  type: "call" | "email" | "whatsapp" | "note" | "meeting" | "status_change";
  content: string;
  timestamp: string;
  user: string;
}

export interface EnhancedLead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: EnhancedLeadStatus;
  source: string;
  assignedTo: string;
  estimatedValue: number;
  createdAt: string;
  lastActivity: string;
  isDuplicate: boolean;
  duplicateOf?: string;
  activities: LeadActivity[];
  convertedToAccountId?: string;
  convertedToDealId?: string;
  lostReason?: string;
}

export interface QuotationLineItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

export interface QuotationVersion {
  version: number;
  items: QuotationLineItem[];
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  createdAt: string;
  createdBy: string;
  notes?: string;
}

export type QuotationStatus = "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "rejected" | "expired";

export interface EnhancedQuotation {
  id: string;
  quotationNumber: string;
  dealId: string;
  accountId: string;
  contactId: string;
  status: QuotationStatus;
  currentVersion: number;
  versions: QuotationVersion[];
  validUntil: string;
  createdAt: string;
  sentAt?: string;
  sentVia?: "email" | "whatsapp";
  requiresApproval: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedBy?: string;
}

export type OrderStatus = "confirmed" | "processing" | "ready_to_dispatch" | "dispatched" | "in_transit" | "delivered";

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  serialNumbers?: string[];
}

export interface Order {
  id: string;
  orderNumber: string;
  dealId: string;
  accountId: string;
  contactId: string;
  quotationRef: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  grandTotal: number;
  status: OrderStatus;
  orderDate: string;
  expectedDelivery: string;
  deliveredDate?: string;
  fgAvailable: boolean;
  whatsappSent: boolean;
  emailSent: boolean;
}

export interface DeliveryChallan {
  id: string;
  challanNumber: string;
  orderId: string;
  items: { productName: string; quantity: number; serialNumbers: string[] }[];
  transporterName: string;
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  dispatchDate: string;
  expectedArrival: string;
  status: "dispatched" | "in_transit" | "delivered";
}

export type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "critical";
export type TicketCategory = "hardware_defect" | "calibration" | "software_bug" | "training" | "warranty_claim" | "general_inquiry";

export interface TicketComment {
  id: string;
  type: "internal" | "customer";
  user: string;
  content: string;
  timestamp: string;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  accountId: string;
  contactId: string;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  deviceSerial?: string;
  productId?: string;
  assignedTo: string;
  slaDeadline: string;
  createdAt: string;
  resolvedAt?: string;
  comments: TicketComment[];
  whatsappNotified: boolean;
}

export interface CrmActivity {
  id: string;
  entityType: "lead" | "deal" | "account" | "order" | "ticket" | "quotation";
  entityId: string;
  type: "comment" | "status_change" | "system_log" | "whatsapp" | "email" | "call" | "meeting";
  user: string;
  content: string;
  timestamp: string;
}

export const accounts: Account[] = [];
export const contacts: Contact[] = [];
export const enhancedLeads: EnhancedLead[] = [];
export const enhancedQuotations: EnhancedQuotation[] = [];
export const orders: Order[] = [];
export const deliveryChallans: DeliveryChallan[] = [];
export const supportTickets: SupportTicket[] = [];
export const crmActivities: CrmActivity[] = [];

// --- Helper functions ---
export function getAccountById(_id: string): Account | undefined {
  return undefined;
}

export function getContactById(_id: string): Contact | undefined {
  return undefined;
}

export function getContactsForAccount(_accountId: string): Contact[] {
  return [];
}

export function getCrmActivitiesForEntity(_entityType: string, _entityId: string): CrmActivity[] {
  return [];
}

export function getHealthScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 bg-green-50 border-green-200";
  if (score >= 60) return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-red-600 bg-red-50 border-red-200";
}

export function getHealthScoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Attention";
  return "At Risk";
}
