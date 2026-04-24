// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

export type LeadStatus = "new" | "contacted" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export type DealStage = "discovery" | "proposal" | "negotiation" | "closed_won" | "closed_lost";
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type WorkOrderStatus = "planned" | "in_progress" | "quality_check" | "completed" | "on_hold";
export type LeaveStatus = "pending" | "approved" | "rejected";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "critical";

// --- Users ---
export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  department: string;
}

export const users: User[] = [];

// --- Products ---
export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  unit: string;
  stock: number;
  warehouse: string;
}

export const products: Product[] = [];

// --- Leads ---
export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: LeadStatus;
  source: string;
  assignedTo: string;
  value: number;
  createdAt: string;
  lastActivity: string;
}

export const leads: Lead[] = [];

// --- Deals ---
export interface Deal {
  id: string;
  title: string;
  company: string;
  contactName: string;
  stage: DealStage;
  value: number;
  probability: number;
  assignedTo: string;
  expectedClose: string;
  createdAt: string;
  leadId?: string;
  products: { productId: string; quantity: number }[];
}

export const deals: Deal[] = [];

// --- Sales Orders ---
export interface SalesOrder {
  id: string;
  dealId: string;
  orderNumber: string;
  customer: string;
  status: "draft" | "confirmed" | "processing" | "shipped" | "delivered";
  items: { productId: string; quantity: number; unitPrice: number }[];
  total: number;
  createdAt: string;
  deliveryDate: string;
}

export const salesOrders: SalesOrder[] = [];

// --- Work Orders ---
export interface WorkOrderStage {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  assignedTo: string;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
}

export interface BOMItem {
  productId: string;
  quantity: number;
  consumed: number;
}

export interface WorkOrder {
  id: string;
  orderNumber: string;
  salesOrderId: string;
  productId: string;
  quantity: number;
  status: WorkOrderStatus;
  priority: Priority;
  stages: WorkOrderStage[];
  bom: BOMItem[];
  startDate: string;
  dueDate: string;
  completedDate?: string;
  assignedTo: string;
}

export const workOrders: WorkOrder[] = [];

// --- Inventory / Batches / Serials ---
export interface Batch {
  id: string;
  batchNumber: string;
  productId: string;
  quantity: number;
  manufacturedDate: string;
  expiryDate: string;
  warehouse: string;
  status: "available" | "reserved" | "expired" | "quarantine";
}

export const batches: Batch[] = [];

export interface SerialItem {
  id: string;
  serialNumber: string;
  productId: string;
  batchId?: string;
  status: "in_stock" | "sold" | "warranty" | "returned" | "scrapped";
  warehouse: string;
  soldTo?: string;
  soldDate?: string;
}

export const serialItems: SerialItem[] = [];

// --- Invoices ---
export interface InvoiceItem {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  salesOrderId: string;
  customer: string;
  status: InvoiceStatus;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  issuedDate: string;
  dueDate: string;
  paidDate?: string;
  paidAmount: number;
}

export const invoices: Invoice[] = [];

// --- Employees ---
export interface Employee {
  id: string;
  name: string;
  email: string;
  avatar: string;
  department: string;
  designation: string;
  joinDate: string;
  phone: string;
  status: "active" | "on_leave" | "inactive";
  leaveBalance: { casual: number; sick: number; earned: number };
  reportingTo?: string;
}

export const employees: Employee[] = [];

// --- Leave Requests ---
export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: "casual" | "sick" | "earned";
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  appliedOn: string;
  approvedBy?: string;
}

export const leaveRequests: LeaveRequest[] = [];

// --- Projects & Tasks ---
export interface Project {
  id: string;
  name: string;
  description: string;
  status: "active" | "completed" | "on_hold";
  progress: number;
  startDate: string;
  endDate: string;
  lead: string;
  members: string[];
}

export const projects: Project[] = [];

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignedTo: string;
  dueDate: string;
  createdAt: string;
  tags: string[];
}

export const tasks: Task[] = [];

// --- Activity Feed ---
export interface Activity {
  id: string;
  entityType: "lead" | "deal" | "salesOrder" | "workOrder" | "invoice" | "project" | "task" | "employee" | "leave" | "system";
  entityId: string;
  type: "comment" | "status_change" | "mention" | "system_log" | "creation" | "update";
  user: string;
  content: string;
  timestamp: string;
  mentions?: string[];
}

export const activities: Activity[] = [];

// --- Ledger Entries ---
export interface LedgerEntry {
  id: string;
  date: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  reference: string;
}

export const ledgerEntries: LedgerEntry[] = [];

// --- Quotations ---
export interface Quotation {
  id: string;
  quotationNumber: string;
  dealId: string;
  customer: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  items: { productId: string; quantity: number; unitPrice: number; discount: number }[];
  total: number;
  validUntil: string;
  createdAt: string;
}

export const quotations: Quotation[] = [];

// --- Helper functions ---
export function getUserById(_id: string): User | undefined {
  return undefined;
}

export function getProductById(_id: string): Product | undefined {
  return undefined;
}

export function getActivitiesForEntity(_entityType: string, _entityId: string): Activity[] {
  return [];
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
