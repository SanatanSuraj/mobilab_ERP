import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  // General
  new: "bg-blue-50 text-blue-700 border-blue-200",
  active: "bg-green-50 text-green-700 border-green-200",
  inactive: "bg-gray-50 text-gray-500 border-gray-200",
  on_leave: "bg-amber-50 text-amber-700 border-amber-200",

  // Lead / Deal
  contacted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  qualified: "bg-purple-50 text-purple-700 border-purple-200",
  proposal: "bg-orange-50 text-orange-700 border-orange-200",
  negotiation: "bg-amber-50 text-amber-700 border-amber-200",
  discovery: "bg-cyan-50 text-cyan-700 border-cyan-200",
  won: "bg-green-50 text-green-700 border-green-200",
  closed_won: "bg-green-50 text-green-700 border-green-200",
  lost: "bg-red-50 text-red-700 border-red-200",
  closed_lost: "bg-red-50 text-red-700 border-red-200",

  // Orders
  draft: "bg-gray-50 text-gray-600 border-gray-200",
  confirmed: "bg-blue-50 text-blue-700 border-blue-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200",
  shipped: "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered: "bg-green-50 text-green-700 border-green-200",

  // Invoice
  sent: "bg-blue-50 text-blue-700 border-blue-200",
  paid: "bg-green-50 text-green-700 border-green-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-gray-50 text-gray-500 border-gray-200",

  // Work Orders
  planned: "bg-blue-50 text-blue-700 border-blue-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  quality_check: "bg-purple-50 text-purple-700 border-purple-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  on_hold: "bg-gray-50 text-gray-500 border-gray-200",
  failed: "bg-red-50 text-red-700 border-red-200",

  // Tasks
  todo: "bg-gray-50 text-gray-600 border-gray-200",
  review: "bg-purple-50 text-purple-700 border-purple-200",
  done: "bg-green-50 text-green-700 border-green-200",

  // Leave
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",

  // Inventory
  available: "bg-green-50 text-green-700 border-green-200",
  reserved: "bg-amber-50 text-amber-700 border-amber-200",
  expired: "bg-red-50 text-red-700 border-red-200",
  quarantine: "bg-orange-50 text-orange-700 border-orange-200",
  in_stock: "bg-green-50 text-green-700 border-green-200",
  sold: "bg-blue-50 text-blue-700 border-blue-200",
  warranty: "bg-purple-50 text-purple-700 border-purple-200",
  returned: "bg-orange-50 text-orange-700 border-orange-200",
  scrapped: "bg-red-50 text-red-700 border-red-200",

  // Priority
  low: "bg-gray-50 text-gray-600 border-gray-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",

  // Quotation
  accepted: "bg-green-50 text-green-700 border-green-200",
  expired_q: "bg-gray-50 text-gray-500 border-gray-200",

  // Finance - Sales Invoice
  partially_paid: "bg-cyan-50 text-cyan-700 border-cyan-200",

  // Finance - PO Approval
  pending_approval: "bg-amber-50 text-amber-700 border-amber-200",
  auto_approved: "bg-teal-50 text-teal-700 border-teal-200",
  finance_approved: "bg-blue-50 text-blue-700 border-blue-200",
  management_approved: "bg-green-50 text-green-700 border-green-200",

  // Finance - Purchase Invoice
  pending_match: "bg-amber-50 text-amber-700 border-amber-200",
  matched: "bg-green-50 text-green-700 border-green-200",
  disputed: "bg-red-50 text-red-700 border-red-200",

  // Finance - E-Way Bill
  generated: "bg-blue-50 text-blue-700 border-blue-200",

  // Finance - ITC
  eligible: "bg-green-50 text-green-700 border-green-200",
  ineligible: "bg-red-50 text-red-700 border-red-200",
  reversed: "bg-orange-50 text-orange-700 border-orange-200",

  // CRM - Leads
  converted: "bg-green-50 text-green-700 border-green-200",

  // CRM - Orders & Dispatch
  ready_to_dispatch: "bg-cyan-50 text-cyan-700 border-cyan-200",
  in_transit: "bg-indigo-50 text-indigo-700 border-indigo-200",

  // CRM - Support Tickets
  waiting_customer: "bg-purple-50 text-purple-700 border-purple-200",

  // Inventory - Batch Status
  ACTIVE: "bg-green-50 text-green-700 border-green-200",
  PARTIALLY_CONSUMED: "bg-blue-50 text-blue-700 border-blue-200",
  FULLY_CONSUMED: "bg-gray-50 text-gray-500 border-gray-200",
  QUARANTINED: "bg-orange-50 text-orange-700 border-orange-200",
  EXPIRED: "bg-red-50 text-red-700 border-red-200",
  RETURNED_TO_VENDOR: "bg-purple-50 text-purple-700 border-purple-200",

  // Inventory - Serial Status
  CREATED: "bg-gray-50 text-gray-600 border-gray-200",
  IN_PRODUCTION: "bg-blue-50 text-blue-700 border-blue-200",
  QC_HOLD: "bg-orange-50 text-orange-700 border-orange-200",
  FINISHED: "bg-green-50 text-green-700 border-green-200",
  RESERVED: "bg-amber-50 text-amber-700 border-amber-200",
  DISPATCHED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  RETURNED: "bg-purple-50 text-purple-700 border-purple-200",
  SCRAPPED: "bg-red-50 text-red-700 border-red-200",

  // Inventory - GRN Status
  DRAFT: "bg-gray-50 text-gray-600 border-gray-200",
  CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
  PARTIALLY_QC: "bg-amber-50 text-amber-700 border-amber-200",
  QC_DONE: "bg-green-50 text-green-700 border-green-200",

  // Inventory - Transfer Status
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  IN_TRANSIT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  RECEIVED: "bg-green-50 text-green-700 border-green-200",
  DISCREPANCY: "bg-red-50 text-red-700 border-red-200",

  // Inventory - Adjustment Status
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",

  // Inventory - Tracking Type
  NONE: "bg-gray-50 text-gray-500 border-gray-200",
  BATCH: "bg-blue-50 text-blue-700 border-blue-200",
  SERIAL: "bg-purple-50 text-purple-700 border-purple-200",

  // ABC Class
  A: "bg-red-50 text-red-700 border-red-200",
  B: "bg-amber-50 text-amber-700 border-amber-200",
  C: "bg-gray-50 text-gray-600 border-gray-200",

  // QC Status
  PASSED: "bg-green-50 text-green-700 border-green-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",

  // Procurement - Vendor Status (ACTIVE already defined above)
  ON_PROBATION: "bg-amber-50 text-amber-700 border-amber-200",
  BLACKLISTED: "bg-red-50 text-red-700 border-red-200",

  // Procurement - Indent / PO Status
  SUBMITTED: "bg-blue-50 text-blue-700 border-blue-200",
  PO_RAISED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PARTIALLY_RECEIVED: "bg-cyan-50 text-cyan-700 border-cyan-200",
  FULFILLED: "bg-green-50 text-green-700 border-green-200",
  PENDING_FINANCE: "bg-amber-50 text-amber-700 border-amber-200",
  PENDING_MGMT: "bg-orange-50 text-orange-700 border-orange-200",
  PO_SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  AMENDED: "bg-purple-50 text-purple-700 border-purple-200",

  // Procurement - Inward / QC Status
  QC_IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  GRN_CREATED: "bg-green-50 text-green-700 border-green-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  PARTIALLY_PASSED: "bg-cyan-50 text-cyan-700 border-cyan-200",

  // Procurement - RTV Status
  VENDOR_ACKNOWLEDGED: "bg-blue-50 text-blue-700 border-blue-200",
  DEBIT_NOTE_RAISED: "bg-green-50 text-green-700 border-green-200",

  // Procurement - Urgency
  URGENT: "bg-red-50 text-red-700 border-red-200",
  NORMAL: "bg-gray-50 text-gray-600 border-gray-200",

  // Manufacturing - WO / WIP Status
  PLANNED: "bg-blue-50 text-blue-700 border-blue-200",
  MATERIAL_CHECK: "bg-amber-50 text-amber-700 border-amber-200",
  REWORK: "bg-orange-50 text-orange-700 border-orange-200",

  // Manufacturing - BOM Status
  SUPERSEDED: "bg-gray-50 text-gray-500 border-gray-200",
  OBSOLETE: "bg-red-50 text-red-500 border-red-200",

  // Manufacturing - ECN Status
  IN_REVIEW: "bg-indigo-50 text-indigo-700 border-indigo-200",
  IMPLEMENTED: "bg-green-50 text-green-700 border-green-200",

  // Manufacturing - Priority
  LOW: "bg-gray-50 text-gray-500 border-gray-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",

  // Manufacturing - Product Family
  MOBILAB_INSTRUMENT: "bg-blue-50 text-blue-700 border-blue-200",
  CBL_DEVICE: "bg-purple-50 text-purple-700 border-purple-200",
  REAGENT: "bg-teal-50 text-teal-700 border-teal-200",

  // Mobicase - Work Order statuses
  PENDING_RM: "bg-amber-50 text-amber-700 border-amber-200",
  RM_ISSUED: "bg-cyan-50 text-cyan-700 border-cyan-200",
  RM_QC_IN_PROGRESS: "bg-orange-50 text-orange-700 border-orange-200",
  ASSEMBLY_COMPLETE: "bg-teal-50 text-teal-700 border-teal-200",
  QC_HANDOVER_PENDING: "bg-purple-50 text-purple-700 border-purple-200",
  QC_COMPLETED: "bg-green-50 text-green-700 border-green-200",
  PARTIAL_COMPLETE: "bg-cyan-50 text-cyan-700 border-cyan-200",

  // Mobicase - Device ID statuses
  SUB_QC_PASS: "bg-green-50 text-green-700 border-green-200",
  SUB_QC_FAIL: "bg-red-50 text-red-700 border-red-200",
  IN_REWORK: "bg-orange-50 text-orange-700 border-orange-200",
  REWORK_LIMIT_EXCEEDED: "bg-red-50 text-red-700 border-red-200",
  FINAL_ASSEMBLY: "bg-indigo-50 text-indigo-700 border-indigo-200",
  FINAL_QC_PASS: "bg-green-50 text-green-700 border-green-200",
  FINAL_QC_FAIL: "bg-red-50 text-red-700 border-red-200",
  RELEASED: "bg-teal-50 text-teal-700 border-teal-200",
  RECALLED: "bg-red-50 text-red-700 border-red-200",

  // Mobicase - Scrap Root Cause
  OC_FITMENT: "bg-red-50 text-red-700 border-red-200",
  PCB_ASSEMBLY_ERROR: "bg-orange-50 text-orange-700 border-orange-200",
  INCOMING_MATERIAL: "bg-amber-50 text-amber-700 border-amber-200",
  DIMENSIONAL: "bg-purple-50 text-purple-700 border-purple-200",
  PROCESS_ERROR: "bg-orange-50 text-orange-700 border-orange-200",
  HANDLING_ESD: "bg-red-50 text-red-700 border-red-200",
  FIRMWARE_ERROR: "bg-indigo-50 text-indigo-700 border-indigo-200",

  // Mobicase - Downtime Category
  RM_DELAY_INVENTORY: "bg-amber-50 text-amber-700 border-amber-200",
  RM_DELAY_QUALITY: "bg-orange-50 text-orange-700 border-orange-200",
  EQUIPMENT_FAILURE: "bg-red-50 text-red-700 border-red-200",
  OPERATOR_ABSENCE_PLANNED: "bg-gray-50 text-gray-600 border-gray-200",
  OPERATOR_ABSENCE_UNPLANNED: "bg-orange-50 text-orange-700 border-orange-200",
  POWER_INFRASTRUCTURE: "bg-red-50 text-red-700 border-red-200",
  REWORK_HOLD: "bg-amber-50 text-amber-700 border-amber-200",
  MANAGEMENT_HOLD: "bg-purple-50 text-purple-700 border-purple-200",

  // Mobicase - BMR Status
  PRODUCTION_SIGNED: "bg-blue-50 text-blue-700 border-blue-200",
  QC_SIGNED: "bg-indigo-50 text-indigo-700 border-indigo-200",

  // Mobicase - Assembly Lines
  L1: "bg-blue-50 text-blue-700 border-blue-200",
  L2: "bg-red-50 text-red-700 border-red-200",
  L3: "bg-purple-50 text-purple-700 border-purple-200",
  L4: "bg-teal-50 text-teal-700 border-teal-200",
  L5: "bg-green-50 text-green-700 border-green-200",

  // Mobicase - Product Codes
  MBA: "bg-blue-50 text-blue-700 border-blue-200",
  MBM: "bg-purple-50 text-purple-700 border-purple-200",
  MBC: "bg-indigo-50 text-indigo-700 border-indigo-200",
  MCC: "bg-teal-50 text-teal-700 border-teal-200",
  CFG: "bg-gray-50 text-gray-600 border-gray-200",

  // Mobicase - Operator Tiers
  T1: "bg-green-50 text-green-700 border-green-200",
  T2: "bg-blue-50 text-blue-700 border-blue-200",
  T3: "bg-gray-50 text-gray-600 border-gray-200",

  // Mobicase - Shifts
  SHIFT_1: "bg-amber-50 text-amber-700 border-amber-200",
  SHIFT_2: "bg-indigo-50 text-indigo-700 border-indigo-200",

  // QC - Inspection / AQL Status
  PENDING_COUNTERSIGN: "bg-purple-50 text-purple-700 border-purple-200",
  ON_HOLD: "bg-amber-50 text-amber-700 border-amber-200",
  AQL_PASSED: "bg-green-50 text-green-700 border-green-200",
  AQL_FAILED: "bg-red-50 text-red-700 border-red-200",

  // QC - AQL Result
  ACCEPT: "bg-green-50 text-green-700 border-green-200",
  REJECT: "bg-red-50 text-red-700 border-red-200",
  MARGINAL: "bg-amber-50 text-amber-700 border-amber-200",

  // QC - NCR Status
  OPEN: "bg-red-50 text-red-700 border-red-200",
  INVESTIGATING: "bg-orange-50 text-orange-700 border-orange-200",
  PENDING_CAPA: "bg-amber-50 text-amber-700 border-amber-200",
  CAPA_RAISED: "bg-blue-50 text-blue-700 border-blue-200",

  // QC - CAPA Status
  ROOT_CAUSE_IDENTIFIED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ACTION_PLAN_APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  VERIFICATION_PENDING: "bg-purple-50 text-purple-700 border-purple-200",
  OVERDUE: "bg-red-50 text-red-700 border-red-200",

  // QC - CAPA Type
  CORRECTIVE: "bg-red-50 text-red-700 border-red-200",
  PREVENTIVE: "bg-blue-50 text-blue-700 border-blue-200",

  // QC - Equipment Calibration Status
  CALIBRATED: "bg-green-50 text-green-700 border-green-200",
  CALIBRATION_DUE: "bg-amber-50 text-amber-700 border-amber-200",
  CALIBRATION_OVERDUE: "bg-red-50 text-red-700 border-red-200",
  OUT_OF_SERVICE: "bg-gray-50 text-gray-500 border-gray-200",
  UNDER_REPAIR: "bg-orange-50 text-orange-700 border-orange-200",

  // QC - Equipment Category
  TEST_EQUIPMENT: "bg-blue-50 text-blue-700 border-blue-200",
  MEASURING_INSTRUMENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  FIXTURE: "bg-purple-50 text-purple-700 border-purple-200",
  PRODUCTION_TOOL: "bg-teal-50 text-teal-700 border-teal-200",

  // QC - NCR Disposition
  USE_AS_IS: "bg-gray-50 text-gray-600 border-gray-200",
  RETURN_TO_VENDOR: "bg-orange-50 text-orange-700 border-orange-200",

  // QC - NCR/CAPA Severity (CRITICAL/MAJOR/MINOR already defined above as priority)
  // QC - Root Cause Methods
  "5_WHY": "bg-blue-50 text-blue-700 border-blue-200",
  ISHIKAWA: "bg-purple-50 text-purple-700 border-purple-200",
  FAULT_TREE: "bg-indigo-50 text-indigo-700 border-indigo-200",
  "8D": "bg-teal-50 text-teal-700 border-teal-200",

  // QC - Effectiveness
  EFFECTIVE: "bg-green-50 text-green-700 border-green-200",
  INEFFECTIVE: "bg-red-50 text-red-700 border-red-200",
  MONITORING: "bg-blue-50 text-blue-700 border-blue-200",
  NOT_STARTED: "bg-gray-50 text-gray-500 border-gray-200",

  // CRM - Ticket Category
  hardware_defect: "bg-red-50 text-red-700 border-red-200",
  calibration: "bg-amber-50 text-amber-700 border-amber-200",
  software_bug: "bg-orange-50 text-orange-700 border-orange-200",
  training: "bg-blue-50 text-blue-700 border-blue-200",
  warranty_claim: "bg-purple-50 text-purple-700 border-purple-200",
  general_inquiry: "bg-gray-50 text-gray-600 border-gray-200",

  // CRM - Contract-typed UPPER_CASE variants (served by /crm/* real API).
  // Keep color mapping aligned with the lowercase mock entries above so the
  // badge doesn't visually shift as pages migrate from mock → real API.
  // OPEN / IN_PROGRESS / LOW / HIGH / CRITICAL are already defined above
  // for other entities and their colors are acceptable here too.

  // Ticket Status
  WAITING_CUSTOMER: "bg-purple-50 text-purple-700 border-purple-200",
  RESOLVED: "bg-green-50 text-green-700 border-green-200",
  CLOSED: "bg-gray-50 text-gray-500 border-gray-200",

  // Ticket Priority
  MEDIUM: "bg-blue-50 text-blue-700 border-blue-200",

  // Ticket Category
  HARDWARE_DEFECT: "bg-red-50 text-red-700 border-red-200",
  CALIBRATION: "bg-amber-50 text-amber-700 border-amber-200",
  SOFTWARE_BUG: "bg-orange-50 text-orange-700 border-orange-200",
  TRAINING: "bg-blue-50 text-blue-700 border-blue-200",
  WARRANTY_CLAIM: "bg-purple-50 text-purple-700 border-purple-200",
  GENERAL_INQUIRY: "bg-gray-50 text-gray-600 border-gray-200",

  // Deal Stage
  DISCOVERY: "bg-cyan-50 text-cyan-700 border-cyan-200",
  PROPOSAL: "bg-orange-50 text-orange-700 border-orange-200",
  NEGOTIATION: "bg-amber-50 text-amber-700 border-amber-200",
  CLOSED_WON: "bg-green-50 text-green-700 border-green-200",
  CLOSED_LOST: "bg-red-50 text-red-700 border-red-200",

  // Lead Status (UPPER_CASE variants for /crm/leads)
  NEW: "bg-blue-50 text-blue-700 border-blue-200",
  CONTACTED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  QUALIFIED: "bg-purple-50 text-purple-700 border-purple-200",
  CONVERTED: "bg-green-50 text-green-700 border-green-200",
  LOST: "bg-red-50 text-red-700 border-red-200",
};

function formatLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = statusStyles[status] || "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <Badge variant="outline" className={cn("font-medium text-xs", style, className)}>
      {formatLabel(status)}
    </Badge>
  );
}
