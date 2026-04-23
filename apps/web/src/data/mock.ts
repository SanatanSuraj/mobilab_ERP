// ============================================================
// MOCK DATA - Complete ERP + CRM Dataset
// ============================================================

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

export const users: User[] = [
  { id: "u1", name: "Chetan (HOD)", email: "chetan@instigenie.in", avatar: "CH", role: "Production Manager", department: "Manufacturing" },
  { id: "u2", name: "Priya Sharma", email: "priya@instigenie.in", avatar: "PS", role: "Sales Rep", department: "Sales" },
  { id: "u3", name: "Shubham (T1)", email: "shubham@instigenie.in", avatar: "SH", role: "Production Technician", department: "Manufacturing" },
  { id: "u4", name: "Sanju (T1)", email: "sanju@instigenie.in", avatar: "SJ", role: "QC Inspector", department: "Quality" },
  { id: "u5", name: "Jatin (T1)", email: "jatin@instigenie.in", avatar: "JT", role: "Production Technician", department: "Manufacturing" },
  { id: "u6", name: "Anita Das", email: "anita@instigenie.in", avatar: "AD", role: "Finance Lead", department: "Accounting" },
  { id: "u7", name: "Rishabh (T1)", email: "rishabh@instigenie.in", avatar: "RT", role: "Stores Technician", department: "Stores" },
  { id: "u8", name: "Binsu (T2)", email: "binsu@instigenie.in", avatar: "BT", role: "Production Technician", department: "Manufacturing" },
  { id: "u9", name: "Saurabh (T3)", email: "saurabh@instigenie.in", avatar: "ST", role: "QC Technician", department: "Quality" },
  { id: "u10", name: "Minakshi (T3)", email: "minakshi@instigenie.in", avatar: "MT", role: "Production Technician", department: "Manufacturing" },
];

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

export const products: Product[] = [
  { id: "p1", name: "Mobicase Analyser", sku: "MBA-001", category: "Devices", price: 285000, unit: "unit", stock: 12, warehouse: "Mumbai Central" },
  { id: "p2", name: "Mobimix", sku: "MBM-002", category: "Devices", price: 95000, unit: "unit", stock: 28, warehouse: "Mumbai Central" },
  { id: "p3", name: "Mobicube", sku: "MBC-003", category: "Devices", price: 125000, unit: "unit", stock: 18, warehouse: "Delhi NCR" },
  { id: "p4", name: "Mobicase Final Assembly", sku: "MCC-004", category: "Devices", price: 320000, unit: "unit", stock: 8, warehouse: "Delhi NCR" },
  { id: "p5", name: "Centrifuge", sku: "CFG-005", category: "Devices", price: 75000, unit: "unit", stock: 15, warehouse: "Bangalore Hub" },
  { id: "p6", name: "Reagent Pack Alpha", sku: "RPA-006", category: "Reagents", price: 800, unit: "pack", stock: 1500, warehouse: "Mumbai Central" },
  { id: "p7", name: "Reagent Pack Beta", sku: "RPB-007", category: "Reagents", price: 1200, unit: "pack", stock: 980, warehouse: "Delhi NCR" },
  { id: "p8", name: "Calibration Solution", sku: "CAL-008", category: "Consumables", price: 350, unit: "set", stock: 2200, warehouse: "Bangalore Hub" },
];

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

export const leads: Lead[] = [
  { id: "l1", name: "Dr. Rakesh Gupta", company: "LifeCare Hospitals Guwahati", email: "rakesh@lifecare.in", phone: "+91 98765 43210", status: "qualified", source: "Website", assignedTo: "u2", value: 450000, createdAt: "2025-12-01", lastActivity: "2026-01-15" },
  { id: "l2", name: "Meena Krishnan", company: "Apollo Diagnostics Noida", email: "meena@apollo.in", phone: "+91 87654 32109", status: "proposal", source: "Trade Show", assignedTo: "u1", value: 1200000, createdAt: "2025-11-15", lastActivity: "2026-01-20" },
  { id: "l3", name: "Dr. Suresh Tiwari", company: "AIIMS Bhopal Diagnostics", email: "suresh@aiimsbhopal.in", phone: "+91 76543 21098", status: "new", source: "Referral", assignedTo: "u2", value: 850000, createdAt: "2026-01-10", lastActivity: "2026-01-10" },
  { id: "l4", name: "Kavita Nair", company: "Manipal Hospital Bengaluru", email: "kavita@manipal.in", phone: "+91 65432 10987", status: "contacted", source: "LinkedIn", assignedTo: "u1", value: 320000, createdAt: "2025-12-20", lastActivity: "2026-01-18" },
  { id: "l5", name: "Amit Joshi", company: "Max Healthcare Delhi", email: "amit@maxhealthcare.in", phone: "+91 54321 09876", status: "negotiation", source: "Website", assignedTo: "u2", value: 960000, createdAt: "2025-10-05", lastActivity: "2026-01-22" },
  { id: "l6", name: "Fatima Shaikh", company: "Fortis Diagnostics Kolkata", email: "fatima@fortis.in", phone: "+91 43210 98765", status: "won", source: "Cold Call", assignedTo: "u1", value: 560000, createdAt: "2025-09-15", lastActivity: "2026-01-05" },
  { id: "l7", name: "Ravi Shankar", company: "NM Medical Chennai", email: "ravi@nmmedical.in", phone: "+91 32109 87654", status: "qualified", source: "Trade Show", assignedTo: "u2", value: 750000, createdAt: "2025-12-10", lastActivity: "2026-01-19" },
  { id: "l8", name: "Nisha Pillai", company: "SRL Diagnostics Hyderabad", email: "nisha@srl.in", phone: "+91 21098 76543", status: "lost", source: "Website", assignedTo: "u1", value: 285000, createdAt: "2025-08-20", lastActivity: "2025-12-30" },
];

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

export const deals: Deal[] = [
  { id: "d1", title: "LifeCare Mobicase Analyser Rollout", company: "LifeCare Hospitals Guwahati", contactName: "Dr. Rakesh Gupta", stage: "proposal", value: 570000, probability: 60, assignedTo: "u2", expectedClose: "2026-03-15", createdAt: "2026-01-15", leadId: "l1", products: [{ productId: "p1", quantity: 2 }] },
  { id: "d2", title: "Apollo Diagnostics Mobimix Deal", company: "Apollo Diagnostics Noida", contactName: "Meena Krishnan", stage: "negotiation", value: 1200000, probability: 80, assignedTo: "u1", expectedClose: "2026-02-28", createdAt: "2026-01-20", leadId: "l2", products: [{ productId: "p2", quantity: 8 }, { productId: "p6", quantity: 200 }] },
  { id: "d3", title: "Max Healthcare Reagent Supply", company: "Max Healthcare Delhi", contactName: "Amit Joshi", stage: "closed_won", value: 960000, probability: 100, assignedTo: "u2", expectedClose: "2026-01-25", createdAt: "2025-12-01", leadId: "l5", products: [{ productId: "p6", quantity: 400 }, { productId: "p7", quantity: 300 }] },
  { id: "d4", title: "Fortis Centrifuge Order", company: "Fortis Diagnostics Kolkata", contactName: "Fatima Shaikh", stage: "closed_won", value: 560000, probability: 100, assignedTo: "u1", expectedClose: "2026-01-10", createdAt: "2025-11-01", leadId: "l6", products: [{ productId: "p5", quantity: 6 }] },
  { id: "d5", title: "NM Medical Mobicube Bundle", company: "NM Medical Chennai", contactName: "Ravi Shankar", stage: "discovery", value: 750000, probability: 30, assignedTo: "u2", expectedClose: "2026-04-30", createdAt: "2026-01-19", leadId: "l7", products: [{ productId: "p3", quantity: 4 }, { productId: "p8", quantity: 10 }] },
  { id: "d6", title: "SRL Diagnostics Reagent Supply", company: "SRL Diagnostics Hyderabad", contactName: "Nisha Pillai", stage: "closed_lost", value: 285000, probability: 0, assignedTo: "u1", expectedClose: "2025-12-30", createdAt: "2025-10-01", leadId: "l8", products: [{ productId: "p7", quantity: 250 }] },
];

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

export const salesOrders: SalesOrder[] = [
  { id: "so1", dealId: "d3", orderNumber: "SO-2026-001", customer: "Max Healthcare Delhi", status: "processing", items: [{ productId: "p6", quantity: 400, unitPrice: 800 }, { productId: "p7", quantity: 300, unitPrice: 1200 }], total: 680000, createdAt: "2026-01-26", deliveryDate: "2026-02-15" },
  { id: "so2", dealId: "d4", orderNumber: "SO-2026-002", customer: "Fortis Diagnostics Kolkata", status: "delivered", items: [{ productId: "p5", quantity: 6, unitPrice: 75000 }], total: 450000, createdAt: "2026-01-12", deliveryDate: "2026-01-25" },
  { id: "so3", dealId: "d2", orderNumber: "SO-2026-003", customer: "Apollo Diagnostics Noida", status: "confirmed", items: [{ productId: "p2", quantity: 8, unitPrice: 95000 }, { productId: "p6", quantity: 200, unitPrice: 800 }], total: 920000, createdAt: "2026-02-01", deliveryDate: "2026-03-01" },
];

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

export const workOrders: WorkOrder[] = [
  {
    id: "wo1", orderNumber: "WO-2026-001", salesOrderId: "so1", productId: "p3", quantity: 400,
    status: "in_progress", priority: "high", assignedTo: "u3",
    startDate: "2026-01-28", dueDate: "2026-02-10",
    stages: [
      { id: "s1", name: "Raw Material Prep", status: "completed", assignedTo: "u3", startedAt: "2026-01-28", completedAt: "2026-01-30" },
      { id: "s2", name: "Mixing & Formulation", status: "in_progress", assignedTo: "u3", startedAt: "2026-01-31" },
      { id: "s3", name: "Packaging", status: "pending", assignedTo: "u5" },
      { id: "s4", name: "Quality Check", status: "pending", assignedTo: "u4" },
    ],
    bom: [
      { productId: "p6", quantity: 200, consumed: 180 },
      { productId: "p7", quantity: 50, consumed: 0 },
    ],
  },
  {
    id: "wo2", orderNumber: "WO-2026-002", salesOrderId: "so1", productId: "p4", quantity: 300,
    status: "planned", priority: "medium", assignedTo: "u3",
    startDate: "2026-02-05", dueDate: "2026-02-15",
    stages: [
      { id: "s5", name: "Raw Material Prep", status: "pending", assignedTo: "u3" },
      { id: "s6", name: "Mixing & Formulation", status: "pending", assignedTo: "u3" },
      { id: "s7", name: "Packaging", status: "pending", assignedTo: "u5" },
      { id: "s8", name: "Quality Check", status: "pending", assignedTo: "u4" },
    ],
    bom: [
      { productId: "p6", quantity: 150, consumed: 0 },
    ],
  },
  {
    id: "wo3", orderNumber: "WO-2026-003", salesOrderId: "so2", productId: "p5", quantity: 6,
    status: "completed", priority: "critical", assignedTo: "u3",
    startDate: "2026-01-14", dueDate: "2026-01-22", completedDate: "2026-01-21",
    stages: [
      { id: "s9", name: "Component Assembly", status: "completed", assignedTo: "u3", startedAt: "2026-01-14", completedAt: "2026-01-17" },
      { id: "s10", name: "Calibration", status: "completed", assignedTo: "u4", startedAt: "2026-01-18", completedAt: "2026-01-19" },
      { id: "s11", name: "Final QC", status: "completed", assignedTo: "u4", startedAt: "2026-01-20", completedAt: "2026-01-21" },
    ],
    bom: [
      { productId: "p6", quantity: 12, consumed: 12 },
    ],
  },
];

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

export const batches: Batch[] = [
  { id: "b1", batchNumber: "BT-240101-A", productId: "p3", quantity: 500, manufacturedDate: "2026-01-01", expiryDate: "2027-01-01", warehouse: "Delhi NCR", status: "available" },
  { id: "b2", batchNumber: "BT-240101-B", productId: "p3", quantity: 400, manufacturedDate: "2026-01-01", expiryDate: "2027-01-01", warehouse: "Delhi NCR", status: "reserved" },
  { id: "b3", batchNumber: "BT-231215-A", productId: "p4", quantity: 300, manufacturedDate: "2025-12-15", expiryDate: "2026-12-15", warehouse: "Delhi NCR", status: "available" },
  { id: "b4", batchNumber: "BT-240110-A", productId: "p6", quantity: 800, manufacturedDate: "2026-01-10", expiryDate: "2027-06-10", warehouse: "Mumbai Central", status: "available" },
  { id: "b5", batchNumber: "BT-231001-A", productId: "p7", quantity: 200, manufacturedDate: "2025-10-01", expiryDate: "2026-04-01", warehouse: "Delhi NCR", status: "quarantine" },
];

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

export const serialItems: SerialItem[] = [
  { id: "sr1", serialNumber: "MBA-001-00001", productId: "p1", status: "in_stock", warehouse: "Mumbai Central" },
  { id: "sr2", serialNumber: "MBA-001-00002", productId: "p1", status: "sold", warehouse: "Mumbai Central", soldTo: "LifeCare Hospitals Guwahati", soldDate: "2026-01-15" },
  { id: "sr3", serialNumber: "MBM-002-00001", productId: "p2", status: "in_stock", warehouse: "Mumbai Central" },
  { id: "sr4", serialNumber: "CFG-005-00001", productId: "p5", status: "sold", warehouse: "Bangalore Hub", soldTo: "Fortis Diagnostics Kolkata", soldDate: "2026-01-25" },
  { id: "sr5", serialNumber: "CFG-005-00002", productId: "p5", status: "sold", warehouse: "Bangalore Hub", soldTo: "Fortis Diagnostics Kolkata", soldDate: "2026-01-25" },
  { id: "sr6", serialNumber: "CAL-008-00001", productId: "p8", status: "in_stock", warehouse: "Bangalore Hub" },
  { id: "sr7", serialNumber: "CAL-008-00002", productId: "p8", status: "warranty", warehouse: "Bangalore Hub", soldTo: "NM Medical Chennai", soldDate: "2025-11-10" },
];

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

export const invoices: Invoice[] = [
  {
    id: "inv1", invoiceNumber: "INV-2026-001", salesOrderId: "so2", customer: "Fortis Diagnostics Kolkata",
    status: "paid",
    items: [{ productId: "p5", description: "Centrifuge", quantity: 6, unitPrice: 75000, total: 450000 }],
    subtotal: 450000, tax: 81000, total: 531000,
    issuedDate: "2026-01-26", dueDate: "2026-02-25", paidDate: "2026-02-10", paidAmount: 531000,
  },
  {
    id: "inv2", invoiceNumber: "INV-2026-002", salesOrderId: "so1", customer: "Max Healthcare Delhi",
    status: "sent",
    items: [
      { productId: "p6", description: "Reagent Pack Alpha", quantity: 400, unitPrice: 800, total: 320000 },
      { productId: "p7", description: "Reagent Pack Beta", quantity: 300, unitPrice: 1200, total: 360000 },
    ],
    subtotal: 680000, tax: 122400, total: 802400,
    issuedDate: "2026-02-01", dueDate: "2026-03-03", paidAmount: 0,
  },
  {
    id: "inv3", invoiceNumber: "INV-2026-003", salesOrderId: "so3", customer: "Apollo Diagnostics Noida",
    status: "draft",
    items: [
      { productId: "p2", description: "Mobimix", quantity: 8, unitPrice: 95000, total: 760000 },
      { productId: "p6", description: "Reagent Pack Alpha", quantity: 200, unitPrice: 800, total: 160000 },
    ],
    subtotal: 920000, tax: 165600, total: 1085600,
    issuedDate: "2026-02-05", dueDate: "2026-03-07", paidAmount: 0,
  },
];

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

export const employees: Employee[] = [
  { id: "u1", name: "Chetan (HOD)", email: "chetan@instigenie.in", avatar: "CH", department: "Manufacturing", designation: "Production Manager", joinDate: "2020-03-15", phone: "+91 98765 00001", status: "active", leaveBalance: { casual: 8, sick: 5, earned: 12 } },
  { id: "u2", name: "Priya Sharma", email: "priya@instigenie.in", avatar: "PS", department: "Sales", designation: "Sales Rep", joinDate: "2023-06-01", phone: "+91 98765 00002", status: "active", leaveBalance: { casual: 6, sick: 4, earned: 10 }, reportingTo: "u1" },
  { id: "u3", name: "Shubham (T1)", email: "shubham@instigenie.in", avatar: "SH", department: "Manufacturing", designation: "Production Technician T1", joinDate: "2022-01-10", phone: "+91 98765 00003", status: "active", leaveBalance: { casual: 5, sick: 6, earned: 8 }, reportingTo: "u1" },
  { id: "u4", name: "Sanju (T1)", email: "sanju@instigenie.in", avatar: "SJ", department: "Quality", designation: "QC Inspector T1", joinDate: "2022-08-20", phone: "+91 98765 00004", status: "active", leaveBalance: { casual: 7, sick: 5, earned: 11 }, reportingTo: "u1" },
  { id: "u5", name: "Jatin (T1)", email: "jatin@instigenie.in", avatar: "JT", department: "Manufacturing", designation: "Production Technician T1", joinDate: "2023-02-14", phone: "+91 98765 00005", status: "on_leave", leaveBalance: { casual: 3, sick: 4, earned: 5 }, reportingTo: "u1" },
  { id: "u6", name: "Anita Das", email: "anita@instigenie.in", avatar: "AD", department: "Accounting", designation: "Finance Lead", joinDate: "2021-07-01", phone: "+91 98765 00006", status: "active", leaveBalance: { casual: 9, sick: 6, earned: 14 } },
  { id: "u7", name: "Rishabh (T1)", email: "rishabh@instigenie.in", avatar: "RT", department: "Stores", designation: "Stores Technician T1", joinDate: "2022-11-05", phone: "+91 98765 00007", status: "active", leaveBalance: { casual: 4, sick: 3, earned: 7 }, reportingTo: "u1" },
  { id: "u8", name: "Binsu (T2)", email: "binsu@instigenie.in", avatar: "BT", department: "Manufacturing", designation: "Production Technician T2", joinDate: "2021-05-15", phone: "+91 98765 00008", status: "active", leaveBalance: { casual: 6, sick: 5, earned: 10 }, reportingTo: "u1" },
  { id: "u9", name: "Saurabh (T3)", email: "saurabh@instigenie.in", avatar: "ST", department: "Quality", designation: "QC Technician T3", joinDate: "2023-09-01", phone: "+91 98765 00009", status: "active", leaveBalance: { casual: 5, sick: 4, earned: 6 }, reportingTo: "u4" },
  { id: "u10", name: "Minakshi (T3)", email: "minakshi@instigenie.in", avatar: "MT", department: "Manufacturing", designation: "Production Technician T3", joinDate: "2024-01-10", phone: "+91 98765 00010", status: "active", leaveBalance: { casual: 6, sick: 3, earned: 4 }, reportingTo: "u1" },
];

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

export const leaveRequests: LeaveRequest[] = [
  { id: "lr1", employeeId: "u5", type: "casual", startDate: "2026-02-10", endDate: "2026-02-12", days: 3, reason: "Family function", status: "approved", appliedOn: "2026-02-01", approvedBy: "u1" },
  { id: "lr2", employeeId: "u2", type: "sick", startDate: "2026-02-15", endDate: "2026-02-15", days: 1, reason: "Not feeling well", status: "pending", appliedOn: "2026-02-14" },
  { id: "lr3", employeeId: "u3", type: "earned", startDate: "2026-03-01", endDate: "2026-03-05", days: 5, reason: "Vacation", status: "pending", appliedOn: "2026-02-10" },
  { id: "lr4", employeeId: "u4", type: "casual", startDate: "2026-01-20", endDate: "2026-01-20", days: 1, reason: "Personal work", status: "approved", appliedOn: "2026-01-18", approvedBy: "u1" },
  { id: "lr5", employeeId: "u8", type: "sick", startDate: "2026-01-25", endDate: "2026-01-26", days: 2, reason: "Medical appointment", status: "rejected", appliedOn: "2026-01-24" },
];

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

export const projects: Project[] = [
  { id: "prj1", name: "BioSense v2 Launch", description: "Next-gen glucose monitor development and launch", status: "active", progress: 65, startDate: "2025-10-01", endDate: "2026-04-30", lead: "u8", members: ["u3", "u4", "u5"] },
  { id: "prj2", name: "ERP System Migration", description: "Migrate legacy ERP to new cloud platform", status: "active", progress: 40, startDate: "2025-12-01", endDate: "2026-06-30", lead: "u8", members: ["u1", "u6", "u7"] },
  { id: "prj3", name: "ISO 13485 Certification", description: "Quality management system certification for medical devices", status: "on_hold", progress: 20, startDate: "2026-01-15", endDate: "2026-09-30", lead: "u4", members: ["u3", "u7"] },
];

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

export const tasks: Task[] = [
  { id: "t1", projectId: "prj1", title: "Finalize PCB design", description: "Complete PCB layout for BioSense v2", status: "done", priority: "critical", assignedTo: "u8", dueDate: "2026-01-15", createdAt: "2025-11-01", tags: ["hardware"] },
  { id: "t2", projectId: "prj1", title: "Firmware testing", description: "Run full regression tests on firmware v2.1", status: "in_progress", priority: "high", assignedTo: "u3", dueDate: "2026-02-10", createdAt: "2025-12-01", tags: ["testing"] },
  { id: "t3", projectId: "prj1", title: "Clinical trial documentation", description: "Prepare docs for clinical trial submission", status: "todo", priority: "high", assignedTo: "u4", dueDate: "2026-03-01", createdAt: "2026-01-05", tags: ["docs", "compliance"] },
  { id: "t4", projectId: "prj1", title: "Packaging design review", description: "Review and approve packaging artwork", status: "review", priority: "medium", assignedTo: "u5", dueDate: "2026-02-20", createdAt: "2026-01-10", tags: ["design"] },
  { id: "t5", projectId: "prj2", title: "Data migration script", description: "Write ETL scripts for legacy data migration", status: "in_progress", priority: "critical", assignedTo: "u8", dueDate: "2026-02-28", createdAt: "2026-01-01", tags: ["backend", "data"] },
  { id: "t6", projectId: "prj2", title: "User acceptance testing", description: "Coordinate UAT with department heads", status: "todo", priority: "high", assignedTo: "u7", dueDate: "2026-04-15", createdAt: "2026-01-15", tags: ["testing"] },
  { id: "t7", projectId: "prj2", title: "Finance module setup", description: "Configure chart of accounts and tax rules", status: "in_progress", priority: "high", assignedTo: "u6", dueDate: "2026-03-15", createdAt: "2026-01-10", tags: ["finance"] },
  { id: "t8", projectId: "prj3", title: "Gap analysis document", description: "Document current vs required processes", status: "todo", priority: "medium", assignedTo: "u4", dueDate: "2026-03-30", createdAt: "2026-01-20", tags: ["compliance", "docs"] },
];

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

export const activities: Activity[] = [
  { id: "a1", entityType: "deal", entityId: "d2", type: "comment", user: "u1", content: "Had a great call with Meena. Apollo Diagnostics Noida ready to move forward with Mobimix deal.", timestamp: "2026-01-20T14:30:00Z" },
  { id: "a2", entityType: "deal", entityId: "d2", type: "status_change", user: "u1", content: "Stage changed from Proposal to Negotiation", timestamp: "2026-01-20T14:35:00Z" },
  { id: "a3", entityType: "deal", entityId: "d2", type: "mention", user: "u1", content: "@Priya Sharma can you prepare the revised quotation by tomorrow?", timestamp: "2026-01-20T14:40:00Z", mentions: ["u2"] },
  { id: "a4", entityType: "workOrder", entityId: "wo1", type: "status_change", user: "u3", content: "Stage 'Raw Material Prep' marked as completed", timestamp: "2026-01-30T10:00:00Z" },
  { id: "a5", entityType: "workOrder", entityId: "wo1", type: "comment", user: "u3", content: "Starting mixing phase. All raw materials verified and ready.", timestamp: "2026-01-31T08:15:00Z" },
  { id: "a6", entityType: "workOrder", entityId: "wo1", type: "mention", user: "u3", content: "@Sanju (T1) please schedule QC slot for Feb 8-9", timestamp: "2026-01-31T08:20:00Z", mentions: ["u4"] },
  { id: "a7", entityType: "invoice", entityId: "inv1", type: "status_change", user: "u6", content: "Payment received from Fortis Diagnostics Kolkata. Invoice marked as Paid.", timestamp: "2026-02-10T11:00:00Z" },
  { id: "a8", entityType: "invoice", entityId: "inv2", type: "system_log", user: "system", content: "Invoice INV-2026-002 sent to Max Healthcare Delhi via email", timestamp: "2026-02-01T09:00:00Z" },
  { id: "a9", entityType: "project", entityId: "prj1", type: "comment", user: "u8", content: "PCB design approved by review board. Moving to firmware testing phase.", timestamp: "2026-01-16T16:00:00Z" },
  { id: "a10", entityType: "task", entityId: "t2", type: "status_change", user: "u3", content: "Status changed from Todo to In Progress", timestamp: "2026-01-20T09:00:00Z" },
  { id: "a11", entityType: "deal", entityId: "d3", type: "system_log", user: "system", content: "Sales Order SO-2026-001 auto-generated from closed deal", timestamp: "2026-01-26T00:00:00Z" },
  { id: "a12", entityType: "salesOrder", entityId: "so1", type: "system_log", user: "system", content: "Work Order WO-2026-001 created from Sales Order", timestamp: "2026-01-27T00:00:00Z" },
  { id: "a13", entityType: "leave", entityId: "lr1", type: "status_change", user: "u7", content: "Leave request approved for Jatin (T1) (Feb 10-12)", timestamp: "2026-02-02T10:00:00Z" },
  { id: "a14", entityType: "employee", entityId: "u5", type: "system_log", user: "system", content: "Status changed to On Leave", timestamp: "2026-02-10T00:00:00Z" },
  { id: "a15", entityType: "deal", entityId: "d1", type: "creation", user: "u2", content: "Deal created from lead: Dr. Rakesh Gupta, LifeCare Hospitals Guwahati", timestamp: "2026-01-15T10:00:00Z" },
];

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

export const ledgerEntries: LedgerEntry[] = [
  { id: "le1", date: "2026-01-12", account: "Accounts Receivable", description: "Invoice INV-2026-001 raised - Fortis Diagnostics Kolkata", debit: 531000, credit: 0, balance: 531000, reference: "INV-2026-001" },
  { id: "le2", date: "2026-01-12", account: "Sales Revenue", description: "Revenue from Centrifuge sale", debit: 0, credit: 450000, balance: 450000, reference: "INV-2026-001" },
  { id: "le3", date: "2026-01-12", account: "GST Payable", description: "GST on INV-2026-001", debit: 0, credit: 81000, balance: 81000, reference: "INV-2026-001" },
  { id: "le4", date: "2026-02-01", account: "Accounts Receivable", description: "Invoice INV-2026-002 raised - Max Healthcare Delhi", debit: 802400, credit: 0, balance: 1333400, reference: "INV-2026-002" },
  { id: "le5", date: "2026-02-01", account: "Sales Revenue", description: "Revenue from Reagent supply", debit: 0, credit: 680000, balance: 1130000, reference: "INV-2026-002" },
  { id: "le6", date: "2026-02-10", account: "Bank", description: "Payment received from Fortis Diagnostics Kolkata", debit: 531000, credit: 0, balance: 531000, reference: "PAY-001" },
  { id: "le7", date: "2026-02-10", account: "Accounts Receivable", description: "Payment against INV-2026-001", debit: 0, credit: 531000, balance: 802400, reference: "PAY-001" },
];

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

export const quotations: Quotation[] = [
  { id: "q1", quotationNumber: "QT-2026-001", dealId: "d1", customer: "LifeCare Hospitals Guwahati", status: "sent", items: [{ productId: "p1", quantity: 2, unitPrice: 285000, discount: 5 }], total: 541500, validUntil: "2026-02-28", createdAt: "2026-01-18" },
  { id: "q2", quotationNumber: "QT-2026-002", dealId: "d2", customer: "Apollo Diagnostics Noida", status: "accepted", items: [{ productId: "p2", quantity: 8, unitPrice: 95000, discount: 8 }, { productId: "p6", quantity: 200, unitPrice: 800, discount: 5 }], total: 851200, validUntil: "2026-03-15", createdAt: "2026-01-22" },
  { id: "q3", quotationNumber: "QT-2026-003", dealId: "d5", customer: "NM Medical Chennai", status: "draft", items: [{ productId: "p3", quantity: 4, unitPrice: 125000, discount: 10 }, { productId: "p8", quantity: 10, unitPrice: 350, discount: 5 }], total: 453325, validUntil: "2026-04-30", createdAt: "2026-02-01" },
];

// --- Helper functions ---
export function getUserById(id: string): User | undefined {
  return users.find(u => u.id === id);
}

export function getProductById(id: string): Product | undefined {
  return products.find(p => p.id === id);
}

export function getActivitiesForEntity(entityType: string, entityId: string): Activity[] {
  return activities.filter(a => a.entityType === entityType && a.entityId === entityId);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
