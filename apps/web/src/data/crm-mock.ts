// ============================================================
// ENHANCED CRM MODULE - Mock Data
// ============================================================

import { formatCurrency, formatDate } from "./mock";

// --- Accounts ---
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
  healthScore: number; // 0-100
  isKeyAccount: boolean;
  annualRevenue: number;
  employeeCount: number;
  createdAt: string;
  ownerId: string;
}

export const accounts: Account[] = [
  { id: "acc1", name: "LifeCare Hospitals Pvt Ltd", industry: "Healthcare", website: "lifecare.in", phone: "+91 22 4567 8901", address: "Andheri East", city: "Mumbai", state: "Maharashtra", gstin: "27AABCL1234F1Z5", healthScore: 72, isKeyAccount: true, annualRevenue: 50000000, employeeCount: 500, createdAt: "2024-06-15", ownerId: "u1" },
  { id: "acc2", name: "Apollo Diagnostics Ltd", industry: "Diagnostics", website: "apollo.in", phone: "+91 80 2345 6789", address: "Koramangala", city: "Bangalore", state: "Karnataka", gstin: "29AABCA5678G2Z3", healthScore: 88, isKeyAccount: true, annualRevenue: 120000000, employeeCount: 1200, createdAt: "2024-03-10", ownerId: "u1" },
  { id: "acc3", name: "CureWell Pharma Industries", industry: "Pharma", website: "curewell.in", phone: "+91 79 3456 7890", address: "SG Highway", city: "Ahmedabad", state: "Gujarat", gstin: "24AABCC9012H3Z1", healthScore: 65, isKeyAccount: false, annualRevenue: 30000000, employeeCount: 200, createdAt: "2025-01-20", ownerId: "u2" },
  { id: "acc4", name: "MedTech India Solutions", industry: "MedTech", website: "medtech.in", phone: "+91 22 5678 9012", address: "BKC", city: "Mumbai", state: "Maharashtra", gstin: "27AABCM3456J4Z9", healthScore: 92, isKeyAccount: true, annualRevenue: 80000000, employeeCount: 350, createdAt: "2024-09-05", ownerId: "u2" },
  { id: "acc5", name: "BioGenesis Labs LLP", industry: "Biotech", website: "biogenesis.in", phone: "+91 40 6789 0123", address: "HITEC City", city: "Hyderabad", state: "Telangana", gstin: "36AABCB7890K5Z7", healthScore: 45, isKeyAccount: false, annualRevenue: 15000000, employeeCount: 80, createdAt: "2025-08-12", ownerId: "u1" },
  { id: "acc6", name: "Medipoint Labs", industry: "Diagnostics", website: "medipoint.in", phone: "+91 44 7890 1234", address: "T Nagar", city: "Chennai", state: "Tamil Nadu", gstin: "33AABCM4567L6Z8", healthScore: 58, isKeyAccount: false, annualRevenue: 8000000, employeeCount: 45, createdAt: "2025-11-01", ownerId: "u2" },
  { id: "acc7", name: "PathLab Solutions Inc", industry: "Diagnostics", website: "pathlab.in", phone: "+91 11 8901 2345", address: "Connaught Place", city: "Delhi", state: "Delhi", gstin: "07AABCP5678M7Z6", healthScore: 34, isKeyAccount: false, annualRevenue: 5000000, employeeCount: 30, createdAt: "2025-12-10", ownerId: "u1" },
];

// --- Contacts ---
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

export const contacts: Contact[] = [
  { id: "con1", accountId: "acc1", firstName: "Rakesh", lastName: "Gupta", email: "rakesh@lifecare.in", phone: "+91 98765 43210", designation: "Chief Medical Officer", department: "Medical", isPrimary: true },
  { id: "con2", accountId: "acc1", firstName: "Pooja", lastName: "Menon", email: "pooja@lifecare.in", phone: "+91 98765 43211", designation: "Procurement Head", department: "Procurement", isPrimary: false },
  { id: "con3", accountId: "acc2", firstName: "Meena", lastName: "Krishnan", email: "meena@apollo.in", phone: "+91 87654 32109", designation: "VP Operations", department: "Operations", isPrimary: true },
  { id: "con4", accountId: "acc2", firstName: "Suresh", lastName: "Nair", email: "suresh@apollo.in", phone: "+91 87654 32110", designation: "Lab Director", department: "Lab", isPrimary: false },
  { id: "con5", accountId: "acc3", firstName: "Amit", lastName: "Joshi", email: "amit@curewell.in", phone: "+91 54321 09876", designation: "CEO", department: "Management", isPrimary: true },
  { id: "con6", accountId: "acc4", firstName: "Fatima", lastName: "Shaikh", email: "fatima@medtech.in", phone: "+91 43210 98765", designation: "CTO", department: "Technology", isPrimary: true },
  { id: "con7", accountId: "acc4", firstName: "Nikhil", lastName: "Kapoor", email: "nikhil@medtech.in", phone: "+91 43210 98766", designation: "Purchase Manager", department: "Procurement", isPrimary: false },
  { id: "con8", accountId: "acc5", firstName: "Ravi", lastName: "Shankar", email: "ravi@biogenesis.in", phone: "+91 32109 87654", designation: "Founder & CEO", department: "Management", isPrimary: true },
  { id: "con9", accountId: "acc6", firstName: "Sanjay", lastName: "Reddy", email: "sanjay@medipoint.in", phone: "+91 76543 21098", designation: "Lab Manager", department: "Lab", isPrimary: true },
  { id: "con10", accountId: "acc7", firstName: "Kavita", lastName: "Nair", email: "kavita@pathlab.in", phone: "+91 65432 10987", designation: "Director", department: "Management", isPrimary: true },
];

// --- Enhanced Leads ---
export type EnhancedLeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";

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

export interface LeadActivity {
  id: string;
  type: "call" | "email" | "whatsapp" | "note" | "meeting" | "status_change";
  content: string;
  timestamp: string;
  user: string;
}

export const enhancedLeads: EnhancedLead[] = [
  {
    id: "el1", name: "Dr. Rakesh Gupta", company: "LifeCare Hospitals", email: "rakesh@lifecare.in", phone: "+91 98765 43210",
    status: "converted", source: "Trade Show", assignedTo: "u2", estimatedValue: 450000, createdAt: "2025-10-01", lastActivity: "2025-12-15",
    isDuplicate: false, convertedToAccountId: "acc1", convertedToDealId: "d1",
    activities: [
      { id: "la1", type: "note", content: "Met at BioMed India 2025 expo. Interested in glucose monitors.", timestamp: "2025-10-01T10:00:00Z", user: "u2" },
      { id: "la2", type: "call", content: "Introductory call. Discussed product range and pricing.", timestamp: "2025-10-15T14:00:00Z", user: "u2" },
      { id: "la3", type: "email", content: "Sent product catalog and pricing sheet.", timestamp: "2025-10-20T09:00:00Z", user: "u2" },
      { id: "la4", type: "meeting", content: "On-site demo at LifeCare Mumbai. Dr. Gupta and procurement team attended.", timestamp: "2025-11-10T11:00:00Z", user: "u1" },
      { id: "la5", type: "status_change", content: "Lead converted to Account and Deal.", timestamp: "2025-12-15T16:00:00Z", user: "u2" },
    ],
  },
  {
    id: "el2", name: "Meena Krishnan", company: "Apollo Diagnostics", email: "meena@apollo.in", phone: "+91 87654 32109",
    status: "converted", source: "Website", assignedTo: "u1", estimatedValue: 1200000, createdAt: "2025-09-15", lastActivity: "2025-11-20",
    isDuplicate: false, convertedToAccountId: "acc2", convertedToDealId: "d2",
    activities: [
      { id: "la6", type: "email", content: "Inbound inquiry via website. Interested in bulk analyzer kits.", timestamp: "2025-09-15T08:00:00Z", user: "system" },
      { id: "la7", type: "call", content: "Discovery call. Large diagnostics chain, 200+ centers.", timestamp: "2025-09-20T10:00:00Z", user: "u1" },
      { id: "la8", type: "whatsapp", content: "Shared quick comparison doc via WhatsApp.", timestamp: "2025-10-05T15:00:00Z", user: "u1" },
      { id: "la9", type: "status_change", content: "Qualified. Budget confirmed, decision timeline Q1 2026.", timestamp: "2025-10-15T12:00:00Z", user: "u1" },
    ],
  },
  {
    id: "el3", name: "Sanjay Reddy", company: "Medipoint Labs", email: "sanjay@medipoint.in", phone: "+91 76543 21098",
    status: "new", source: "Referral", assignedTo: "u2", estimatedValue: 85000, createdAt: "2026-01-10", lastActivity: "2026-01-10",
    isDuplicate: true, duplicateOf: "el9",
    activities: [
      { id: "la10", type: "note", content: "Referred by Dr. Gupta from LifeCare.", timestamp: "2026-01-10T09:00:00Z", user: "u2" },
    ],
  },
  {
    id: "el4", name: "Kavita Nair", company: "PathLab Solutions", email: "kavita@pathlab.in", phone: "+91 65432 10987",
    status: "contacted", source: "LinkedIn", assignedTo: "u1", estimatedValue: 320000, createdAt: "2025-12-20", lastActivity: "2026-01-18",
    isDuplicate: false,
    activities: [
      { id: "la11", type: "email", content: "Cold outreach via LinkedIn InMail.", timestamp: "2025-12-20T10:00:00Z", user: "u1" },
      { id: "la12", type: "call", content: "Follow-up call. Interested but evaluating competitors.", timestamp: "2026-01-10T11:00:00Z", user: "u1" },
      { id: "la13", type: "whatsapp", content: "Sent case study: 'How LifeCare reduced testing costs by 30%'", timestamp: "2026-01-18T16:00:00Z", user: "u1" },
    ],
  },
  {
    id: "el5", name: "Vikrant Malhotra", company: "NovaCare Clinics", email: "vikrant@novacare.in", phone: "+91 98123 45678",
    status: "qualified", source: "Cold Call", assignedTo: "u2", estimatedValue: 560000, createdAt: "2025-11-05", lastActivity: "2026-02-01",
    isDuplicate: false,
    activities: [
      { id: "la14", type: "call", content: "Cold call. Chain of 15 clinics across Pune.", timestamp: "2025-11-05T14:00:00Z", user: "u2" },
      { id: "la15", type: "meeting", content: "Virtual demo. 8 attendees including CFO.", timestamp: "2025-12-10T10:00:00Z", user: "u2" },
      { id: "la16", type: "note", content: "Budget approved. Moving to proposal stage.", timestamp: "2026-02-01T09:00:00Z", user: "u2" },
    ],
  },
  {
    id: "el6", name: "Priyanka Dutta", company: "HealthFirst Labs", email: "priyanka@healthfirst.in", phone: "+91 91234 56789",
    status: "new", source: "Website", assignedTo: "u1", estimatedValue: 150000, createdAt: "2026-02-08", lastActivity: "2026-02-08",
    isDuplicate: false,
    activities: [
      { id: "la17", type: "email", content: "Downloaded product brochure from website.", timestamp: "2026-02-08T07:00:00Z", user: "system" },
    ],
  },
  {
    id: "el7", name: "Arjun Bhat", company: "Pinnacle Hospitals", email: "arjun@pinnacle.in", phone: "+91 82345 67890",
    status: "lost", source: "Trade Show", assignedTo: "u2", estimatedValue: 280000, createdAt: "2025-08-20", lastActivity: "2025-12-30",
    isDuplicate: false, lostReason: "Chose competitor - lower pricing from MedEquip Corp",
    activities: [
      { id: "la18", type: "note", content: "Met at expo. Interested in centrifuge line.", timestamp: "2025-08-20T10:00:00Z", user: "u2" },
      { id: "la19", type: "call", content: "Multiple follow-ups. Price is a concern.", timestamp: "2025-11-15T14:00:00Z", user: "u2" },
      { id: "la20", type: "status_change", content: "Lost to competitor. MedEquip offered 20% lower pricing.", timestamp: "2025-12-30T10:00:00Z", user: "u2" },
    ],
  },
  {
    id: "el8", name: "Neha Sharma", company: "DiagPlus Network", email: "neha@diagplus.in", phone: "+91 73456 78901",
    status: "contacted", source: "Referral", assignedTo: "u1", estimatedValue: 720000, createdAt: "2026-01-25", lastActivity: "2026-02-10",
    isDuplicate: false,
    activities: [
      { id: "la21", type: "note", content: "Referred by Meena from Apollo. Network of 50+ diagnostic centers.", timestamp: "2026-01-25T09:00:00Z", user: "u1" },
      { id: "la22", type: "call", content: "Intro call. Very interested in full platform deal.", timestamp: "2026-02-05T10:00:00Z", user: "u1" },
      { id: "la23", type: "email", content: "Sent pricing proposal and ROI calculator.", timestamp: "2026-02-10T11:00:00Z", user: "u1" },
    ],
  },
];

// --- Enhanced Quotations with versioning ---
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

export interface QuotationLineItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
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

export const enhancedQuotations: EnhancedQuotation[] = [
  {
    id: "eq1", quotationNumber: "QT-2026-001", dealId: "d1", accountId: "acc1", contactId: "con1",
    status: "sent", currentVersion: 2, validUntil: "2026-03-15", createdAt: "2026-01-18",
    sentAt: "2026-01-25", sentVia: "email", requiresApproval: false,
    versions: [
      { version: 1, items: [{ productId: "p1", productName: "BioSense Glucose Monitor", sku: "BSG-001", quantity: 100, unitPrice: 4500, discount: 0, lineTotal: 450000 }], subtotal: 450000, discountPercent: 0, discountAmount: 0, taxAmount: 81000, grandTotal: 531000, createdAt: "2026-01-18", createdBy: "u2", notes: "Initial quote at list price" },
      { version: 2, items: [{ productId: "p1", productName: "BioSense Glucose Monitor", sku: "BSG-001", quantity: 100, unitPrice: 4500, discount: 5, lineTotal: 427500 }], subtotal: 427500, discountPercent: 5, discountAmount: 22500, taxAmount: 76950, grandTotal: 504450, createdAt: "2026-01-22", createdBy: "u2", notes: "5% discount applied per customer request" },
    ],
  },
  {
    id: "eq2", quotationNumber: "QT-2026-002", dealId: "d2", accountId: "acc2", contactId: "con3",
    status: "accepted", currentVersion: 3, validUntil: "2026-03-15", createdAt: "2026-01-20",
    sentAt: "2026-01-28", sentVia: "email", requiresApproval: true, approvalStatus: "approved", approvedBy: "u1",
    versions: [
      { version: 1, items: [{ productId: "p2", productName: "HemaCheck Analyzer Kit", sku: "HCK-002", quantity: 50, unitPrice: 12000, discount: 0, lineTotal: 600000 }, { productId: "p3", productName: "Reagent Pack Alpha", sku: "RPA-003", quantity: 200, unitPrice: 800, discount: 0, lineTotal: 160000 }], subtotal: 760000, discountPercent: 0, discountAmount: 0, taxAmount: 136800, grandTotal: 896800, createdAt: "2026-01-20", createdBy: "u1" },
      { version: 2, items: [{ productId: "p2", productName: "HemaCheck Analyzer Kit", sku: "HCK-002", quantity: 50, unitPrice: 12000, discount: 5, lineTotal: 570000 }, { productId: "p3", productName: "Reagent Pack Alpha", sku: "RPA-003", quantity: 200, unitPrice: 800, discount: 5, lineTotal: 152000 }], subtotal: 722000, discountPercent: 5, discountAmount: 38000, taxAmount: 129960, grandTotal: 851960, createdAt: "2026-01-23", createdBy: "u1", notes: "5% across the board" },
      { version: 3, items: [{ productId: "p2", productName: "HemaCheck Analyzer Kit", sku: "HCK-002", quantity: 50, unitPrice: 12000, discount: 8, lineTotal: 552000 }, { productId: "p3", productName: "Reagent Pack Alpha", sku: "RPA-003", quantity: 200, unitPrice: 800, discount: 5, lineTotal: 152000 }], subtotal: 704000, discountPercent: 0, discountAmount: 56000, taxAmount: 126720, grandTotal: 830720, createdAt: "2026-01-26", createdBy: "u1", notes: "8% on analyzers per management approval" },
    ],
  },
  {
    id: "eq3", quotationNumber: "QT-2026-003", dealId: "d5", accountId: "acc5", contactId: "con8",
    status: "pending_approval", currentVersion: 1, validUntil: "2026-04-30", createdAt: "2026-02-01",
    requiresApproval: true, approvalStatus: "pending",
    versions: [
      { version: 1, items: [{ productId: "p5", productName: "MicroPlate Reader 96", sku: "MPR-005", quantity: 4, unitPrice: 85000, discount: 12, lineTotal: 299200 }, { productId: "p8", productName: "Portable Centrifuge Mini", sku: "PCM-008", quantity: 10, unitPrice: 28000, discount: 8, lineTotal: 257600 }], subtotal: 556800, discountPercent: 0, discountAmount: 119200, taxAmount: 100224, grandTotal: 657024, createdAt: "2026-02-01", createdBy: "u2", notes: "High discount - requires management approval" },
    ],
  },
];

// --- Orders & Dispatch ---
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

export const orders: Order[] = [
  {
    id: "ord1", orderNumber: "ORD-2026-001", dealId: "d3", accountId: "acc3", contactId: "con5",
    quotationRef: "QT-2025-010",
    items: [
      { productId: "p3", productName: "Reagent Pack Alpha", quantity: 400, unitPrice: 800, serialNumbers: [] },
      { productId: "p4", productName: "Reagent Pack Beta", quantity: 300, unitPrice: 1200, serialNumbers: [] },
    ],
    subtotal: 680000, tax: 122400, grandTotal: 802400, status: "processing",
    orderDate: "2026-01-26", expectedDelivery: "2026-02-15", fgAvailable: false,
    whatsappSent: true, emailSent: true,
  },
  {
    id: "ord2", orderNumber: "ORD-2026-002", dealId: "d4", accountId: "acc4", contactId: "con6",
    quotationRef: "QT-2025-008",
    items: [
      { productId: "p5", productName: "MicroPlate Reader 96", quantity: 6, unitPrice: 85000, serialNumbers: ["MPR-005-00001", "MPR-005-00002", "MPR-005-00003", "MPR-005-00004", "MPR-005-00005", "MPR-005-00006"] },
    ],
    subtotal: 510000, tax: 91800, grandTotal: 601800, status: "delivered",
    orderDate: "2026-01-12", expectedDelivery: "2026-01-25", deliveredDate: "2026-01-24",
    fgAvailable: true, whatsappSent: true, emailSent: true,
  },
  {
    id: "ord3", orderNumber: "ORD-2026-003", dealId: "d2", accountId: "acc2", contactId: "con3",
    quotationRef: "QT-2026-002",
    items: [
      { productId: "p2", productName: "HemaCheck Analyzer Kit", quantity: 50, unitPrice: 12000 },
      { productId: "p3", productName: "Reagent Pack Alpha", quantity: 200, unitPrice: 800 },
    ],
    subtotal: 760000, tax: 136800, grandTotal: 896800, status: "confirmed",
    orderDate: "2026-02-01", expectedDelivery: "2026-03-01", fgAvailable: false,
    whatsappSent: true, emailSent: true,
  },
];

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

export const deliveryChallans: DeliveryChallan[] = [
  {
    id: "dc1", challanNumber: "DC-2026-001", orderId: "ord2",
    items: [{ productName: "MicroPlate Reader 96", quantity: 6, serialNumbers: ["MPR-005-00001", "MPR-005-00002", "MPR-005-00003", "MPR-005-00004", "MPR-005-00005", "MPR-005-00006"] }],
    transporterName: "BlueDart Logistics", vehicleNumber: "MH-04-AB-1234", driverName: "Ramesh Kumar", driverPhone: "+91 99887 76655",
    dispatchDate: "2026-01-22", expectedArrival: "2026-01-24", status: "delivered",
  },
];

// --- Support Tickets ---
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

export const supportTickets: SupportTicket[] = [
  {
    id: "tk1", ticketNumber: "TK-2026-001", accountId: "acc4", contactId: "con6",
    subject: "MicroPlate Reader display flickering", description: "Unit MPR-005-00003 display intermittently flickers during readings. Started 3 days ago.",
    category: "hardware_defect", priority: "high", status: "in_progress", deviceSerial: "MPR-005-00003", productId: "p5",
    assignedTo: "u4", slaDeadline: "2026-02-16T18:00:00Z", createdAt: "2026-02-14T09:00:00Z",
    whatsappNotified: true,
    comments: [
      { id: "tc1", type: "customer", user: "con6", content: "The display flickers every 10-15 seconds during active readings. Affects accuracy.", timestamp: "2026-02-14T09:00:00Z" },
      { id: "tc2", type: "internal", user: "u4", content: "Likely a ribbon cable issue. Seen this in batch BT-231215. Checking with production.", timestamp: "2026-02-14T11:00:00Z" },
      { id: "tc3", type: "internal", user: "u3", content: "Confirmed. Ribbon cable connector loose. Sending replacement kit.", timestamp: "2026-02-14T14:00:00Z" },
    ],
  },
  {
    id: "tk2", ticketNumber: "TK-2026-002", accountId: "acc1", contactId: "con2",
    subject: "Calibration drift on BioSense units", description: "3 out of 50 BioSense units showing calibration drift beyond acceptable range after 2 months of use.",
    category: "calibration", priority: "medium", status: "open", deviceSerial: "BSG-001-00015", productId: "p1",
    assignedTo: "u4", slaDeadline: "2026-02-18T18:00:00Z", createdAt: "2026-02-15T10:00:00Z",
    whatsappNotified: false,
    comments: [
      { id: "tc4", type: "customer", user: "con2", content: "Units BSG-001-00015, BSG-001-00023, and BSG-001-00031 are showing readings 5-8% off from reference.", timestamp: "2026-02-15T10:00:00Z" },
    ],
  },
  {
    id: "tk3", ticketNumber: "TK-2026-003", accountId: "acc2", contactId: "con4",
    subject: "Training request for new HemaCheck batch", description: "We have new lab technicians joining next month. Need product training for HemaCheck Analyzer Kit.",
    category: "training", priority: "low", status: "open",
    assignedTo: "u2", slaDeadline: "2026-03-01T18:00:00Z", createdAt: "2026-02-10T08:00:00Z",
    whatsappNotified: true,
    comments: [
      { id: "tc5", type: "customer", user: "con4", content: "5 new technicians starting March 1. Can we schedule training for the first week?", timestamp: "2026-02-10T08:00:00Z" },
      { id: "tc6", type: "internal", user: "u2", content: "Coordinating with product team for March 3-4 training session.", timestamp: "2026-02-11T10:00:00Z" },
    ],
  },
  {
    id: "tk4", ticketNumber: "TK-2026-004", accountId: "acc5", contactId: "con8",
    subject: "Centrifuge making unusual noise", description: "Portable Centrifuge Mini making grinding noise at high RPM. Under warranty.",
    category: "warranty_claim", priority: "critical", status: "waiting_customer",
    deviceSerial: "PCM-008-00002", productId: "p8",
    assignedTo: "u4", slaDeadline: "2026-02-13T18:00:00Z", createdAt: "2026-02-12T15:00:00Z",
    whatsappNotified: true,
    comments: [
      { id: "tc7", type: "customer", user: "con8", content: "The centrifuge is making a loud grinding noise above 8000 RPM. We've stopped using it for safety.", timestamp: "2026-02-12T15:00:00Z" },
      { id: "tc8", type: "internal", user: "u4", content: "Bearing failure suspected. This unit was flagged for recall check but wasn't returned. Requesting pickup.", timestamp: "2026-02-12T16:30:00Z" },
      { id: "tc9", type: "internal", user: "u4", content: "Courier pickup scheduled for Feb 14. Sent replacement unit PCM-008-00010 from Bangalore hub.", timestamp: "2026-02-13T09:00:00Z" },
      { id: "tc10", type: "customer", user: "con8", content: "Thank you. When can we expect the replacement?", timestamp: "2026-02-13T11:00:00Z" },
    ],
  },
  {
    id: "tk5", ticketNumber: "TK-2026-005", accountId: "acc4", contactId: "con7",
    subject: "Software update for MicroPlate Reader", description: "Firmware v2.1 update notification received. Need assistance with update process.",
    category: "software_bug", priority: "low", status: "resolved",
    productId: "p5", assignedTo: "u3", slaDeadline: "2026-02-20T18:00:00Z",
    createdAt: "2026-02-08T09:00:00Z", resolvedAt: "2026-02-10T14:00:00Z",
    whatsappNotified: true,
    comments: [
      { id: "tc11", type: "customer", user: "con7", content: "We received the update notification. Can someone guide us through the process?", timestamp: "2026-02-08T09:00:00Z" },
      { id: "tc12", type: "internal", user: "u3", content: "Sent firmware update guide and remote session link.", timestamp: "2026-02-09T10:00:00Z" },
      { id: "tc13", type: "customer", user: "con7", content: "Update completed successfully on all 6 units. Thank you!", timestamp: "2026-02-10T14:00:00Z" },
    ],
  },
];

// --- CRM Activity Feed ---
export interface CrmActivity {
  id: string;
  entityType: "lead" | "deal" | "account" | "order" | "ticket" | "quotation";
  entityId: string;
  type: "comment" | "status_change" | "system_log" | "whatsapp" | "email" | "call" | "meeting";
  user: string;
  content: string;
  timestamp: string;
}

export const crmActivities: CrmActivity[] = [
  { id: "ca1", entityType: "deal", entityId: "d2", type: "status_change", user: "u1", content: "Deal moved from Proposal to Negotiation", timestamp: "2026-01-20T14:30:00Z" },
  { id: "ca2", entityType: "deal", entityId: "d2", type: "whatsapp", user: "u1", content: "WhatsApp sent: Revised quotation shared with Meena", timestamp: "2026-01-20T14:45:00Z" },
  { id: "ca3", entityType: "quotation", entityId: "eq2", type: "email", user: "u1", content: "Quotation QT-2026-002 v3 sent via email to Apollo Diagnostics", timestamp: "2026-01-28T10:00:00Z" },
  { id: "ca4", entityType: "order", entityId: "ord2", type: "system_log", user: "system", content: "Order confirmed. Work Order WO-2026-003 auto-generated.", timestamp: "2026-01-12T09:00:00Z" },
  { id: "ca5", entityType: "order", entityId: "ord2", type: "whatsapp", user: "system", content: "WhatsApp notification sent to MedTech India: Order dispatched", timestamp: "2026-01-22T10:00:00Z" },
  { id: "ca6", entityType: "order", entityId: "ord2", type: "email", user: "system", content: "Email sent: Delivery challan DC-2026-001 shared with customer", timestamp: "2026-01-22T10:05:00Z" },
  { id: "ca7", entityType: "order", entityId: "ord2", type: "status_change", user: "u5", content: "Order delivered. Signed by Fatima Shaikh.", timestamp: "2026-01-24T16:00:00Z" },
  { id: "ca8", entityType: "ticket", entityId: "tk1", type: "system_log", user: "system", content: "Ticket TK-2026-001 created. SLA: 48 hours.", timestamp: "2026-02-14T09:00:00Z" },
  { id: "ca9", entityType: "ticket", entityId: "tk4", type: "whatsapp", user: "system", content: "WhatsApp sent to BioGenesis Labs: Replacement unit shipped", timestamp: "2026-02-13T09:30:00Z" },
  { id: "ca10", entityType: "deal", entityId: "d3", type: "system_log", user: "system", content: "Deal Won! Sales Order ORD-2026-001 created. Work Order + MRP triggered.", timestamp: "2026-01-25T16:00:00Z" },
  { id: "ca11", entityType: "account", entityId: "acc4", type: "comment", user: "u1", content: "Key account review completed. Health score upgraded to 92. Expanding to new product lines.", timestamp: "2026-02-01T15:00:00Z" },
  { id: "ca12", entityType: "deal", entityId: "d1", type: "call", user: "u2", content: "Call with Dr. Gupta. Finalizing delivery schedule for Q1.", timestamp: "2026-02-05T11:00:00Z" },
];

// --- Helper functions ---
export function getAccountById(id: string): Account | undefined {
  return accounts.find((a) => a.id === id);
}

export function getContactById(id: string): Contact | undefined {
  return contacts.find((c) => c.id === id);
}

export function getContactsForAccount(accountId: string): Contact[] {
  return contacts.filter((c) => c.accountId === accountId);
}

export function getCrmActivitiesForEntity(entityType: string, entityId: string): CrmActivity[] {
  return crmActivities.filter((a) => a.entityType === entityType && a.entityId === entityId);
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
