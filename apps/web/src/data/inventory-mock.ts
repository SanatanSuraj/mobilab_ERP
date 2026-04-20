// ─── Inventory & Warehouse Mock Data ────────────────────────────────────────
// Company: Mobilab Instruments (medical diagnostics)
// Warehouses: Guwahati HQ (primary), Noida (secondary)

export type TrackingType = "NONE" | "BATCH" | "SERIAL";
export type ItemStatus = "active" | "inactive";
export type AbcClass = "A" | "B" | "C";

export interface InvItem {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  subCategory: string;
  trackingType: TrackingType;
  unit: string;
  standardCost: number;
  hsnCode: string;
  abcClass: AbcClass;
  status: ItemStatus;
  isSlowMoving: boolean;
  isDeadStock: boolean;
  description: string;
  reorderPoints: { warehouseId: string; reorderPoint: number; reorderQty: number; safetyStock: number }[];
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  city: string;
  gstin: string;
  isPrimary: boolean;
  zones: Zone[];
}

export interface Zone {
  id: string;
  warehouseId: string;
  name: string;
  code: string;
  allowedTxnTypes: string[];
}

export type LedgerTxnType =
  | "IN" | "OUT" | "TRANSFER_OUT" | "TRANSFER_IN"
  | "ADJUSTMENT" | "RESERVATION" | "RESERVATION_RELEASE" | "RETURN";

export type LedgerRefDocType =
  | "GRN" | "WORK_ORDER" | "DELIVERY_CHALLAN" | "TRANSFER" | "ADJUSTMENT" | "RETURN";

export interface StockLedgerEntry {
  id: string;
  itemId: string;
  warehouseId: string;
  zoneId: string;
  txnType: LedgerTxnType;
  qty: number; // positive = IN, negative = OUT
  balanceQty: number;
  refDocType: LedgerRefDocType;
  refDocId: string;
  batchId?: string;
  serialId?: string;
  reasonCode?: string;
  remarks?: string;
  createdBy: string;
  txnAt: string;
  status: "CONFIRMED" | "PENDING";
}

export interface StockSummary {
  itemId: string;
  warehouseId: string;
  totalQty: number;
  reservedQty: number;
  availableQty: number;
}

export type BatchStatus =
  | "ACTIVE" | "PARTIALLY_CONSUMED" | "FULLY_CONSUMED"
  | "QUARANTINED" | "EXPIRED" | "RETURNED_TO_VENDOR";

export interface InvBatch {
  id: string;
  batchNumber: string;
  itemId: string;
  warehouseId: string;
  zoneId: string;
  vendorLotNumber: string;
  vendorId: string;
  vendorName: string;
  grnId: string;
  mfgDate: string;
  expiryDate: string;
  receivedQty: number;
  currentQty: number;
  consumedQty: number;
  status: BatchStatus;
  qcInspectionId?: string;
  qcStatus: "PENDING" | "PASSED" | "FAILED";
  // Reagent-specific
  catalogueNumber?: string;
  storageTemp?: string;
  reconstitutionDate?: string;
}

export type SerialStatus =
  | "CREATED" | "IN_PRODUCTION" | "QC_HOLD" | "FINISHED"
  | "RESERVED" | "DISPATCHED" | "RETURNED" | "SCRAPPED";

export interface InvSerial {
  id: string;
  serialNumber: string;
  itemId: string;
  warehouseId: string;
  workOrderId?: string;
  status: SerialStatus;
  pcbId?: string;
  mechId?: string;
  sensorId?: string;
  qcCertUrl?: string;
  accountId?: string;
  accountName?: string;
  deliveryChallanId?: string;
  manufacturedDate?: string;
  dispatchedDate?: string;
  returnedDate?: string;
  scrapReason?: string;
}

export type GrnStatus = "DRAFT" | "CONFIRMED" | "PARTIALLY_QC" | "QC_DONE";

export interface GrnLineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unit: string;
  batchId?: string;
  batchNumber?: string;
  expiryDate?: string;
  unitCost: number;
  totalCost: number;
}

export interface Grn {
  id: string;
  grnNumber: string;
  vendorId: string;
  vendorName: string;
  poNumber: string;
  warehouseId: string;
  warehouseName: string;
  receivedDate: string;
  status: GrnStatus;
  lines: GrnLineItem[];
  totalValue: number;
  receivedBy: string;
  inspectedBy?: string;
  remarks?: string;
}

export type TransferStatus = "DRAFT" | "APPROVED" | "IN_TRANSIT" | "RECEIVED" | "DISCREPANCY";

export interface StockTransfer {
  id: string;
  transferNumber: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  status: TransferStatus;
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
  shippedAt?: string;
  receivedAt?: string;
  lines: TransferLine[];
  totalValue: number;
  eWayBillRequired: boolean;
  eWayBillNumber?: string;
  remarks?: string;
}

export interface TransferLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  requestedQty: number;
  shippedQty?: number;
  receivedQty?: number;
  unit: string;
  batchId?: string;
  batchNumber?: string;
}

export type AdjustmentStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export interface StockAdjustment {
  id: string;
  adjNumber: string;
  warehouseId: string;
  warehouseName: string;
  status: AdjustmentStatus;
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
  approvedAt?: string;
  reasonCode: string;
  remarks: string;
  lines: AdjustmentLine[];
  requiresApproval: boolean;
}

export interface AdjustmentLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  systemQty: number;
  physicalQty: number;
  varianceQty: number;
  unit: string;
  batchId?: string;
}

export interface ReorderAlert {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  availableQty: number;
  reorderPoint: number;
  safetyStock: number;
  reorderQty: number;
  severity: "CRITICAL" | "WARNING";
  isSuppressed: boolean;
  suppressedUntil?: string;
  indentCreated: boolean;
  indentNumber?: string;
  lastCheckedAt: string;
}

// ─── Data ────────────────────────────────────────────────────────────────────

export const warehouses: Warehouse[] = [
  {
    id: "wh1",
    code: "GUW-HQ",
    name: "Guwahati HQ",
    city: "Guwahati",
    gstin: "18AABCM1234A1Z5",
    isPrimary: true,
    zones: [
      { id: "z1", warehouseId: "wh1", name: "Raw Materials", code: "RM", allowedTxnTypes: ["IN", "OUT", "ADJUSTMENT", "TRANSFER_OUT", "TRANSFER_IN"] },
      { id: "z2", warehouseId: "wh1", name: "WIP", code: "WIP", allowedTxnTypes: ["IN", "OUT", "RESERVATION", "RESERVATION_RELEASE"] },
      { id: "z3", warehouseId: "wh1", name: "Finished Goods", code: "FG", allowedTxnTypes: ["IN", "OUT", "RESERVATION", "RESERVATION_RELEASE", "TRANSFER_OUT"] },
      { id: "z4", warehouseId: "wh1", name: "Quarantine", code: "QRN", allowedTxnTypes: ["IN", "OUT", "RETURN"] },
      { id: "z5", warehouseId: "wh1", name: "Rejection", code: "REJ", allowedTxnTypes: ["IN", "RETURN"] },
      { id: "z6", warehouseId: "wh1", name: "Returns", code: "RET", allowedTxnTypes: ["IN", "OUT", "RETURN"] },
    ],
  },
  {
    id: "wh2",
    code: "NOI-SEC",
    name: "Noida Secondary",
    city: "Noida",
    gstin: "09AABCM1234A1Z8",
    isPrimary: false,
    zones: [
      { id: "z7", warehouseId: "wh2", name: "Raw Materials", code: "RM", allowedTxnTypes: ["IN", "OUT", "ADJUSTMENT", "TRANSFER_OUT", "TRANSFER_IN"] },
      { id: "z8", warehouseId: "wh2", name: "Finished Goods", code: "FG", allowedTxnTypes: ["IN", "OUT", "RESERVATION", "RESERVATION_RELEASE"] },
      { id: "z9", warehouseId: "wh2", name: "Quarantine", code: "QRN", allowedTxnTypes: ["IN", "OUT", "RETURN"] },
      { id: "z10", warehouseId: "wh2", name: "Returns", code: "RET", allowedTxnTypes: ["IN", "OUT", "RETURN"] },
    ],
  },
];

export const invItems: InvItem[] = [
  {
    id: "itm1",
    itemCode: "MLB-ITM-0001",
    name: "Hematology Analyzer HA-500",
    category: "Finished Instruments",
    subCategory: "Hematology",
    trackingType: "SERIAL",
    unit: "PCS",
    standardCost: 185000,
    hsnCode: "90278090",
    abcClass: "A",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "5-part differential hematology analyzer for clinical diagnostics",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 5, reorderQty: 10, safetyStock: 2 },
      { warehouseId: "wh2", reorderPoint: 3, reorderQty: 5, safetyStock: 1 },
    ],
  },
  {
    id: "itm2",
    itemCode: "MLB-ITM-0002",
    name: "Biochemistry Analyzer BA-200",
    category: "Finished Instruments",
    subCategory: "Biochemistry",
    trackingType: "SERIAL",
    unit: "PCS",
    standardCost: 245000,
    hsnCode: "90278090",
    abcClass: "A",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "Semi-automatic biochemistry analyzer with 200 tests/hour throughput",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 3, reorderQty: 6, safetyStock: 1 },
      { warehouseId: "wh2", reorderPoint: 2, reorderQty: 4, safetyStock: 1 },
    ],
  },
  {
    id: "itm3",
    itemCode: "MLB-ITM-0003",
    name: "CBC Reagent Kit - 500 Tests",
    category: "Reagents",
    subCategory: "Hematology Reagents",
    trackingType: "BATCH",
    unit: "KIT",
    standardCost: 4200,
    hsnCode: "38220090",
    abcClass: "A",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "Complete blood count reagent kit with 500-test capacity, requires cold storage 2-8°C",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 50, reorderQty: 200, safetyStock: 20 },
      { warehouseId: "wh2", reorderPoint: 30, reorderQty: 100, safetyStock: 10 },
    ],
  },
  {
    id: "itm4",
    itemCode: "MLB-ITM-0004",
    name: "Liver Function Test Kit",
    category: "Reagents",
    subCategory: "Biochemistry Reagents",
    trackingType: "BATCH",
    unit: "KIT",
    standardCost: 2800,
    hsnCode: "38220090",
    abcClass: "B",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "LFT reagent kit with SGOT, SGPT, ALP, bilirubin panels",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 40, reorderQty: 150, safetyStock: 15 },
      { warehouseId: "wh2", reorderPoint: 20, reorderQty: 80, safetyStock: 8 },
    ],
  },
  {
    id: "itm5",
    itemCode: "MLB-ITM-0005",
    name: "PCB Assembly - HA500 Main Board",
    category: "Components",
    subCategory: "Electronic Components",
    trackingType: "BATCH",
    unit: "PCS",
    standardCost: 8500,
    hsnCode: "85340019",
    abcClass: "A",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "Main controller PCB for HA-500 hematology analyzer",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 20, reorderQty: 50, safetyStock: 8 },
    ],
  },
  {
    id: "itm6",
    itemCode: "MLB-ITM-0006",
    name: "Flow Cell Sensor - Precision Grade",
    category: "Components",
    subCategory: "Optical Components",
    trackingType: "BATCH",
    unit: "PCS",
    standardCost: 12000,
    hsnCode: "90132000",
    abcClass: "A",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "High-precision optical flow cell sensor for cell counting",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 15, reorderQty: 40, safetyStock: 5 },
    ],
  },
  {
    id: "itm7",
    itemCode: "MLB-ITM-0007",
    name: "Packaging Carton - HA500",
    category: "Packaging",
    subCategory: "Corrugated Boxes",
    trackingType: "NONE",
    unit: "PCS",
    standardCost: 350,
    hsnCode: "48192000",
    abcClass: "C",
    status: "active",
    isSlowMoving: true,
    isDeadStock: false,
    description: "Export-grade packaging carton for HA-500 analyzer",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 100, reorderQty: 500, safetyStock: 50 },
    ],
  },
  {
    id: "itm8",
    itemCode: "MLB-ITM-0008",
    name: "Cleaning Solution 1L",
    category: "Consumables",
    subCategory: "Cleaning Agents",
    trackingType: "BATCH",
    unit: "BTL",
    standardCost: 450,
    hsnCode: "34021900",
    abcClass: "C",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "Instrument cleaning and decontamination solution",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 200, reorderQty: 500, safetyStock: 80 },
      { warehouseId: "wh2", reorderPoint: 100, reorderQty: 200, safetyStock: 40 },
    ],
  },
  {
    id: "itm9",
    itemCode: "MLB-ITM-0009",
    name: "Mechanical Frame - BA200",
    category: "Components",
    subCategory: "Mechanical Components",
    trackingType: "BATCH",
    unit: "PCS",
    standardCost: 6200,
    hsnCode: "84798900",
    abcClass: "B",
    status: "active",
    isSlowMoving: false,
    isDeadStock: false,
    description: "Precision CNC-machined mechanical frame for BA-200 analyzer",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 10, reorderQty: 30, safetyStock: 4 },
    ],
  },
  {
    id: "itm10",
    itemCode: "MLB-ITM-0010",
    name: "User Manual - English",
    category: "Documentation",
    subCategory: "Manuals",
    trackingType: "NONE",
    unit: "PCS",
    standardCost: 80,
    hsnCode: "49019900",
    abcClass: "C",
    status: "active",
    isSlowMoving: true,
    isDeadStock: false,
    description: "Printed user manual in English for all analyzers",
    reorderPoints: [
      { warehouseId: "wh1", reorderPoint: 500, reorderQty: 1000, safetyStock: 200 },
    ],
  },
];

export const stockSummaries: StockSummary[] = [
  { itemId: "itm1", warehouseId: "wh1", totalQty: 12, reservedQty: 3, availableQty: 9 },
  { itemId: "itm1", warehouseId: "wh2", totalQty: 4, reservedQty: 1, availableQty: 3 },
  { itemId: "itm2", warehouseId: "wh1", totalQty: 7, reservedQty: 2, availableQty: 5 },
  { itemId: "itm2", warehouseId: "wh2", totalQty: 3, reservedQty: 0, availableQty: 3 },
  { itemId: "itm3", warehouseId: "wh1", totalQty: 180, reservedQty: 40, availableQty: 140 },
  { itemId: "itm3", warehouseId: "wh2", totalQty: 45, reservedQty: 15, availableQty: 30 },
  { itemId: "itm4", warehouseId: "wh1", totalQty: 95, reservedQty: 30, availableQty: 65 },
  { itemId: "itm4", warehouseId: "wh2", totalQty: 18, reservedQty: 5, availableQty: 13 },
  { itemId: "itm5", warehouseId: "wh1", totalQty: 35, reservedQty: 10, availableQty: 25 },
  { itemId: "itm6", warehouseId: "wh1", totalQty: 18, reservedQty: 5, availableQty: 13 },
  { itemId: "itm7", warehouseId: "wh1", totalQty: 320, reservedQty: 0, availableQty: 320 },
  { itemId: "itm8", warehouseId: "wh1", totalQty: 380, reservedQty: 80, availableQty: 300 },
  { itemId: "itm8", warehouseId: "wh2", totalQty: 95, reservedQty: 20, availableQty: 75 },
  { itemId: "itm9", warehouseId: "wh1", totalQty: 8, reservedQty: 3, availableQty: 5 },
  { itemId: "itm10", warehouseId: "wh1", totalQty: 1200, reservedQty: 0, availableQty: 1200 },
];

export const invBatches: InvBatch[] = [
  {
    id: "bat1",
    batchNumber: "MLB-BAT-2026-001",
    itemId: "itm3",
    warehouseId: "wh1",
    zoneId: "z1",
    vendorLotNumber: "SYSMEX-LOT-A2609",
    vendorId: "vnd3",
    vendorName: "Sysmex India Pvt Ltd",
    grnId: "grn1",
    mfgDate: "2025-10-15",
    expiryDate: "2026-10-14",
    receivedQty: 100,
    currentQty: 60,
    consumedQty: 40,
    status: "PARTIALLY_CONSUMED",
    qcInspectionId: "qc001",
    qcStatus: "PASSED",
    catalogueNumber: "SYS-CBC-500",
    storageTemp: "2-8°C",
  },
  {
    id: "bat2",
    batchNumber: "MLB-BAT-2026-002",
    itemId: "itm3",
    warehouseId: "wh1",
    zoneId: "z1",
    vendorLotNumber: "SYSMEX-LOT-B0126",
    vendorId: "vnd3",
    vendorName: "Sysmex India Pvt Ltd",
    grnId: "grn2",
    mfgDate: "2025-12-01",
    expiryDate: "2026-12-31",
    receivedQty: 80,
    currentQty: 80,
    consumedQty: 0,
    status: "ACTIVE",
    qcInspectionId: "qc002",
    qcStatus: "PASSED",
    catalogueNumber: "SYS-CBC-500",
    storageTemp: "2-8°C",
  },
  {
    id: "bat3",
    batchNumber: "MLB-BAT-2026-003",
    itemId: "itm4",
    warehouseId: "wh1",
    zoneId: "z1",
    vendorLotNumber: "BIOLABS-LFT-0226",
    vendorId: "vnd4",
    vendorName: "Biolabs Sciences",
    grnId: "grn2",
    mfgDate: "2025-11-20",
    expiryDate: "2026-05-19",
    receivedQty: 60,
    currentQty: 35,
    consumedQty: 25,
    status: "PARTIALLY_CONSUMED",
    qcInspectionId: "qc003",
    qcStatus: "PASSED",
    catalogueNumber: "BL-LFT-250",
    storageTemp: "2-8°C",
  },
  {
    id: "bat4",
    batchNumber: "MLB-BAT-2026-004",
    itemId: "itm4",
    warehouseId: "wh1",
    zoneId: "z4",
    vendorLotNumber: "BIOLABS-LFT-0126",
    vendorId: "vnd4",
    vendorName: "Biolabs Sciences",
    grnId: "grn1",
    mfgDate: "2025-09-10",
    expiryDate: "2026-03-09",
    receivedQty: 40,
    currentQty: 40,
    consumedQty: 0,
    status: "QUARANTINED",
    qcInspectionId: "qc004",
    qcStatus: "FAILED",
    catalogueNumber: "BL-LFT-250",
    storageTemp: "2-8°C",
  },
  {
    id: "bat5",
    batchNumber: "MLB-BAT-2025-018",
    itemId: "itm3",
    warehouseId: "wh2",
    zoneId: "z7",
    vendorLotNumber: "SYSMEX-LOT-A0925",
    vendorId: "vnd3",
    vendorName: "Sysmex India Pvt Ltd",
    grnId: "grn3",
    mfgDate: "2025-06-01",
    expiryDate: "2026-06-30",
    receivedQty: 50,
    currentQty: 45,
    consumedQty: 5,
    status: "ACTIVE",
    qcInspectionId: "qc005",
    qcStatus: "PASSED",
    catalogueNumber: "SYS-CBC-500",
    storageTemp: "2-8°C",
  },
  {
    id: "bat6",
    batchNumber: "MLB-BAT-2026-005",
    itemId: "itm5",
    warehouseId: "wh1",
    zoneId: "z1",
    vendorLotNumber: "PCBTECH-HA5-0326",
    vendorId: "vnd5",
    vendorName: "PCB Technologies India",
    grnId: "grn3",
    mfgDate: "2026-01-15",
    expiryDate: "2028-01-14",
    receivedQty: 30,
    currentQty: 25,
    consumedQty: 5,
    status: "PARTIALLY_CONSUMED",
    qcInspectionId: "qc006",
    qcStatus: "PASSED",
  },
  {
    id: "bat7",
    batchNumber: "MLB-BAT-2025-025",
    itemId: "itm8",
    warehouseId: "wh1",
    zoneId: "z1",
    vendorLotNumber: "CLEAN-CS-1124",
    vendorId: "vnd6",
    vendorName: "ChemSafe Solutions",
    grnId: "grn1",
    mfgDate: "2025-08-01",
    expiryDate: "2026-07-31",
    receivedQty: 200,
    currentQty: 180,
    consumedQty: 20,
    status: "ACTIVE",
    qcInspectionId: "qc007",
    qcStatus: "PASSED",
    storageTemp: "Room temperature",
  },
  {
    id: "bat8",
    batchNumber: "MLB-BAT-2025-030",
    itemId: "itm4",
    warehouseId: "wh2",
    zoneId: "z7",
    vendorLotNumber: "BIOLABS-LFT-0925",
    vendorId: "vnd4",
    vendorName: "Biolabs Sciences",
    grnId: "grn4",
    mfgDate: "2025-07-01",
    expiryDate: "2026-05-05",
    receivedQty: 35,
    currentQty: 18,
    consumedQty: 17,
    status: "PARTIALLY_CONSUMED",
    qcInspectionId: "qc008",
    qcStatus: "PASSED",
    catalogueNumber: "BL-LFT-250",
    storageTemp: "2-8°C",
  },
];

export const invSerials: InvSerial[] = [
  {
    id: "srl1",
    serialNumber: "MBA-2025-0381",
    itemId: "itm1",
    warehouseId: "wh1",
    workOrderId: "WO-2026-001",
    status: "FINISHED",
    pcbId: "bat6",
    mechId: "MLB-MECH-HA5-0091",
    sensorId: "MLB-SEN-FC-0045",
    qcCertUrl: "/certs/MBA-2025-0381.pdf",
    manufacturedDate: "2026-01-20",
  },
  {
    id: "srl2",
    serialNumber: "MBA-2025-0382",
    itemId: "itm1",
    warehouseId: "wh1",
    workOrderId: "WO-2026-001",
    status: "RESERVED",
    pcbId: "bat6",
    mechId: "MLB-MECH-HA5-0092",
    sensorId: "MLB-SEN-FC-0046",
    qcCertUrl: "/certs/MBA-2025-0382.pdf",
    manufacturedDate: "2026-01-21",
  },
  {
    id: "srl3",
    serialNumber: "MBA-2025-0383",
    itemId: "itm1",
    warehouseId: "wh1",
    workOrderId: "WO-2026-002",
    status: "DISPATCHED",
    pcbId: "bat6",
    mechId: "MLB-MECH-HA5-0093",
    sensorId: "MLB-SEN-FC-0047",
    qcCertUrl: "/certs/MBA-2025-0383.pdf",
    accountId: "acc1",
    accountName: "Apollo Diagnostics",
    deliveryChallanId: "DC-2026-041",
    manufacturedDate: "2026-01-22",
    dispatchedDate: "2026-02-10",
  },
  {
    id: "srl4",
    serialNumber: "MBA-2025-0384",
    itemId: "itm1",
    warehouseId: "wh1",
    workOrderId: "WO-2026-002",
    status: "QC_HOLD",
    pcbId: "bat6",
    mechId: "MLB-MECH-HA5-0094",
    sensorId: "MLB-SEN-FC-0048",
    manufacturedDate: "2026-01-25",
  },
  {
    id: "srl5",
    serialNumber: "MBA-2025-0385",
    itemId: "itm1",
    warehouseId: "wh2",
    workOrderId: "WO-2026-003",
    status: "FINISHED",
    pcbId: "bat6",
    mechId: "MLB-MECH-HA5-0095",
    sensorId: "MLB-SEN-FC-0049",
    qcCertUrl: "/certs/MBA-2025-0385.pdf",
    manufacturedDate: "2026-02-01",
  },
  {
    id: "srl6",
    serialNumber: "MBA-2025-0301",
    itemId: "itm1",
    warehouseId: "wh2",
    workOrderId: "WO-2025-088",
    status: "RETURNED",
    accountId: "acc3",
    accountName: "Medipoint Labs",
    returnedDate: "2026-01-15",
    qcCertUrl: "/certs/MBA-2025-0301.pdf",
    manufacturedDate: "2025-08-10",
  },
  {
    id: "srl7",
    serialNumber: "MBA-2026-0001",
    itemId: "itm2",
    warehouseId: "wh1",
    workOrderId: "WO-2026-004",
    status: "IN_PRODUCTION",
    manufacturedDate: "2026-03-01",
  },
  {
    id: "srl8",
    serialNumber: "MBA-2026-0002",
    itemId: "itm2",
    warehouseId: "wh1",
    workOrderId: "WO-2026-004",
    status: "IN_PRODUCTION",
    manufacturedDate: "2026-03-02",
  },
  {
    id: "srl9",
    serialNumber: "MBA-2025-0210",
    itemId: "itm2",
    warehouseId: "wh1",
    workOrderId: "WO-2025-071",
    status: "DISPATCHED",
    accountId: "acc2",
    accountName: "MedTech India",
    deliveryChallanId: "DC-2025-118",
    qcCertUrl: "/certs/MBA-2025-0210.pdf",
    manufacturedDate: "2025-09-15",
    dispatchedDate: "2025-11-20",
  },
  {
    id: "srl10",
    serialNumber: "MBA-2025-0211",
    itemId: "itm2",
    warehouseId: "wh2",
    workOrderId: "WO-2025-072",
    status: "FINISHED",
    qcCertUrl: "/certs/MBA-2025-0211.pdf",
    manufacturedDate: "2025-09-16",
  },
];

export const grns: Grn[] = [
  {
    id: "grn1",
    grnNumber: "MLB-GRN-2026-001",
    vendorId: "vnd3",
    vendorName: "Sysmex India Pvt Ltd",
    poNumber: "MLB-PO-2025-042",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    receivedDate: "2026-01-10",
    status: "QC_DONE",
    lines: [
      {
        id: "grnl1",
        itemId: "itm3",
        itemName: "CBC Reagent Kit - 500 Tests",
        itemCode: "MLB-ITM-0003",
        orderedQty: 100,
        receivedQty: 100,
        acceptedQty: 100,
        rejectedQty: 0,
        unit: "KIT",
        batchId: "bat1",
        batchNumber: "MLB-BAT-2026-001",
        expiryDate: "2026-10-14",
        unitCost: 4200,
        totalCost: 420000,
      },
      {
        id: "grnl2",
        itemId: "itm8",
        itemName: "Cleaning Solution 1L",
        itemCode: "MLB-ITM-0008",
        orderedQty: 200,
        receivedQty: 200,
        acceptedQty: 200,
        rejectedQty: 0,
        unit: "BTL",
        batchId: "bat7",
        batchNumber: "MLB-BAT-2025-025",
        expiryDate: "2026-07-31",
        unitCost: 450,
        totalCost: 90000,
      },
    ],
    totalValue: 510000,
    receivedBy: "Ranjit Bora",
    inspectedBy: "Priya Sharma",
    remarks: "All items received in good condition",
  },
  {
    id: "grn2",
    grnNumber: "MLB-GRN-2026-002",
    vendorId: "vnd4",
    vendorName: "Biolabs Sciences",
    poNumber: "MLB-PO-2026-003",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    receivedDate: "2026-02-05",
    status: "PARTIALLY_QC",
    lines: [
      {
        id: "grnl3",
        itemId: "itm4",
        itemName: "Liver Function Test Kit",
        itemCode: "MLB-ITM-0004",
        orderedQty: 100,
        receivedQty: 100,
        acceptedQty: 60,
        rejectedQty: 40,
        unit: "KIT",
        batchId: "bat3",
        batchNumber: "MLB-BAT-2026-003",
        expiryDate: "2026-05-19",
        unitCost: 2800,
        totalCost: 168000,
      },
      {
        id: "grnl4",
        itemId: "itm3",
        itemName: "CBC Reagent Kit - 500 Tests",
        itemCode: "MLB-ITM-0003",
        orderedQty: 80,
        receivedQty: 80,
        acceptedQty: 80,
        rejectedQty: 0,
        unit: "KIT",
        batchId: "bat2",
        batchNumber: "MLB-BAT-2026-002",
        expiryDate: "2026-12-31",
        unitCost: 4200,
        totalCost: 336000,
      },
    ],
    totalValue: 504000,
    receivedBy: "Ranjit Bora",
    remarks: "40 LFT kits failed QC - sent to quarantine",
  },
  {
    id: "grn3",
    grnNumber: "MLB-GRN-2026-003",
    vendorId: "vnd5",
    vendorName: "PCB Technologies India",
    poNumber: "MLB-PO-2026-007",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    receivedDate: "2026-03-01",
    status: "QC_DONE",
    lines: [
      {
        id: "grnl5",
        itemId: "itm5",
        itemName: "PCB Assembly - HA500 Main Board",
        itemCode: "MLB-ITM-0005",
        orderedQty: 30,
        receivedQty: 30,
        acceptedQty: 30,
        rejectedQty: 0,
        unit: "PCS",
        batchId: "bat6",
        batchNumber: "MLB-BAT-2026-005",
        unitCost: 8500,
        totalCost: 255000,
      },
    ],
    totalValue: 255000,
    receivedBy: "Ranjit Bora",
    inspectedBy: "Amit Kumar",
    remarks: "PCBs received and QC passed",
  },
  {
    id: "grn4",
    grnNumber: "MLB-GRN-2026-004",
    vendorId: "vnd4",
    vendorName: "Biolabs Sciences",
    poNumber: "MLB-PO-2026-009",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    receivedDate: "2026-03-15",
    status: "CONFIRMED",
    lines: [
      {
        id: "grnl6",
        itemId: "itm4",
        itemName: "Liver Function Test Kit",
        itemCode: "MLB-ITM-0004",
        orderedQty: 35,
        receivedQty: 35,
        acceptedQty: 35,
        rejectedQty: 0,
        unit: "KIT",
        batchId: "bat8",
        batchNumber: "MLB-BAT-2025-030",
        expiryDate: "2026-05-05",
        unitCost: 2800,
        totalCost: 98000,
      },
    ],
    totalValue: 98000,
    receivedBy: "Suresh Gupta",
    remarks: "Awaiting QC inspection",
  },
];

export const stockLedger: StockLedgerEntry[] = [
  { id: "sl1", itemId: "itm3", warehouseId: "wh1", zoneId: "z1", txnType: "IN", qty: 100, balanceQty: 100, refDocType: "GRN", refDocId: "grn1", batchId: "bat1", createdBy: "Ranjit Bora", txnAt: "2026-01-10T09:30:00", status: "CONFIRMED" },
  { id: "sl2", itemId: "itm8", warehouseId: "wh1", zoneId: "z1", txnType: "IN", qty: 200, balanceQty: 200, refDocType: "GRN", refDocId: "grn1", batchId: "bat7", createdBy: "Ranjit Bora", txnAt: "2026-01-10T09:35:00", status: "CONFIRMED" },
  { id: "sl3", itemId: "itm3", warehouseId: "wh1", zoneId: "z1", txnType: "RESERVATION", qty: -40, balanceQty: 60, refDocType: "WORK_ORDER", refDocId: "WO-2026-001", batchId: "bat1", createdBy: "System", txnAt: "2026-01-15T10:00:00", status: "CONFIRMED" },
  { id: "sl4", itemId: "itm3", warehouseId: "wh1", zoneId: "z1", txnType: "OUT", qty: -40, balanceQty: 20, refDocType: "WORK_ORDER", refDocId: "WO-2026-001", batchId: "bat1", createdBy: "System", txnAt: "2026-01-20T14:00:00", status: "CONFIRMED" },
  { id: "sl5", itemId: "itm4", warehouseId: "wh1", zoneId: "z4", txnType: "IN", qty: 40, balanceQty: 40, refDocType: "GRN", refDocId: "grn2", batchId: "bat4", createdBy: "Ranjit Bora", txnAt: "2026-02-05T11:00:00", status: "CONFIRMED", remarks: "QC Failed - Quarantined" },
  { id: "sl6", itemId: "itm4", warehouseId: "wh1", zoneId: "z1", txnType: "IN", qty: 60, balanceQty: 100, refDocType: "GRN", refDocId: "grn2", batchId: "bat3", createdBy: "Ranjit Bora", txnAt: "2026-02-05T11:05:00", status: "CONFIRMED" },
  { id: "sl7", itemId: "itm3", warehouseId: "wh1", zoneId: "z1", txnType: "IN", qty: 80, balanceQty: 100, refDocType: "GRN", refDocId: "grn2", batchId: "bat2", createdBy: "Ranjit Bora", txnAt: "2026-02-05T11:10:00", status: "CONFIRMED" },
  { id: "sl8", itemId: "itm5", warehouseId: "wh1", zoneId: "z1", txnType: "IN", qty: 30, balanceQty: 30, refDocType: "GRN", refDocId: "grn3", batchId: "bat6", createdBy: "Ranjit Bora", txnAt: "2026-03-01T09:00:00", status: "CONFIRMED" },
  { id: "sl9", itemId: "itm5", warehouseId: "wh1", zoneId: "z2", txnType: "OUT", qty: -5, balanceQty: 25, refDocType: "WORK_ORDER", refDocId: "WO-2026-003", batchId: "bat6", createdBy: "System", txnAt: "2026-03-05T10:00:00", status: "CONFIRMED" },
  { id: "sl10", itemId: "itm4", warehouseId: "wh1", zoneId: "z1", txnType: "OUT", qty: -25, balanceQty: 75, refDocType: "WORK_ORDER", refDocId: "WO-2026-002", batchId: "bat3", createdBy: "System", txnAt: "2026-03-10T12:00:00", status: "CONFIRMED" },
  { id: "sl11", itemId: "itm3", warehouseId: "wh1", zoneId: "z3", txnType: "TRANSFER_OUT", qty: -20, balanceQty: 80, refDocType: "TRANSFER", refDocId: "trf1", batchId: "bat2", createdBy: "Ranjit Bora", txnAt: "2026-03-20T09:00:00", status: "CONFIRMED" },
  { id: "sl12", itemId: "itm3", warehouseId: "wh2", zoneId: "z7", txnType: "TRANSFER_IN", qty: 20, balanceQty: 65, refDocType: "TRANSFER", refDocId: "trf1", batchId: "bat2", createdBy: "Suresh Gupta", txnAt: "2026-03-21T11:00:00", status: "CONFIRMED" },
  { id: "sl13", itemId: "itm8", warehouseId: "wh1", zoneId: "z1", txnType: "ADJUSTMENT", qty: -20, balanceQty: 180, refDocType: "ADJUSTMENT", refDocId: "adj1", batchId: "bat7", createdBy: "Ranjit Bora", txnAt: "2026-04-01T10:00:00", status: "CONFIRMED", reasonCode: "BREAKAGE", remarks: "20 bottles found broken during cycle count" },
  { id: "sl14", itemId: "itm4", warehouseId: "wh2", zoneId: "z7", txnType: "IN", qty: 35, balanceQty: 35, refDocType: "GRN", refDocId: "grn4", batchId: "bat8", createdBy: "Suresh Gupta", txnAt: "2026-03-15T14:00:00", status: "CONFIRMED" },
  { id: "sl15", itemId: "itm4", warehouseId: "wh2", zoneId: "z7", txnType: "OUT", qty: -17, balanceQty: 18, refDocType: "DELIVERY_CHALLAN", refDocId: "DC-2026-058", batchId: "bat8", createdBy: "Suresh Gupta", txnAt: "2026-04-02T15:00:00", status: "CONFIRMED" },
];

export const stockTransfers: StockTransfer[] = [
  {
    id: "trf1",
    transferNumber: "MLB-TRF-2026-001",
    fromWarehouseId: "wh1",
    fromWarehouseName: "Guwahati HQ",
    toWarehouseId: "wh2",
    toWarehouseName: "Noida Secondary",
    status: "RECEIVED",
    requestedBy: "Ranjit Bora",
    approvedBy: "Vikram Nair",
    createdAt: "2026-03-18",
    shippedAt: "2026-03-20",
    receivedAt: "2026-03-21",
    lines: [
      { id: "trfl1", itemId: "itm3", itemName: "CBC Reagent Kit - 500 Tests", itemCode: "MLB-ITM-0003", requestedQty: 20, shippedQty: 20, receivedQty: 20, unit: "KIT", batchId: "bat2", batchNumber: "MLB-BAT-2026-002" },
    ],
    totalValue: 84000,
    eWayBillRequired: true,
    eWayBillNumber: "EWB-2026-193847",
    remarks: "Monthly reagent replenishment to Noida",
  },
  {
    id: "trf2",
    transferNumber: "MLB-TRF-2026-002",
    fromWarehouseId: "wh1",
    fromWarehouseName: "Guwahati HQ",
    toWarehouseId: "wh2",
    toWarehouseName: "Noida Secondary",
    status: "IN_TRANSIT",
    requestedBy: "Ranjit Bora",
    approvedBy: "Vikram Nair",
    createdAt: "2026-04-05",
    shippedAt: "2026-04-08",
    lines: [
      { id: "trfl2", itemId: "itm1", itemName: "Hematology Analyzer HA-500", itemCode: "MLB-ITM-0001", requestedQty: 2, shippedQty: 2, unit: "PCS" },
      { id: "trfl3", itemId: "itm3", itemName: "CBC Reagent Kit - 500 Tests", itemCode: "MLB-ITM-0003", requestedQty: 30, shippedQty: 30, unit: "KIT", batchId: "bat2", batchNumber: "MLB-BAT-2026-002" },
    ],
    totalValue: 496000,
    eWayBillRequired: true,
    eWayBillNumber: "EWB-2026-204891",
  },
  {
    id: "trf3",
    transferNumber: "MLB-TRF-2026-003",
    fromWarehouseId: "wh2",
    fromWarehouseName: "Noida Secondary",
    toWarehouseId: "wh1",
    toWarehouseName: "Guwahati HQ",
    status: "DRAFT",
    requestedBy: "Suresh Gupta",
    createdAt: "2026-04-14",
    lines: [
      { id: "trfl4", itemId: "itm4", itemName: "Liver Function Test Kit", itemCode: "MLB-ITM-0004", requestedQty: 10, unit: "KIT" },
    ],
    totalValue: 28000,
    eWayBillRequired: false,
    remarks: "Return excess LFT kits before expiry",
  },
];

export const stockAdjustments: StockAdjustment[] = [
  {
    id: "adj1",
    adjNumber: "MLB-ADJ-2026-001",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    status: "APPROVED",
    requestedBy: "Ranjit Bora",
    approvedBy: "Vikram Nair",
    createdAt: "2026-04-01",
    approvedAt: "2026-04-01",
    reasonCode: "BREAKAGE",
    remarks: "20 bottles of cleaning solution found broken during routine inspection",
    requiresApproval: true,
    lines: [
      { id: "adjl1", itemId: "itm8", itemName: "Cleaning Solution 1L", itemCode: "MLB-ITM-0008", systemQty: 200, physicalQty: 180, varianceQty: -20, unit: "BTL", batchId: "bat7" },
    ],
  },
  {
    id: "adj2",
    adjNumber: "MLB-ADJ-2026-002",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    status: "PENDING_APPROVAL",
    requestedBy: "Ranjit Bora",
    createdAt: "2026-04-12",
    reasonCode: "CYCLE_COUNT",
    remarks: "Quarterly cycle count variance — 3 CBC kits missing from shelf B-4",
    requiresApproval: true,
    lines: [
      { id: "adjl2", itemId: "itm3", itemName: "CBC Reagent Kit - 500 Tests", itemCode: "MLB-ITM-0003", systemQty: 183, physicalQty: 180, varianceQty: -3, unit: "KIT", batchId: "bat2" },
    ],
  },
  {
    id: "adj3",
    adjNumber: "MLB-ADJ-2026-003",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    status: "APPROVED",
    requestedBy: "Suresh Gupta",
    approvedBy: "Vikram Nair",
    createdAt: "2026-03-28",
    approvedAt: "2026-03-29",
    reasonCode: "SYSTEM_ERROR",
    remarks: "Correction of data entry error from GRN grn4 — 2 kits over-counted",
    requiresApproval: false,
    lines: [
      { id: "adjl3", itemId: "itm4", itemName: "Liver Function Test Kit", itemCode: "MLB-ITM-0004", systemQty: 37, physicalQty: 35, varianceQty: -2, unit: "KIT", batchId: "bat8" },
    ],
  },
];

export const reorderAlerts: ReorderAlert[] = [
  {
    id: "ror1",
    itemId: "itm6",
    itemCode: "MLB-ITM-0006",
    itemName: "Flow Cell Sensor - Precision Grade",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    availableQty: 13,
    reorderPoint: 15,
    safetyStock: 5,
    reorderQty: 40,
    severity: "WARNING",
    isSuppressed: false,
    indentCreated: true,
    indentNumber: "MLB-INDENT-2026-018",
    lastCheckedAt: "2026-04-16T06:00:00",
  },
  {
    id: "ror2",
    itemId: "itm9",
    itemCode: "MLB-ITM-0009",
    itemName: "Mechanical Frame - BA200",
    warehouseId: "wh1",
    warehouseName: "Guwahati HQ",
    availableQty: 5,
    reorderPoint: 10,
    safetyStock: 4,
    reorderQty: 30,
    severity: "CRITICAL",
    isSuppressed: false,
    indentCreated: false,
    lastCheckedAt: "2026-04-16T06:00:00",
  },
  {
    id: "ror3",
    itemId: "itm3",
    itemCode: "MLB-ITM-0003",
    itemName: "CBC Reagent Kit - 500 Tests",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    availableQty: 30,
    reorderPoint: 30,
    safetyStock: 10,
    reorderQty: 100,
    severity: "CRITICAL",
    isSuppressed: false,
    indentCreated: true,
    indentNumber: "MLB-INDENT-2026-020",
    lastCheckedAt: "2026-04-16T06:00:00",
  },
  {
    id: "ror4",
    itemId: "itm4",
    itemCode: "MLB-ITM-0004",
    itemName: "Liver Function Test Kit",
    warehouseId: "wh2",
    warehouseName: "Noida Secondary",
    availableQty: 13,
    reorderPoint: 20,
    safetyStock: 8,
    reorderQty: 80,
    severity: "CRITICAL",
    isSuppressed: true,
    suppressedUntil: "2026-04-30",
    indentCreated: true,
    indentNumber: "MLB-INDENT-2026-015",
    lastCheckedAt: "2026-04-16T06:00:00",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getInvItemById(id: string): InvItem | undefined {
  return invItems.find((i) => i.id === id);
}

export function getWarehouseById(id: string): Warehouse | undefined {
  return warehouses.find((w) => w.id === id);
}

export function getStockSummaryForItem(itemId: string): StockSummary[] {
  return stockSummaries.filter((s) => s.itemId === itemId);
}

export function getTotalStockForItem(itemId: string): { total: number; reserved: number; available: number } {
  const summaries = getStockSummaryForItem(itemId);
  return summaries.reduce(
    (acc, s) => ({
      total: acc.total + s.totalQty,
      reserved: acc.reserved + s.reservedQty,
      available: acc.available + s.availableQty,
    }),
    { total: 0, reserved: 0, available: 0 }
  );
}

export function getBatchesForItem(itemId: string): InvBatch[] {
  return invBatches.filter((b) => b.itemId === itemId);
}

export function getSerialsForItem(itemId: string): InvSerial[] {
  return invSerials.filter((s) => s.itemId === itemId);
}

export function getLedgerForItem(itemId: string, warehouseId?: string): StockLedgerEntry[] {
  return stockLedger.filter(
    (e) => e.itemId === itemId && (!warehouseId || e.warehouseId === warehouseId)
  ).sort((a, b) => new Date(b.txnAt).getTime() - new Date(a.txnAt).getTime());
}

export function getExpiringBatches(daysThreshold: number): InvBatch[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysThreshold);
  return invBatches.filter((b) => {
    if (b.status === "FULLY_CONSUMED" || b.status === "RETURNED_TO_VENDOR") return false;
    const expiry = new Date(b.expiryDate);
    return expiry <= cutoff;
  });
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

export function getDaysToExpiry(expiryDate: string): number {
  const today = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function getExpiryUrgency(expiryDate: string): "expired" | "urgent" | "warning" | "ok" {
  const days = getDaysToExpiry(expiryDate);
  if (days <= 0) return "expired";
  if (days <= 30) return "urgent";
  if (days <= 90) return "warning";
  return "ok";
}
