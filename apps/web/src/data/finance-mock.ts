// Dummy data purged — this file is a type-only shim for pages not yet wired to the real API.

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

export interface FinActivity {
  id: string;
  entityType: "sales_invoice" | "purchase_invoice" | "purchase_order" | "payment" | "eway_bill" | "finance";
  entityId: string;
  type: "comment" | "status_change" | "system_log" | "approval";
  user: string;
  content: string;
  timestamp: string;
}

export interface AgeingBucket {
  label: string;
  range: string;
  amount: number;
  count: number;
}

export const finCustomers: FinCustomer[] = [];
export const vendors: Vendor[] = [];
export const salesInvoices: SalesInvoice[] = [];
export const purchaseOrders: PurchaseOrder[] = [];
export const purchaseInvoices: PurchaseInvoice[] = [];
export const finPayments: FinPayment[] = [];
export const customerLedgerEntries: LedgerEntryFin[] = [];
export const vendorLedgerEntries: LedgerEntryFin[] = [];
export const ewayBills: EWayBill[] = [];
export const gstr1Entries: GSTR1Entry[] = [];
export const itcEntries: ITCEntry[] = [];
export const finActivities: FinActivity[] = [];

// --- Helper functions ---
export function getFinCustomerById(_id: string): FinCustomer | undefined {
  return undefined;
}

export function getVendorById(_id: string): Vendor | undefined {
  return undefined;
}

export function getFinActivitiesForEntity(_entityType: string, _entityId: string): FinActivity[] {
  return [];
}

export function getReceivablesAgeing(): AgeingBucket[] {
  return [];
}

export function getPayablesAgeing(): AgeingBucket[] {
  return [];
}
