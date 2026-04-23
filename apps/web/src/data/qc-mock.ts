// ─── QC / Quality Assurance Module — Instigenie Manufacturing ────────────────────
// ISO 13485 compliant QC flows: AQL Incoming → WIP Gates → Final Batch QC
// Products: MBA (Analyser), MBM (Mobimix), MBC (Mobicube/Incubator), MCC (Mobicase Final)
// Lines: L1 (Mobimix/MBM), L2 (Analyser/MBA), L3 (Incubator/MBC), L4 (Final Assembly), L5 (Final Device QC)

// ─── Enums & Types ────────────────────────────────────────────────────────────

export type InspectionStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "PASSED"
  | "FAILED"
  | "AQL_PASSED"
  | "AQL_FAILED"
  | "ON_HOLD"
  | "PENDING_COUNTERSIGN"
  | "CLOSED";

export type AQLResult = "ACCEPT" | "REJECT" | "MARGINAL";
export type CheckResult = "PASS" | "FAIL" | "NA";
export type CheckSeverity = "CRITICAL" | "MAJOR" | "MINOR";
export type CheckCategory = "DIMENSIONAL" | "ELECTRICAL" | "VISUAL" | "FUNCTIONAL" | "DOCUMENTATION" | "SAFETY";

export type NCRStatus = "OPEN" | "INVESTIGATING" | "PENDING_CAPA" | "CAPA_RAISED" | "CLOSED" | "REJECTED";
export type NCRSeverity = "CRITICAL" | "MAJOR" | "MINOR";
export type NCRSource = "INCOMING_QC" | "WIP_INSPECTION" | "FINAL_QC" | "CUSTOMER_COMPLAINT" | "AUDIT";

export type CAPAStatus = "OPEN" | "ROOT_CAUSE_IDENTIFIED" | "ACTION_PLAN_APPROVED" | "IN_PROGRESS" | "VERIFICATION_PENDING" | "CLOSED" | "OVERDUE";
export type CAPAType = "CORRECTIVE" | "PREVENTIVE";
export type RootCauseMethod = "5_WHY" | "ISHIKAWA" | "FAULT_TREE" | "8D";

export type EquipmentStatus = "CALIBRATED" | "CALIBRATION_DUE" | "CALIBRATION_OVERDUE" | "OUT_OF_SERVICE" | "UNDER_REPAIR";
export type EquipmentCategory = "TEST_EQUIPMENT" | "MEASURING_INSTRUMENT" | "FIXTURE" | "PRODUCTION_TOOL";

export type WIPLine = "L1" | "L2" | "L3" | "L4" | "L5";

// ─── Incoming RM QC Inspections (AQL-Based) ───────────────────────────────────

export interface AQLMeasurement {
  checkId: string;
  checkName: string;
  specification: string;
  unit: string;
  measuredValues: number[];
  lowerLimit?: number;
  upperLimit?: number;
  category: CheckCategory;
  severity: CheckSeverity;
  result: CheckResult;
  remarks?: string;
}

export interface IncomingQCInspection {
  id: string;
  inspectionNumber: string;
  grnNumber: string;
  poNumber: string;
  vendorName: string;
  vendorCode: string;
  itemCode: string;
  itemName: string;
  batchLotNumber: string;
  qtyReceived: number;
  qtySampled: number;
  aqlLevel: string;
  acceptNumber: number;
  rejectNumber: number;
  defectsFound: number;
  aqlResult: AQLResult;
  status: InspectionStatus;
  inspectedBy: string;
  inspectionDate: string;
  completedAt?: string;
  measurements: AQLMeasurement[];
  overallResult: "PASS" | "FAIL" | null;
  linkedNCRId?: string;
  notes?: string;
}

export const incomingInspections: IncomingQCInspection[] = [
  {
    id: "inq-001",
    inspectionNumber: "IQC-2026-0041",
    grnNumber: "GRN-2026-0089",
    poNumber: "PO-2026-0234",
    vendorName: "PCBTech India Pvt. Ltd.",
    vendorCode: "VND-PCB-001",
    itemCode: "MLB-ITM-0005",
    itemName: "PCB Assembly — HA500 Main Board",
    batchLotNumber: "MLB-BAT-2026-005",
    qtyReceived: 50,
    qtySampled: 8,
    aqlLevel: "AQL 1.0 Level II",
    acceptNumber: 0,
    rejectNumber: 1,
    defectsFound: 0,
    aqlResult: "ACCEPT",
    status: "PASSED",
    inspectedBy: "Sanju (QC)",
    inspectionDate: "2026-04-10",
    completedAt: "2026-04-10T14:30:00",
    overallResult: "PASS",
    measurements: [
      {
        checkId: "chk-001",
        checkName: "Board Dimensions",
        specification: "150mm × 100mm ± 0.5mm",
        unit: "mm",
        measuredValues: [150.1, 149.9, 150.2, 150.0, 149.8, 150.1, 150.3, 150.0],
        lowerLimit: 149.5,
        upperLimit: 150.5,
        category: "DIMENSIONAL",
        severity: "MAJOR",
        result: "PASS",
        remarks: "All 8 samples within tolerance",
      },
      {
        checkId: "chk-002",
        checkName: "Visual Inspection — Solder Quality",
        specification: "No cold joints, bridges, or missing components per IPC-A-610",
        unit: "visual",
        measuredValues: [],
        category: "VISUAL",
        severity: "CRITICAL",
        result: "PASS",
        remarks: "Clean solder on all samples. No defects observed.",
      },
      {
        checkId: "chk-003",
        checkName: "Continuity Test — Power Rail",
        specification: "Resistance < 0.5 Ω on 3.3V and 5V rails",
        unit: "Ω",
        measuredValues: [0.12, 0.15, 0.11, 0.14, 0.13, 0.12, 0.16, 0.11],
        upperLimit: 0.5,
        category: "ELECTRICAL",
        severity: "CRITICAL",
        result: "PASS",
      },
      {
        checkId: "chk-004",
        checkName: "Component Count Verification",
        specification: "BOM v3 component count: 47 components",
        unit: "count",
        measuredValues: [47, 47, 47, 47, 47, 47, 47, 47],
        lowerLimit: 47,
        upperLimit: 47,
        category: "VISUAL",
        severity: "MAJOR",
        result: "PASS",
      },
      {
        checkId: "chk-005",
        checkName: "CoC Document Check",
        specification: "Vendor CoC must be present with batch number matching GRN",
        unit: "document",
        measuredValues: [],
        category: "DOCUMENTATION",
        severity: "MAJOR",
        result: "PASS",
        remarks: "CoC attached — Cert No. PCBT-2026-00112",
      },
    ],
    notes: "All 8 samples passed. Batch cleared for production.",
  },
  {
    id: "inq-002",
    inspectionNumber: "IQC-2026-0042",
    grnNumber: "GRN-2026-0090",
    poNumber: "PO-2026-0235",
    vendorName: "Precision Optics Solutions",
    vendorCode: "VND-OPT-003",
    itemCode: "MLB-ITM-0006",
    itemName: "Flow Cell Sensor — Precision Grade",
    batchLotNumber: "MLB-BAT-2026-SEN-RECALL",
    qtyReceived: 20,
    qtySampled: 5,
    aqlLevel: "AQL 1.0 Level II",
    acceptNumber: 0,
    rejectNumber: 1,
    defectsFound: 2,
    aqlResult: "REJECT",
    status: "FAILED",
    inspectedBy: "Shubham (QC)",
    inspectionDate: "2026-04-15",
    completedAt: "2026-04-15T16:45:00",
    overallResult: "FAIL",
    linkedNCRId: "ncr-001",
    measurements: [
      {
        checkId: "chk-010",
        checkName: "Optical Sensitivity at Low Cell Count",
        specification: "Sensitivity ≥ 98.5% at 500 cells/µL",
        unit: "%",
        measuredValues: [98.7, 96.2, 98.9, 95.8, 98.5],
        lowerLimit: 98.5,
        category: "FUNCTIONAL",
        severity: "CRITICAL",
        result: "FAIL",
        remarks: "Units 2 and 4 failed — calibration drift. Values 96.2% and 95.8% below 98.5% minimum.",
      },
      {
        checkId: "chk-011",
        checkName: "Dimensional — Optical Aperture",
        specification: "Aperture diameter 2.00mm ± 0.02mm",
        unit: "mm",
        measuredValues: [2.00, 2.01, 1.99, 2.02, 2.00],
        lowerLimit: 1.98,
        upperLimit: 2.02,
        category: "DIMENSIONAL",
        severity: "CRITICAL",
        result: "PASS",
        remarks: "All within tolerance",
      },
      {
        checkId: "chk-012",
        checkName: "Response Time",
        specification: "Response time ≤ 120ms",
        unit: "ms",
        measuredValues: [88, 134, 91, 127, 85],
        upperLimit: 120,
        category: "FUNCTIONAL",
        severity: "MAJOR",
        result: "FAIL",
        remarks: "Units 2 and 4: 134ms and 127ms exceeded 120ms limit",
      },
    ],
    notes: "BATCH QUARANTINED. Systematic calibration drift detected. NCR raised. ECN-2026-004 triggered.",
  },
  {
    id: "inq-003",
    inspectionNumber: "IQC-2026-0043",
    grnNumber: "GRN-2026-0091",
    poNumber: "PO-2026-0238",
    vendorName: "MetalWorks Fabricators",
    vendorCode: "VND-MFG-007",
    itemCode: "MLB-ITM-0009",
    itemName: "Mechanical Frame — BA200",
    batchLotNumber: "MLB-BAT-2026-FR-012",
    qtyReceived: 30,
    qtySampled: 6,
    aqlLevel: "AQL 2.5 Level II",
    acceptNumber: 1,
    rejectNumber: 2,
    defectsFound: 1,
    aqlResult: "MARGINAL",
    status: "PENDING_COUNTERSIGN",
    inspectedBy: "Rishabh (QC)",
    inspectionDate: "2026-04-16",
    overallResult: "PASS",
    measurements: [
      {
        checkId: "chk-020",
        checkName: "Frame Overall Dimensions",
        specification: "340mm × 220mm × 180mm ± 1mm",
        unit: "mm",
        measuredValues: [340.2, 339.8, 340.5, 340.1, 339.9, 340.3],
        lowerLimit: 339.0,
        upperLimit: 341.0,
        category: "DIMENSIONAL",
        severity: "MAJOR",
        result: "PASS",
      },
      {
        checkId: "chk-021",
        checkName: "Surface Finish — Anodising",
        specification: "No bare metal, scratches > 2mm, or corrosion marks",
        unit: "visual",
        measuredValues: [],
        category: "VISUAL",
        severity: "MINOR",
        result: "FAIL",
        remarks: "1 unit with minor surface scratch 2.5mm — accepted as marginal. Chetan countersign required.",
      },
      {
        checkId: "chk-022",
        checkName: "Mounting Hole Position Tolerance",
        specification: "Hole position ± 0.3mm from nominal",
        unit: "mm",
        measuredValues: [0.12, 0.18, 0.22, 0.09, 0.15, 0.21],
        upperLimit: 0.3,
        category: "DIMENSIONAL",
        severity: "CRITICAL",
        result: "PASS",
      },
    ],
    notes: "1 minor surface defect — within AQL accept limit. Marginal accept — awaiting Chetan countersign.",
  },
  {
    id: "inq-004",
    inspectionNumber: "IQC-2026-0044",
    grnNumber: "GRN-2026-0092",
    poNumber: "PO-2026-0240",
    vendorName: "ChemSource Labs",
    vendorCode: "VND-CHEM-002",
    itemCode: "MLB-ITM-0003",
    itemName: "CBC Reagent Kit — 500 Tests",
    batchLotNumber: "MLB-BAT-2026-CHEM-019",
    qtyReceived: 200,
    qtySampled: 13,
    aqlLevel: "AQL 1.0 Level II",
    acceptNumber: 0,
    rejectNumber: 1,
    defectsFound: 0,
    aqlResult: "ACCEPT",
    status: "PASSED",
    inspectedBy: "Sanju (QC)",
    inspectionDate: "2026-04-14",
    completedAt: "2026-04-14T17:00:00",
    overallResult: "PASS",
    measurements: [
      {
        checkId: "chk-030",
        checkName: "pH Level",
        specification: "pH 7.2 ± 0.1",
        unit: "pH",
        measuredValues: [7.21, 7.19, 7.22, 7.20, 7.21, 7.18, 7.22, 7.20, 7.21, 7.19, 7.20, 7.21, 7.22],
        lowerLimit: 7.1,
        upperLimit: 7.3,
        category: "FUNCTIONAL",
        severity: "CRITICAL",
        result: "PASS",
        remarks: "All 13 vials within pH specification",
      },
      {
        checkId: "chk-031",
        checkName: "Expiry Date Verification",
        specification: "Expiry date ≥ 18 months from receipt",
        unit: "months",
        measuredValues: [],
        category: "DOCUMENTATION",
        severity: "CRITICAL",
        result: "PASS",
        remarks: "Expiry: Oct 2027 — 18 months from receipt. Acceptable.",
      },
      {
        checkId: "chk-032",
        checkName: "Container Integrity",
        specification: "No leakage, deformation, or broken seals",
        unit: "visual",
        measuredValues: [],
        category: "VISUAL",
        severity: "MAJOR",
        result: "PASS",
      },
    ],
    notes: "Reagent lot cleared. CoA from ChemSource Labs attached.",
  },
  {
    id: "inq-005",
    inspectionNumber: "IQC-2026-0045",
    grnNumber: "GRN-2026-0094",
    poNumber: "PO-2026-0244",
    vendorName: "Triton PCB Solutions",
    vendorCode: "VND-PCB-002",
    itemCode: "MLB-ITM-0005",
    itemName: "PCB Assembly — HA500 Main Board (Alternate Vendor)",
    batchLotNumber: "TPS-BAT-2026-PCB-001",
    qtyReceived: 10,
    qtySampled: 3,
    aqlLevel: "AQL 1.0 Level II (First Sample — Alternate Vendor)",
    acceptNumber: 0,
    rejectNumber: 1,
    defectsFound: 0,
    aqlResult: "ACCEPT",
    status: "IN_PROGRESS",
    inspectedBy: "Shubham (QC)",
    inspectionDate: "2026-04-17",
    overallResult: null,
    measurements: [
      {
        checkId: "chk-040",
        checkName: "Board Dimensions",
        specification: "150mm × 100mm ± 0.5mm",
        unit: "mm",
        measuredValues: [150.0, 149.9, 150.1],
        lowerLimit: 149.5,
        upperLimit: 150.5,
        category: "DIMENSIONAL",
        severity: "MAJOR",
        result: "PASS",
      },
      {
        checkId: "chk-041",
        checkName: "Continuity Test",
        specification: "Resistance < 0.5 Ω",
        unit: "Ω",
        measuredValues: [0.13, 0.14, 0.12],
        upperLimit: 0.5,
        category: "ELECTRICAL",
        severity: "CRITICAL",
        result: "PASS",
      },
      {
        checkId: "chk-042",
        checkName: "Functional Boot Test",
        specification: "All 3 boards must boot within 30 seconds and pass self-test",
        unit: "seconds",
        measuredValues: [],
        category: "FUNCTIONAL",
        severity: "CRITICAL",
        result: "NA",
        remarks: "Functional test in progress",
      },
    ],
    notes: "First sample inspection for alternate vendor Triton PCB (ref ECN-2026-003). Extended 8-check protocol.",
  },
];

// ─── WIP Inspection (Line-Level Gate Checkpoints) ─────────────────────────────

export interface WIPCheckpoint {
  checkId: string;
  checkName: string;
  description: string;
  category: CheckCategory;
  severity: CheckSeverity;
  specification: string;
  measuredValue?: string;
  result: CheckResult;
  remarks?: string;
}

export interface WIPInspection {
  id: string;
  inspectionNumber: string;
  workOrderId: string;
  workOrderPid: string;
  productCode: string;
  productName: string;
  deviceId?: string;
  line: WIPLine;
  stageName: string;
  stageSequence: number;
  qtyUnderInspection: number;
  qtyPassed: number;
  qtyFailed: number;
  status: InspectionStatus;
  inspectedBy: string;
  operatorName: string;
  startedAt: string;
  completedAt?: string;
  overallResult: "PASS" | "FAIL" | null;
  checkpoints: WIPCheckpoint[];
  linkedNCRId?: string;
  reworkRequired: boolean;
  notes?: string;
}

export const wipInspections: WIPInspection[] = [
  {
    id: "wip-001",
    inspectionNumber: "WIP-2026-0201",
    workOrderId: "ewo1",
    workOrderPid: "PID-2026-041",
    productCode: "MBA-HA500",
    productName: "Hematology Analyser HA-500",
    deviceId: "MBA-2026-04-0001-0",
    line: "L2",
    stageName: "PCB Sub-Assembly — Gate Check",
    stageSequence: 2,
    qtyUnderInspection: 3,
    qtyPassed: 3,
    qtyFailed: 0,
    status: "PASSED",
    inspectedBy: "Sanju (QC)",
    operatorName: "Bikash Deka",
    startedAt: "2026-04-04T09:30:00",
    completedAt: "2026-04-04T10:15:00",
    overallResult: "PASS",
    reworkRequired: false,
    checkpoints: [
      {
        checkId: "wcp-001",
        checkName: "PCB Placement Accuracy",
        description: "All PCBs correctly seated — no rocking or misalignment",
        category: "VISUAL",
        severity: "CRITICAL",
        specification: "Zero tolerance — any misalignment = FAIL",
        result: "PASS",
        remarks: "All 3 units correctly seated",
      },
      {
        checkId: "wcp-002",
        checkName: "Solder Joint Quality (IPC-A-610)",
        description: "Minimum Class 2 solder quality on all joints",
        category: "VISUAL",
        severity: "CRITICAL",
        specification: "No cold joints, bridges, or insufficient solder",
        result: "PASS",
        remarks: "Inspected under 10× magnification — all joints acceptable",
      },
      {
        checkId: "wcp-003",
        checkName: "ESD Wrist Strap Verification",
        description: "Operator ESD wrist strap continuity test logged",
        category: "SAFETY",
        severity: "MAJOR",
        specification: "Wrist strap resistance 1MΩ ± 10%",
        measuredValue: "1.02 MΩ",
        result: "PASS",
      },
      {
        checkId: "wcp-004",
        checkName: "Firmware Pre-load Version Check",
        description: "Base firmware version confirmed before final load",
        category: "FUNCTIONAL",
        severity: "MINOR",
        specification: "Base firmware v2.1.0 or later",
        measuredValue: "v2.1.3",
        result: "PASS",
      },
    ],
    notes: "Gate check passed. WO cleared to proceed to Mechanical Assembly (Stage 3).",
  },
  {
    id: "wip-002",
    inspectionNumber: "WIP-2026-0202",
    workOrderId: "ewo2",
    workOrderPid: "PID-2026-042",
    productCode: "MBA-BA200",
    productName: "Biochemistry Analyser BA-200",
    deviceId: "MBA-2026-04-0201-0",
    line: "L2",
    stageName: "Electrical Testing — Gate Check",
    stageSequence: 5,
    qtyUnderInspection: 2,
    qtyPassed: 1,
    qtyFailed: 1,
    status: "FAILED",
    inspectedBy: "Shubham (QC)",
    operatorName: "Priya Devi",
    startedAt: "2026-04-12T09:00:00",
    completedAt: "2026-04-12T11:30:00",
    overallResult: "FAIL",
    linkedNCRId: "ncr-002",
    reworkRequired: true,
    checkpoints: [
      {
        checkId: "wcp-010",
        checkName: "Power Supply — 3.3V Rail",
        description: "Measure 3.3V rail under load",
        category: "ELECTRICAL",
        severity: "CRITICAL",
        specification: "3.3V ± 0.1V (3.2V – 3.4V)",
        measuredValue: "Unit 1: 3.31V ✓ | Unit 2: 2.97V ✗",
        result: "FAIL",
        remarks: "Unit 2 (MBA-2026-04-0201-1) below minimum 3.2V. Voltage regulator failure. Rework required.",
      },
      {
        checkId: "wcp-011",
        checkName: "Power Supply — 5V Rail",
        description: "Measure 5V rail under load",
        category: "ELECTRICAL",
        severity: "CRITICAL",
        specification: "5.0V ± 0.15V (4.85V – 5.15V)",
        measuredValue: "Unit 1: 5.02V ✓ | Unit 2: 4.68V ✗",
        result: "FAIL",
        remarks: "Unit 2: 4.68V below 4.85V minimum — same regulator failure",
      },
      {
        checkId: "wcp-012",
        checkName: "Current Draw — Idle",
        description: "Idle current draw within spec",
        category: "ELECTRICAL",
        severity: "MAJOR",
        specification: "Idle current ≤ 850mA",
        measuredValue: "Unit 1: 620mA | Unit 2: 580mA",
        result: "PASS",
      },
      {
        checkId: "wcp-013",
        checkName: "Safety Ground Continuity",
        description: "Safety earth ground continuity from chassis to plug",
        category: "SAFETY",
        severity: "CRITICAL",
        specification: "Resistance < 0.1 Ω",
        measuredValue: "Unit 1: 0.04Ω | Unit 2: 0.06Ω",
        result: "PASS",
      },
    ],
    notes: "Unit 2 (MBA-2026-04-0201-1) on QC_HOLD. Voltage regulator replacement required. NCR-2026-0032 raised.",
  },
  {
    id: "wip-003",
    inspectionNumber: "WIP-2026-0203",
    workOrderId: "ewo1",
    workOrderPid: "PID-2026-041",
    productCode: "MBA-HA500",
    productName: "Hematology Analyser HA-500",
    line: "L2",
    stageName: "OC Assembly — Measurement Gate",
    stageSequence: 3,
    qtyUnderInspection: 3,
    qtyPassed: 3,
    qtyFailed: 0,
    status: "PASSED",
    inspectedBy: "Rishabh (QC)",
    operatorName: "Rishabh (Production)",
    startedAt: "2026-04-06T08:00:00",
    completedAt: "2026-04-06T09:00:00",
    overallResult: "PASS",
    reworkRequired: false,
    checkpoints: [
      {
        checkId: "wcp-020",
        checkName: "OC Fitment Gap — Go/No-Go Jig (JIG-OC-001)",
        description: "Go/No-Go jig fitment check on Optical Core",
        category: "DIMENSIONAL",
        severity: "CRITICAL",
        specification: "Gap 0.10mm – 0.15mm (jig mandatory per CAPA-2026-0015)",
        measuredValue: "0.12 / 0.11 / 0.13 mm",
        result: "PASS",
        remarks: "Jig ID JIG-OC-001 used. All 3 units passed. Photo evidence captured.",
      },
      {
        checkId: "wcp-021",
        checkName: "Photographic Evidence — OC Fitment",
        description: "Mandatory photo of fitted OC per CAPA-2026-0015",
        category: "DOCUMENTATION",
        severity: "MAJOR",
        specification: "At least 1 clear photo per unit showing OC fitment",
        result: "PASS",
        remarks: "3 photos captured and attached to stage log",
      },
    ],
    notes: "Rishabh is sole designated operator for OC Assembly (per CAPA-2026-0015). All passed.",
  },
  {
    id: "wip-004",
    inspectionNumber: "WIP-2026-0204",
    workOrderId: "ewo3",
    workOrderPid: "PID-2026-043",
    productCode: "RGT-CBC500",
    productName: "CBC Reagent Lot 500T",
    line: "L3",
    stageName: "QC Sampling & Testing",
    stageSequence: 4,
    qtyUnderInspection: 20,
    qtyPassed: 0,
    qtyFailed: 0,
    status: "IN_PROGRESS",
    inspectedBy: "Sanju (QC)",
    operatorName: "Kavita Sharma",
    startedAt: "2026-04-17T09:00:00",
    overallResult: null,
    reworkRequired: false,
    checkpoints: [
      {
        checkId: "wcp-030",
        checkName: "pH Stability Post-Mixing",
        description: "pH of final mixed reagent batch",
        category: "FUNCTIONAL",
        severity: "CRITICAL",
        specification: "pH 7.2 ± 0.1",
        result: "NA",
        remarks: "Test in progress — awaiting Turbidimeter (EQP-QC-004) calibration clearance",
      },
      {
        checkId: "wcp-031",
        checkName: "Turbidity Check",
        description: "Reagent clarity — no visible particulates",
        category: "VISUAL",
        severity: "MAJOR",
        specification: "Clear — NTU < 0.5",
        result: "NA",
        remarks: "NOTE: EQP-QC-004 Turbidimeter is CALIBRATION OVERDUE. Results flagged.",
      },
      {
        checkId: "wcp-032",
        checkName: "Fill Volume Verification",
        description: "Sample 10 vials for fill volume accuracy",
        category: "DIMENSIONAL",
        severity: "MAJOR",
        specification: "Fill volume 5.00mL ± 0.05mL",
        result: "NA",
        remarks: "10 vials selected for measurement",
      },
    ],
    notes: "QC sampling started. Reagent lot LOT-CBC-2026-019. ALERT: Turbidimeter overdue calibration — results flagged.",
  },
];

// ─── Final Device QC (Batch-Level) ────────────────────────────────────────────

export type BatchQCDecision = "ACCEPT" | "REJECT" | "QC_HOLD" | "PENDING";

export interface FinalDeviceCheck {
  checkId: string;
  checkName: string;
  description: string;
  category: CheckCategory;
  severity: CheckSeverity;
  specification: string;
  passCount: number;
  failCount: number;
  naCount: number;
  result: CheckResult;
  remarks?: string;
}

export interface DeviceQCResult {
  deviceId: string;
  result: "PASS" | "FAIL";
  defects?: string;
  reworkRevision: number;
}

export interface FinalBatchQC {
  id: string;
  batchQCNumber: string;
  workOrderId: string;
  workOrderPid: string;
  productCode: string;
  productName: string;
  batchQty: number;
  sampleSize: number;
  acceptNumber: number;
  rejectNumber: number;
  samplingPlan: string;
  status: InspectionStatus;
  batchDecision: BatchQCDecision;
  inspectedBy: string;
  countersignedBy?: string;
  handoverDate: string;
  completedAt?: string;
  tatHours?: number;
  checks: FinalDeviceCheck[];
  deviceResults: DeviceQCResult[];
  passQty: number;
  failQty: number;
  linkedNCRId?: string;
  bmrReference: string;
  notes?: string;
}

export const finalBatchQCs: FinalBatchQC[] = [
  {
    id: "fqc-001",
    batchQCNumber: "FQC-2026-0038",
    workOrderId: "ewo4",
    workOrderPid: "PID-2026-038",
    productCode: "MBA-HA500",
    productName: "Hematology Analyser HA-500",
    batchQty: 1,
    sampleSize: 1,
    acceptNumber: 0,
    rejectNumber: 1,
    samplingPlan: "100% inspection (batch qty ≤ 3)",
    status: "PASSED",
    batchDecision: "ACCEPT",
    inspectedBy: "Dr. Sunit Bhuyan (QC HOD)",
    countersignedBy: "Chetan (Production HOD)",
    handoverDate: "2026-03-26",
    completedAt: "2026-03-27T14:00:00",
    tatHours: 20,
    passQty: 1,
    failQty: 0,
    bmrReference: "BMR-2026-038",
    checks: [
      {
        checkId: "fqc-chk-001",
        checkName: "Full Traceability Check",
        description: "All Device IDs traceable to RM lot numbers and assembly operators",
        category: "DOCUMENTATION",
        severity: "CRITICAL",
        specification: "100% traceability — every component lot linked",
        passCount: 1,
        failCount: 0,
        naCount: 0,
        result: "PASS",
        remarks: "MBA-2026-03-0091-0 fully traced to MLB-BAT-2026-005 PCB + sensor lot",
      },
      {
        checkId: "fqc-chk-002",
        checkName: "QC Analyser Performance — 10-Sample CBC Test",
        description: "Full analyser functional test — 10 CBC test samples at known concentrations",
        category: "FUNCTIONAL",
        severity: "CRITICAL",
        specification: "All 10 samples within ±3% of reference value",
        passCount: 1,
        failCount: 0,
        naCount: 0,
        result: "PASS",
        remarks: "RBC: 99.1%, WBC: 98.7%, PLT: 100.2% of reference. All within 3%.",
      },
      {
        checkId: "fqc-chk-003",
        checkName: "Safety — Hi-Pot Test (Dielectric Strength)",
        description: "1500V AC for 1 second between live parts and chassis",
        category: "SAFETY",
        severity: "CRITICAL",
        specification: "No breakdown, leakage < 5mA",
        passCount: 1,
        failCount: 0,
        naCount: 0,
        result: "PASS",
        remarks: "Leakage: 0.8mA — well within 5mA limit",
      },
      {
        checkId: "fqc-chk-004",
        checkName: "Firmware Version Verification",
        description: "Final firmware version matches approved release",
        category: "DOCUMENTATION",
        severity: "MAJOR",
        specification: "Firmware v3.2.1 (BOM v3 release)",
        passCount: 1,
        failCount: 0,
        naCount: 0,
        result: "PASS",
        remarks: "v3.2.1 confirmed on device screen at startup",
      },
      {
        checkId: "fqc-chk-005",
        checkName: "Packaging & Labelling Check",
        description: "Device label, serial number, regulatory markings",
        category: "VISUAL",
        severity: "MAJOR",
        specification: "CE mark, UDI label, serial number matches Device ID in system",
        passCount: 1,
        failCount: 0,
        naCount: 0,
        result: "PASS",
      },
    ],
    deviceResults: [
      { deviceId: "MBA-2026-03-0091-0", result: "PASS", reworkRevision: 0 },
    ],
    notes: "Batch of 1 — 100% inspection. Device passed all checks. Released to dispatch.",
  },
  {
    id: "fqc-002",
    batchQCNumber: "FQC-2026-0041",
    workOrderId: "ewo1",
    workOrderPid: "PID-2026-041",
    productCode: "MBA-HA500",
    productName: "Hematology Analyser HA-500",
    batchQty: 3,
    sampleSize: 3,
    acceptNumber: 0,
    rejectNumber: 1,
    samplingPlan: "100% inspection (batch qty ≤ 3)",
    status: "PENDING",
    batchDecision: "PENDING",
    inspectedBy: "Dr. Sunit Bhuyan (QC HOD)",
    handoverDate: "2026-04-30",
    passQty: 0,
    failQty: 0,
    bmrReference: "BMR-2026-041",
    checks: [],
    deviceResults: [
      { deviceId: "MBA-2026-04-0101-0", result: "PASS", reworkRevision: 0 },
      { deviceId: "MBA-2026-04-0102-0", result: "PASS", reworkRevision: 0 },
      { deviceId: "MBA-2026-04-0103-0", result: "PASS", reworkRevision: 0 },
    ],
    notes: "Production in progress. QC handover expected 30-Apr-2026.",
  },
];

// ─── NCR — Non-Conformance Reports ───────────────────────────────────────────

export interface NCRRecord {
  id: string;
  ncrNumber: string;
  source: NCRSource;
  severity: NCRSeverity;
  status: NCRStatus;
  title: string;
  description: string;
  linkedInspectionId?: string;
  linkedInspectionNumber?: string;
  workOrderId?: string;
  workOrderPid?: string;
  productCode?: string;
  productName?: string;
  itemCode?: string;
  itemName?: string;
  batchLotNumber?: string;
  vendorName?: string;
  qtyAffected?: number;
  containmentAction: string;
  raisedBy: string;
  raisedAt: string;
  assignedTo: string;
  targetClosureDate: string;
  closedAt?: string;
  closedBy?: string;
  linkedCAPAId?: string;
  dispositionDecision?: "USE_AS_IS" | "REWORK" | "SCRAP" | "RETURN_TO_VENDOR" | "PENDING";
  notes?: string;
}

export const ncrRecords: NCRRecord[] = [
  {
    id: "ncr-001",
    ncrNumber: "NCR-2026-0031",
    source: "INCOMING_QC",
    severity: "CRITICAL",
    status: "CAPA_RAISED",
    title: "Systematic Calibration Drift — Flow Cell Sensor Batch MLB-BAT-2026-SEN-RECALL",
    description: "2 of 5 sampled sensors from batch MLB-BAT-2026-SEN-RECALL show calibration drift at low cell counts. Sensitivity below 98.5% threshold at 500 cells/µL. Risk of misdiagnosis if deployed in field.",
    linkedInspectionId: "inq-002",
    linkedInspectionNumber: "IQC-2026-0042",
    itemCode: "MLB-ITM-0006",
    itemName: "Flow Cell Sensor — Precision Grade",
    batchLotNumber: "MLB-BAT-2026-SEN-RECALL",
    vendorName: "Precision Optics Solutions",
    qtyAffected: 20,
    containmentAction: "Entire batch MLB-BAT-2026-SEN-RECALL quarantined. ECN-2026-004 raised to hold all WOs using this batch. Vendor notified immediately with IQC-2026-0042 report.",
    raisedBy: "Dr. Sunit Bhuyan (QC HOD)",
    raisedAt: "2026-04-15T17:00:00",
    assignedTo: "Chetan (Production HOD)",
    targetClosureDate: "2026-04-30",
    linkedCAPAId: "capa-001",
    dispositionDecision: "RETURN_TO_VENDOR",
    notes: "All 20 units in quarantine. Replacement stock from approved batch requested from vendor.",
  },
  {
    id: "ncr-002",
    ncrNumber: "NCR-2026-0032",
    source: "WIP_INSPECTION",
    severity: "MAJOR",
    status: "CAPA_RAISED",
    title: "Voltage Regulator Out of Spec — BA-200 Unit MBA-2026-04-0201-1",
    description: "Unit 2 in PID-2026-042 failed Electrical Testing gate — 3.3V rail at 2.97V (spec: 3.2V–3.4V) and 5V rail at 4.68V (spec: 4.85V–5.15V). Root cause: incorrect voltage regulator in batch MLB-BAT-2026-VR-003.",
    linkedInspectionId: "wip-002",
    linkedInspectionNumber: "WIP-2026-0202",
    workOrderId: "ewo2",
    workOrderPid: "PID-2026-042",
    productCode: "MBA-BA200",
    productName: "Biochemistry Analyser BA-200",
    qtyAffected: 1,
    containmentAction: "Unit placed on QC_HOLD. Voltage regulator batch MLB-BAT-2026-VR-003 pulled from stores. Rework sub-WO to be raised for component replacement.",
    raisedBy: "Shubham (QC)",
    raisedAt: "2026-04-12T12:00:00",
    assignedTo: "Chetan (Production HOD)",
    targetClosureDate: "2026-04-22",
    linkedCAPAId: "capa-002",
    dispositionDecision: "REWORK",
    notes: "Rework: replace voltage regulator on Unit 2. Re-test after rework.",
  },
  {
    id: "ncr-003",
    ncrNumber: "NCR-2026-0030",
    source: "INCOMING_QC",
    severity: "MINOR",
    status: "CLOSED",
    title: "Minor Surface Scratch on Mechanical Frame — Batch MLB-BAT-2026-FR-012",
    description: "1 of 6 sampled mechanical frames has a surface scratch of 2.5mm on non-mating surface. Within AQL accept limit but documented for vendor record.",
    linkedInspectionId: "inq-003",
    linkedInspectionNumber: "IQC-2026-0043",
    itemCode: "MLB-ITM-0009",
    itemName: "Mechanical Frame — BA200",
    batchLotNumber: "MLB-BAT-2026-FR-012",
    vendorName: "MetalWorks Fabricators",
    qtyAffected: 1,
    containmentAction: "Unit accepted with deviation under Chetan countersign. Vendor issued formal notice for improvement.",
    raisedBy: "Rishabh (QC)",
    raisedAt: "2026-04-16T10:00:00",
    assignedTo: "Chetan (Production HOD)",
    targetClosureDate: "2026-04-20",
    closedAt: "2026-04-16T15:00:00",
    closedBy: "Chetan (Production HOD)",
    dispositionDecision: "USE_AS_IS",
    notes: "Closed same day — minor deviation accepted. Vendor scorecard updated.",
  },
];

// ─── CAPA — Corrective & Preventive Actions ───────────────────────────────────

export interface CAPAActionItem {
  id: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  completedAt?: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
  evidence?: string;
}

export interface CAPAApprovalStep {
  role: string;
  approver: string;
  action: "PENDING" | "APPROVED" | "REJECTED";
  note?: string;
  actionedAt?: string;
}

export interface CAPARecord {
  id: string;
  capaNumber: string;
  type: CAPAType;
  status: CAPAStatus;
  linkedNCRId?: string;
  linkedNCRNumber?: string;
  workOrderId?: string;
  workOrderPid?: string;
  productCode?: string;
  problemStatement: string;
  immediateContainment: string;
  rootCauseMethod: RootCauseMethod;
  rootCauseFinding: string;
  rootCauseCategory: "OC_FITMENT" | "PCB_ASSEMBLY" | "INCOMING_MATERIAL" | "DIMENSIONAL" | "PROCESS_ERROR" | "HANDLING_ESD" | "FIRMWARE" | "OTHER";
  correctiveAction: string;
  preventiveAction: string;
  responsiblePerson: string;
  openedBy: string;
  openedAt: string;
  targetClosureDate: string;
  closedAt?: string;
  closedBy?: string;
  effectivenessStatus: "NOT_STARTED" | "MONITORING" | "EFFECTIVE" | "INEFFECTIVE";
  actionItems: CAPAActionItem[];
  approvalSteps: CAPAApprovalStep[];
  batchesMonitored: number;
  recurrenceFound: boolean;
  notes?: string;
}

export const capaRecords: CAPARecord[] = [
  {
    id: "capa-001",
    capaNumber: "CAPA-2026-0018",
    type: "CORRECTIVE",
    status: "ACTION_PLAN_APPROVED",
    linkedNCRId: "ncr-001",
    linkedNCRNumber: "NCR-2026-0031",
    productCode: "MLB-ITM-0006",
    problemStatement: "2 of 5 sampled Flow Cell Sensors from batch MLB-BAT-2026-SEN-RECALL show systematic calibration drift at low cell counts. AQL REJECT on IQC-2026-0042. Risk: misdiagnosis if deployed in field.",
    immediateContainment: "Batch MLB-BAT-2026-SEN-RECALL quarantined. ECN-2026-004 approved to hold WOs. All affected WOs placed on QC_HOLD. Vendor notified same day with QC report.",
    rootCauseMethod: "5_WHY",
    rootCauseFinding: "5-Why: (1) Sensors failed calibration → (2) Sensitivity degraded → (3) Optical coating damaged → (4) Thermal shock during transit (excursion > 40°C) → (5) Vendor did not use cold-chain packaging for Guwahati summer shipment.",
    rootCauseCategory: "INCOMING_MATERIAL",
    correctiveAction: "Return entire batch to Precision Optics Solutions. Request 100% inspection and recalibration from vendor before any future shipment. Raise debit note for cost of inspection and production delay.",
    preventiveAction: "Add cold-chain packaging requirement to PO terms for all sensor orders. Update Incoming QC checklist to include shipment temperature log verification. Add temperature indicator label requirement to vendor specification.",
    responsiblePerson: "Chetan (Production HOD)",
    openedBy: "Dr. Sunit Bhuyan (QC HOD)",
    openedAt: "2026-04-15T18:00:00",
    targetClosureDate: "2026-05-15",
    effectivenessStatus: "MONITORING",
    batchesMonitored: 0,
    recurrenceFound: false,
    actionItems: [
      {
        id: "capa-ai-001",
        description: "Return batch MLB-BAT-2026-SEN-RECALL to Precision Optics Solutions with NCR report",
        assignedTo: "Ranjit Bora (Stores)",
        dueDate: "2026-04-20",
        status: "IN_PROGRESS",
      },
      {
        id: "capa-ai-002",
        description: "Update Vendor PO terms to mandate cold-chain packaging with temperature indicator",
        assignedTo: "Procurement Team",
        dueDate: "2026-04-25",
        status: "OPEN",
      },
      {
        id: "capa-ai-003",
        description: "Add shipment temperature log check to Incoming QC checklist for all sensors",
        assignedTo: "Dr. Sunit Bhuyan (QC HOD)",
        dueDate: "2026-04-22",
        status: "OPEN",
      },
      {
        id: "capa-ai-004",
        description: "Qualify alternate sensor vendor as backup supply",
        assignedTo: "Chetan (Production HOD)",
        dueDate: "2026-05-10",
        status: "OPEN",
      },
    ],
    approvalSteps: [
      { role: "QC HOD", approver: "Dr. Sunit Bhuyan", action: "APPROVED", note: "Root cause correct. Action plan adequate.", actionedAt: "2026-04-16T09:00:00" },
      { role: "Production HOD", approver: "Chetan", action: "APPROVED", note: "Action items assigned. Timeline feasible.", actionedAt: "2026-04-16T10:30:00" },
      { role: "Management", approver: "Dr. Sameer Roy", action: "PENDING" },
    ],
    notes: "Monitoring 5 subsequent sensor batches from Precision Optics after corrective action is implemented.",
  },
  {
    id: "capa-002",
    capaNumber: "CAPA-2026-0017",
    type: "CORRECTIVE",
    status: "IN_PROGRESS",
    linkedNCRId: "ncr-002",
    linkedNCRNumber: "NCR-2026-0032",
    workOrderId: "ewo2",
    workOrderPid: "PID-2026-042",
    productCode: "MBA-BA200",
    problemStatement: "Unit MBA-2026-04-0201-1 failed Electrical Testing — voltage regulator on 3.3V and 5V rails out of specification. Component batch MLB-BAT-2026-VR-003 contains wrong-value regulators.",
    immediateContainment: "Unit placed on QC_HOLD. Batch MLB-BAT-2026-VR-003 withdrawn from stores. All PCBs from this batch recalled for bench testing.",
    rootCauseMethod: "8D",
    rootCauseFinding: "8D Analysis: Wrong-value voltage regulator (LM317 instead of specified LM7805) supplied in batch MLB-BAT-2026-VR-003. Mis-pick at PCBTech India in pick-and-place programming. Component labelling on Reel identical — human error.",
    rootCauseCategory: "PCB_ASSEMBLY",
    correctiveAction: "Rework Unit MBA-2026-04-0201-1 — replace incorrect voltage regulator. Re-test after rework. Inspect all remaining PCBs from batch MLB-BAT-2026-VR-003.",
    preventiveAction: "Add in-circuit test (ICT) at PCB vendor before shipment. Update Incoming QC checklist — 100% voltage rail measurement on all PCBs (not AQL sampling). Issue corrective action request to PCBTech India.",
    responsiblePerson: "Chetan (Production HOD)",
    openedBy: "Shubham (QC)",
    openedAt: "2026-04-12T13:00:00",
    targetClosureDate: "2026-04-22",
    effectivenessStatus: "MONITORING",
    batchesMonitored: 0,
    recurrenceFound: false,
    actionItems: [
      {
        id: "capa-ai-010",
        description: "Rework Unit MBA-2026-04-0201-1 — replace voltage regulator",
        assignedTo: "Sanju (Production)",
        dueDate: "2026-04-19",
        status: "IN_PROGRESS",
      },
      {
        id: "capa-ai-011",
        description: "Bench test all PCBs from batch MLB-BAT-2026-VR-003 for voltage rail output",
        assignedTo: "Shubham (QC)",
        dueDate: "2026-04-18",
        completedAt: "2026-04-17T15:00:00",
        status: "COMPLETED",
        evidence: "3 PCBs tested — 1 defective (reworked). 2 remaining pass. Cleared for use.",
      },
      {
        id: "capa-ai-012",
        description: "Update Incoming QC checklist — 100% voltage rail measurement for PCBs",
        assignedTo: "Dr. Sunit Bhuyan (QC HOD)",
        dueDate: "2026-04-20",
        status: "OPEN",
      },
      {
        id: "capa-ai-013",
        description: "Issue formal corrective action request to PCBTech India",
        assignedTo: "Procurement Team",
        dueDate: "2026-04-18",
        status: "IN_PROGRESS",
      },
    ],
    approvalSteps: [
      { role: "QC HOD", approver: "Dr. Sunit Bhuyan", action: "APPROVED", note: "8D analysis thorough. Approve action plan.", actionedAt: "2026-04-13T10:00:00" },
      { role: "Production HOD", approver: "Chetan", action: "APPROVED", note: "Rework assigned to Sanju. Timeline tight but feasible.", actionedAt: "2026-04-13T11:00:00" },
      { role: "Management", approver: "Dr. Sameer Roy", action: "APPROVED", note: "Proceed. Escalate to vendor immediately.", actionedAt: "2026-04-14T09:00:00" },
    ],
    notes: "Rework in progress. Re-inspection scheduled 19-Apr. Monitor next 5 PCB batches from PCBTech.",
  },
  {
    id: "capa-003",
    capaNumber: "CAPA-2026-0015",
    type: "CORRECTIVE",
    status: "CLOSED",
    productCode: "MBA-HA500",
    problemStatement: "OC Assembly defects — 3 units in batch PID-2026-035 failed sub-assembly QC due to OC fitment gap outside specification. Scrap rate on OC stage: 6% (target < 2%).",
    immediateContainment: "Failed units scrapped (3 units). Production stopped on OC Assembly until jig is introduced.",
    rootCauseMethod: "ISHIKAWA",
    rootCauseFinding: "Fishbone analysis: No go/no-go jig (Method). Gap measured by eye (Measurement). Any operator allowed on OC stage (Man). Tolerance stack in OC component from supplier (Material).",
    rootCauseCategory: "OC_FITMENT",
    correctiveAction: "R&D designed go/no-go jig JIG-OC-001 (gap 0.10–0.15mm). Jig validated and introduced. Only Rishabh permitted on OC Assembly. Photo evidence mandatory at this stage.",
    preventiveAction: "OC Assembly stage template updated — jig usage confirmation is mandatory checklist item. Operator skill matrix updated — OC Assembly restricted to Tier 1 only, Rishabh as primary. SPC chart initiated for OC Assembly defect rate.",
    responsiblePerson: "Chetan (Production HOD)",
    openedBy: "Dr. Sunit Bhuyan (QC HOD)",
    openedAt: "2026-03-15T09:00:00",
    targetClosureDate: "2026-04-10",
    closedAt: "2026-04-08T16:00:00",
    closedBy: "Dr. Sunit Bhuyan (QC HOD)",
    effectivenessStatus: "EFFECTIVE",
    batchesMonitored: 2,
    recurrenceFound: false,
    actionItems: [
      {
        id: "capa-ai-020",
        description: "R&D to design and validate OC go/no-go jig",
        assignedTo: "Dr. Ananya Gogoi (R&D)",
        dueDate: "2026-03-31",
        completedAt: "2026-03-28T15:00:00",
        status: "COMPLETED",
        evidence: "JIG-OC-001 validated — 20 trial assemblies: 0 defects vs 6% pre-jig. Validation report attached.",
      },
      {
        id: "capa-ai-021",
        description: "Restrict OC Assembly to Rishabh — update system stage template",
        assignedTo: "Chetan (Production HOD)",
        dueDate: "2026-03-20",
        completedAt: "2026-03-19T12:00:00",
        status: "COMPLETED",
        evidence: "Stage template updated. Operator restriction active in system.",
      },
      {
        id: "capa-ai-022",
        description: "Add mandatory photo capture to OC Assembly stage checklist",
        assignedTo: "Dr. Sunit Bhuyan (QC HOD)",
        dueDate: "2026-03-25",
        completedAt: "2026-03-22T14:00:00",
        status: "COMPLETED",
        evidence: "WIP inspection checklist updated. Photo evidence now mandatory.",
      },
    ],
    approvalSteps: [
      { role: "QC HOD", approver: "Dr. Sunit Bhuyan", action: "APPROVED", note: "CAPA effective — 0 recurrence in 2 batches. Close.", actionedAt: "2026-04-08T15:00:00" },
      { role: "Production HOD", approver: "Chetan", action: "APPROVED", note: "Jig working well. Rishabh has 100% pass rate on OC.", actionedAt: "2026-04-08T15:30:00" },
      { role: "Management", approver: "Dr. Sameer Roy", action: "APPROVED", note: "Good improvement. Close CAPA.", actionedAt: "2026-04-08T16:00:00" },
    ],
    notes: "CAPA closed after 2 clean batches with 0 OC defects. Effectiveness verified.",
  },
];

// ─── Equipment Calibration Registry ──────────────────────────────────────────

export interface CalibrationHistory {
  date: string;
  performedBy: string;
  certNumber: string;
  result: "PASS" | "FAIL" | "ADJUSTED";
  nextDueDate: string;
  notes?: string;
}

export interface EquipmentRecord {
  id: string;
  equipmentId: string;
  equipmentName: string;
  category: EquipmentCategory;
  make: string;
  model: string;
  serialNumber: string;
  location: string;
  status: EquipmentStatus;
  lastCalibrationDate: string;
  nextCalibrationDue: string;
  calibrationFrequencyDays: number;
  calibratedBy: string;
  calibrationCertNumber?: string;
  usedInStages: string[];
  calibrationHistory: CalibrationHistory[];
  notes?: string;
}

export const equipmentRecords: EquipmentRecord[] = [
  {
    id: "eqp-001",
    equipmentId: "EQP-QC-001",
    equipmentName: "QC Analyser — Haematology Reference Unit (Sysmex XN-1000)",
    category: "TEST_EQUIPMENT",
    make: "Sysmex",
    model: "XN-1000",
    serialNumber: "SYS-XN-2024-00881",
    location: "QC Lab — Final QC Station",
    status: "CALIBRATED",
    lastCalibrationDate: "2026-03-01",
    nextCalibrationDue: "2026-06-01",
    calibrationFrequencyDays: 90,
    calibratedBy: "Sysmex India Service",
    calibrationCertNumber: "SYS-CAL-2026-0301",
    usedInStages: ["QC Analyser (L2 — Stage 3)", "Final Device QC (L5)"],
    calibrationHistory: [
      { date: "2026-03-01", performedBy: "Sysmex India Service", certNumber: "SYS-CAL-2026-0301", result: "PASS", nextDueDate: "2026-06-01", notes: "Full calibration — all parameters within spec" },
      { date: "2025-12-01", performedBy: "Sysmex India Service", certNumber: "SYS-CAL-2025-1201", result: "PASS", nextDueDate: "2026-03-01" },
      { date: "2025-09-01", performedBy: "Sysmex India Service", certNumber: "SYS-CAL-2025-0901", result: "ADJUSTED", nextDueDate: "2025-12-01", notes: "RBC channel adjusted — minor drift detected" },
    ],
    notes: "Primary QC reference instrument. All Final Device QC tests must use this equipment.",
  },
  {
    id: "eqp-002",
    equipmentId: "EQP-QC-002",
    equipmentName: "Digital Multimeter — Fluke 87V",
    category: "MEASURING_INSTRUMENT",
    make: "Fluke",
    model: "87V",
    serialNumber: "FLK-87V-2023-4421",
    location: "L2 — Electrical Testing Stage",
    status: "CALIBRATION_DUE",
    lastCalibrationDate: "2025-10-15",
    nextCalibrationDue: "2026-04-15",
    calibrationFrequencyDays: 180,
    calibratedBy: "NABL Lab — Metrology Centre Guwahati",
    calibrationCertNumber: "NABL-2025-10-4421",
    usedInStages: ["Electrical Testing (L2 — Stage 5)", "Incoming QC — Electrical Checks"],
    calibrationHistory: [
      { date: "2025-10-15", performedBy: "NABL Lab — Metrology Centre Guwahati", certNumber: "NABL-2025-10-4421", result: "PASS", nextDueDate: "2026-04-15" },
      { date: "2025-04-20", performedBy: "NABL Lab — Metrology Centre Guwahati", certNumber: "NABL-2025-04-4421", result: "PASS", nextDueDate: "2025-10-15" },
    ],
    notes: "Calibration overdue as of 2026-04-15. Instrument still in use — MUST be sent for calibration immediately.",
  },
  {
    id: "eqp-003",
    equipmentId: "EQP-QC-003",
    equipmentName: "Hi-Pot Tester — GW Instek GPT-805A",
    category: "TEST_EQUIPMENT",
    make: "GW Instek",
    model: "GPT-805A",
    serialNumber: "GWI-805A-2022-1102",
    location: "QC Lab — Final QC Station",
    status: "CALIBRATED",
    lastCalibrationDate: "2026-01-10",
    nextCalibrationDue: "2027-01-10",
    calibrationFrequencyDays: 365,
    calibratedBy: "GW Instek India Service",
    calibrationCertNumber: "GWI-CAL-2026-0110",
    usedInStages: ["Final Device QC (L5 — Safety Hi-Pot Test)"],
    calibrationHistory: [
      { date: "2026-01-10", performedBy: "GW Instek India Service", certNumber: "GWI-CAL-2026-0110", result: "PASS", nextDueDate: "2027-01-10" },
      { date: "2025-01-12", performedBy: "GW Instek India Service", certNumber: "GWI-CAL-2025-0112", result: "PASS", nextDueDate: "2026-01-12" },
    ],
    notes: "Annual calibration. Compliant with IEC 61010.",
  },
  {
    id: "eqp-004",
    equipmentId: "EQP-PROD-001",
    equipmentName: "OC Assembly Jig — JIG-OC-001",
    category: "FIXTURE",
    make: "In-house (R&D — Dr. Ananya Gogoi)",
    model: "JIG-OC-001",
    serialNumber: "MBL-JIG-OC-001",
    location: "L2 — OC Assembly Stage",
    status: "CALIBRATED",
    lastCalibrationDate: "2026-03-28",
    nextCalibrationDue: "2026-06-28",
    calibrationFrequencyDays: 90,
    calibratedBy: "Dr. Ananya Gogoi (R&D)",
    calibrationCertNumber: "MBL-JIG-2026-0328",
    usedInStages: ["OC Assembly (L2 — Stage 3)"],
    calibrationHistory: [
      { date: "2026-03-28", performedBy: "Dr. Ananya Gogoi (R&D)", certNumber: "MBL-JIG-2026-0328", result: "PASS", nextDueDate: "2026-06-28", notes: "New jig validated per CAPA-2026-0015. Tolerance confirmed 0.10–0.15mm gap." },
    ],
    notes: "Mandatory for OC Assembly. Check jig before every shift. Validate monthly or after any drop/impact.",
  },
  {
    id: "eqp-005",
    equipmentId: "EQP-QC-004",
    equipmentName: "Turbidimeter — Hach 2100Q",
    category: "TEST_EQUIPMENT",
    make: "Hach",
    model: "2100Q",
    serialNumber: "HACH-2100Q-2023-9871",
    location: "QC Lab — Reagent QC Station",
    status: "CALIBRATION_OVERDUE",
    lastCalibrationDate: "2025-10-01",
    nextCalibrationDue: "2026-04-01",
    calibrationFrequencyDays: 180,
    calibratedBy: "Hach Service India",
    calibrationCertNumber: "HACH-CAL-2025-1001",
    usedInStages: ["QC Sampling & Testing (L3 — Reagent QC)", "Incoming QC — Reagent Checks"],
    calibrationHistory: [
      { date: "2025-10-01", performedBy: "Hach Service India", certNumber: "HACH-CAL-2025-1001", result: "PASS", nextDueDate: "2026-04-01" },
      { date: "2025-04-05", performedBy: "Hach Service India", certNumber: "HACH-CAL-2025-0405", result: "PASS", nextDueDate: "2025-10-05" },
    ],
    notes: "CALIBRATION OVERDUE — 16 days past due. Reagent QC results after Apr 1 are flagged. Calibrate immediately.",
  },
  {
    id: "eqp-006",
    equipmentId: "EQP-PROD-002",
    equipmentName: "Torque Screwdriver — Wera 7400 (0.5–5 Nm)",
    category: "PRODUCTION_TOOL",
    make: "Wera",
    model: "7400 Series",
    serialNumber: "WRA-7400-2024-0031",
    location: "L4 — Final Assembly",
    status: "CALIBRATED",
    lastCalibrationDate: "2026-02-15",
    nextCalibrationDue: "2026-08-15",
    calibrationFrequencyDays: 180,
    calibratedBy: "Internal — Quality Lab",
    calibrationCertNumber: "MBL-TRQ-2026-0215",
    usedInStages: ["Final Assembly & Cleaning (L4 — Stage 3)", "Top Plate Assembly (L4)"],
    calibrationHistory: [
      { date: "2026-02-15", performedBy: "Internal — Quality Lab", certNumber: "MBL-TRQ-2026-0215", result: "PASS", nextDueDate: "2026-08-15" },
      { date: "2025-08-20", performedBy: "Internal — Quality Lab", certNumber: "MBL-TRQ-2025-0820", result: "PASS", nextDueDate: "2026-02-20" },
    ],
    notes: "Calibrated bi-annually. Use only for final assembly torque-critical fasteners.",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getIncomingInspectionById(id: string): IncomingQCInspection | undefined {
  return incomingInspections.find((i) => i.id === id);
}

export function getWIPInspectionById(id: string): WIPInspection | undefined {
  return wipInspections.find((i) => i.id === id);
}

export function getNCRById(id: string): NCRRecord | undefined {
  return ncrRecords.find((n) => n.id === id);
}

export function getCAPAById(id: string): CAPARecord | undefined {
  return capaRecords.find((c) => c.id === id);
}

export function getEquipmentById(id: string): EquipmentRecord | undefined {
  return equipmentRecords.find((e) => e.id === id);
}

export function getOpenNCRs(): NCRRecord[] {
  return ncrRecords.filter((n) => n.status !== "CLOSED" && n.status !== "REJECTED");
}

export function getOpenCAPAs(): CAPARecord[] {
  return capaRecords.filter((c) => c.status !== "CLOSED");
}

export function getOverdueEquipment(): EquipmentRecord[] {
  return equipmentRecords.filter((e) => e.status === "CALIBRATION_OVERDUE");
}

export function getCalibrationDueEquipment(): EquipmentRecord[] {
  return equipmentRecords.filter(
    (e) => e.status === "CALIBRATION_DUE" || e.status === "CALIBRATION_OVERDUE"
  );
}

export function getPendingIncomingInspections(): IncomingQCInspection[] {
  return incomingInspections.filter(
    (i) => i.status === "PENDING" || i.status === "IN_PROGRESS" || i.status === "PENDING_COUNTERSIGN"
  );
}

export function getIncomingPassRate(): number {
  const completed = incomingInspections.filter((i) => i.overallResult !== null);
  if (completed.length === 0) return 0;
  const passed = completed.filter((i) => i.overallResult === "PASS").length;
  return Math.round((passed / completed.length) * 100);
}

export function getCAPAOverdueCount(): number {
  const today = new Date("2026-04-17");
  return capaRecords.filter(
    (c) => c.status !== "CLOSED" && new Date(c.targetClosureDate) < today
  ).length;
}

export function getDaysUntilCalibration(dueDate: string): number {
  const today = new Date("2026-04-17");
  const due = new Date(dueDate);
  return Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
