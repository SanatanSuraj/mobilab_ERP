// ============================================================
// FINANCE MODULE - Mock Data
// ============================================================

import { formatCurrency, formatDate } from "./mock";

// --- Customers (with GSTIN) ---
export interface FinCustomer {
  id: string;
  name: string;
  gstin: string;
  pan: string;
  address: string;
  state: string;
  stateCode: string;
  contactPerson: string;
  email: string;
  phone: string;
  creditLimit: number;
  outstandingBalance: number;
}

export const finCustomers: FinCustomer[] = [
  { id: "fc1", name: "LifeCare Hospitals Pvt Ltd", gstin: "27AABCL1234F1Z5", pan: "AABCL1234F", address: "Andheri East, Mumbai", state: "Maharashtra", stateCode: "27", contactPerson: "Dr. Rakesh Gupta", email: "accounts@lifecare.in", phone: "+91 22 4567 8901", creditLimit: 1000000, outstandingBalance: 427500 },
  { id: "fc2", name: "Apollo Diagnostics Ltd", gstin: "29AABCA5678G2Z3", pan: "AABCA5678G", address: "Koramangala, Bangalore", state: "Karnataka", stateCode: "29", contactPerson: "Meena Krishnan", email: "finance@apollo.in", phone: "+91 80 2345 6789", creditLimit: 2000000, outstandingBalance: 896800 },
  { id: "fc3", name: "CureWell Pharma Industries", gstin: "24AABCC9012H3Z1", pan: "AABCC9012H", address: "SG Highway, Ahmedabad", state: "Gujarat", stateCode: "24", contactPerson: "Amit Joshi", email: "purchase@curewell.in", phone: "+91 79 3456 7890", creditLimit: 1500000, outstandingBalance: 802400 },
  { id: "fc4", name: "MedTech India Solutions", gstin: "27AABCM3456J4Z9", pan: "AABCM3456J", address: "Bandra Kurla Complex, Mumbai", state: "Maharashtra", stateCode: "27", contactPerson: "Fatima Shaikh", email: "ap@medtech.in", phone: "+91 22 5678 9012", creditLimit: 1200000, outstandingBalance: 0 },
  { id: "fc5", name: "BioGenesis Labs LLP", gstin: "36AABCB7890K5Z7", pan: "AABCB7890K", address: "HITEC City, Hyderabad", state: "Telangana", stateCode: "36", contactPerson: "Ravi Shankar", email: "billing@biogenesis.in", phone: "+91 40 6789 0123", creditLimit: 1800000, outstandingBalance: 340000 },
];

// --- Vendors ---
export interface Vendor {
  id: string;
  name: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
  contactPerson: string;
  email: string;
  phone: string;
  outstandingBalance: number;
}

export const vendors: Vendor[] = [
  { id: "v1", name: "ChemSupply India Pvt Ltd", gstin: "27AABCS1111A1Z1", address: "Thane, Mumbai", state: "Maharashtra", stateCode: "27", contactPerson: "Rajiv Kumar", email: "sales@chemsupply.in", phone: "+91 22 1111 2222", outstandingBalance: 245000 },
  { id: "v2", name: "PrecisionParts Manufacturing", gstin: "33AABCP2222B2Z2", address: "Ambattur, Chennai", state: "Tamil Nadu", stateCode: "33", contactPerson: "Suresh Rajan", email: "accounts@precisionparts.in", phone: "+91 44 3333 4444", outstandingBalance: 180000 },
  { id: "v3", name: "PackRight Solutions", gstin: "29AABCP3333C3Z3", address: "Peenya, Bangalore", state: "Karnataka", stateCode: "29", contactPerson: "Lakshmi Devi", email: "info@packright.in", phone: "+91 80 5555 6666", outstandingBalance: 95000 },
  { id: "v4", name: "TechComp Electronics", gstin: "07AABCT4444D4Z4", address: "Noida, UP", state: "Uttar Pradesh", stateCode: "09", contactPerson: "Anil Verma", email: "supply@techcomp.in", phone: "+91 120 7777 8888", outstandingBalance: 420000 },
];

// --- Sales Invoices (GST compliant) ---
export type SalesInvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface SalesInvoiceItem {
  description: string;
  hsnCode: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  salesOrderRef: string;
  deliveryChallanRef?: string;
  invoiceDate: string;
  dueDate: string;
  placeOfSupply: string;
  supplyType: "intra_state" | "inter_state";
  items: SalesInvoiceItem[];
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  grandTotal: number;
  paidAmount: number;
  status: SalesInvoiceStatus;
  ewayBillId?: string;
  notes?: string;
  createdAt: string;
}

export const salesInvoices: SalesInvoice[] = [
  {
    id: "si1", invoiceNumber: "MBL/24-25/001", customerId: "fc4", salesOrderRef: "SO-2026-002", deliveryChallanRef: "DC-2026-001",
    invoiceDate: "2026-01-26", dueDate: "2026-02-25", placeOfSupply: "Maharashtra", supplyType: "intra_state",
    items: [{ description: "MicroPlate Reader 96", hsnCode: "9027.80", quantity: 6, unitPrice: 85000, discount: 0, taxableAmount: 510000, cgst: 45900, sgst: 45900, igst: 0, total: 601800 }],
    subtotal: 510000, totalCgst: 45900, totalSgst: 45900, totalIgst: 0, totalTax: 91800, grandTotal: 601800,
    paidAmount: 601800, status: "paid", ewayBillId: "ewb1", createdAt: "2026-01-26",
  },
  {
    id: "si2", invoiceNumber: "MBL/24-25/002", customerId: "fc3", salesOrderRef: "SO-2026-001",
    invoiceDate: "2026-02-01", dueDate: "2026-03-03", placeOfSupply: "Gujarat", supplyType: "inter_state",
    items: [
      { description: "Reagent Pack Alpha", hsnCode: "3822.00", quantity: 400, unitPrice: 800, discount: 0, taxableAmount: 320000, cgst: 0, sgst: 0, igst: 57600, total: 377600 },
      { description: "Reagent Pack Beta", hsnCode: "3822.00", quantity: 300, unitPrice: 1200, discount: 0, taxableAmount: 360000, cgst: 0, sgst: 0, igst: 64800, total: 424800 },
    ],
    subtotal: 680000, totalCgst: 0, totalSgst: 0, totalIgst: 122400, totalTax: 122400, grandTotal: 802400,
    paidAmount: 0, status: "sent", ewayBillId: "ewb2", createdAt: "2026-02-01",
  },
  {
    id: "si3", invoiceNumber: "MBL/24-25/003", customerId: "fc2", salesOrderRef: "SO-2026-003",
    invoiceDate: "2026-02-05", dueDate: "2026-03-07", placeOfSupply: "Karnataka", supplyType: "inter_state",
    items: [
      { description: "HemaCheck Analyzer Kit", hsnCode: "9027.80", quantity: 50, unitPrice: 12000, discount: 0, taxableAmount: 600000, cgst: 0, sgst: 0, igst: 108000, total: 708000 },
      { description: "Reagent Pack Alpha", hsnCode: "3822.00", quantity: 200, unitPrice: 800, discount: 0, taxableAmount: 160000, cgst: 0, sgst: 0, igst: 28800, total: 188800 },
    ],
    subtotal: 760000, totalCgst: 0, totalSgst: 0, totalIgst: 136800, totalTax: 136800, grandTotal: 896800,
    paidAmount: 0, status: "draft", createdAt: "2026-02-05",
  },
  {
    id: "si4", invoiceNumber: "MBL/24-25/004", customerId: "fc1", salesOrderRef: "SO-2026-004",
    invoiceDate: "2026-01-18", dueDate: "2026-02-17", placeOfSupply: "Maharashtra", supplyType: "intra_state",
    items: [{ description: "BioSense Glucose Monitor", hsnCode: "9027.80", quantity: 50, unitPrice: 4500, discount: 5, taxableAmount: 213750, cgst: 19238, sgst: 19238, igst: 0, total: 252226 }],
    subtotal: 213750, totalCgst: 19238, totalSgst: 19238, totalIgst: 0, totalTax: 38476, grandTotal: 252226,
    paidAmount: 100000, status: "partially_paid", createdAt: "2026-01-18",
  },
  {
    id: "si5", invoiceNumber: "MBL/24-25/005", customerId: "fc5", salesOrderRef: "SO-2026-005",
    invoiceDate: "2025-12-15", dueDate: "2026-01-14", placeOfSupply: "Telangana", supplyType: "inter_state",
    items: [{ description: "Portable Centrifuge Mini", hsnCode: "8421.19", quantity: 8, unitPrice: 28000, discount: 0, taxableAmount: 224000, cgst: 0, sgst: 0, igst: 40320, total: 264320 }],
    subtotal: 224000, totalCgst: 0, totalSgst: 0, totalIgst: 40320, totalTax: 40320, grandTotal: 264320,
    paidAmount: 0, status: "overdue", createdAt: "2025-12-15",
  },
];

// --- Purchase Orders ---
export type POStatus = "draft" | "pending_approval" | "auto_approved" | "finance_approved" | "management_approved" | "rejected" | "cancelled";

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  tax: number;
  grandTotal: number;
  status: POStatus;
  approvalLevel: "auto" | "finance" | "management";
  requestedBy: string;
  approvedBy?: string;
  approvalDate?: string;
  rejectionReason?: string;
  createdAt: string;
}

export const purchaseOrders: PurchaseOrder[] = [
  { id: "po1", poNumber: "PO-2026-001", vendorId: "v1", items: [{ description: "Reagent Raw Material A", quantity: 500, unitPrice: 200, total: 100000 }], subtotal: 100000, tax: 18000, grandTotal: 118000, status: "auto_approved", approvalLevel: "auto", requestedBy: "u5", approvedBy: "system", approvalDate: "2026-01-15", createdAt: "2026-01-15" },
  { id: "po2", poNumber: "PO-2026-002", vendorId: "v2", items: [{ description: "Precision Sensor Module", quantity: 100, unitPrice: 1500, total: 150000 }, { description: "Calibration Springs", quantity: 200, unitPrice: 250, total: 50000 }], subtotal: 200000, tax: 36000, grandTotal: 236000, status: "finance_approved", approvalLevel: "finance", requestedBy: "u3", approvedBy: "u6", approvalDate: "2026-01-20", createdAt: "2026-01-18" },
  { id: "po3", poNumber: "PO-2026-003", vendorId: "v4", items: [{ description: "Microcontroller Board v3", quantity: 50, unitPrice: 8500, total: 425000 }], subtotal: 425000, tax: 76500, grandTotal: 501500, status: "pending_approval", approvalLevel: "management", requestedBy: "u3", createdAt: "2026-02-01" },
  { id: "po4", poNumber: "PO-2026-004", vendorId: "v3", items: [{ description: "Packaging Material - Premium", quantity: 2000, unitPrice: 35, total: 70000 }], subtotal: 70000, tax: 12600, grandTotal: 82600, status: "pending_approval", approvalLevel: "finance", requestedBy: "u5", createdAt: "2026-02-03" },
  { id: "po5", poNumber: "PO-2026-005", vendorId: "v1", items: [{ description: "Reagent Raw Material B", quantity: 300, unitPrice: 350, total: 105000 }], subtotal: 105000, tax: 18900, grandTotal: 123900, status: "rejected", approvalLevel: "finance", requestedBy: "u5", rejectionReason: "Budget exceeded for Q1. Defer to Q2.", createdAt: "2026-01-25" },
];

// --- Purchase Invoices ---
export type PurchaseInvoiceStatus = "draft" | "pending_match" | "matched" | "approved" | "paid" | "disputed";

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  vendorId: string;
  poRef: string;
  grnRef: string;
  invoiceDate: string;
  dueDate: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  tax: number;
  grandTotal: number;
  status: PurchaseInvoiceStatus;
  matchStatus: { po: boolean; grn: boolean; invoice: boolean };
  createdAt: string;
}

export const purchaseInvoices: PurchaseInvoice[] = [
  { id: "pi1", invoiceNumber: "CHEM/INV/2026/101", vendorId: "v1", poRef: "PO-2026-001", grnRef: "GRN-2026-001", invoiceDate: "2026-01-20", dueDate: "2026-02-19", items: [{ description: "Reagent Raw Material A", quantity: 500, unitPrice: 200, total: 100000 }], subtotal: 100000, tax: 18000, grandTotal: 118000, status: "paid", matchStatus: { po: true, grn: true, invoice: true }, createdAt: "2026-01-20" },
  { id: "pi2", invoiceNumber: "PP/2026/0045", vendorId: "v2", poRef: "PO-2026-002", grnRef: "GRN-2026-002", invoiceDate: "2026-01-25", dueDate: "2026-02-24", items: [{ description: "Precision Sensor Module", quantity: 100, unitPrice: 1500, total: 150000 }, { description: "Calibration Springs", quantity: 200, unitPrice: 250, total: 50000 }], subtotal: 200000, tax: 36000, grandTotal: 236000, status: "matched", matchStatus: { po: true, grn: true, invoice: true }, createdAt: "2026-01-25" },
  { id: "pi3", invoiceNumber: "TC/26/INV-312", vendorId: "v4", poRef: "PO-2026-003", grnRef: "", invoiceDate: "2026-02-05", dueDate: "2026-03-07", items: [{ description: "Microcontroller Board v3", quantity: 50, unitPrice: 8500, total: 425000 }], subtotal: 425000, tax: 76500, grandTotal: 501500, status: "pending_match", matchStatus: { po: true, grn: false, invoice: true }, createdAt: "2026-02-05" },
  { id: "pi4", invoiceNumber: "PR/2026/088", vendorId: "v3", poRef: "PO-2026-004", grnRef: "GRN-2026-003", invoiceDate: "2026-02-08", dueDate: "2026-03-10", items: [{ description: "Packaging Material - Premium", quantity: 2000, unitPrice: 35, total: 70000 }], subtotal: 70000, tax: 12600, grandTotal: 82600, status: "disputed", matchStatus: { po: true, grn: true, invoice: false }, createdAt: "2026-02-08" },
];

// --- Payments ---
export interface FinPayment {
  id: string;
  paymentNumber: string;
  type: "received" | "made";
  entityType: "customer" | "vendor";
  entityId: string;
  invoiceRef: string;
  amount: number;
  method: "bank_transfer" | "cheque" | "upi" | "cash";
  date: string;
  reference: string;
  notes?: string;
}

export const finPayments: FinPayment[] = [
  { id: "fp1", paymentNumber: "PAY-R-001", type: "received", entityType: "customer", entityId: "fc4", invoiceRef: "MBL/24-25/001", amount: 601800, method: "bank_transfer", date: "2026-02-10", reference: "NEFT/2026/FEB/8834" },
  { id: "fp2", paymentNumber: "PAY-R-002", type: "received", entityType: "customer", entityId: "fc1", invoiceRef: "MBL/24-25/004", amount: 100000, method: "bank_transfer", date: "2026-02-05", reference: "NEFT/2026/FEB/7721", notes: "Partial payment, balance pending" },
  { id: "fp3", paymentNumber: "PAY-M-001", type: "made", entityType: "vendor", entityId: "v1", invoiceRef: "CHEM/INV/2026/101", amount: 118000, method: "bank_transfer", date: "2026-02-15", reference: "RTGS/2026/FEB/4456" },
  { id: "fp4", paymentNumber: "PAY-M-002", type: "made", entityType: "vendor", entityId: "v3", invoiceRef: "PR/2026/088", amount: 50000, method: "cheque", date: "2026-02-12", reference: "CHQ/445612", notes: "Partial - dispute pending" },
];

// --- Customer Ledger Entries ---
export interface LedgerEntryFin {
  id: string;
  entityType: "customer" | "vendor";
  entityId: string;
  date: string;
  type: "invoice" | "payment" | "credit_note" | "debit_note" | "opening_balance";
  reference: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export const customerLedgerEntries: LedgerEntryFin[] = [
  // LifeCare Hospitals
  { id: "cle1", entityType: "customer", entityId: "fc1", date: "2026-01-01", type: "opening_balance", reference: "OB", description: "Opening Balance", debit: 175000, credit: 0, runningBalance: 175000 },
  { id: "cle2", entityType: "customer", entityId: "fc1", date: "2026-01-18", type: "invoice", reference: "MBL/24-25/004", description: "BioSense Glucose Monitor - 50 units", debit: 252226, credit: 0, runningBalance: 427226 },
  { id: "cle3", entityType: "customer", entityId: "fc1", date: "2026-02-05", type: "payment", reference: "PAY-R-002", description: "Partial payment via NEFT", debit: 0, credit: 100000, runningBalance: 327226 },
  // MedTech India
  { id: "cle4", entityType: "customer", entityId: "fc4", date: "2026-01-26", type: "invoice", reference: "MBL/24-25/001", description: "MicroPlate Reader 96 - 6 units", debit: 601800, credit: 0, runningBalance: 601800 },
  { id: "cle5", entityType: "customer", entityId: "fc4", date: "2026-02-10", type: "payment", reference: "PAY-R-001", description: "Full payment via NEFT", debit: 0, credit: 601800, runningBalance: 0 },
  // CureWell Pharma
  { id: "cle6", entityType: "customer", entityId: "fc3", date: "2026-02-01", type: "invoice", reference: "MBL/24-25/002", description: "Reagent Pack Alpha + Beta supply", debit: 802400, credit: 0, runningBalance: 802400 },
  // Apollo Diagnostics
  { id: "cle7", entityType: "customer", entityId: "fc2", date: "2026-02-05", type: "invoice", reference: "MBL/24-25/003", description: "HemaCheck + Reagent Pack Alpha", debit: 896800, credit: 0, runningBalance: 896800 },
  // BioGenesis
  { id: "cle8", entityType: "customer", entityId: "fc5", date: "2025-12-15", type: "invoice", reference: "MBL/24-25/005", description: "Portable Centrifuge Mini - 8 units", debit: 264320, credit: 0, runningBalance: 264320 },
];

export const vendorLedgerEntries: LedgerEntryFin[] = [
  { id: "vle1", entityType: "vendor", entityId: "v1", date: "2026-01-20", type: "invoice", reference: "CHEM/INV/2026/101", description: "Reagent Raw Material A", debit: 0, credit: 118000, runningBalance: 118000 },
  { id: "vle2", entityType: "vendor", entityId: "v1", date: "2026-02-15", type: "payment", reference: "PAY-M-001", description: "Payment via RTGS", debit: 118000, credit: 0, runningBalance: 0 },
  { id: "vle3", entityType: "vendor", entityId: "v2", date: "2026-01-25", type: "invoice", reference: "PP/2026/0045", description: "Precision Sensor Module + Springs", debit: 0, credit: 236000, runningBalance: 236000 },
  { id: "vle4", entityType: "vendor", entityId: "v4", date: "2026-02-05", type: "invoice", reference: "TC/26/INV-312", description: "Microcontroller Board v3", debit: 0, credit: 501500, runningBalance: 501500 },
  { id: "vle5", entityType: "vendor", entityId: "v3", date: "2026-02-08", type: "invoice", reference: "PR/2026/088", description: "Packaging Material - Premium", debit: 0, credit: 82600, runningBalance: 82600 },
  { id: "vle6", entityType: "vendor", entityId: "v3", date: "2026-02-12", type: "payment", reference: "PAY-M-002", description: "Partial payment via cheque", debit: 50000, credit: 0, runningBalance: 32600 },
];

// --- E-Way Bills ---
export type EWBStatus = "generated" | "active" | "expired" | "cancelled";

export interface EWayBill {
  id: string;
  ewbNumber: string;
  invoiceRef: string;
  customerId: string;
  fromState: string;
  toState: string;
  transporterName: string;
  vehicleNumber: string;
  distance: number;
  value: number;
  generatedDate: string;
  validUntil: string;
  status: EWBStatus;
}

export const ewayBills: EWayBill[] = [
  { id: "ewb1", ewbNumber: "2714 1234 5678", invoiceRef: "MBL/24-25/001", customerId: "fc4", fromState: "Maharashtra", toState: "Maharashtra", transporterName: "BlueDart Logistics", vehicleNumber: "MH-04-AB-1234", distance: 25, value: 601800, generatedDate: "2026-01-26", validUntil: "2026-01-27", status: "expired" },
  { id: "ewb2", ewbNumber: "2714 2345 6789", invoiceRef: "MBL/24-25/002", customerId: "fc3", fromState: "Maharashtra", toState: "Gujarat", transporterName: "DTDC Express", vehicleNumber: "MH-12-CD-5678", distance: 520, value: 802400, generatedDate: "2026-02-02", validUntil: "2026-02-05", status: "active" },
  { id: "ewb3", ewbNumber: "2714 3456 7890", invoiceRef: "MBL/24-25/005", customerId: "fc5", fromState: "Maharashtra", toState: "Telangana", transporterName: "Gati Logistics", vehicleNumber: "MH-02-EF-9012", distance: 710, value: 264320, generatedDate: "2025-12-16", validUntil: "2025-12-19", status: "expired" },
];

// --- GST Data ---
export interface GSTR1Entry {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerGstin: string;
  customerName: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  invoiceValue: number;
  supplyType: "B2B" | "B2C";
}

export const gstr1Entries: GSTR1Entry[] = salesInvoices.map((si) => {
  const cust = finCustomers.find((c) => c.id === si.customerId);
  return {
    id: si.id,
    invoiceNumber: si.invoiceNumber,
    invoiceDate: si.invoiceDate,
    customerGstin: cust?.gstin || "",
    customerName: cust?.name || "",
    taxableValue: si.subtotal,
    cgst: si.totalCgst,
    sgst: si.totalSgst,
    igst: si.totalIgst,
    totalTax: si.totalTax,
    invoiceValue: si.grandTotal,
    supplyType: "B2B" as const,
  };
});

export interface ITCEntry {
  id: string;
  vendorGstin: string;
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  totalItc: number;
  status: "eligible" | "ineligible" | "reversed";
}

export const itcEntries: ITCEntry[] = [
  { id: "itc1", vendorGstin: "27AABCS1111A1Z1", vendorName: "ChemSupply India", invoiceNumber: "CHEM/INV/2026/101", invoiceDate: "2026-01-20", taxableValue: 100000, igst: 0, cgst: 9000, sgst: 9000, totalItc: 18000, status: "eligible" },
  { id: "itc2", vendorGstin: "33AABCP2222B2Z2", vendorName: "PrecisionParts Mfg", invoiceNumber: "PP/2026/0045", invoiceDate: "2026-01-25", taxableValue: 200000, igst: 36000, cgst: 0, sgst: 0, totalItc: 36000, status: "eligible" },
  { id: "itc3", vendorGstin: "07AABCT4444D4Z4", vendorName: "TechComp Electronics", invoiceNumber: "TC/26/INV-312", invoiceDate: "2026-02-05", taxableValue: 425000, igst: 76500, cgst: 0, sgst: 0, totalItc: 76500, status: "ineligible" },
  { id: "itc4", vendorGstin: "29AABCP3333C3Z3", vendorName: "PackRight Solutions", invoiceNumber: "PR/2026/088", invoiceDate: "2026-02-08", taxableValue: 70000, igst: 12600, cgst: 0, sgst: 0, totalItc: 12600, status: "reversed" },
];

// --- Finance Activity Feed ---
export interface FinActivity {
  id: string;
  entityType: "sales_invoice" | "purchase_invoice" | "purchase_order" | "payment" | "eway_bill" | "finance";
  entityId: string;
  type: "comment" | "status_change" | "system_log" | "approval";
  user: string;
  content: string;
  timestamp: string;
}

export const finActivities: FinActivity[] = [
  { id: "fa1", entityType: "sales_invoice", entityId: "si1", type: "system_log", user: "system", content: "Invoice MBL/24-25/001 created from Sales Order SO-2026-002", timestamp: "2026-01-26T09:00:00Z" },
  { id: "fa2", entityType: "sales_invoice", entityId: "si1", type: "status_change", user: "u6", content: "Invoice marked as Sent", timestamp: "2026-01-26T10:30:00Z" },
  { id: "fa3", entityType: "sales_invoice", entityId: "si1", type: "status_change", user: "u6", content: "Payment of ₹6,01,800 received. Invoice marked as Paid.", timestamp: "2026-02-10T11:00:00Z" },
  { id: "fa4", entityType: "purchase_order", entityId: "po1", type: "approval", user: "system", content: "PO auto-approved (amount below ₹1,50,000 threshold)", timestamp: "2026-01-15T09:00:00Z" },
  { id: "fa5", entityType: "purchase_order", entityId: "po2", type: "approval", user: "u6", content: "PO approved by Finance Lead", timestamp: "2026-01-20T14:00:00Z" },
  { id: "fa6", entityType: "purchase_order", entityId: "po3", type: "system_log", user: "system", content: "PO pending Management approval (amount exceeds ₹5,00,000)", timestamp: "2026-02-01T09:00:00Z" },
  { id: "fa7", entityType: "purchase_order", entityId: "po5", type: "approval", user: "u6", content: "PO rejected: Budget exceeded for Q1. Defer to Q2.", timestamp: "2026-01-26T10:00:00Z" },
  { id: "fa8", entityType: "eway_bill", entityId: "ewb2", type: "system_log", user: "system", content: "E-Way Bill generated via NIC API. EWB No: 2714 2345 6789", timestamp: "2026-02-02T08:00:00Z" },
  { id: "fa9", entityType: "purchase_invoice", entityId: "pi2", type: "status_change", user: "u6", content: "3-way match completed. PO, GRN, and Invoice verified.", timestamp: "2026-01-26T15:00:00Z" },
  { id: "fa10", entityType: "purchase_invoice", entityId: "pi4", type: "comment", user: "u6", content: "Quantity mismatch: GRN shows 2000 units but invoice billed for 2100. Flagged as disputed.", timestamp: "2026-02-09T11:00:00Z" },
  { id: "fa11", entityType: "sales_invoice", entityId: "si5", type: "system_log", user: "system", content: "Invoice MBL/24-25/005 is now overdue. Due date was 14 Jan 2026.", timestamp: "2026-01-15T00:00:00Z" },
  { id: "fa12", entityType: "sales_invoice", entityId: "si4", type: "status_change", user: "u6", content: "Partial payment of ₹1,00,000 received from LifeCare Hospitals", timestamp: "2026-02-05T12:00:00Z" },
];

// --- Helper functions ---
export function getFinCustomerById(id: string): FinCustomer | undefined {
  return finCustomers.find((c) => c.id === id);
}

export function getVendorById(id: string): Vendor | undefined {
  return vendors.find((v) => v.id === id);
}

export function getFinActivitiesForEntity(entityType: string, entityId: string): FinActivity[] {
  return finActivities.filter((a) => a.entityType === entityType && a.entityId === entityId);
}

// --- Ageing helpers ---
export interface AgeingBucket {
  label: string;
  range: string;
  amount: number;
  count: number;
}

export function getReceivablesAgeing(): AgeingBucket[] {
  const today = new Date("2026-02-15");
  const buckets: AgeingBucket[] = [
    { label: "Current", range: "0-30 days", amount: 0, count: 0 },
    { label: "30 Days", range: "31-60 days", amount: 0, count: 0 },
    { label: "60 Days", range: "61-90 days", amount: 0, count: 0 },
    { label: "90+ Days", range: "90+ days", amount: 0, count: 0 },
  ];
  salesInvoices.filter((si) => si.status !== "paid" && si.status !== "cancelled").forEach((si) => {
    const due = new Date(si.dueDate);
    const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    const outstanding = si.grandTotal - si.paidAmount;
    if (diff <= 0) { buckets[0].amount += outstanding; buckets[0].count++; }
    else if (diff <= 30) { buckets[1].amount += outstanding; buckets[1].count++; }
    else if (diff <= 60) { buckets[2].amount += outstanding; buckets[2].count++; }
    else { buckets[3].amount += outstanding; buckets[3].count++; }
  });
  return buckets;
}

export function getPayablesAgeing(): AgeingBucket[] {
  const today = new Date("2026-02-15");
  const buckets: AgeingBucket[] = [
    { label: "Current", range: "0-30 days", amount: 0, count: 0 },
    { label: "30 Days", range: "31-60 days", amount: 0, count: 0 },
    { label: "60 Days", range: "61-90 days", amount: 0, count: 0 },
    { label: "90+ Days", range: "90+ days", amount: 0, count: 0 },
  ];
  purchaseInvoices.filter((pi) => pi.status !== "paid").forEach((pi) => {
    const due = new Date(pi.dueDate);
    const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 0) { buckets[0].amount += pi.grandTotal; buckets[0].count++; }
    else if (diff <= 30) { buckets[1].amount += pi.grandTotal; buckets[1].count++; }
    else if (diff <= 60) { buckets[2].amount += pi.grandTotal; buckets[2].count++; }
    else { buckets[3].amount += pi.grandTotal; buckets[3].count++; }
  });
  return buckets;
}
