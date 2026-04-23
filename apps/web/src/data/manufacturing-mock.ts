// ─── Manufacturing & Production Module Mock Data ─────────────────────────────
// Company: Instigenie Instruments — Analyzers, CBL Devices, Reagents

export type ProductFamily = "INSTIGENIE_INSTRUMENT" | "CBL_DEVICE" | "REAGENT";
export type BOMStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED" | "OBSOLETE";
export type WOStatus =
  | "PLANNED" | "MATERIAL_CHECK" | "IN_PROGRESS"
  | "QC_HOLD" | "REWORK" | "COMPLETED" | "CANCELLED";
export type WIPStageStatus = "PENDING" | "IN_PROGRESS" | "QC_HOLD" | "REWORK" | "COMPLETED";
export type ECNStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "IMPLEMENTED";
export type WOPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

// ─── Products ─────────────────────────────────────────────────────────────────

export interface MfgProduct {
  id: string;
  productCode: string;
  name: string;
  family: ProductFamily;
  hasSerialTracking: boolean;
  activeBomVersion: string;
  standardCycleDays: number;
}

export const mfgProducts: MfgProduct[] = [
  { id: "mp1", productCode: "MBA-HA500", name: "Hematology Analyzer HA-500", family: "INSTIGENIE_INSTRUMENT", hasSerialTracking: true, activeBomVersion: "v3", standardCycleDays: 8 },
  { id: "mp2", productCode: "MBA-BA200", name: "Biochemistry Analyzer BA-200", family: "INSTIGENIE_INSTRUMENT", hasSerialTracking: true, activeBomVersion: "v2", standardCycleDays: 8 },
  { id: "mp3", productCode: "MBM-MX100", name: "Vortex Mixer MX-100", family: "INSTIGENIE_INSTRUMENT", hasSerialTracking: true, activeBomVersion: "v1", standardCycleDays: 5 },
  { id: "mp4", productCode: "CBL-GS300", name: "CBL Glucometer Strip GS-300", family: "CBL_DEVICE", hasSerialTracking: true, activeBomVersion: "v2", standardCycleDays: 6 },
  { id: "mp5", productCode: "RGT-CBC500", name: "CBC Reagent Lot 500T", family: "REAGENT", hasSerialTracking: false, activeBomVersion: "v1", standardCycleDays: 4 },
  { id: "mp6", productCode: "RGT-LFT250", name: "LFT Reagent Lot 250T", family: "REAGENT", hasSerialTracking: false, activeBomVersion: "v1", standardCycleDays: 3 },
];

// ─── BOM ─────────────────────────────────────────────────────────────────────

export interface BOMLine {
  id: string;
  componentItemId: string;
  componentCode: string;
  componentName: string;
  qtyPerUnit: number;
  uom: string;
  referenceDesignator?: string;
  isCritical: boolean;
  trackingType: "SERIAL" | "BATCH" | "NONE";
  leadTimeDays: number;
}

export interface BOM {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  version: string;
  status: BOMStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  lines: BOMLine[];
  createdBy: string;
  approvedBy?: string;
  totalStdCost: number;
  notes?: string;
  ecnRef?: string;
}

export const boms: BOM[] = [
  {
    id: "bom1",
    productId: "mp1",
    productName: "Hematology Analyzer HA-500",
    productCode: "MBA-HA500",
    version: "v3",
    status: "ACTIVE",
    effectiveFrom: "2026-01-01",
    lines: [
      { id: "bl1", componentItemId: "itm5", componentCode: "MLB-ITM-0005", componentName: "PCB Assembly - HA500 Main Board", qtyPerUnit: 1, uom: "PCS", referenceDesignator: "PCB-MAIN-01", isCritical: true, trackingType: "BATCH", leadTimeDays: 30 },
      { id: "bl2", componentItemId: "itm6", componentCode: "MLB-ITM-0006", componentName: "Flow Cell Sensor - Precision Grade", qtyPerUnit: 1, uom: "PCS", referenceDesignator: "SENS-FC-01", isCritical: true, trackingType: "BATCH", leadTimeDays: 18 },
      { id: "bl3", componentItemId: "itm9", componentCode: "MLB-ITM-0009", componentName: "Mechanical Frame - BA200", qtyPerUnit: 1, uom: "PCS", referenceDesignator: "MECH-FR-01", isCritical: false, trackingType: "BATCH", leadTimeDays: 10 },
      { id: "bl4", componentItemId: "itm3", componentCode: "MLB-ITM-0003", componentName: "CBC Reagent Kit - 500 Tests", qtyPerUnit: 1, uom: "KIT", isCritical: false, trackingType: "BATCH", leadTimeDays: 21 },
      { id: "bl5", componentItemId: "itm7", componentCode: "MLB-ITM-0007", componentName: "Packaging Carton - HA500", qtyPerUnit: 1, uom: "PCS", isCritical: false, trackingType: "NONE", leadTimeDays: 7 },
      { id: "bl6", componentItemId: "itm10", componentCode: "MLB-ITM-0010", componentName: "User Manual - English", qtyPerUnit: 1, uom: "PCS", isCritical: false, trackingType: "NONE", leadTimeDays: 3 },
    ],
    createdBy: "Dr. Ananya Gogoi (R&D)",
    approvedBy: "Vikram Nair",
    totalStdCost: 214330,
    notes: "v3 introduces upgraded Flow Cell Sensor (ECN-2025-008)",
    ecnRef: "ECN-2025-008",
  },
  {
    id: "bom2",
    productId: "mp1",
    productName: "Hematology Analyzer HA-500",
    productCode: "MBA-HA500",
    version: "v2",
    status: "SUPERSEDED",
    effectiveFrom: "2025-06-01",
    effectiveTo: "2025-12-31",
    lines: [
      { id: "bl7", componentItemId: "itm5", componentCode: "MLB-ITM-0005", componentName: "PCB Assembly - HA500 Main Board", qtyPerUnit: 1, uom: "PCS", referenceDesignator: "PCB-MAIN-01", isCritical: true, trackingType: "BATCH", leadTimeDays: 30 },
      { id: "bl8", componentItemId: "itm6", componentCode: "MLB-ITM-0006", componentName: "Flow Cell Sensor (Standard Grade)", qtyPerUnit: 1, uom: "PCS", referenceDesignator: "SENS-FC-01", isCritical: true, trackingType: "BATCH", leadTimeDays: 14 },
      { id: "bl9", componentItemId: "itm9", componentCode: "MLB-ITM-0009", componentName: "Mechanical Frame", qtyPerUnit: 1, uom: "PCS", referenceDesignator: "MECH-FR-01", isCritical: false, trackingType: "BATCH", leadTimeDays: 10 },
    ],
    createdBy: "Dr. Ananya Gogoi (R&D)",
    approvedBy: "Vikram Nair",
    totalStdCost: 202500,
    ecnRef: "ECN-2025-008",
  },
  {
    id: "bom3",
    productId: "mp2",
    productName: "Biochemistry Analyzer BA-200",
    productCode: "MBA-BA200",
    version: "v2",
    status: "ACTIVE",
    effectiveFrom: "2025-09-01",
    lines: [
      { id: "bl10", componentItemId: "itm5", componentCode: "MLB-ITM-0005", componentName: "PCB Assembly - HA500 Main Board", qtyPerUnit: 2, uom: "PCS", referenceDesignator: "PCB-MAIN-01,PCB-SUB-01", isCritical: true, trackingType: "BATCH", leadTimeDays: 30 },
      { id: "bl11", componentItemId: "itm9", componentCode: "MLB-ITM-0009", componentName: "Mechanical Frame - BA200", qtyPerUnit: 1, uom: "PCS", referenceDesignator: "MECH-FR-01", isCritical: true, trackingType: "BATCH", leadTimeDays: 10 },
      { id: "bl12", componentItemId: "itm4", componentCode: "MLB-ITM-0004", componentName: "Liver Function Test Kit", qtyPerUnit: 2, uom: "KIT", isCritical: false, trackingType: "BATCH", leadTimeDays: 14 },
      { id: "bl13", componentItemId: "itm8", componentCode: "MLB-ITM-0008", componentName: "Cleaning Solution 1L", qtyPerUnit: 2, uom: "BTL", isCritical: false, trackingType: "BATCH", leadTimeDays: 7 },
    ],
    createdBy: "Dr. Ananya Gogoi (R&D)",
    approvedBy: "Vikram Nair",
    totalStdCost: 267600,
  },
  {
    id: "bom4",
    productId: "mp5",
    productName: "CBC Reagent Lot 500T",
    productCode: "RGT-CBC500",
    version: "v1",
    status: "ACTIVE",
    effectiveFrom: "2025-04-01",
    lines: [
      { id: "bl14", componentItemId: "itm3", componentCode: "MLB-ITM-0003", componentName: "CBC Reagent Kit - 500 Tests", qtyPerUnit: 5, uom: "KIT", isCritical: true, trackingType: "BATCH", leadTimeDays: 21 },
      { id: "bl15", componentItemId: "itm8", componentCode: "MLB-ITM-0008", componentName: "Cleaning Solution 1L", qtyPerUnit: 1, uom: "BTL", isCritical: false, trackingType: "BATCH", leadTimeDays: 7 },
    ],
    createdBy: "Dr. Ananya Gogoi (R&D)",
    approvedBy: "Vikram Nair",
    totalStdCost: 21450,
  },
];

// ─── WIP Stage Templates ──────────────────────────────────────────────────────

export interface WIPStageTemplate {
  id: string;
  productFamily: ProductFamily;
  sequenceNumber: number;
  stageName: string;
  requiresQCSignOff: boolean;
  expectedDurationHours: number;
  responsibleRole: string;
}

export const wipStageTemplates: WIPStageTemplate[] = [
  // Instigenie Instrument stages
  { id: "wst1", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 1, stageName: "Component Kitting", requiresQCSignOff: false, expectedDurationHours: 2, responsibleRole: "Stores" },
  { id: "wst2", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 2, stageName: "PCB Sub-Assembly", requiresQCSignOff: true, expectedDurationHours: 4, responsibleRole: "Production" },
  { id: "wst3", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 3, stageName: "Mechanical Assembly", requiresQCSignOff: false, expectedDurationHours: 3, responsibleRole: "Production" },
  { id: "wst4", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 4, stageName: "Main Integration", requiresQCSignOff: false, expectedDurationHours: 4, responsibleRole: "Production" },
  { id: "wst5", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 5, stageName: "Electrical Testing", requiresQCSignOff: true, expectedDurationHours: 3, responsibleRole: "QC" },
  { id: "wst6", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 6, stageName: "Software/Firmware Load", requiresQCSignOff: false, expectedDurationHours: 1, responsibleRole: "Production" },
  { id: "wst7", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 7, stageName: "Burn-in / Soak Test", requiresQCSignOff: false, expectedDurationHours: 4, responsibleRole: "Production" },
  { id: "wst8", productFamily: "INSTIGENIE_INSTRUMENT", sequenceNumber: 8, stageName: "Final QC", requiresQCSignOff: true, expectedDurationHours: 2, responsibleRole: "QC" },
  // CBL Device stages
  { id: "wst9", productFamily: "CBL_DEVICE", sequenceNumber: 1, stageName: "Component Kitting", requiresQCSignOff: false, expectedDurationHours: 1.5, responsibleRole: "Stores" },
  { id: "wst10", productFamily: "CBL_DEVICE", sequenceNumber: 2, stageName: "PCB Sub-Assembly", requiresQCSignOff: true, expectedDurationHours: 3, responsibleRole: "Production" },
  { id: "wst11", productFamily: "CBL_DEVICE", sequenceNumber: 3, stageName: "Mechanical Assembly", requiresQCSignOff: false, expectedDurationHours: 2, responsibleRole: "Production" },
  { id: "wst12", productFamily: "CBL_DEVICE", sequenceNumber: 4, stageName: "Main Integration", requiresQCSignOff: false, expectedDurationHours: 2.5, responsibleRole: "Production" },
  { id: "wst13", productFamily: "CBL_DEVICE", sequenceNumber: 5, stageName: "Functional Testing", requiresQCSignOff: true, expectedDurationHours: 2, responsibleRole: "QC" },
  { id: "wst14", productFamily: "CBL_DEVICE", sequenceNumber: 6, stageName: "Final QC", requiresQCSignOff: true, expectedDurationHours: 1.5, responsibleRole: "QC" },
  // Reagent stages
  { id: "wst15", productFamily: "REAGENT", sequenceNumber: 1, stageName: "Raw Material Verification", requiresQCSignOff: false, expectedDurationHours: 1, responsibleRole: "Stores" },
  { id: "wst16", productFamily: "REAGENT", sequenceNumber: 2, stageName: "Preparation / Mixing", requiresQCSignOff: false, expectedDurationHours: 3, responsibleRole: "Production" },
  { id: "wst17", productFamily: "REAGENT", sequenceNumber: 3, stageName: "Filling / Packaging", requiresQCSignOff: false, expectedDurationHours: 2, responsibleRole: "Production" },
  { id: "wst18", productFamily: "REAGENT", sequenceNumber: 4, stageName: "QC Sampling & Testing", requiresQCSignOff: true, expectedDurationHours: 4, responsibleRole: "QC" },
  { id: "wst19", productFamily: "REAGENT", sequenceNumber: 5, stageName: "Release to Finished Goods", requiresQCSignOff: false, expectedDurationHours: 0.5, responsibleRole: "Stores" },
];

// ─── Work Orders ──────────────────────────────────────────────────────────────

export interface WIPStage {
  id: string;
  templateId: string;
  stageName: string;
  sequenceNumber: number;
  requiresQCSignOff: boolean;
  expectedDurationHours: number;
  status: WIPStageStatus;
  startedAt?: string;
  completedAt?: string;
  qcResult?: "PASS" | "FAIL";
  reworkCount: number;
  assignedTo?: string;
  notes?: string;
}

export interface ComponentAssignment {
  componentItemId: string;
  componentCode: string;
  componentName: string;
  assignmentType: "SERIAL" | "BATCH";
  serialId?: string;
  batchId?: string;
  batchNumber?: string;
  assignedAt: string;
}

export interface MRPLine {
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyRequired: number;
  qtyAvailable: number;
  qtyShortfall: number;
  status: "SUFFICIENT" | "SHORTFALL" | "RESERVED";
  indentNumber?: string;
  reservedBatch?: string;
}

export interface EnhancedWorkOrder {
  id: string;
  pid: string; // e.g. PID-2026-041
  productId: string;
  productName: string;
  productCode: string;
  productFamily: ProductFamily;
  bomId: string;
  bomVersion: string;
  quantity: number;
  status: WOStatus;
  priority: WOPriority;
  targetDate: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  dealId?: string;
  assignedTo: string;
  createdBy: string;
  wipStages: WIPStage[];
  mrpLines: MRPLine[];
  componentAssignments: ComponentAssignment[];
  deviceSerials: string[];
  currentStageIndex: number;
  reworkCount: number;
  notes?: string;
  lotNumber?: string; // for reagents
}

export const enhancedWorkOrders: EnhancedWorkOrder[] = [
  {
    id: "ewo1",
    pid: "PID-2026-041",
    productId: "mp1",
    productName: "Hematology Analyzer HA-500",
    productCode: "MBA-HA500",
    productFamily: "INSTIGENIE_INSTRUMENT",
    bomId: "bom1",
    bomVersion: "v3",
    quantity: 3,
    status: "IN_PROGRESS",
    priority: "HIGH",
    targetDate: "2026-04-30",
    createdAt: "2026-04-01",
    startedAt: "2026-04-03",
    dealId: "deal-2026-011",
    assignedTo: "Bikash Deka",
    createdBy: "System (CRM Deal Won)",
    wipStages: [
      { id: "ws1", templateId: "wst1", stageName: "Component Kitting", sequenceNumber: 1, requiresQCSignOff: false, expectedDurationHours: 2, status: "COMPLETED", startedAt: "2026-04-03T08:00:00", completedAt: "2026-04-03T10:30:00", reworkCount: 0, assignedTo: "Ranjit Bora" },
      { id: "ws2", templateId: "wst2", stageName: "PCB Sub-Assembly", sequenceNumber: 2, requiresQCSignOff: true, expectedDurationHours: 4, status: "COMPLETED", startedAt: "2026-04-03T11:00:00", completedAt: "2026-04-04T09:00:00", qcResult: "PASS", reworkCount: 0, assignedTo: "Bikash Deka" },
      { id: "ws3", templateId: "wst3", stageName: "Mechanical Assembly", sequenceNumber: 3, requiresQCSignOff: false, expectedDurationHours: 3, status: "COMPLETED", startedAt: "2026-04-04T10:00:00", completedAt: "2026-04-06T14:00:00", reworkCount: 0, assignedTo: "Bikash Deka" },
      { id: "ws4", templateId: "wst4", stageName: "Main Integration", sequenceNumber: 4, requiresQCSignOff: false, expectedDurationHours: 4, status: "IN_PROGRESS", startedAt: "2026-04-07T09:00:00", reworkCount: 0, assignedTo: "Bikash Deka", notes: "Unit 2 integration complete. Unit 3 started." },
      { id: "ws5", templateId: "wst5", stageName: "Electrical Testing", sequenceNumber: 5, requiresQCSignOff: true, expectedDurationHours: 3, status: "PENDING", reworkCount: 0 },
      { id: "ws6", templateId: "wst6", stageName: "Software/Firmware Load", sequenceNumber: 6, requiresQCSignOff: false, expectedDurationHours: 1, status: "PENDING", reworkCount: 0 },
      { id: "ws7", templateId: "wst7", stageName: "Burn-in / Soak Test", sequenceNumber: 7, requiresQCSignOff: false, expectedDurationHours: 4, status: "PENDING", reworkCount: 0 },
      { id: "ws8", templateId: "wst8", stageName: "Final QC", sequenceNumber: 8, requiresQCSignOff: true, expectedDurationHours: 2, status: "PENDING", reworkCount: 0 },
    ],
    mrpLines: [
      { itemId: "itm5", itemCode: "MLB-ITM-0005", itemName: "PCB Assembly - HA500 Main Board", qtyRequired: 3, qtyAvailable: 25, qtyShortfall: 0, status: "RESERVED", reservedBatch: "MLB-BAT-2026-005" },
      { itemId: "itm6", itemCode: "MLB-ITM-0006", itemName: "Flow Cell Sensor", qtyRequired: 3, qtyAvailable: 13, qtyShortfall: 0, status: "SUFFICIENT" },
      { itemId: "itm9", itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame - BA200", qtyRequired: 3, qtyAvailable: 5, qtyShortfall: 0, status: "SUFFICIENT" },
      { itemId: "itm3", itemCode: "MLB-ITM-0003", itemName: "CBC Reagent Kit - 500 Tests", qtyRequired: 3, qtyAvailable: 140, qtyShortfall: 0, status: "SUFFICIENT" },
    ],
    componentAssignments: [
      { componentItemId: "itm5", componentCode: "MLB-ITM-0005", componentName: "PCB Assembly", assignmentType: "BATCH", batchId: "bat6", batchNumber: "MLB-BAT-2026-005", assignedAt: "2026-04-03T09:00:00" },
      { componentItemId: "itm6", componentCode: "MLB-ITM-0006", componentName: "Flow Cell Sensor", assignmentType: "SERIAL", serialId: "MLB-SEN-FC-0050", assignedAt: "2026-04-03T09:30:00" },
    ],
    deviceSerials: ["MBA-2026-0101", "MBA-2026-0102", "MBA-2026-0103"],
    currentStageIndex: 3,
    reworkCount: 0,
    notes: "CRM Deal D-2026-011 — Apollo Diagnostics order for 3 units",
  },
  {
    id: "ewo2",
    pid: "PID-2026-042",
    productId: "mp2",
    productName: "Biochemistry Analyzer BA-200",
    productCode: "MBA-BA200",
    productFamily: "INSTIGENIE_INSTRUMENT",
    bomId: "bom3",
    bomVersion: "v2",
    quantity: 2,
    status: "QC_HOLD",
    priority: "HIGH",
    targetDate: "2026-04-25",
    createdAt: "2026-04-02",
    startedAt: "2026-04-04",
    assignedTo: "Priya Devi",
    createdBy: "Vikram Nair (Manual)",
    wipStages: [
      { id: "ws9", templateId: "wst1", stageName: "Component Kitting", sequenceNumber: 1, requiresQCSignOff: false, expectedDurationHours: 2, status: "COMPLETED", startedAt: "2026-04-04T08:00:00", completedAt: "2026-04-04T10:00:00", reworkCount: 0 },
      { id: "ws10", templateId: "wst2", stageName: "PCB Sub-Assembly", sequenceNumber: 2, requiresQCSignOff: true, expectedDurationHours: 4, status: "COMPLETED", startedAt: "2026-04-05T09:00:00", completedAt: "2026-04-06T14:00:00", qcResult: "PASS", reworkCount: 0 },
      { id: "ws11", templateId: "wst3", stageName: "Mechanical Assembly", sequenceNumber: 3, requiresQCSignOff: false, expectedDurationHours: 3, status: "COMPLETED", startedAt: "2026-04-07T09:00:00", completedAt: "2026-04-08T12:00:00", reworkCount: 0 },
      { id: "ws12", templateId: "wst4", stageName: "Main Integration", sequenceNumber: 4, requiresQCSignOff: false, expectedDurationHours: 4, status: "COMPLETED", startedAt: "2026-04-09T09:00:00", completedAt: "2026-04-11T15:00:00", reworkCount: 0 },
      { id: "ws13", templateId: "wst5", stageName: "Electrical Testing", sequenceNumber: 5, requiresQCSignOff: true, expectedDurationHours: 3, status: "QC_HOLD", startedAt: "2026-04-12T09:00:00", qcResult: "FAIL", reworkCount: 1, notes: "Unit 1: voltage regulator output out of spec. QC FAIL — rework required." },
      { id: "ws14", templateId: "wst6", stageName: "Software/Firmware Load", sequenceNumber: 6, requiresQCSignOff: false, expectedDurationHours: 1, status: "PENDING", reworkCount: 0 },
      { id: "ws15", templateId: "wst7", stageName: "Burn-in / Soak Test", sequenceNumber: 7, requiresQCSignOff: false, expectedDurationHours: 4, status: "PENDING", reworkCount: 0 },
      { id: "ws16", templateId: "wst8", stageName: "Final QC", sequenceNumber: 8, requiresQCSignOff: true, expectedDurationHours: 2, status: "PENDING", reworkCount: 0 },
    ],
    mrpLines: [
      { itemId: "itm5", itemCode: "MLB-ITM-0005", itemName: "PCB Assembly - HA500 Main Board", qtyRequired: 4, qtyAvailable: 25, qtyShortfall: 0, status: "RESERVED" },
      { itemId: "itm9", itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame - BA200", qtyRequired: 2, qtyAvailable: 5, qtyShortfall: 0, status: "SUFFICIENT" },
    ],
    componentAssignments: [
      { componentItemId: "itm5", componentCode: "MLB-ITM-0005", componentName: "PCB Assembly", assignmentType: "BATCH", batchId: "bat6", batchNumber: "MLB-BAT-2026-005", assignedAt: "2026-04-04T09:00:00" },
    ],
    deviceSerials: ["MBA-2026-0201", "MBA-2026-0202"],
    currentStageIndex: 4,
    reworkCount: 1,
    notes: "Unit 1 in rework — voltage regulator replacement needed",
  },
  {
    id: "ewo3",
    pid: "PID-2026-043",
    productId: "mp5",
    productName: "CBC Reagent Lot 500T",
    productCode: "RGT-CBC500",
    productFamily: "REAGENT",
    bomId: "bom4",
    bomVersion: "v1",
    quantity: 20,
    status: "IN_PROGRESS",
    priority: "NORMAL",
    targetDate: "2026-04-22",
    createdAt: "2026-04-10",
    startedAt: "2026-04-15",
    assignedTo: "Kavita Sharma",
    createdBy: "Vikram Nair (Manual)",
    lotNumber: "LOT-CBC-2026-019",
    wipStages: [
      { id: "ws17", templateId: "wst15", stageName: "Raw Material Verification", sequenceNumber: 1, requiresQCSignOff: false, expectedDurationHours: 1, status: "COMPLETED", startedAt: "2026-04-15T08:00:00", completedAt: "2026-04-15T09:30:00", reworkCount: 0 },
      { id: "ws18", templateId: "wst16", stageName: "Preparation / Mixing", sequenceNumber: 2, requiresQCSignOff: false, expectedDurationHours: 3, status: "COMPLETED", startedAt: "2026-04-15T10:00:00", completedAt: "2026-04-15T14:00:00", reworkCount: 0 },
      { id: "ws19", templateId: "wst17", stageName: "Filling / Packaging", sequenceNumber: 3, requiresQCSignOff: false, expectedDurationHours: 2, status: "IN_PROGRESS", startedAt: "2026-04-16T09:00:00", reworkCount: 0, assignedTo: "Kavita Sharma" },
      { id: "ws20", templateId: "wst18", stageName: "QC Sampling & Testing", sequenceNumber: 4, requiresQCSignOff: true, expectedDurationHours: 4, status: "PENDING", reworkCount: 0 },
      { id: "ws21", templateId: "wst19", stageName: "Release to Finished Goods", sequenceNumber: 5, requiresQCSignOff: false, expectedDurationHours: 0.5, status: "PENDING", reworkCount: 0 },
    ],
    mrpLines: [
      { itemId: "itm3", itemCode: "MLB-ITM-0003", itemName: "CBC Reagent Kit - 500 Tests", qtyRequired: 100, qtyAvailable: 140, qtyShortfall: 0, status: "SUFFICIENT" },
      { itemId: "itm8", itemCode: "MLB-ITM-0008", itemName: "Cleaning Solution 1L", qtyRequired: 20, qtyAvailable: 300, qtyShortfall: 0, status: "SUFFICIENT" },
    ],
    componentAssignments: [
      { componentItemId: "itm3", componentCode: "MLB-ITM-0003", componentName: "CBC Reagent Kit", assignmentType: "BATCH", batchId: "bat1", batchNumber: "MLB-BAT-2026-001", assignedAt: "2026-04-15T08:30:00" },
    ],
    deviceSerials: [],
    currentStageIndex: 2,
    reworkCount: 0,
  },
  {
    id: "ewo4",
    pid: "PID-2026-038",
    productId: "mp1",
    productName: "Hematology Analyzer HA-500",
    productCode: "MBA-HA500",
    productFamily: "INSTIGENIE_INSTRUMENT",
    bomId: "bom1",
    bomVersion: "v3",
    quantity: 1,
    status: "COMPLETED",
    priority: "NORMAL",
    targetDate: "2026-03-31",
    createdAt: "2026-03-05",
    startedAt: "2026-03-07",
    completedAt: "2026-03-28",
    assignedTo: "Bikash Deka",
    createdBy: "System (CRM Deal Won)",
    dealId: "deal-2026-008",
    wipStages: [
      { id: "ws22", templateId: "wst1", stageName: "Component Kitting", sequenceNumber: 1, requiresQCSignOff: false, expectedDurationHours: 2, status: "COMPLETED", reworkCount: 0 },
      { id: "ws23", templateId: "wst2", stageName: "PCB Sub-Assembly", sequenceNumber: 2, requiresQCSignOff: true, expectedDurationHours: 4, status: "COMPLETED", qcResult: "PASS", reworkCount: 0 },
      { id: "ws24", templateId: "wst3", stageName: "Mechanical Assembly", sequenceNumber: 3, requiresQCSignOff: false, expectedDurationHours: 3, status: "COMPLETED", reworkCount: 0 },
      { id: "ws25", templateId: "wst4", stageName: "Main Integration", sequenceNumber: 4, requiresQCSignOff: false, expectedDurationHours: 4, status: "COMPLETED", reworkCount: 0 },
      { id: "ws26", templateId: "wst5", stageName: "Electrical Testing", sequenceNumber: 5, requiresQCSignOff: true, expectedDurationHours: 3, status: "COMPLETED", qcResult: "PASS", reworkCount: 0 },
      { id: "ws27", templateId: "wst6", stageName: "Software/Firmware Load", sequenceNumber: 6, requiresQCSignOff: false, expectedDurationHours: 1, status: "COMPLETED", reworkCount: 0 },
      { id: "ws28", templateId: "wst7", stageName: "Burn-in / Soak Test", sequenceNumber: 7, requiresQCSignOff: false, expectedDurationHours: 4, status: "COMPLETED", reworkCount: 0 },
      { id: "ws29", templateId: "wst8", stageName: "Final QC", sequenceNumber: 8, requiresQCSignOff: true, expectedDurationHours: 2, status: "COMPLETED", qcResult: "PASS", reworkCount: 0 },
    ],
    mrpLines: [],
    componentAssignments: [
      { componentItemId: "itm5", componentCode: "MLB-ITM-0005", componentName: "PCB Assembly", assignmentType: "BATCH", batchId: "bat6", batchNumber: "MLB-BAT-2026-005", assignedAt: "2026-03-07T09:00:00" },
    ],
    deviceSerials: ["MBA-2026-0091"],
    currentStageIndex: 7,
    reworkCount: 0,
  },
  {
    id: "ewo5",
    pid: "PID-2026-044",
    productId: "mp4",
    productName: "CBL Glucometer Strip GS-300",
    productCode: "CBL-GS300",
    productFamily: "CBL_DEVICE",
    bomId: "bom3",
    bomVersion: "v2",
    quantity: 5,
    status: "MATERIAL_CHECK",
    priority: "CRITICAL",
    targetDate: "2026-04-28",
    createdAt: "2026-04-16",
    assignedTo: "Priya Devi",
    createdBy: "Vikram Nair (Manual)",
    wipStages: [
      { id: "ws30", templateId: "wst9", stageName: "Component Kitting", sequenceNumber: 1, requiresQCSignOff: false, expectedDurationHours: 1.5, status: "PENDING", reworkCount: 0 },
      { id: "ws31", templateId: "wst10", stageName: "PCB Sub-Assembly", sequenceNumber: 2, requiresQCSignOff: true, expectedDurationHours: 3, status: "PENDING", reworkCount: 0 },
      { id: "ws32", templateId: "wst11", stageName: "Mechanical Assembly", sequenceNumber: 3, requiresQCSignOff: false, expectedDurationHours: 2, status: "PENDING", reworkCount: 0 },
      { id: "ws33", templateId: "wst12", stageName: "Main Integration", sequenceNumber: 4, requiresQCSignOff: false, expectedDurationHours: 2.5, status: "PENDING", reworkCount: 0 },
      { id: "ws34", templateId: "wst13", stageName: "Functional Testing", sequenceNumber: 5, requiresQCSignOff: true, expectedDurationHours: 2, status: "PENDING", reworkCount: 0 },
      { id: "ws35", templateId: "wst14", stageName: "Final QC", sequenceNumber: 6, requiresQCSignOff: true, expectedDurationHours: 1.5, status: "PENDING", reworkCount: 0 },
    ],
    mrpLines: [
      { itemId: "itm5", itemCode: "MLB-ITM-0005", itemName: "PCB Assembly", qtyRequired: 10, qtyAvailable: 25, qtyShortfall: 0, status: "SUFFICIENT" },
      { itemId: "itm9", itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame", qtyRequired: 5, qtyAvailable: 5, qtyShortfall: 0, status: "SUFFICIENT" },
      { itemId: "itm6", itemCode: "MLB-ITM-0006", itemName: "Flow Cell Sensor", qtyRequired: 5, qtyAvailable: 13, qtyShortfall: 0, status: "SUFFICIENT" },
    ],
    componentAssignments: [],
    deviceSerials: [],
    currentStageIndex: 0,
    reworkCount: 0,
    notes: "MRP check complete — all materials available. Ready to release.",
  },
];

// ─── ECN ─────────────────────────────────────────────────────────────────────

export interface ECNApprovalStep {
  role: string;
  approver: string;
  action: "PENDING" | "APPROVED" | "REJECTED";
  note?: string;
  actionedAt?: string;
}

export interface ECN {
  id: string;
  ecnNumber: string;
  title: string;
  reason: string;
  reasonCode: "QUALITY_IMPROVEMENT" | "COST_REDUCTION" | "SUPPLIER_CHANGE" | "REGULATORY" | "SAFETY" | "PERFORMANCE";
  affectedProductIds: string[];
  affectedProductNames: string[];
  fromBomId: string;
  fromBomVersion: string;
  toBomVersion: string;
  changeDescription: string;
  impact: string;
  status: ECNStatus;
  isUrgent: boolean;
  effectiveDate?: string;
  initiatedBy: string;
  createdAt: string;
  implementedAt?: string;
  approvalSteps: ECNApprovalStep[];
}

export const ecns: ECN[] = [
  {
    id: "ecn1",
    ecnNumber: "ECN-2025-008",
    title: "Upgrade Flow Cell Sensor from Standard to Precision Grade",
    reason: "Field data showed 3 precision failures in Standard Grade sensors at Apollo Diagnostics. Precision Grade eliminates variance. QC pass rate improved from 94% to 99% in trial.",
    reasonCode: "QUALITY_IMPROVEMENT",
    affectedProductIds: ["mp1"],
    affectedProductNames: ["Hematology Analyzer HA-500"],
    fromBomId: "bom2",
    fromBomVersion: "v2",
    toBomVersion: "v3",
    changeDescription: "Replace MLB-ITM-0006 Standard Grade Flow Cell Sensor with Precision Grade variant. Unit cost increases by ₹3,830. Lead time increases from 14 to 18 days.",
    impact: "Unit cost +₹3,830. Lead time +4 days. Procurement must update vendor and AVL. Outstanding WOs on v2 BOM to be completed as-is (grandfathered).",
    status: "IMPLEMENTED",
    isUrgent: false,
    effectiveDate: "2026-01-01",
    initiatedBy: "Dr. Ananya Gogoi (R&D)",
    createdAt: "2025-11-15",
    implementedAt: "2025-12-28",
    approvalSteps: [
      { role: "R&D Lead", approver: "Dr. Ananya Gogoi", action: "APPROVED", note: "Trial data supports upgrade. Full test report attached.", actionedAt: "2025-11-20T10:00:00" },
      { role: "Production Manager", approver: "Vikram Nair", action: "APPROVED", note: "Accepted. Will schedule changeover from Jan 1 2026.", actionedAt: "2025-12-01T14:00:00" },
      { role: "Management", approver: "Dr. Sameer Roy", action: "APPROVED", note: "Approved. Customer quality is non-negotiable.", actionedAt: "2025-12-15T09:00:00" },
    ],
  },
  {
    id: "ecn2",
    ecnNumber: "ECN-2026-003",
    title: "PCB Main Board — Switch to alternate PCB supplier (Bengaluru vendor)",
    reason: "PCBTech India delivery delays averaging 12 days over promised lead time for last 3 POs. Propose qualifying alternate supplier Triton PCB Solutions.",
    reasonCode: "SUPPLIER_CHANGE",
    affectedProductIds: ["mp1", "mp2"],
    affectedProductNames: ["Hematology Analyzer HA-500", "Biochemistry Analyzer BA-200"],
    fromBomId: "bom1",
    fromBomVersion: "v3",
    toBomVersion: "v4",
    changeDescription: "Add Triton PCB Solutions as approved alternate vendor for MLB-ITM-0005 PCB Assembly. Primary remains PCBTech India. Triton is activated only when PCBTech delivery is delayed > 7 days.",
    impact: "No BOM line change — only AVL update. Requires Procurement to qualify Triton and conduct first sample QC inspection. Cost neutral. Lead time improves by 5 days if alternate is used.",
    status: "IN_REVIEW",
    isUrgent: false,
    initiatedBy: "Ranjit Bora (Stores)",
    createdAt: "2026-03-20",
    approvalSteps: [
      { role: "R&D Lead", approver: "Dr. Ananya Gogoi", action: "APPROVED", note: "Technically acceptable — Triton samples pass functional test.", actionedAt: "2026-03-28T11:00:00" },
      { role: "Production Manager", approver: "Vikram Nair", action: "PENDING" },
      { role: "Management", approver: "Dr. Sameer Roy", action: "PENDING" },
    ],
  },
  {
    id: "ecn3",
    ecnNumber: "ECN-2026-004",
    title: "URGENT: Remove defective sensor batch MLB-BAT-2026-SEN-RECALL from all production",
    reason: "QC identified systematic calibration drift in sensor batch MLB-BAT-2026-SEN-RECALL. Affects sensitivity at low cell counts. Potential misdiagnosis risk.",
    reasonCode: "SAFETY",
    affectedProductIds: ["mp1"],
    affectedProductNames: ["Hematology Analyzer HA-500"],
    fromBomId: "bom1",
    fromBomVersion: "v3",
    toBomVersion: "v3-R1",
    changeDescription: "Quarantine and return all units from batch MLB-BAT-2026-SEN-RECALL. Identify all WOs using this batch and put on QC_HOLD. Replace with approved batch.",
    impact: "3 WOs potentially affected. Replacement stock available. Estimated 2-day delay per affected WO.",
    status: "APPROVED",
    isUrgent: true,
    effectiveDate: "2026-04-16",
    initiatedBy: "Dr. Sunit Bhuyan (QC)",
    createdAt: "2026-04-15",
    approvalSteps: [
      { role: "R&D Lead", approver: "Dr. Ananya Gogoi", action: "APPROVED", note: "Confirmed — batch is defective. Quarantine immediately.", actionedAt: "2026-04-15T16:00:00" },
      { role: "Production Manager", approver: "Vikram Nair", action: "APPROVED", note: "WO PID-2026-041 and PID-2026-042 to be checked immediately.", actionedAt: "2026-04-15T17:00:00" },
      { role: "Management", approver: "Dr. Sameer Roy", action: "APPROVED", note: "Safety first. Execute immediately.", actionedAt: "2026-04-15T18:00:00" },
    ],
  },
  {
    id: "ecn4",
    ecnNumber: "ECN-2026-005",
    title: "BA-200 BOM v2 — Add anti-vibration mount to mechanical assembly",
    reason: "Field service reports vibration-induced misalignment in BA-200 units in transport. Anti-vibration mount eliminates the issue.",
    reasonCode: "PERFORMANCE",
    affectedProductIds: ["mp2"],
    affectedProductNames: ["Biochemistry Analyzer BA-200"],
    fromBomId: "bom3",
    fromBomVersion: "v2",
    toBomVersion: "v3",
    changeDescription: "Add new component: Anti-Vibration Mount AVM-200 (new item code to be created) to BA-200 BOM. Qty per unit: 4. Cost impact: +₹1,200 per unit.",
    impact: "New item to be created in Item Master and sourced. Procurement to issue indent. Production line change: mount installation added at Mechanical Assembly stage.",
    status: "DRAFT",
    isUrgent: false,
    initiatedBy: "Vikram Nair (Production Manager)",
    createdAt: "2026-04-10",
    approvalSteps: [
      { role: "R&D Lead", approver: "Dr. Ananya Gogoi", action: "PENDING" },
      { role: "Production Manager", approver: "Vikram Nair", action: "PENDING" },
      { role: "Management", approver: "Dr. Sameer Roy", action: "PENDING" },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getMfgProductById(id: string): MfgProduct | undefined {
  return mfgProducts.find((p) => p.id === id);
}

export function getBOMById(id: string): BOM | undefined {
  return boms.find((b) => b.id === id);
}

export function getBOMsForProduct(productId: string): BOM[] {
  return boms.filter((b) => b.productId === productId);
}

export function getWIPTemplatesForFamily(family: ProductFamily): WIPStageTemplate[] {
  return wipStageTemplates.filter((t) => t.productFamily === family).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

export function getWOById(id: string): EnhancedWorkOrder | undefined {
  return enhancedWorkOrders.find((w) => w.id === id);
}

export function getCompletedStages(wo: EnhancedWorkOrder): number {
  return wo.wipStages.filter((s) => s.status === "COMPLETED").length;
}

export function getWOProgress(wo: EnhancedWorkOrder): number {
  if (wo.wipStages.length === 0) return 0;
  return Math.round((getCompletedStages(wo) / wo.wipStages.length) * 100);
}

export function isWOOverdue(wo: EnhancedWorkOrder): boolean {
  if (wo.status === "COMPLETED" || wo.status === "CANCELLED") return false;
  return new Date(wo.targetDate) < new Date();
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
