// ─── Procurement Module Mock Data ────────────────────────────────────────────
// Company: Mobilab Instruments (medical diagnostics)

export type VendorStatus = "ACTIVE" | "ON_PROBATION" | "BLACKLISTED" | "INACTIVE";
export type VendorCategory =
  | "PCB Manufacturer" | "Mechanical" | "Electronic Components"
  | "Reagent Supplier" | "Packaging" | "Logistics" | "Service" | "Other";

export interface VendorRatingPeriod {
  period: string; // e.g. "Q4-FY2025"
  qcPassRate: number;
  onTimeRate: number;
  rejectionRate: number;
  score: number;
}

export interface Vendor {
  id: string;
  code: string;
  legalName: string;
  tradeName: string;
  gstin: string;
  pan: string;
  category: VendorCategory;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  paymentTerms: "Net 15" | "Net 30" | "Net 45" | "Advance" | "On Delivery";
  leadTimeDays: number;
  status: VendorStatus;
  ratingScore: number;
  ratingPeriods: VendorRatingPeriod[];
  totalPOValue: number;
  totalGRNs: number;
  msmeRegistered: boolean;
  bankName: string;
  bankAccount: string; // masked
  ifsc: string;
  createdAt: string;
}

export type IndentStatus =
  | "DRAFT" | "SUBMITTED" | "APPROVED" | "PO_RAISED"
  | "PARTIALLY_RECEIVED" | "FULFILLED" | "CANCELLED";
export type IndentUrgency = "NORMAL" | "URGENT";
export type IndentSource = "MANUAL" | "MRP_AUTO" | "REORDER_AUTO";

export interface Indent {
  id: string;
  indentNumber: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyRequired: number;
  uom: string;
  requiredByDate: string;
  reason: string;
  urgency: IndentUrgency;
  source: IndentSource;
  status: IndentStatus;
  workOrderId?: string;
  warehouseId: string;
  warehouseName: string;
  requestedBy: string;
  approvedBy?: string;
  poNumber?: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export type POStatus =
  | "DRAFT" | "PENDING_FINANCE" | "PENDING_MGMT" | "APPROVED"
  | "PO_SENT" | "PARTIALLY_RECEIVED" | "FULFILLED" | "CANCELLED" | "AMENDED";

export interface POLine {
  id: string;
  indentId?: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qty: number;
  unit: string;
  unitPrice: number;
  hsnCode: string;
  gstRate: number;
  lineTotal: number;
  qtyReceived: number;
}

export interface POApprovalLog {
  id: string;
  approver: string;
  role: string;
  action: "APPROVED" | "REJECTED" | "ESCALATED" | "PENDING";
  note?: string;
  actionedAt?: string;
  threshold: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  vendorGstin: string;
  warehouseId: string;
  warehouseName: string;
  requiredDeliveryDate: string;
  status: POStatus;
  lines: POLine[];
  subtotal: number;
  gstAmount: number;
  totalValue: number;
  approvalLogs: POApprovalLog[];
  proformaInvoiceRef?: string;
  proformaUploaded: boolean;
  createdBy: string;
  createdAt: string;
  approvedAt?: string;
  sentAt?: string;
  notes?: string;
  costCentre: string;
}

export type InwardStatus = "RECEIVED" | "QC_IN_PROGRESS" | "QC_DONE" | "GRN_CREATED";

export interface InwardLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyOrdered: number;
  qtyReceived: number;
  unit: string;
  vendorBatchRef?: string;
  condition: "GOOD" | "DAMAGED" | "EXCESS";
}

export interface InwardEntry {
  id: string;
  inwardNumber: string;
  poId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  warehouseId: string;
  warehouseName: string;
  vehicleNumber: string;
  driverName: string;
  challanRef: string;
  receivedAt: string;
  status: InwardStatus;
  lines: InwardLine[];
  receivedBy: string;
  qcTaskId?: string;
  grnId?: string;
  remarks?: string;
}

export type QCStatus = "PENDING" | "IN_PROGRESS" | "PASSED" | "PARTIALLY_PASSED" | "FAILED";

export interface QCCheckItem {
  id: string;
  checkName: string;
  category: string;
  result: "PASS" | "FAIL" | "NA";
  remarks?: string;
}

export interface QCInspection {
  id: string;
  inwardId: string;
  inwardNumber: string;
  poNumber: string;
  vendorName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyInspected: number;
  qtyAccepted: number;
  qtyRejected: number;
  status: QCStatus;
  checklist: QCCheckItem[];
  inspectedBy?: string;
  inspectedAt?: string;
  defectReason?: string;
  grnId?: string;
}

export type GRNStatus = "DRAFT" | "CONFIRMED";

export interface GRNLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyAccepted: number;
  qtyRejected: number;
  unit: string;
  batchNumber: string;
  expiryDate?: string;
  unitPrice: number;
  lineValue: number;
  qcResult: "PASSED" | "PARTIALLY_PASSED" | "FAILED";
}

export interface GRN {
  id: string;
  grnNumber: string;
  inwardId: string;
  inwardNumber: string;
  poId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  qcInspectionId: string;
  warehouseId: string;
  warehouseName: string;
  status: GRNStatus;
  lines: GRNLine[];
  totalAcceptedValue: number;
  purchaseInvoiceDraft?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  stockUpdated: boolean;
}

export type RTVReason = "QC_REJECTION" | "WRONG_ITEM" | "EXCESS" | "DAMAGED_IN_TRANSIT" | "EXPIRED";
export type RTVStatus = "DRAFT" | "DISPATCHED" | "VENDOR_ACKNOWLEDGED" | "DEBIT_NOTE_RAISED";

export interface RTVLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyReturned: number;
  unit: string;
  unitPrice: number;
  lineValue: number;
  reasonDetail: string;
}

export interface ReturnToVendor {
  id: string;
  rtvNumber: string;
  inwardId: string;
  inwardNumber: string;
  grnId?: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  reason: RTVReason;
  status: RTVStatus;
  lines: RTVLine[];
  totalReturnValue: number;
  debitNoteRef?: string;
  debitNoteCreated: boolean;
  createdBy: string;
  createdAt: string;
  dispatchedAt?: string;
}

// ─── Vendors ──────────────────────────────────────────────────────────────────

export const vendors: Vendor[] = [
  {
    id: "vnd1",
    code: "MLB-VND-001",
    legalName: "Sysmex India Private Limited",
    tradeName: "Sysmex India",
    gstin: "27AABCS1234A1Z5",
    pan: "AABCS1234A",
    category: "Reagent Supplier",
    contactName: "Rajesh Mehta",
    phone: "+91-98201-44551",
    email: "procurement@sysmex.in",
    address: "Plot 45, MIDC Phase II, Andheri East, Mumbai",
    state: "Maharashtra",
    paymentTerms: "Net 30",
    leadTimeDays: 21,
    status: "ACTIVE",
    ratingScore: 88,
    ratingPeriods: [
      { period: "Q2-FY2025", qcPassRate: 96, onTimeRate: 85, rejectionRate: 4, score: 87 },
      { period: "Q3-FY2025", qcPassRate: 97, onTimeRate: 88, rejectionRate: 3, score: 89 },
      { period: "Q4-FY2025", qcPassRate: 95, onTimeRate: 88, rejectionRate: 5, score: 88 },
    ],
    totalPOValue: 4850000,
    totalGRNs: 18,
    msmeRegistered: false,
    bankName: "HDFC Bank",
    bankAccount: "****4821",
    ifsc: "HDFC0001234",
    createdAt: "2024-04-01",
  },
  {
    id: "vnd2",
    code: "MLB-VND-002",
    legalName: "PCB Technologies India Pvt Ltd",
    tradeName: "PCBTech India",
    gstin: "36AABCP9876B1Z2",
    pan: "AABCP9876B",
    category: "PCB Manufacturer",
    contactName: "Suresh Iyer",
    phone: "+91-94400-18892",
    email: "orders@pcbtech.in",
    address: "16B Electronic City Phase I, Bengaluru",
    state: "Karnataka",
    paymentTerms: "Net 45",
    leadTimeDays: 30,
    status: "ACTIVE",
    ratingScore: 82,
    ratingPeriods: [
      { period: "Q2-FY2025", qcPassRate: 90, onTimeRate: 80, rejectionRate: 10, score: 80 },
      { period: "Q3-FY2025", qcPassRate: 92, onTimeRate: 82, rejectionRate: 8, score: 82 },
      { period: "Q4-FY2025", qcPassRate: 91, onTimeRate: 83, rejectionRate: 9, score: 82 },
    ],
    totalPOValue: 2340000,
    totalGRNs: 12,
    msmeRegistered: true,
    bankName: "ICICI Bank",
    bankAccount: "****7732",
    ifsc: "ICIC0002345",
    createdAt: "2024-04-01",
  },
  {
    id: "vnd3",
    code: "MLB-VND-003",
    legalName: "Biolabs Sciences Pvt Ltd",
    tradeName: "Biolabs Sciences",
    gstin: "09AABCB5678C1Z3",
    pan: "AABCB5678C",
    category: "Reagent Supplier",
    contactName: "Priya Sharma",
    phone: "+91-98100-22341",
    email: "supply@biolabs.co.in",
    address: "B-24 Sector 63, Noida",
    state: "Uttar Pradesh",
    paymentTerms: "Net 30",
    leadTimeDays: 14,
    status: "ON_PROBATION",
    ratingScore: 58,
    ratingPeriods: [
      { period: "Q2-FY2025", qcPassRate: 75, onTimeRate: 65, rejectionRate: 25, score: 66 },
      { period: "Q3-FY2025", qcPassRate: 70, onTimeRate: 60, rejectionRate: 30, score: 61 },
      { period: "Q4-FY2025", qcPassRate: 68, onTimeRate: 58, rejectionRate: 32, score: 58 },
    ],
    totalPOValue: 980000,
    totalGRNs: 9,
    msmeRegistered: true,
    bankName: "SBI",
    bankAccount: "****3318",
    ifsc: "SBIN0003456",
    createdAt: "2024-06-15",
  },
  {
    id: "vnd4",
    code: "MLB-VND-004",
    legalName: "PrecisionMech Components LLP",
    tradeName: "PrecisionMech",
    gstin: "18AABCP2345D1Z6",
    pan: "AABCP2345D",
    category: "Mechanical",
    contactName: "Anup Baruah",
    phone: "+91-94350-61100",
    email: "sales@precisionmech.in",
    address: "Industrial Area, Guwahati",
    state: "Assam",
    paymentTerms: "Net 15",
    leadTimeDays: 10,
    status: "ACTIVE",
    ratingScore: 91,
    ratingPeriods: [
      { period: "Q2-FY2025", qcPassRate: 98, onTimeRate: 92, rejectionRate: 2, score: 90 },
      { period: "Q3-FY2025", qcPassRate: 99, onTimeRate: 93, rejectionRate: 1, score: 91 },
      { period: "Q4-FY2025", qcPassRate: 98, onTimeRate: 93, rejectionRate: 2, score: 91 },
    ],
    totalPOValue: 1620000,
    totalGRNs: 22,
    msmeRegistered: true,
    bankName: "Axis Bank",
    bankAccount: "****9901",
    ifsc: "UTIB0004567",
    createdAt: "2024-03-01",
  },
  {
    id: "vnd5",
    code: "MLB-VND-005",
    legalName: "ChemSafe Solutions Pvt Ltd",
    tradeName: "ChemSafe",
    gstin: "07AABCC4321E1Z1",
    pan: "AABCC4321E",
    category: "Reagent Supplier",
    contactName: "Meena Kapoor",
    phone: "+91-99110-55623",
    email: "procurement@chemsafe.co.in",
    address: "A-12 Okhla Industrial Estate Phase III, New Delhi",
    state: "Delhi",
    paymentTerms: "On Delivery",
    leadTimeDays: 7,
    status: "ACTIVE",
    ratingScore: 79,
    ratingPeriods: [
      { period: "Q2-FY2025", qcPassRate: 85, onTimeRate: 78, rejectionRate: 15, score: 79 },
      { period: "Q3-FY2025", qcPassRate: 86, onTimeRate: 79, rejectionRate: 14, score: 79 },
      { period: "Q4-FY2025", qcPassRate: 84, onTimeRate: 78, rejectionRate: 16, score: 79 },
    ],
    totalPOValue: 540000,
    totalGRNs: 14,
    msmeRegistered: false,
    bankName: "Kotak Bank",
    bankAccount: "****1187",
    ifsc: "KKBK0005678",
    createdAt: "2024-07-01",
  },
  {
    id: "vnd6",
    code: "MLB-VND-006",
    legalName: "Optronics Components India Ltd",
    tradeName: "Optronics India",
    gstin: "29AABCO8765F1Z4",
    pan: "AABCO8765F",
    category: "Electronic Components",
    contactName: "Vikas Joshi",
    phone: "+91-98440-77321",
    email: "b2b@optronics.in",
    address: "60-A Rajajinagar Industrial Area, Bengaluru",
    state: "Karnataka",
    paymentTerms: "Net 30",
    leadTimeDays: 18,
    status: "BLACKLISTED",
    ratingScore: 41,
    ratingPeriods: [
      { period: "Q2-FY2025", qcPassRate: 60, onTimeRate: 40, rejectionRate: 40, score: 48 },
      { period: "Q3-FY2025", qcPassRate: 55, onTimeRate: 35, rejectionRate: 45, score: 43 },
      { period: "Q4-FY2025", qcPassRate: 50, onTimeRate: 38, rejectionRate: 50, score: 41 },
    ],
    totalPOValue: 320000,
    totalGRNs: 5,
    msmeRegistered: false,
    bankName: "HDFC Bank",
    bankAccount: "****4456",
    ifsc: "HDFC0006789",
    createdAt: "2024-05-01",
  },
];

// ─── Indents ──────────────────────────────────────────────────────────────────

export const indents: Indent[] = [
  {
    id: "ind1",
    indentNumber: "MLB-IND-2026-001",
    itemId: "itm6",
    itemCode: "MLB-ITM-0006",
    itemName: "Flow Cell Sensor - Precision Grade",
    qtyRequired: 40,
    uom: "PCS",
    requiredByDate: "2026-04-30",
    reason: "Reorder point breached — available qty 13 < reorder 15",
    urgency: "URGENT",
    source: "REORDER_AUTO",
    status: "APPROVED",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requestedBy: "System (Auto)",
    approvedBy: "Vikram Nair",
    poNumber: undefined,
    createdAt: "2026-04-16T06:00:00",
    updatedAt: "2026-04-16T08:00:00",
  },
  {
    id: "ind2",
    indentNumber: "MLB-IND-2026-002",
    itemId: "itm9",
    itemCode: "MLB-ITM-0009",
    itemName: "Mechanical Frame - BA200",
    qtyRequired: 30,
    uom: "PCS",
    requiredByDate: "2026-04-25",
    reason: "Critical reorder — available qty at safety stock level",
    urgency: "URGENT",
    source: "REORDER_AUTO",
    status: "SUBMITTED",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requestedBy: "System (Auto)",
    createdAt: "2026-04-16T06:00:00",
    updatedAt: "2026-04-16T06:00:00",
  },
  {
    id: "ind3",
    indentNumber: "MLB-IND-2026-003",
    itemId: "itm3",
    itemCode: "MLB-ITM-0003",
    itemName: "CBC Reagent Kit - 500 Tests",
    qtyRequired: 100,
    uom: "KIT",
    requiredByDate: "2026-05-01",
    reason: "Monthly replenishment for Noida warehouse",
    urgency: "NORMAL",
    source: "MANUAL",
    status: "PO_RAISED",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    requestedBy: "Suresh Gupta",
    approvedBy: "Vikram Nair",
    poNumber: "MLB-PO-2026-011",
    createdAt: "2026-04-10T10:00:00",
    updatedAt: "2026-04-12T14:00:00",
  },
  {
    id: "ind4",
    indentNumber: "MLB-IND-2026-004",
    itemId: "itm5",
    itemCode: "MLB-ITM-0005",
    itemName: "PCB Assembly - HA500 Main Board",
    qtyRequired: 50,
    uom: "PCS",
    requiredByDate: "2026-05-15",
    reason: "Work Order WO-2026-005 — BOM shortfall",
    urgency: "NORMAL",
    source: "MRP_AUTO",
    status: "APPROVED",
    workOrderId: "WO-2026-005",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requestedBy: "System (MRP)",
    approvedBy: "Vikram Nair",
    createdAt: "2026-04-08T09:00:00",
    updatedAt: "2026-04-09T10:00:00",
  },
  {
    id: "ind5",
    indentNumber: "MLB-IND-2026-005",
    itemId: "itm4",
    itemCode: "MLB-ITM-0004",
    itemName: "Liver Function Test Kit",
    qtyRequired: 80,
    uom: "KIT",
    requiredByDate: "2026-04-28",
    reason: "Noida stock critically low — expiring batches being consumed",
    urgency: "URGENT",
    source: "MANUAL",
    status: "FULFILLED",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    requestedBy: "Suresh Gupta",
    approvedBy: "Vikram Nair",
    poNumber: "MLB-PO-2026-009",
    createdAt: "2026-03-20T11:00:00",
    updatedAt: "2026-04-02T15:00:00",
  },
  {
    id: "ind6",
    indentNumber: "MLB-IND-2026-006",
    itemId: "itm8",
    itemCode: "MLB-ITM-0008",
    itemName: "Cleaning Solution 1L",
    qtyRequired: 300,
    uom: "BTL",
    requiredByDate: "2026-05-20",
    reason: "Routine replenishment after breakage adjustment",
    urgency: "NORMAL",
    source: "MANUAL",
    status: "DRAFT",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requestedBy: "Ranjit Bora",
    createdAt: "2026-04-15T14:00:00",
    updatedAt: "2026-04-15T14:00:00",
  },
];

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export const purchaseOrders: PurchaseOrder[] = [
  {
    id: "po1",
    poNumber: "MLB-PO-2026-009",
    vendorId: "vnd3",
    vendorName: "Biolabs Sciences",
    vendorGstin: "09AABCB5678C1Z3",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    requiredDeliveryDate: "2026-04-05",
    status: "FULFILLED",
    lines: [
      { id: "pol1", indentId: "ind5", itemId: "itm4", itemCode: "MLB-ITM-0004", itemName: "Liver Function Test Kit", qty: 80, unit: "KIT", unitPrice: 2800, hsnCode: "38220090", gstRate: 12, lineTotal: 224000, qtyReceived: 80 },
    ],
    subtotal: 224000,
    gstAmount: 26880,
    totalValue: 250880,
    proformaUploaded: true,
    proformaInvoiceRef: "PI-BIO-2026-041",
    approvalLogs: [
      { id: "apl1", approver: "Ananya Das", role: "Finance", action: "APPROVED", note: "Within Finance threshold. PI verified.", actionedAt: "2026-03-22T10:30:00", threshold: "< ₹2,50,000" },
    ],
    createdBy: "Ranjit Bora",
    createdAt: "2026-03-21",
    approvedAt: "2026-03-22",
    sentAt: "2026-03-22",
    costCentre: "STORES-NOI",
  },
  {
    id: "po2",
    poNumber: "MLB-PO-2026-010",
    vendorId: "vnd2",
    vendorName: "PCBTech India",
    vendorGstin: "36AABCP9876B1Z2",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requiredDeliveryDate: "2026-05-15",
    status: "APPROVED",
    lines: [
      { id: "pol2", indentId: "ind4", itemId: "itm5", itemCode: "MLB-ITM-0005", itemName: "PCB Assembly - HA500 Main Board", qty: 50, unit: "PCS", unitPrice: 8500, hsnCode: "85340019", gstRate: 18, lineTotal: 425000, qtyReceived: 0 },
    ],
    subtotal: 425000,
    gstAmount: 76500,
    totalValue: 501500,
    proformaUploaded: true,
    proformaInvoiceRef: "PI-PCB-2026-015",
    approvalLogs: [
      { id: "apl2", approver: "Ananya Das", role: "Finance", action: "APPROVED", note: "Verified against budget. Within Finance threshold.", actionedAt: "2026-04-10T14:00:00", threshold: "< ₹5,00,000" },
      { id: "apl3", approver: "Vikram Nair", role: "Finance Manager", action: "APPROVED", note: "Approved. Critical for WO-2026-005.", actionedAt: "2026-04-10T16:00:00", threshold: "> ₹2,50,000" },
    ],
    createdBy: "Ranjit Bora",
    createdAt: "2026-04-09",
    approvedAt: "2026-04-10",
    sentAt: "2026-04-11",
    costCentre: "PROD-GUW",
    notes: "Urgent — linked to WO-2026-005 for HA-500 production run",
  },
  {
    id: "po3",
    poNumber: "MLB-PO-2026-011",
    vendorId: "vnd1",
    vendorName: "Sysmex India",
    vendorGstin: "27AABCS1234A1Z5",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    requiredDeliveryDate: "2026-05-05",
    status: "PENDING_FINANCE",
    lines: [
      { id: "pol3", indentId: "ind3", itemId: "itm3", itemCode: "MLB-ITM-0003", itemName: "CBC Reagent Kit - 500 Tests", qty: 100, unit: "KIT", unitPrice: 4200, hsnCode: "38220090", gstRate: 12, lineTotal: 420000, qtyReceived: 0 },
    ],
    subtotal: 420000,
    gstAmount: 50400,
    totalValue: 470400,
    proformaUploaded: false,
    approvalLogs: [
      { id: "apl4", approver: "Ananya Das", role: "Finance", action: "PENDING", threshold: "< ₹5,00,000" },
    ],
    createdBy: "Ranjit Bora",
    createdAt: "2026-04-12",
    costCentre: "STORES-NOI",
    notes: "Awaiting Finance approval and Proforma Invoice from vendor",
  },
  {
    id: "po4",
    poNumber: "MLB-PO-2026-012",
    vendorId: "vnd4",
    vendorName: "PrecisionMech",
    vendorGstin: "18AABCP2345D1Z6",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requiredDeliveryDate: "2026-04-22",
    status: "PARTIALLY_RECEIVED",
    lines: [
      { id: "pol4", indentId: "ind2", itemId: "itm9", itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame - BA200", qty: 30, unit: "PCS", unitPrice: 6200, hsnCode: "84798900", gstRate: 18, lineTotal: 186000, qtyReceived: 15 },
    ],
    subtotal: 186000,
    gstAmount: 33480,
    totalValue: 219480,
    proformaUploaded: true,
    proformaInvoiceRef: "PI-PMC-2026-008",
    approvalLogs: [
      { id: "apl5", approver: "Ananya Das", role: "Finance", action: "APPROVED", note: "Within Finance threshold.", actionedAt: "2026-04-08T11:00:00", threshold: "< ₹2,50,000" },
    ],
    createdBy: "Ranjit Bora",
    createdAt: "2026-04-07",
    approvedAt: "2026-04-08",
    sentAt: "2026-04-08",
    costCentre: "PROD-GUW",
  },
  {
    id: "po5",
    poNumber: "MLB-PO-2026-013",
    vendorId: "vnd1",
    vendorName: "Sysmex India",
    vendorGstin: "27AABCS1234A1Z5",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requiredDeliveryDate: "2026-04-15",
    status: "PENDING_MGMT",
    lines: [
      { id: "pol5", itemId: "itm3", itemCode: "MLB-ITM-0003", itemName: "CBC Reagent Kit - 500 Tests", qty: 300, unit: "KIT", unitPrice: 4200, hsnCode: "38220090", gstRate: 12, lineTotal: 1260000, qtyReceived: 0 },
      { id: "pol6", itemId: "itm8", itemCode: "MLB-ITM-0008", itemName: "Cleaning Solution 1L", qty: 500, unit: "BTL", unitPrice: 450, hsnCode: "34021900", gstRate: 18, lineTotal: 225000, qtyReceived: 0 },
    ],
    subtotal: 1485000,
    gstAmount: 192150,
    totalValue: 1677150,
    proformaUploaded: false,
    approvalLogs: [
      { id: "apl6", approver: "Ananya Das", role: "Finance", action: "APPROVED", note: "Approved Finance level. Escalated to Management.", actionedAt: "2026-04-16T09:00:00", threshold: "< ₹15,00,000" },
      { id: "apl7", approver: "Dr. Sameer Roy", role: "Management", action: "PENDING", threshold: "> ₹15,00,000" },
    ],
    createdBy: "Ranjit Bora",
    createdAt: "2026-04-15",
    costCentre: "STORES-GUW",
    notes: "Annual bulk order for CBC kits — significant cost saving vs monthly orders",
  },
  {
    id: "po6",
    poNumber: "MLB-PO-2026-007",
    vendorId: "vnd5",
    vendorName: "ChemSafe Solutions",
    vendorGstin: "07AABCC4321E1Z1",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    requiredDeliveryDate: "2026-03-20",
    status: "CANCELLED",
    lines: [
      { id: "pol7", itemId: "itm8", itemCode: "MLB-ITM-0008", itemName: "Cleaning Solution 1L", qty: 200, unit: "BTL", unitPrice: 450, hsnCode: "34021900", gstRate: 18, lineTotal: 90000, qtyReceived: 0 },
    ],
    subtotal: 90000,
    gstAmount: 16200,
    totalValue: 106200,
    proformaUploaded: false,
    approvalLogs: [
      { id: "apl8", approver: "Ananya Das", role: "Finance", action: "REJECTED", note: "Vendor pricing exceeds approved rate card by 18%. Return to requestor.", actionedAt: "2026-03-18T15:00:00", threshold: "< ₹1,50,000" },
    ],
    createdBy: "Ranjit Bora",
    createdAt: "2026-03-17",
    costCentre: "STORES-GUW",
    notes: "Cancelled — vendor pricing rejected by Finance",
  },
];

// ─── Inward Entries ───────────────────────────────────────────────────────────

export const inwardEntries: InwardEntry[] = [
  {
    id: "inw1",
    inwardNumber: "MLB-INW-2026-001",
    poId: "po1",
    poNumber: "MLB-PO-2026-009",
    vendorId: "vnd3",
    vendorName: "Biolabs Sciences",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    vehicleNumber: "DL-01-AB-1234",
    driverName: "Ramesh Kumar",
    challanRef: "BIO-CH-2026-0412",
    receivedAt: "2026-04-02T11:30:00",
    status: "GRN_CREATED",
    lines: [
      { id: "inl1", itemId: "itm4", itemCode: "MLB-ITM-0004", itemName: "Liver Function Test Kit", qtyOrdered: 80, qtyReceived: 80, unit: "KIT", vendorBatchRef: "BIO-LFT-0326", condition: "GOOD" },
    ],
    receivedBy: "Suresh Gupta",
    qcTaskId: "qc-inw-001",
    grnId: "grn101",
    remarks: "Delivered on time. All boxes intact.",
  },
  {
    id: "inw2",
    inwardNumber: "MLB-INW-2026-002",
    poId: "po4",
    poNumber: "MLB-PO-2026-012",
    vendorId: "vnd4",
    vendorName: "PrecisionMech",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    vehicleNumber: "AS-01-CD-5678",
    driverName: "Bikash Kalita",
    challanRef: "PMC-DC-2026-018",
    receivedAt: "2026-04-15T09:00:00",
    status: "QC_DONE",
    lines: [
      { id: "inl2", itemId: "itm9", itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame - BA200", qtyOrdered: 30, qtyReceived: 15, unit: "PCS", vendorBatchRef: "PMC-MF-0126", condition: "GOOD" },
    ],
    receivedBy: "Ranjit Bora",
    qcTaskId: "qc-inw-002",
    grnId: "grn102",
    remarks: "Partial delivery — remaining 15 units expected by April 30",
  },
  {
    id: "inw3",
    inwardNumber: "MLB-INW-2026-003",
    poId: "po2",
    poNumber: "MLB-PO-2026-010",
    vendorId: "vnd2",
    vendorName: "PCBTech India",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    vehicleNumber: "KA-05-GH-9012",
    driverName: "Santosh Rao",
    challanRef: "PCBT-INV-2026-0289",
    receivedAt: "2026-04-17T14:00:00",
    status: "QC_IN_PROGRESS",
    lines: [
      { id: "inl3", itemId: "itm5", itemCode: "MLB-ITM-0005", itemName: "PCB Assembly - HA500 Main Board", qtyOrdered: 50, qtyReceived: 50, unit: "PCS", vendorBatchRef: "PCBT-HA5-0426", condition: "GOOD" },
    ],
    receivedBy: "Ranjit Bora",
    qcTaskId: "qc-inw-003",
    remarks: "Full quantity received. QC in progress.",
  },
];

// ─── QC Inspections ───────────────────────────────────────────────────────────

export const qcInspections: QCInspection[] = [
  {
    id: "qci1",
    inwardId: "inw1",
    inwardNumber: "MLB-INW-2026-001",
    poNumber: "MLB-PO-2026-009",
    vendorName: "Biolabs Sciences",
    itemId: "itm4",
    itemCode: "MLB-ITM-0004",
    itemName: "Liver Function Test Kit",
    qtyInspected: 80,
    qtyAccepted: 80,
    qtyRejected: 0,
    status: "PASSED",
    checklist: [
      { id: "cc1", checkName: "Packaging integrity", category: "Visual", result: "PASS" },
      { id: "cc2", checkName: "Label accuracy (item code, batch, expiry)", category: "Documentation", result: "PASS" },
      { id: "cc3", checkName: "Cold chain compliance (2–8°C)", category: "Temperature", result: "PASS" },
      { id: "cc4", checkName: "Quantity count matches challan", category: "Quantity", result: "PASS" },
      { id: "cc5", checkName: "Certificate of Analysis present", category: "Documentation", result: "PASS" },
      { id: "cc6", checkName: "Expiry date > 6 months from today", category: "Expiry", result: "PASS" },
    ],
    inspectedBy: "Dr. Sunit Bhuyan",
    inspectedAt: "2026-04-02T15:00:00",
    grnId: "grn101",
  },
  {
    id: "qci2",
    inwardId: "inw2",
    inwardNumber: "MLB-INW-2026-002",
    poNumber: "MLB-PO-2026-012",
    vendorName: "PrecisionMech",
    itemId: "itm9",
    itemCode: "MLB-ITM-0009",
    itemName: "Mechanical Frame - BA200",
    qtyInspected: 15,
    qtyAccepted: 14,
    qtyRejected: 1,
    status: "PARTIALLY_PASSED",
    checklist: [
      { id: "cc7", checkName: "Dimensional tolerance check (±0.05mm)", category: "Dimensional", result: "PASS" },
      { id: "cc8", checkName: "Surface finish (Ra ≤ 1.6µm)", category: "Surface", result: "PASS" },
      { id: "cc9", checkName: "Mounting hole alignment", category: "Dimensional", result: "FAIL", remarks: "1 unit has misaligned holes — rejected" },
      { id: "cc10", checkName: "Material grade certification", category: "Documentation", result: "PASS" },
      { id: "cc11", checkName: "Anti-corrosion coating intact", category: "Visual", result: "PASS" },
    ],
    inspectedBy: "Dr. Sunit Bhuyan",
    inspectedAt: "2026-04-16T11:00:00",
    defectReason: "1 unit rejected: mounting hole misalignment exceeds tolerance",
    grnId: "grn102",
  },
  {
    id: "qci3",
    inwardId: "inw3",
    inwardNumber: "MLB-INW-2026-003",
    poNumber: "MLB-PO-2026-010",
    vendorName: "PCBTech India",
    itemId: "itm5",
    itemCode: "MLB-ITM-0005",
    itemName: "PCB Assembly - HA500 Main Board",
    qtyInspected: 50,
    qtyAccepted: 0,
    qtyRejected: 0,
    status: "IN_PROGRESS",
    checklist: [
      { id: "cc12", checkName: "Visual inspection (no burnt components, solder bridges)", category: "Visual", result: "PASS" },
      { id: "cc13", checkName: "Functional test — power-on self-test", category: "Functional", result: "NA", remarks: "In progress" },
      { id: "cc14", checkName: "Communication bus test (CAN, I2C)", category: "Functional", result: "NA" },
      { id: "cc15", checkName: "ESD protection verification", category: "Safety", result: "NA" },
      { id: "cc16", checkName: "Component BOM match verification", category: "Documentation", result: "PASS" },
    ],
    inspectedBy: "Dr. Sunit Bhuyan",
  },
];

// ─── GRNs ─────────────────────────────────────────────────────────────────────

export const procurementGRNs: GRN[] = [
  {
    id: "grn101",
    grnNumber: "MLB-GRN-2026-P001",
    inwardId: "inw1",
    inwardNumber: "MLB-INW-2026-001",
    poId: "po1",
    poNumber: "MLB-PO-2026-009",
    vendorId: "vnd3",
    vendorName: "Biolabs Sciences",
    qcInspectionId: "qci1",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    status: "CONFIRMED",
    lines: [
      { id: "grnl101", itemId: "itm4", itemCode: "MLB-ITM-0004", itemName: "Liver Function Test Kit", qtyAccepted: 80, qtyRejected: 0, unit: "KIT", batchNumber: "MLB-BAT-2026-P01", expiryDate: "2027-03-31", unitPrice: 2800, lineValue: 224000, qcResult: "PASSED" },
    ],
    totalAcceptedValue: 224000,
    purchaseInvoiceDraft: "PINV-DRAFT-2026-038",
    confirmedBy: "Ranjit Bora",
    confirmedAt: "2026-04-02T16:00:00",
    createdAt: "2026-04-02T15:30:00",
    stockUpdated: true,
  },
  {
    id: "grn102",
    grnNumber: "MLB-GRN-2026-P002",
    inwardId: "inw2",
    inwardNumber: "MLB-INW-2026-002",
    poId: "po4",
    poNumber: "MLB-PO-2026-012",
    vendorId: "vnd4",
    vendorName: "PrecisionMech",
    qcInspectionId: "qci2",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    status: "CONFIRMED",
    lines: [
      { id: "grnl102", itemId: "itm9", itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame - BA200", qtyAccepted: 14, qtyRejected: 1, unit: "PCS", batchNumber: "MLB-BAT-2026-P02", unitPrice: 6200, lineValue: 86800, qcResult: "PARTIALLY_PASSED" },
    ],
    totalAcceptedValue: 86800,
    purchaseInvoiceDraft: "PINV-DRAFT-2026-041",
    confirmedBy: "Ranjit Bora",
    confirmedAt: "2026-04-16T14:00:00",
    createdAt: "2026-04-16T13:00:00",
    stockUpdated: true,
  },
];

// ─── Return to Vendor ─────────────────────────────────────────────────────────

export const rtvList: ReturnToVendor[] = [
  {
    id: "rtv1",
    rtvNumber: "MLB-RTV-2026-001",
    inwardId: "inw2",
    inwardNumber: "MLB-INW-2026-002",
    grnId: "grn102",
    poNumber: "MLB-PO-2026-012",
    vendorId: "vnd4",
    vendorName: "PrecisionMech",
    reason: "QC_REJECTION",
    status: "DRAFT",
    lines: [
      { id: "rtvl1", itemId: "itm9", itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame - BA200", qtyReturned: 1, unit: "PCS", unitPrice: 6200, lineValue: 6200, reasonDetail: "Mounting hole misalignment exceeds ±0.05mm tolerance" },
    ],
    totalReturnValue: 6200,
    debitNoteCreated: false,
    createdBy: "Ranjit Bora",
    createdAt: "2026-04-16T15:00:00",
  },
  {
    id: "rtv2",
    rtvNumber: "MLB-RTV-2026-002",
    inwardId: "inw1",
    inwardNumber: "MLB-INW-2026-001",
    poNumber: "MLB-PO-2025-041",
    vendorId: "vnd3",
    vendorName: "Biolabs Sciences",
    reason: "EXPIRED",
    status: "DEBIT_NOTE_RAISED",
    lines: [
      { id: "rtvl2", itemId: "itm4", itemCode: "MLB-ITM-0004", itemName: "Liver Function Test Kit", qtyReturned: 40, unit: "KIT", unitPrice: 2800, lineValue: 112000, reasonDetail: "Batch expired before contracted shelf life — vendor supplied stock with < 3 month expiry" },
    ],
    totalReturnValue: 112000,
    debitNoteRef: "DN-2026-004",
    debitNoteCreated: true,
    createdBy: "Suresh Gupta",
    createdAt: "2026-02-10",
    dispatchedAt: "2026-02-12",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getVendorById(id: string): Vendor | undefined {
  return vendors.find((v) => v.id === id);
}

export function getPOById(id: string): PurchaseOrder | undefined {
  return purchaseOrders.find((p) => p.id === id);
}

export function getInwardById(id: string): InwardEntry | undefined {
  return inwardEntries.find((i) => i.id === id);
}

export function getQCByInwardId(inwardId: string): QCInspection | undefined {
  return qcInspections.find((q) => q.inwardId === inwardId);
}

export function getGRNByInwardId(inwardId: string): GRN | undefined {
  return procurementGRNs.find((g) => g.inwardId === inwardId);
}

export function getRatingColor(score: number): string {
  if (score >= 85) return "text-green-600";
  if (score >= 70) return "text-amber-600";
  if (score >= 60) return "text-orange-600";
  return "text-red-600";
}

export function getRatingLabel(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 60) return "Acceptable";
  return "Poor";
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
