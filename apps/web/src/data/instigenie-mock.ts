// ─── Instigenie Manufacturing Module ─────────────────────────────────────────────
// Mobicase Diagnostic Suite: MBA (Analyser), MBM (Mobimix), MBC (Mobicube), MCC (Final Case), CFG (Centrifuge)
// Assembly Lines: L1 (Mobimix), L2 (Analyser), L3 (Incubator), L4 (Final Assembly), L5 (Final Device QC)
// Compliance: ISO 13485:2016 | 21 CFR Part 11 | IEC 62304
// Team: Chetan (HOD), Shubham (Deputy/T1), Sanju (T1), Jatin (T1), Rishabh (T1), Binsu (T2), Saurabh (T3), Minakshi (T3)

// ─── Types ───────────────────────────────────────────────────────────────────

export type MobicaseProduct = "MBA" | "MBM" | "MBC" | "MCC" | "CFG";

export type MobiWOStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PENDING_RM"
  | "RM_ISSUED"
  | "RM_QC_IN_PROGRESS"
  | "IN_PROGRESS"
  | "ASSEMBLY_COMPLETE"
  | "QC_HANDOVER_PENDING"
  | "QC_IN_PROGRESS"
  | "QC_COMPLETED"
  | "COMPLETED"
  | "PARTIAL_COMPLETE"
  | "ON_HOLD"
  | "CANCELLED";

export type MobiWOPriority = "NORMAL" | "URGENT" | "CRITICAL";
export type AssemblyLine = "L1" | "L2" | "L3" | "L4" | "L5";
export type OperatorTier = "T1" | "T2" | "T3";
export type ShiftType = "SHIFT_1" | "SHIFT_2";

export type DeviceIDStatus =
  | "CREATED"
  | "IN_PRODUCTION"
  | "SUB_QC_PASS"
  | "SUB_QC_FAIL"
  | "IN_REWORK"
  | "REWORK_LIMIT_EXCEEDED"
  | "FINAL_ASSEMBLY"
  | "FINAL_QC_PASS"
  | "FINAL_QC_FAIL"
  | "RELEASED"
  | "DISPATCHED"
  | "SCRAPPED"
  | "RECALLED";

export type ScrapRootCause =
  | "OC_FITMENT"
  | "PCB_ASSEMBLY_ERROR"
  | "INCOMING_MATERIAL"
  | "DIMENSIONAL"
  | "PROCESS_ERROR"
  | "HANDLING_ESD"
  | "FIRMWARE_ERROR"
  | "OTHER";

export type DowntimeCategory =
  | "RM_DELAY_INVENTORY"
  | "RM_DELAY_QUALITY"
  | "EQUIPMENT_FAILURE"
  | "OPERATOR_ABSENCE_PLANNED"
  | "OPERATOR_ABSENCE_UNPLANNED"
  | "POWER_INFRASTRUCTURE"
  | "REWORK_HOLD"
  | "MANAGEMENT_HOLD";

export type BMRStatus = "DRAFT" | "PRODUCTION_SIGNED" | "QC_SIGNED" | "CLOSED";

// ─── Operators ───────────────────────────────────────────────────────────────

export interface MobiOperator {
  id: string;
  name: string;
  role: string;
  tier: OperatorTier;
  permittedLines: AssemblyLine[];
  canPCBRework: boolean;
  canOCAssembly: boolean;
  isDeputyHOD: boolean;
}

export const mobiOperators: MobiOperator[] = [
  { id: "op-chetan", name: "Chetan", role: "Production HOD", tier: "T1", permittedLines: ["L1","L2","L3","L4","L5"], canPCBRework: true, canOCAssembly: true, isDeputyHOD: false },
  { id: "op-shubham", name: "Shubham", role: "Production Executive", tier: "T1", permittedLines: ["L1","L2","L3","L4","L5"], canPCBRework: true, canOCAssembly: true, isDeputyHOD: true },
  { id: "op-sanju", name: "Sanju", role: "Production Executive", tier: "T1", permittedLines: ["L1","L2","L3","L4","L5"], canPCBRework: true, canOCAssembly: false, isDeputyHOD: false },
  { id: "op-jatin", name: "Jatin", role: "Production Executive", tier: "T1", permittedLines: ["L1","L2","L3","L4","L5"], canPCBRework: true, canOCAssembly: false, isDeputyHOD: false },
  { id: "op-rishabh", name: "Rishabh", role: "Production Executive", tier: "T1", permittedLines: ["L1","L2","L3","L4","L5"], canPCBRework: true, canOCAssembly: true, isDeputyHOD: false },
  { id: "op-binsu", name: "Binsu", role: "Production Executive", tier: "T2", permittedLines: ["L1","L3","L4","L5"], canPCBRework: false, canOCAssembly: false, isDeputyHOD: false },
  { id: "op-saurabh", name: "Saurabh", role: "Production Executive", tier: "T3", permittedLines: ["L4","L5"], canPCBRework: false, canOCAssembly: false, isDeputyHOD: false },
  { id: "op-minakshi", name: "Minakshi", role: "Production Executive", tier: "T3", permittedLines: ["L4","L5"], canPCBRework: false, canOCAssembly: false, isDeputyHOD: false },
];

// ─── Assembly Line Templates ──────────────────────────────────────────────────

export interface LineStageTemplate {
  id: string;
  line: AssemblyLine;
  sequence: number;
  stageName: string;
  product: MobicaseProduct;
  stdTimeMin: number;
  requiresQCGate: boolean;
  minTier: OperatorTier;
  ocAssemblyOnly?: boolean;  // Rishabh restriction
  requiresPhoto: boolean;
  requiresMeasurement: boolean;
  isBottleneck: boolean;
  notes?: string;
}

export const lineStageTemplates: LineStageTemplate[] = [
  // L1 — MBM Mobimix
  { id: "lst-l1-1", line: "L1", sequence: 1, stageName: "Motor & Scotch Assembly", product: "MBM", stdTimeMin: 5, requiresQCGate: false, minTier: "T2", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false },
  { id: "lst-l1-2", line: "L1", sequence: 2, stageName: "Cuvette Slide Assembly", product: "MBM", stdTimeMin: 5, requiresQCGate: false, minTier: "T2", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false },
  { id: "lst-l1-3", line: "L1", sequence: 3, stageName: "Mechanism Assembly", product: "MBM", stdTimeMin: 10, requiresQCGate: false, minTier: "T2", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false },
  { id: "lst-l1-4", line: "L1", sequence: 4, stageName: "PCB Rework & QC", product: "MBM", stdTimeMin: 25, requiresQCGate: true, minTier: "T1", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false, notes: "T1 only. SPC tracked." },
  { id: "lst-l1-5", line: "L1", sequence: 5, stageName: "Programming & Config QC", product: "MBM", stdTimeMin: 15, requiresQCGate: true, minTier: "T1", requiresPhoto: false, requiresMeasurement: true, isBottleneck: false, notes: "Firmware version mandatory" },
  { id: "lst-l1-6", line: "L1", sequence: 6, stageName: "QC Mixer", product: "MBM", stdTimeMin: 30, requiresQCGate: true, minTier: "T1", requiresPhoto: false, requiresMeasurement: true, isBottleneck: false, notes: "SPC on QC cycle time" },
  // L2 — MBA Analyser (bottleneck line)
  { id: "lst-l2-1", line: "L2", sequence: 1, stageName: "PCB Rework & QC", product: "MBA", stdTimeMin: 25, requiresQCGate: true, minTier: "T1", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false, notes: "SPC chart on defect rate. T1 only." },
  { id: "lst-l2-2", line: "L2", sequence: 2, stageName: "OC Assembly", product: "MBA", stdTimeMin: 6, requiresQCGate: false, minTier: "T1", ocAssemblyOnly: true, requiresPhoto: true, requiresMeasurement: true, isBottleneck: false, notes: "Rishabh primary. Go/No-Go jig JIG-OC-001 mandatory. Photo + gap measurement." },
  { id: "lst-l2-3", line: "L2", sequence: 3, stageName: "Heater & Metal Block", product: "MBA", stdTimeMin: 5, requiresQCGate: false, minTier: "T2", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false },
  { id: "lst-l2-4", line: "L2", sequence: 4, stageName: "QC Analyser", product: "MBA", stdTimeMin: 180, requiresQCGate: true, minTier: "T1", requiresPhoto: false, requiresMeasurement: true, isBottleneck: true, notes: "PRIMARY BOTTLENECK. 180 min/unit. Fixture ID required. SPC on cycle time. Target ≥4 fixtures." },
  // L3 — MBC Incubator
  { id: "lst-l3-1", line: "L3", sequence: 1, stageName: "Incubator Sub-Assembly", product: "MBC", stdTimeMin: 20, requiresQCGate: false, minTier: "T2", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false },
  { id: "lst-l3-2", line: "L3", sequence: 2, stageName: "QC Incubator", product: "MBC", stdTimeMin: 20, requiresQCGate: true, minTier: "T2", requiresPhoto: false, requiresMeasurement: true, isBottleneck: false, notes: "Temp calibration check logged" },
  // L4 — MCC Final Assembly
  { id: "lst-l4-1", line: "L4", sequence: 1, stageName: "Base Plate Assembly", product: "MCC", stdTimeMin: 10, requiresQCGate: false, minTier: "T1", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false },
  { id: "lst-l4-2", line: "L4", sequence: 2, stageName: "Top Plate with Devices", product: "MCC", stdTimeMin: 20, requiresQCGate: false, minTier: "T1", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false, notes: "Dep gate: L1+L2+L3 must be complete" },
  { id: "lst-l4-3", line: "L4", sequence: 3, stageName: "Final Assembly & Cleaning", product: "MCC", stdTimeMin: 15, requiresQCGate: false, minTier: "T1", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false, notes: "Cleaning standard checklist" },
  // L5 — Final Device QC
  { id: "lst-l5-1", line: "L5", sequence: 1, stageName: "Centrifuge Battery Pack", product: "CFG", stdTimeMin: 0, requiresQCGate: false, minTier: "T2", requiresPhoto: false, requiresMeasurement: false, isBottleneck: false, notes: "Vendor item. Vendor lot ID scan only." },
  { id: "lst-l5-2", line: "L5", sequence: 2, stageName: "Final Device QC", product: "MCC", stdTimeMin: 20, requiresQCGate: true, minTier: "T1", requiresPhoto: false, requiresMeasurement: true, isBottleneck: false, notes: "QC Dept only. TAT clock. Full traceability check." },
];

// ─── Device IDs ───────────────────────────────────────────────────────────────

export interface MobiDeviceID {
  id: string;
  deviceId: string;
  productCode: MobicaseProduct;
  workOrderId: string;
  workOrderNumber: string;
  status: DeviceIDStatus;
  reworkCount: number;
  maxReworkLimit: number;
  createdAt: string;
  assignedLine: AssemblyLine;

  // ── Standalone unit component IDs ────────────────────────────────────────
  // MBA (Analyzer) standalone
  pcbId?: string;           // e.g. PCB-MBA-2604-0001
  sensorId?: string;        // e.g. SNS-MBA-2604-0001
  detectorId?: string;      // e.g. DET-MBA-2604-0001
  // MBM (Mixer) standalone
  machineId?: string;       // e.g. MCH-MBM-2604-0001
  // MBC (Incubator) standalone also uses pcbId
  // CFG (Centrifuge) standalone / vendor-provided inside MCC
  cfgVendorId?: string;     // e.g. OMRON-CFG-20260301-0044
  cfgSerialNo?: string;     // Vendor serial number on nameplate
  // ── MCC internal sub-assembly component IDs ───────────────────────────────
  // The MCC is the device. Analyzer/Mixer/Incubator are assemblies INSIDE it.
  analyzerPcbId?: string;       // PCB inside the Analyzer assembly
  analyzerSensorId?: string;    // Sensor inside the Analyzer assembly
  analyzerDetectorId?: string;  // Detector inside the Analyzer assembly
  mixerMachineId?: string;      // Machine body of the Mixer assembly
  mixerPcbId?: string;          // PCB inside the Mixer assembly
  incubatorPcbId?: string;      // PCB inside the Incubator assembly
  // ── Unit-level accessories ────────────────────────────────────────────────
  micropipetteId?: string;  // e.g. MP-2026-0091
  centrifugeId?: string;    // fallback if cfgSerialNo/cfgVendorId absent
  // ── Dispatch / FG ─────────────────────────────────────────────────────────
  finishedGoodsRef?: string;
  invoiceRef?: string;
  deliveryChallanRef?: string;
  salesOrderRef?: string;
  scrappedAt?: string;
  scrappedReason?: string;
  dispatchedAt?: string;
}

export const mobiDeviceIDs: MobiDeviceID[] = [
  // ── WO-2026-04-001 (April batch, active) ──────────────────────────────────
  {
    id: "dev-001",
    deviceId: "MBA-2026-04-0001-0",
    productCode: "MBA",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    status: "IN_PRODUCTION",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-04-03T08:00:00",
    assignedLine: "L2",
    pcbId: "PCB-MBA-2604-0001",
    sensorId: "SNS-MBA-2604-0001",
    detectorId: "DET-MBA-2604-0001",
  },
  {
    id: "dev-002",
    deviceId: "MBA-2026-04-0002-0",
    productCode: "MBA",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    status: "IN_PRODUCTION",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-04-03T08:00:00",
    assignedLine: "L2",
    pcbId: "PCB-MBA-2604-0002",
    sensorId: "SNS-MBA-2604-0002",
    detectorId: "DET-MBA-2604-0002",
  },
  {
    id: "dev-003",
    deviceId: "MBA-2026-04-0003-0",
    productCode: "MBA",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    status: "SUB_QC_PASS",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-04-03T08:00:00",
    assignedLine: "L2",
    pcbId: "PCB-MBA-2604-0003",
    sensorId: "SNS-MBA-2604-0003",
    detectorId: "DET-MBA-2604-0003",
    micropipetteId: "MP-2026-0003",
    centrifugeId: "CFG-2026-0003",
  },
  {
    id: "dev-004",
    deviceId: "MBM-2026-04-0001-0",
    productCode: "MBM",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    status: "SUB_QC_PASS",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-04-03T08:00:00",
    assignedLine: "L1",
    machineId: "MCH-MBM-2604-0001",
    pcbId: "PCB-MBM-2604-0001",
  },
  {
    id: "dev-005",
    deviceId: "MBM-2026-04-0002-0",
    productCode: "MBM",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    status: "SUB_QC_PASS",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-04-03T08:00:00",
    assignedLine: "L1",
    machineId: "MCH-MBM-2604-0002",
    pcbId: "PCB-MBM-2604-0002",
  },
  {
    id: "dev-006",
    deviceId: "MBC-2026-04-0001-0",
    productCode: "MBC",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    status: "SUB_QC_PASS",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-04-03T08:00:00",
    assignedLine: "L3",
    pcbId: "PCB-MBC-2604-0001",
  },
  // ── WO-2026-04-002 (April batch, partial issues) ───────────────────────────
  {
    id: "dev-007",
    deviceId: "MBA-2026-04-0201-1",
    productCode: "MBA",
    workOrderId: "mwo-002",
    workOrderNumber: "WO-2026-04-002",
    status: "IN_REWORK",
    reworkCount: 1,
    maxReworkLimit: 3,
    createdAt: "2026-04-04T08:00:00",
    assignedLine: "L2",
    pcbId: "PCB-MBA-2604-0201",
    sensorId: "SNS-MBA-2604-0201",
    detectorId: "DET-MBA-2604-0201",
  },
  {
    id: "dev-008",
    deviceId: "MBA-2026-04-0202-0",
    productCode: "MBA",
    workOrderId: "mwo-002",
    workOrderNumber: "WO-2026-04-002",
    status: "SUB_QC_FAIL",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-04-04T08:00:00",
    assignedLine: "L2",
    pcbId: "PCB-MBA-2604-0202",
    sensorId: "SNS-MBA-2604-0202",
    detectorId: "DET-MBA-2604-0202",
  },
  // ── WO-2026-03-004 (March dispatched MCC) ─────────────────────────────────
  {
    id: "dev-009",
    deviceId: "MCC-2026-03-0091-0",
    productCode: "MCC",
    workOrderId: "mwo-004",
    workOrderNumber: "WO-2026-03-004",
    status: "DISPATCHED",
    reworkCount: 0,
    maxReworkLimit: 3,
    createdAt: "2026-03-07T08:00:00",
    assignedLine: "L4",
    // ── Analyzer (MBA) assembly inside this MCC ───────────────────────────
    analyzerPcbId: "PCB-MBA-2603-0091",
    analyzerSensorId: "SNS-MBA-2603-0091",
    analyzerDetectorId: "DET-MBA-2603-0091",
    // ── Mixer (MBM) assembly inside this MCC ─────────────────────────────
    mixerMachineId: "MCH-MBM-2603-0091",
    mixerPcbId: "PCB-MBM-2603-0091",
    // ── Incubator (MBC) assembly inside this MCC ──────────────────────────
    incubatorPcbId: "PCB-MBC-2603-0091",
    // ── Centrifuge (vendor-provided) ──────────────────────────────────────
    cfgVendorId: "OMRON-CFG-20260301-0044",
    cfgSerialNo: "OMR-SN-20260301-0044",
    // ── Unit-level accessories ────────────────────────────────────────────
    micropipetteId: "MP-2026-0091",
    // Dispatch
    finishedGoodsRef: "FG-2026-0091",
    invoiceRef: "MBL/24-25/0028",
    deliveryChallanRef: "DC-2026-0028",
    salesOrderRef: "SO-2026-008",
    dispatchedAt: "2026-03-28",
  },
  // ── WO-2026-03-003 (scrapped unit) ────────────────────────────────────────
  {
    id: "dev-010",
    deviceId: "MBA-2026-03-0035-0",
    productCode: "MBA",
    workOrderId: "mwo-003",
    workOrderNumber: "WO-2026-03-003",
    status: "SCRAPPED",
    reworkCount: 3,
    maxReworkLimit: 3,
    createdAt: "2026-03-10T08:00:00",
    assignedLine: "L2",
    pcbId: "PCB-MBA-2603-0035",
    sensorId: "SNS-MBA-2603-0035",
    detectorId: "DET-MBA-2603-0035",
    scrappedAt: "2026-03-22",
    scrappedReason: "REWORK_LIMIT_EXCEEDED — OC Assembly defect persisted after 3 rework attempts",
  },
];

// ─── Work Orders (Instigenie WO Lifecycle) ──────────────────────────────────────

export interface MobiRMLine {
  itemCode: string;
  itemName: string;
  qtyRequired: number;
  qtyIssued: number;
  lotNumber?: string;
  issuedAt?: string;
  status: "PENDING" | "ISSUED" | "SHORTAGE";
}

export interface MobiApprovalLog {
  step: string;
  approver: string;
  action: "PENDING" | "APPROVED" | "REJECTED";
  note?: string;
  timestamp?: string;
}

export interface MobiLineAssignment {
  line: AssemblyLine;
  leadOperator: string;
  supportOperators: string[];
  shift: ShiftType;
  targetQty: number;
}

export interface MobiWorkOrder {
  id: string;
  woNumber: string;
  dmrVersion: string;
  productCodes: MobicaseProduct[];
  batchQty: number;
  priority: MobiWOPriority;
  status: MobiWOStatus;
  targetStartDate: string;
  targetEndDate: string;
  createdAt: string;
  createdBy: string;
  deputyId?: string;
  approvedBy?: string;
  approvedAt?: string;
  linkedSalesOrder?: string;
  customerName?: string;
  onHoldReason?: string;
  rmLines: MobiRMLine[];
  approvalLog: MobiApprovalLog[];
  lineAssignments: MobiLineAssignment[];
  deviceIds: string[];
  scrapCount: number;
  reworkCount: number;
  firstPassYield?: number;
  bmrId?: string;
  notes?: string;
}

export const mobiWorkOrders: MobiWorkOrder[] = [
  {
    id: "mwo-001",
    woNumber: "WO-2026-04-001",
    dmrVersion: "DMR-v3.2",
    productCodes: ["MBA", "MBM", "MBC", "CFG", "MCC"],
    batchQty: 5,
    priority: "URGENT",
    status: "IN_PROGRESS",
    targetStartDate: "2026-04-03",
    targetEndDate: "2026-04-30",
    createdAt: "2026-04-01T09:00:00",
    createdBy: "Chetan (Production HOD)",
    deputyId: "op-shubham",
    approvedBy: "Chetan",
    approvedAt: "2026-04-02T10:00:00",
    linkedSalesOrder: "SO-2026-011",
    customerName: "Apollo Diagnostics, Guwahati",
    rmLines: [
      { itemCode: "MLB-ITM-0005", itemName: "PCB Assembly — HA500 Main Board", qtyRequired: 5, qtyIssued: 5, lotNumber: "MLB-BAT-2026-005", issuedAt: "2026-04-03T07:30:00", status: "ISSUED" },
      { itemCode: "MLB-ITM-0006", itemName: "Flow Cell Sensor — Precision Grade", qtyRequired: 5, qtyIssued: 0, status: "SHORTAGE", lotNumber: "MLB-BAT-2026-SEN-RECALL" },
      { itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame — BA200", qtyRequired: 5, qtyIssued: 5, lotNumber: "MLB-BAT-2026-FR-012", issuedAt: "2026-04-03T07:30:00", status: "ISSUED" },
      { itemCode: "MLB-ITM-0003", itemName: "CBC Reagent Kit — 500 Tests", qtyRequired: 5, qtyIssued: 5, lotNumber: "MLB-BAT-2026-CHEM-019", issuedAt: "2026-04-03T07:30:00", status: "ISSUED" },
    ],
    approvalLog: [
      { step: "Production HOD Sign-off", approver: "Chetan", action: "APPROVED", note: "Batch approved. RM to be issued by Stores by 07:30 on start date.", timestamp: "2026-04-02T10:00:00" },
    ],
    lineAssignments: [
      { line: "L1", leadOperator: "Jatin", supportOperators: ["Binsu"], shift: "SHIFT_1", targetQty: 5 },
      { line: "L2", leadOperator: "Rishabh", supportOperators: ["Sanju"], shift: "SHIFT_1", targetQty: 5 },
      { line: "L3", leadOperator: "Shubham", supportOperators: [], shift: "SHIFT_1", targetQty: 5 },
      { line: "L4", leadOperator: "Sanju", supportOperators: ["Saurabh", "Minakshi"], shift: "SHIFT_1", targetQty: 5 },
    ],
    deviceIds: ["MBA-2026-04-0001-0", "MBA-2026-04-0002-0", "MBA-2026-04-0003-0", "MBM-2026-04-0001-0", "MBM-2026-04-0002-0", "MBC-2026-04-0001-0"],
    scrapCount: 0,
    reworkCount: 0,
    bmrId: "bmr-001",
    notes: "Sensor batch MLB-BAT-2026-SEN-RECALL quarantined (ECN-2026-004). Replacement stock requested. L2 on hold pending sensor.",
  },
  {
    id: "mwo-002",
    woNumber: "WO-2026-04-002",
    dmrVersion: "DMR-v2.1",
    productCodes: ["MBA", "MBM", "MBC", "CFG", "MCC"],
    batchQty: 2,
    priority: "NORMAL",
    status: "QC_IN_PROGRESS",
    targetStartDate: "2026-04-04",
    targetEndDate: "2026-04-25",
    createdAt: "2026-04-02T09:00:00",
    createdBy: "Chetan (Production HOD)",
    approvedBy: "Chetan",
    approvedAt: "2026-04-03T09:00:00",
    rmLines: [
      { itemCode: "MLB-ITM-0005", itemName: "PCB Assembly — HA500 Main Board", qtyRequired: 4, qtyIssued: 4, lotNumber: "MLB-BAT-2026-005", issuedAt: "2026-04-04T07:30:00", status: "ISSUED" },
      { itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame — BA200", qtyRequired: 2, qtyIssued: 2, lotNumber: "MLB-BAT-2026-FR-012", issuedAt: "2026-04-04T07:30:00", status: "ISSUED" },
    ],
    approvalLog: [
      { step: "Production HOD Sign-off", approver: "Chetan", action: "APPROVED", timestamp: "2026-04-03T09:00:00" },
    ],
    lineAssignments: [
      { line: "L2", leadOperator: "Rishabh", supportOperators: ["Sanju"], shift: "SHIFT_1", targetQty: 2 },
      { line: "L4", leadOperator: "Shubham", supportOperators: [], shift: "SHIFT_1", targetQty: 2 },
    ],
    deviceIds: ["MBA-2026-04-0201-1", "MBA-2026-04-0202-0"],
    scrapCount: 0,
    reworkCount: 1,
    bmrId: "bmr-002",
    notes: "Unit MBA-2026-04-0201-1 in rework (voltage regulator). Assembly complete for unit 2. QC handover done.",
  },
  {
    id: "mwo-003",
    woNumber: "WO-2026-04-003",
    dmrVersion: "DMR-v3.2",
    productCodes: ["MBA", "MBM", "MBC", "CFG", "MCC"],
    batchQty: 10,
    priority: "CRITICAL",
    status: "PENDING_APPROVAL",
    targetStartDate: "2026-04-20",
    targetEndDate: "2026-05-15",
    createdAt: "2026-04-17T10:00:00",
    createdBy: "Shubham (Deputy HOD)",
    approvalLog: [
      { step: "Production HOD Sign-off", approver: "Chetan", action: "PENDING" },
    ],
    lineAssignments: [],
    rmLines: [
      { itemCode: "MLB-ITM-0005", itemName: "PCB Assembly — HA500 Main Board", qtyRequired: 10, qtyIssued: 0, status: "PENDING" },
      { itemCode: "MLB-ITM-0006", itemName: "Flow Cell Sensor — Precision Grade", qtyRequired: 10, qtyIssued: 0, status: "PENDING" },
      { itemCode: "MLB-ITM-0009", itemName: "Mechanical Frame", qtyRequired: 10, qtyIssued: 0, status: "PENDING" },
    ],
    deviceIds: [],
    scrapCount: 0,
    reworkCount: 0,
    linkedSalesOrder: "SO-2026-014",
    customerName: "Max Healthcare, Delhi",
    notes: "10-unit batch. Awaiting Chetan approval. Sensor stock confirmation needed from procurement first.",
  },
  {
    id: "mwo-004",
    woNumber: "WO-2026-03-004",
    dmrVersion: "DMR-v3.1",
    productCodes: ["MBA", "MBM", "MBC", "CFG", "MCC"],
    batchQty: 1,
    priority: "NORMAL",
    status: "COMPLETED",
    targetStartDate: "2026-03-07",
    targetEndDate: "2026-03-31",
    createdAt: "2026-03-05T09:00:00",
    createdBy: "Chetan (Production HOD)",
    approvedBy: "Chetan",
    approvedAt: "2026-03-06T10:00:00",
    linkedSalesOrder: "SO-2026-008",
    customerName: "Apollo Diagnostics, Kolkata",
    rmLines: [
      { itemCode: "MLB-ITM-0005", itemName: "PCB Assembly — HA500 Main Board", qtyRequired: 1, qtyIssued: 1, lotNumber: "MLB-BAT-2026-004", issuedAt: "2026-03-07T07:30:00", status: "ISSUED" },
    ],
    approvalLog: [
      { step: "Production HOD Sign-off", approver: "Chetan", action: "APPROVED", timestamp: "2026-03-06T10:00:00" },
    ],
    lineAssignments: [
      { line: "L2", leadOperator: "Rishabh", supportOperators: ["Sanju"], shift: "SHIFT_1", targetQty: 1 },
      { line: "L4", leadOperator: "Sanju", supportOperators: [], shift: "SHIFT_1", targetQty: 1 },
    ],
    deviceIds: ["MCC-2026-03-0091-0"],
    scrapCount: 0,
    reworkCount: 0,
    firstPassYield: 100,
    bmrId: "bmr-004",
    notes: "Completed and dispatched. BMR signed by QC HOD on 27-Mar-2026.",
  },
  {
    id: "mwo-005",
    woNumber: "WO-2026-04-005",
    dmrVersion: "DMR-v3.2",
    productCodes: ["MBA"],
    batchQty: 3,
    priority: "NORMAL",
    status: "ON_HOLD",
    targetStartDate: "2026-04-10",
    targetEndDate: "2026-04-22",
    createdAt: "2026-04-08T09:00:00",
    createdBy: "Chetan (Production HOD)",
    approvedBy: "Chetan",
    approvedAt: "2026-04-09T10:00:00",
    onHoldReason: "Sensor batch MLB-BAT-2026-SEN-RECALL quarantined per ECN-2026-004. Waiting for replacement sensor stock from Precision Optics Solutions.",
    rmLines: [
      { itemCode: "MLB-ITM-0006", itemName: "Flow Cell Sensor — Precision Grade", qtyRequired: 3, qtyIssued: 0, status: "SHORTAGE" },
    ],
    approvalLog: [
      { step: "Production HOD Sign-off", approver: "Chetan", action: "APPROVED", timestamp: "2026-04-09T10:00:00" },
    ],
    lineAssignments: [{ line: "L2", leadOperator: "Rishabh", supportOperators: [], shift: "SHIFT_1", targetQty: 3 }],
    deviceIds: [],
    scrapCount: 0,
    reworkCount: 0,
    notes: "ON HOLD — sensor quarantine. Resume after replacement stock cleared by IQC.",
  },
  {
    id: "mwo-006",
    woNumber: "WO-2026-04-006",
    dmrVersion: "DMR-v2.8",
    productCodes: ["CFG"],
    batchQty: 2,
    priority: "NORMAL",
    status: "APPROVED",
    targetStartDate: "2026-04-20",
    targetEndDate: "2026-05-05",
    createdAt: "2026-04-18T09:00:00",
    createdBy: "Chetan (Production HOD)",
    approvedBy: "Chetan",
    approvedAt: "2026-04-19T08:30:00",
    linkedSalesOrder: "SO-FD-2026-019",
    customerName: "Fortis Diagnostics, Pune",
    rmLines: [
      { itemCode: "MLB-ITM-0012", itemName: "Centrifuge Motor Assembly", qtyRequired: 2, qtyIssued: 2, status: "ISSUED" },
      { itemCode: "MLB-ITM-0013", itemName: "CFG Battery Pack", qtyRequired: 2, qtyIssued: 2, status: "ISSUED" },
    ],
    approvalLog: [
      { step: "Production HOD Sign-off", approver: "Chetan", action: "APPROVED", timestamp: "2026-04-19T08:30:00" },
    ],
    lineAssignments: [{ line: "L5", leadOperator: "Rishabh", supportOperators: [], shift: "SHIFT_1", targetQty: 2 }],
    deviceIds: [],
    scrapCount: 0,
    reworkCount: 0,
    notes: "CFG units for Fortis Diagnostics Pune order.",
  },
];

// ─── Stage Logs (Shop Floor) ──────────────────────────────────────────────────

export interface MobiStageLog {
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  line: AssemblyLine;
  stageTemplateId: string;
  stageName: string;
  stageSequence: number;
  deviceId?: string;
  operator: string;
  shift: ShiftType;
  plannedStartAt: string;
  actualStartAt?: string;
  completedAt?: string;
  waitTimeMin?: number;      // time between prev stage complete → this stage actual start
  cycleTimeMin?: number;     // actual duration
  stdTimeMin: number;
  qtyCompleted: number;
  qtyScrap: number;
  status: "PENDING" | "IN_PROGRESS" | "QC_GATE_PENDING" | "COMPLETED" | "QC_FAIL" | "ON_HOLD";
  qcResult?: "PASS" | "FAIL";
  qcInspector?: string;
  fixtureId?: string;        // L2 QC Analyser
  firmwareVersion?: string;  // L1 Programming stage
  ocGapMm?: number;          // OC Assembly measurement
  measurementData?: Record<string, string>;
  reworkReason?: string;
  notes?: string;
}

export const mobiStageLogs: MobiStageLog[] = [
  // WO-2026-04-001 — L1 MBM
  { id: "sl-001", workOrderId: "mwo-001", workOrderNumber: "WO-2026-04-001", line: "L1", stageTemplateId: "lst-l1-1", stageName: "Motor & Scotch Assembly", stageSequence: 1, operator: "Jatin", shift: "SHIFT_1", plannedStartAt: "2026-04-03T08:00:00", actualStartAt: "2026-04-03T08:05:00", completedAt: "2026-04-03T08:35:00", waitTimeMin: 5, cycleTimeMin: 30, stdTimeMin: 25, qtyCompleted: 5, qtyScrap: 0, status: "COMPLETED" },
  { id: "sl-002", workOrderId: "mwo-001", workOrderNumber: "WO-2026-04-001", line: "L1", stageTemplateId: "lst-l1-4", stageName: "PCB Rework & QC", stageSequence: 4, operator: "Sanju", shift: "SHIFT_1", plannedStartAt: "2026-04-03T09:00:00", actualStartAt: "2026-04-03T09:15:00", completedAt: "2026-04-03T11:45:00", waitTimeMin: 15, cycleTimeMin: 150, stdTimeMin: 125, qtyCompleted: 5, qtyScrap: 0, status: "COMPLETED", qcResult: "PASS", qcInspector: "Dr. Sunit Bhuyan (QC HOD)" },
  { id: "sl-003", workOrderId: "mwo-001", workOrderNumber: "WO-2026-04-001", line: "L1", stageTemplateId: "lst-l1-6", stageName: "QC Mixer", stageSequence: 6, operator: "Jatin", shift: "SHIFT_1", plannedStartAt: "2026-04-03T13:00:00", actualStartAt: "2026-04-03T13:30:00", completedAt: "2026-04-03T16:00:00", waitTimeMin: 30, cycleTimeMin: 150, stdTimeMin: 150, qtyCompleted: 5, qtyScrap: 0, status: "COMPLETED", qcResult: "PASS", qcInspector: "Shubham (QC)" },
  // WO-2026-04-001 — L2 MBA
  { id: "sl-004", workOrderId: "mwo-001", workOrderNumber: "WO-2026-04-001", line: "L2", stageTemplateId: "lst-l2-1", stageName: "PCB Rework & QC", stageSequence: 1, deviceId: "MBA-2026-04-0001-0", operator: "Sanju", shift: "SHIFT_1", plannedStartAt: "2026-04-04T08:00:00", actualStartAt: "2026-04-04T08:10:00", completedAt: "2026-04-04T10:15:00", waitTimeMin: 10, cycleTimeMin: 125, stdTimeMin: 125, qtyCompleted: 3, qtyScrap: 0, status: "COMPLETED", qcResult: "PASS", qcInspector: "Sanju (QC)" },
  { id: "sl-005", workOrderId: "mwo-001", workOrderNumber: "WO-2026-04-001", line: "L2", stageTemplateId: "lst-l2-2", stageName: "OC Assembly", stageSequence: 2, deviceId: "MBA-2026-04-0001-0", operator: "Rishabh", shift: "SHIFT_1", plannedStartAt: "2026-04-06T08:00:00", actualStartAt: "2026-04-06T08:00:00", completedAt: "2026-04-06T09:00:00", waitTimeMin: 0, cycleTimeMin: 18, stdTimeMin: 18, qtyCompleted: 3, qtyScrap: 0, status: "COMPLETED", ocGapMm: 0.12, measurementData: { "OC Gap Unit 1": "0.12mm", "OC Gap Unit 2": "0.11mm", "OC Gap Unit 3": "0.13mm" } },
  { id: "sl-006", workOrderId: "mwo-001", workOrderNumber: "WO-2026-04-001", line: "L2", stageTemplateId: "lst-l2-4", stageName: "QC Analyser", stageSequence: 4, deviceId: "MBA-2026-04-0001-0", operator: "Rishabh", shift: "SHIFT_1", plannedStartAt: "2026-04-07T08:00:00", actualStartAt: "2026-04-07T08:30:00", stdTimeMin: 540, qtyCompleted: 0, qtyScrap: 0, status: "ON_HOLD", fixtureId: "FIXTURE-QCA-001", waitTimeMin: 30, notes: "ON HOLD — sensor batch recall. Awaiting replacement sensors." },
  // WO-2026-04-002 — L2 MBA (rework unit)
  { id: "sl-007", workOrderId: "mwo-002", workOrderNumber: "WO-2026-04-002", line: "L2", stageTemplateId: "lst-l2-1", stageName: "PCB Rework & QC", stageSequence: 1, deviceId: "MBA-2026-04-0201-1", operator: "Sanju", shift: "SHIFT_1", plannedStartAt: "2026-04-05T08:00:00", actualStartAt: "2026-04-05T08:00:00", completedAt: "2026-04-06T14:00:00", waitTimeMin: 0, cycleTimeMin: 360, stdTimeMin: 250, qtyCompleted: 2, qtyScrap: 0, status: "COMPLETED", qcResult: "PASS", qcInspector: "Shubham (QC)" },
  { id: "sl-008", workOrderId: "mwo-002", workOrderNumber: "WO-2026-04-002", line: "L2", stageTemplateId: "lst-l2-4", stageName: "QC Analyser — Electrical Testing", stageSequence: 4, deviceId: "MBA-2026-04-0201-1", operator: "Rishabh", shift: "SHIFT_1", plannedStartAt: "2026-04-12T09:00:00", actualStartAt: "2026-04-12T09:00:00", completedAt: "2026-04-12T11:30:00", waitTimeMin: 0, cycleTimeMin: 150, stdTimeMin: 180, qtyCompleted: 1, qtyScrap: 0, status: "QC_FAIL", qcResult: "FAIL", qcInspector: "Shubham (QC)", reworkReason: "Voltage regulator output below spec (3.3V rail: 2.97V, 5V rail: 4.68V). NCR-2026-0032 raised.", fixtureId: "FIXTURE-QCA-002" },
];

// ─── Scrap Log ────────────────────────────────────────────────────────────────

export interface ScrapEntry {
  id: string;
  scrapNumber: string;
  workOrderId: string;
  workOrderNumber: string;
  line: AssemblyLine;
  stageName: string;
  deviceId?: string;
  itemCode: string;
  itemName: string;
  qtyScrap: number;
  rootCause: ScrapRootCause;
  rootCauseDescription: string;
  materialType: "ELECTRONIC" | "PLASTIC" | "METAL" | "HAZARDOUS" | "OTHER";
  operator: string;
  scrapValueINR: number;
  autoCAPATriggered: boolean;
  linkedCAPANumber?: string;
  scrappedAt: string;
  approvedBy: string;
  notes?: string;
}

export const scrapEntries: ScrapEntry[] = [
  {
    id: "scr-001",
    scrapNumber: "SCRAP-2026-0041",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    line: "L2",
    stageName: "OC Assembly",
    deviceId: "MBA-2026-03-0035-0",
    itemCode: "MLB-ITM-0006",
    itemName: "Flow Cell Sensor — Precision Grade",
    qtyScrap: 20,
    rootCause: "INCOMING_MATERIAL",
    rootCauseDescription: "Entire batch MLB-BAT-2026-SEN-RECALL scrapped/returned. Systematic calibration drift detected — sensitivity below 98.5% at 500 cells/µL. 20 units quarantined and returned to vendor.",
    materialType: "ELECTRONIC",
    operator: "Chetan (Production HOD)",
    scrapValueINR: 420000,
    autoCAPATriggered: true,
    linkedCAPANumber: "CAPA-2026-0018",
    scrappedAt: "2026-04-15T18:00:00",
    approvedBy: "Chetan (Production HOD)",
    notes: "Return to vendor. Debit note to be raised by Finance.",
  },
  {
    id: "scr-002",
    scrapNumber: "SCRAP-2026-0035",
    workOrderId: "mwo-003",
    workOrderNumber: "WO-2026-03-003",
    line: "L2",
    stageName: "OC Assembly",
    deviceId: "MBA-2026-03-0035-0",
    itemCode: "MLB-ASSY-OC",
    itemName: "Optical Core Sub-Assembly",
    qtyScrap: 3,
    rootCause: "OC_FITMENT",
    rootCauseDescription: "OC fitment gap out of specification (measured 0.18–0.22mm vs spec 0.10–0.15mm). Jig not in use at the time — pre-CAPA-2026-0015. Unit reworked 3× and scrapped after limit exceeded.",
    materialType: "ELECTRONIC",
    operator: "Sanju",
    scrapValueINR: 96000,
    autoCAPATriggered: true,
    linkedCAPANumber: "CAPA-2026-0015",
    scrappedAt: "2026-03-22T16:00:00",
    approvedBy: "Chetan (Production HOD)",
    notes: "Triggered CAPA-2026-0015 for OC jig introduction. 3 units scrapped from batch PID-2026-035.",
  },
  {
    id: "scr-003",
    scrapNumber: "SCRAP-2026-0032",
    workOrderId: "mwo-002",
    workOrderNumber: "WO-2026-04-002",
    line: "L2",
    stageName: "PCB Rework & QC",
    deviceId: "MBA-2026-04-0201-1",
    itemCode: "MLB-ITM-0005",
    itemName: "PCB Assembly — HA500 Main Board",
    qtyScrap: 1,
    rootCause: "PCB_ASSEMBLY_ERROR",
    rootCauseDescription: "Wrong-value voltage regulator (LM317 instead of LM7805) supplied in batch MLB-BAT-2026-VR-003 by PCBTech India. 3.3V rail output 2.97V (spec: 3.2V–3.4V).",
    materialType: "ELECTRONIC",
    operator: "Sanju",
    scrapValueINR: 18500,
    autoCAPATriggered: true,
    linkedCAPANumber: "CAPA-2026-0017",
    scrappedAt: "2026-04-12T15:00:00",
    approvedBy: "Chetan (Production HOD)",
    notes: "Component replaced. Unit reworked. CAPA raised for vendor corrective action.",
  },
];

// ─── BMR — Batch Manufacturing Records ───────────────────────────────────────

export interface BMRSection {
  sectionName: string;
  status: "COMPLETE" | "INCOMPLETE" | "PENDING";
  completedBy?: string;
  completedAt?: string;
}

export interface BMR {
  id: string;
  bmrNumber: string;
  workOrderId: string;
  workOrderNumber: string;
  dmrVersion: string;
  productName: string;
  batchQty: number;
  startDate: string;
  endDate?: string;
  status: BMRStatus;
  productionHODSign?: string;
  productionHODSignAt?: string;
  qcHODSign?: string;
  qcHODSignAt?: string;
  passQty: number;
  failQty: number;
  scrapQty: number;
  firstPassYield?: number;
  sections: BMRSection[];
  auditTrailEntries: number;
  notes?: string;
}

export const bmrRecords: BMR[] = [
  {
    id: "bmr-001",
    bmrNumber: "BMR-2026-04-001",
    workOrderId: "mwo-001",
    workOrderNumber: "WO-2026-04-001",
    dmrVersion: "DMR-v3.2",
    productName: "Mobicase Diagnostic Suite (MBA+MBM+MBC+MCC)",
    batchQty: 5,
    startDate: "2026-04-03",
    status: "DRAFT",
    passQty: 0,
    failQty: 0,
    scrapQty: 0,
    sections: [
      { sectionName: "Header & DMR Reference", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-03T08:00:00" },
      { sectionName: "RM Issue & Lot Record", status: "INCOMPLETE", completedBy: undefined },
      { sectionName: "RM QC Results", status: "PENDING" },
      { sectionName: "Device ID Genealogy", status: "PENDING" },
      { sectionName: "Equipment Calibration Log", status: "PENDING" },
      { sectionName: "Assembly Line Summaries (L1–L4)", status: "INCOMPLETE" },
      { sectionName: "Scrap Consolidated Log", status: "PENDING" },
      { sectionName: "CAPA References", status: "PENDING" },
      { sectionName: "Extra Material Variance Log", status: "PENDING" },
      { sectionName: "QC Handover Certificate", status: "PENDING" },
      { sectionName: "Final QC Results", status: "PENDING" },
      { sectionName: "Audit Trail", status: "PENDING" },
    ],
    auditTrailEntries: 12,
    notes: "BMR in progress. WO blocked on sensor quarantine. Sections will be completed as production progresses.",
  },
  {
    id: "bmr-002",
    bmrNumber: "BMR-2026-04-002",
    workOrderId: "mwo-002",
    workOrderNumber: "WO-2026-04-002",
    dmrVersion: "DMR-v2.1",
    productName: "Mobicase Diagnostic Suite (MBA+MBM+MBC+MCC)",
    batchQty: 2,
    startDate: "2026-04-04",
    status: "PRODUCTION_SIGNED",
    productionHODSign: "Chetan",
    productionHODSignAt: "2026-04-16T17:00:00",
    passQty: 1,
    failQty: 1,
    scrapQty: 0,
    firstPassYield: 50,
    sections: [
      { sectionName: "Header & DMR Reference", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-04T08:00:00" },
      { sectionName: "RM Issue & Lot Record", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-04T08:30:00" },
      { sectionName: "RM QC Results", status: "COMPLETE", completedBy: "Dr. Sunit Bhuyan", completedAt: "2026-04-10T17:00:00" },
      { sectionName: "Device ID Genealogy", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-16T16:00:00" },
      { sectionName: "Equipment Calibration Log", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-16T16:00:00" },
      { sectionName: "Assembly Line Summaries (L1–L4)", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-16T16:30:00" },
      { sectionName: "Scrap Consolidated Log", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-16T16:30:00" },
      { sectionName: "CAPA References", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-16T16:45:00" },
      { sectionName: "Extra Material Variance Log", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-04-16T16:45:00" },
      { sectionName: "QC Handover Certificate", status: "COMPLETE", completedBy: "Dr. Sunit Bhuyan", completedAt: "2026-04-16T17:00:00" },
      { sectionName: "Final QC Results", status: "INCOMPLETE" },
      { sectionName: "Audit Trail", status: "COMPLETE", completedBy: "System", completedAt: "2026-04-16T17:00:00" },
    ],
    auditTrailEntries: 34,
    notes: "Production sign-off complete. Awaiting QC HOD final sign-off after Final QC.",
  },
  {
    id: "bmr-004",
    bmrNumber: "BMR-2026-03-004",
    workOrderId: "mwo-004",
    workOrderNumber: "WO-2026-03-004",
    dmrVersion: "DMR-v3.1",
    productName: "Mobicase Diagnostic Suite (MBA+MBM+MBC+MCC)",
    batchQty: 1,
    startDate: "2026-03-07",
    endDate: "2026-03-27",
    status: "CLOSED",
    productionHODSign: "Chetan",
    productionHODSignAt: "2026-03-26T16:00:00",
    qcHODSign: "Dr. Sunit Bhuyan",
    qcHODSignAt: "2026-03-27T14:00:00",
    passQty: 1,
    failQty: 0,
    scrapQty: 0,
    firstPassYield: 100,
    sections: [
      { sectionName: "Header & DMR Reference", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-07T08:00:00" },
      { sectionName: "RM Issue & Lot Record", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-07T08:30:00" },
      { sectionName: "RM QC Results", status: "COMPLETE", completedBy: "Dr. Sunit Bhuyan", completedAt: "2026-03-08T17:00:00" },
      { sectionName: "Device ID Genealogy", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-26T15:00:00" },
      { sectionName: "Equipment Calibration Log", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-26T15:30:00" },
      { sectionName: "Assembly Line Summaries (L1–L4)", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-26T16:00:00" },
      { sectionName: "Scrap Consolidated Log", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-26T16:00:00" },
      { sectionName: "CAPA References", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-26T16:00:00" },
      { sectionName: "Extra Material Variance Log", status: "COMPLETE", completedBy: "Chetan", completedAt: "2026-03-26T16:00:00" },
      { sectionName: "QC Handover Certificate", status: "COMPLETE", completedBy: "Dr. Sunit Bhuyan", completedAt: "2026-03-26T17:00:00" },
      { sectionName: "Final QC Results", status: "COMPLETE", completedBy: "Dr. Sunit Bhuyan", completedAt: "2026-03-27T14:00:00" },
      { sectionName: "Audit Trail", status: "COMPLETE", completedBy: "System", completedAt: "2026-03-27T14:00:00" },
    ],
    auditTrailEntries: 58,
    notes: "BMR closed. 100% FPY. Dispatched to Apollo Diagnostics Kolkata.",
  },
];

// ─── Downtime Log ─────────────────────────────────────────────────────────────

export interface DowntimeEntry {
  id: string;
  downtimeNumber: string;
  workOrderId?: string;
  line: AssemblyLine;
  category: DowntimeCategory;
  description: string;
  startedAt: string;
  resolvedAt?: string;
  durationHours?: number;
  reportedBy: string;
  resolvedBy?: string;
  impactedUnits?: number;
}

export const downtimeEntries: DowntimeEntry[] = [
  {
    id: "dt-001",
    downtimeNumber: "DT-2026-0041",
    workOrderId: "mwo-001",
    line: "L2",
    category: "RM_DELAY_QUALITY",
    description: "Flow Cell Sensor batch MLB-BAT-2026-SEN-RECALL quarantined after IQC failure. L2 QC Analyser stage blocked. Replacement stock ordered from vendor.",
    startedAt: "2026-04-15T17:00:00",
    reportedBy: "Chetan (Production HOD)",
    impactedUnits: 5,
  },
  {
    id: "dt-002",
    downtimeNumber: "DT-2026-0038",
    workOrderId: "mwo-002",
    line: "L2",
    category: "REWORK_HOLD",
    description: "Unit MBA-2026-04-0201-1 on QC_HOLD pending voltage regulator replacement. L2 line partially blocked for 1 unit.",
    startedAt: "2026-04-12T12:00:00",
    reportedBy: "Shubham (QC)",
    impactedUnits: 1,
  },
  {
    id: "dt-003",
    downtimeNumber: "DT-2026-0030",
    line: "L2",
    category: "EQUIPMENT_FAILURE",
    description: "QC Fixture FIXTURE-QCA-002 calibration flag — Fluke 87V multimeter overdue for calibration. Electrical testing measurements flagged. Sent for calibration.",
    startedAt: "2026-04-15T08:00:00",
    resolvedAt: "2026-04-16T14:00:00",
    durationHours: 30,
    reportedBy: "Rishabh (Production)",
    resolvedBy: "NABL Lab (Guwahati)",
    impactedUnits: 0,
  },
];

// ─── OEE Snapshot ─────────────────────────────────────────────────────────────

export interface OEERecord {
  id: string;
  date: string;
  shift: ShiftType;
  line: AssemblyLine;
  availableHours: number;
  downtimeHours: number;
  availability: number;       // %
  theoreticalUnits: number;
  actualUnits: number;
  performance: number;        // %
  unitsStarted: number;
  unitsPassedFPY: number;
  quality: number;            // %
  oee: number;                // %
}

export const oeeRecords: OEERecord[] = [
  { id: "oee-001", date: "2026-04-03", shift: "SHIFT_1", line: "L1", availableHours: 8, downtimeHours: 0, availability: 100, theoreticalUnits: 5, actualUnits: 5, performance: 100, unitsStarted: 5, unitsPassedFPY: 5, quality: 100, oee: 100 },
  { id: "oee-002", date: "2026-04-04", shift: "SHIFT_1", line: "L2", availableHours: 8, downtimeHours: 0, availability: 100, theoreticalUnits: 2, actualUnits: 2, performance: 100, unitsStarted: 2, unitsPassedFPY: 1, quality: 50, oee: 50 },
  { id: "oee-003", date: "2026-04-15", shift: "SHIFT_1", line: "L2", availableHours: 8, downtimeHours: 8, availability: 0, theoreticalUnits: 2, actualUnits: 0, performance: 0, unitsStarted: 0, unitsPassedFPY: 0, quality: 0, oee: 0 },
  { id: "oee-004", date: "2026-03-27", shift: "SHIFT_1", line: "L4", availableHours: 8, downtimeHours: 0.5, availability: 94, theoreticalUnits: 10, actualUnits: 9, performance: 90, unitsStarted: 1, unitsPassedFPY: 1, quality: 100, oee: 84 },
];

// ─── COPQ Snapshot ─────────────────────────────────────────────────────────────

export interface COPQRecord {
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  batchQty: number;
  scrapCostINR: number;
  reworkLabourCostINR: number;
  appraisalCostINR: number;
  preventionCostINR: number;
  totalCOPQINR: number;
  standardBatchCostINR: number;
  copqPercent: number;
}

export const copqRecords: COPQRecord[] = [
  { id: "copq-001", workOrderId: "mwo-001", workOrderNumber: "WO-2026-04-001", batchQty: 5, scrapCostINR: 420000, reworkLabourCostINR: 0, appraisalCostINR: 12000, preventionCostINR: 5000, totalCOPQINR: 437000, standardBatchCostINR: 1071650, copqPercent: 40.8 },
  { id: "copq-002", workOrderId: "mwo-002", workOrderNumber: "WO-2026-04-002", batchQty: 2, scrapCostINR: 18500, reworkLabourCostINR: 8000, appraisalCostINR: 8000, preventionCostINR: 2000, totalCOPQINR: 36500, standardBatchCostINR: 428660, copqPercent: 8.5 },
  { id: "copq-004", workOrderId: "mwo-004", workOrderNumber: "WO-2026-03-004", batchQty: 1, scrapCostINR: 0, reworkLabourCostINR: 0, appraisalCostINR: 4000, preventionCostINR: 1000, totalCOPQINR: 5000, standardBatchCostINR: 214330, copqPercent: 2.3 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getMobiWOById(id: string): MobiWorkOrder | undefined {
  return mobiWorkOrders.find((w) => w.id === id);
}

export function getDeviceIDsByWO(workOrderId: string): MobiDeviceID[] {
  return mobiDeviceIDs.filter((d) => d.workOrderId === workOrderId);
}

export function getStageLogsByWO(workOrderId: string): MobiStageLog[] {
  return mobiStageLogs.filter((s) => s.workOrderId === workOrderId);
}

export function getScrapByWO(workOrderId: string): ScrapEntry[] {
  return scrapEntries.filter((s) => s.workOrderId === workOrderId);
}

export function getActiveWOs(): MobiWorkOrder[] {
  const inactive = ["COMPLETED", "CANCELLED"];
  return mobiWorkOrders.filter((w) => !inactive.includes(w.status));
}

export function getOnHoldWOs(): MobiWorkOrder[] {
  return mobiWorkOrders.filter((w) => w.status === "ON_HOLD");
}

export function getWOProgress(wo: MobiWorkOrder): number {
  const statusOrder: MobiWOStatus[] = [
    "DRAFT", "PENDING_APPROVAL", "APPROVED", "PENDING_RM", "RM_ISSUED",
    "RM_QC_IN_PROGRESS", "IN_PROGRESS", "ASSEMBLY_COMPLETE",
    "QC_HANDOVER_PENDING", "QC_IN_PROGRESS", "QC_COMPLETED", "COMPLETED",
  ];
  const idx = statusOrder.indexOf(wo.status);
  if (idx < 0) return 0;
  return Math.round((idx / (statusOrder.length - 1)) * 100);
}

export function getOEEAvg(): number {
  if (oeeRecords.length === 0) return 0;
  const valid = oeeRecords.filter((o) => o.oee > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((s, o) => s + o.oee, 0) / valid.length);
}

export function getTotalScrapValue(): number {
  return scrapEntries.reduce((s, e) => s + e.scrapValueINR, 0);
}

export function getBMRById(id: string): BMR | undefined {
  return bmrRecords.find((b) => b.id === id);
}

export function getOperatorById(id: string): MobiOperator | undefined {
  return mobiOperators.find((o) => o.id === id);
}

export function isWOOverdue(wo: MobiWorkOrder): boolean {
  if (wo.status === "COMPLETED" || wo.status === "CANCELLED") return false;
  return new Date(wo.targetEndDate) < new Date("2026-04-17");
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

// ─── Device vs Module Classification ──────────────────────────────────────────
// Canonical rule: only MCC (the final Mobicase) is a finished Device.
// MCC is composed of exactly FOUR modules:
//   MBA  (Analyser)  — manufactured in-house on L2
//   MBM  (Mobimix)   — manufactured in-house on L1
//   MBC  (Mobicube)  — manufactured in-house on L3
//   CFG  (Centrifuge) — VENDOR-SOURCED (purchased ready-made, scanned in
//                        by vendor lot ID; no in-house production steps)
// Use these helpers everywhere — do NOT redefine locally.

export const DEVICE_PRODUCT_CODES: readonly MobicaseProduct[] = ["MCC"] as const;
export const MODULE_PRODUCT_CODES: readonly MobicaseProduct[] = ["MBA", "MBM", "MBC", "CFG"] as const;

/**
 * MCC BOM — the canonical 4-module composition.
 * Every MCC device consumes exactly one of each of these modules.
 */
export const MCC_MODULE_BOM: readonly MobicaseProduct[] = ["MBA", "MBM", "MBC", "CFG"] as const;

/**
 * Module sourcing model: in-house (manufactured on one of our lines)
 * vs vendor (externally purchased, scanned in by vendor lot ID).
 */
export const VENDOR_SOURCED_PRODUCT_CODES: readonly MobicaseProduct[] = ["CFG"] as const;

export function isFinishedDeviceCode(code: MobicaseProduct): boolean {
  return DEVICE_PRODUCT_CODES.includes(code);
}

export function isModuleCode(code: MobicaseProduct): boolean {
  return !DEVICE_PRODUCT_CODES.includes(code);
}

/**
 * Is this product externally purchased from a vendor (vs manufactured in-house)?
 * Currently only CFG (Centrifuge) is vendor-sourced — we buy them ready-made
 * and integrate them into the MCC device.
 */
export function isVendorSourcedCode(code: MobicaseProduct): boolean {
  return VENDOR_SOURCED_PRODUCT_CODES.includes(code);
}

/** "In-house" vs "Vendor" label for a module code. */
export function getSourcingLabel(code: MobicaseProduct): "In-house" | "Vendor" {
  return isVendorSourcedCode(code) ? "Vendor" : "In-house";
}

export function isFinishedDevice(d: Pick<MobiDeviceID, "productCode">): boolean {
  return isFinishedDeviceCode(d.productCode);
}

export function isModule(d: Pick<MobiDeviceID, "productCode">): boolean {
  return isModuleCode(d.productCode);
}

export type UnitKind = "DEVICE" | "MODULE";

export function getUnitKind(code: MobicaseProduct): UnitKind {
  return isFinishedDeviceCode(code) ? "DEVICE" : "MODULE";
}

export function getUnitKindLabel(code: MobicaseProduct): "Device" | "Module" {
  return isFinishedDeviceCode(code) ? "Device" : "Module";
}

export function getUnitKindLabelPlural(code: MobicaseProduct): "Devices" | "Modules" {
  return isFinishedDeviceCode(code) ? "Devices" : "Modules";
}
