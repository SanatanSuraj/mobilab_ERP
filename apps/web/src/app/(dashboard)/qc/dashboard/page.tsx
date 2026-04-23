"use client";

// TODO(phase-5): QC dashboard aggregates across incoming / WIP / NCR / CAPA /
// equipment. useApiQcInspections + useApiQcCerts exist, but the specialized
// incoming/WIP/NCR/CAPA/equipment entities and rollups have no backend route
// yet. Expected:
//   GET /qc/overview - single-call aggregates for all dashboard KPIs
// Mock imports left in place until the overview route ships in
// apps/api/src/modules/qc (or until the specialized slices ship and the
// dashboard is rewritten over them).

import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  incomingInspections,
  wipInspections,
  ncrRecords,
  equipmentRecords,
  getPendingIncomingInspections,
  getOpenNCRs,
  getOpenCAPAs,
  getCalibrationDueEquipment,
  getOverdueEquipment,
  getIncomingPassRate,
  getDaysUntilCalibration,
  formatDate,
  formatDateTime,
} from "@/data/qc-mock";
import {
  ClipboardList,
  ShieldAlert,
  AlertTriangle,
  Wrench,
  TrendingUp,
  Activity,
  AlertCircle,
} from "lucide-react";

export default function QCDashboardPage() {
  const pendingIncoming = getPendingIncomingInspections();
  const openNCRs = getOpenNCRs();
  const openCAPAs = getOpenCAPAs();
  const calDueEquipment = getCalibrationDueEquipment();
  const overdueEquipment = getOverdueEquipment();
  const incomingPassRate = getIncomingPassRate();
  const today = new Date("2026-04-17");

  const wipActive = wipInspections.filter(
    (i) => i.status === "IN_PROGRESS" || i.status === "PENDING"
  );

  return (
    <div className="space-y-8 p-6">
      <PageHeader
        title="QC Dashboard — Instigenie Manufacturing"
        description="ISO 13485 Quality Control — Guwahati Plant | Chetan's QC Team"
      />

      {/* Calibration Overdue Alert Banner */}
      {overdueEquipment.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Equipment Calibration Overdue</span>
            {" — "}
            {overdueEquipment.map((e) => e.equipmentName).join(", ")}.{" "}
            Results from affected stages are flagged.
          </div>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KPICard
          title="Incoming Inspections"
          value={String(pendingIncoming.length)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change="Pending / In Progress / Countersign"
          trend="neutral"
        />
        <KPICard
          title="Open NCRs"
          value={String(openNCRs.length)}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={openNCRs.length > 0 ? "Requires action" : "All clear"}
          trend={openNCRs.length > 0 ? "down" : "up"}
        />
        <KPICard
          title="Open CAPAs"
          value={String(openCAPAs.length)}
          icon={ShieldAlert}
          iconColor="text-orange-600"
          change={openCAPAs.length > 0 ? "In progress" : "All closed"}
          trend={openCAPAs.length > 0 ? "down" : "up"}
        />
        <KPICard
          title="Calibration Alerts"
          value={String(calDueEquipment.length)}
          icon={Wrench}
          iconColor="text-amber-600"
          change={calDueEquipment.length > 0 ? "Due / Overdue" : "All calibrated"}
          trend={calDueEquipment.length > 0 ? "down" : "up"}
        />
        <KPICard
          title="Incoming Pass Rate"
          value={`${incomingPassRate}%`}
          icon={TrendingUp}
          iconColor="text-teal-600"
          change="All completed AQL inspections"
          trend={incomingPassRate >= 80 ? "up" : "down"}
        />
        <KPICard
          title="WIP Inspections"
          value={String(wipActive.length)}
          icon={Activity}
          iconColor="text-indigo-600"
          change="Active gate inspections"
          trend="neutral"
        />
      </div>

      {/* Incoming QC Queue */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Incoming QC Queue</h2>
        <Card>
          <CardContent className="p-0">
            {pendingIncoming.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                No pending incoming inspections
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inspection #</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">GRN #</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vendor</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Batch / Lot</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">AQL Level</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inspector</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pendingIncoming.map((insp) => (
                      <tr key={insp.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                          {insp.inspectionNumber}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {insp.grnNumber}
                        </td>
                        <td className="px-4 py-3 text-sm">{insp.vendorName}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium">{insp.itemName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{insp.itemCode}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{insp.batchLotNumber}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{insp.qtyReceived}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{insp.aqlLevel}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={insp.status} />
                        </td>
                        <td className="px-4 py-3 text-sm">{insp.inspectedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Open NCRs */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Open NCRs</h2>
        <Card>
          <CardContent className="p-0">
            {openNCRs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                No open NCRs
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">NCR #</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Severity</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">WO / Item</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Raised By</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Raised At</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">CAPA Linked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {openNCRs.map((ncr) => (
                      <tr key={ncr.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-bold text-red-700">
                          {ncr.ncrNumber}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={ncr.severity} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={ncr.source} />
                        </td>
                        <td className="px-4 py-3 max-w-[240px]">
                          <p className="text-sm truncate" title={ncr.title}>
                            {ncr.title.length > 60 ? ncr.title.slice(0, 60) + "…" : ncr.title}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {ncr.workOrderPid ?? ncr.itemName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">{ncr.raisedBy}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDateTime(ncr.raisedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={ncr.status} />
                        </td>
                        <td className="px-4 py-3">
                          {ncr.linkedCAPAId ? (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                              Yes
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                              No
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Open CAPAs */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Open CAPAs</h2>
        <Card>
          <CardContent className="p-0">
            {openCAPAs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                No open CAPAs
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">CAPA #</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Problem Statement</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Responsible</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target Closure</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Effectiveness</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {openCAPAs.map((capa) => {
                      const isOverdue = new Date(capa.targetClosureDate) < today;
                      return (
                        <tr
                          key={capa.id}
                          className={`hover:bg-muted/30 transition-colors ${isOverdue ? "bg-red-50/60" : ""}`}
                        >
                          <td className="px-4 py-3 font-mono text-xs font-bold text-orange-700">
                            {capa.capaNumber}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={capa.type} />
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={capa.status} />
                          </td>
                          <td className="px-4 py-3 max-w-[280px]">
                            <p className="text-sm truncate" title={capa.problemStatement}>
                              {capa.problemStatement.length > 70
                                ? capa.problemStatement.slice(0, 70) + "…"
                                : capa.problemStatement}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-sm">{capa.responsiblePerson}</td>
                          <td className={`px-4 py-3 text-sm font-medium ${isOverdue ? "text-red-700" : ""}`}>
                            {formatDate(capa.targetClosureDate)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={capa.effectivenessStatus} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Equipment Calibration Status */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Equipment Calibration Status</h2>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Equipment ID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Last Cal. Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Next Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {equipmentRecords.map((eqp) => {
                    const daysLeft = getDaysUntilCalibration(eqp.nextCalibrationDue);
                    const isOverdue = eqp.status === "CALIBRATION_OVERDUE";
                    const isDueSoon = !isOverdue && daysLeft <= 30;
                    const dueDateClass = isOverdue
                      ? "text-red-700 font-medium"
                      : isDueSoon
                      ? "text-amber-700 font-medium"
                      : "";
                    return (
                      <tr key={eqp.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                          {eqp.equipmentId}
                        </td>
                        <td className="px-4 py-3 text-sm">{eqp.equipmentName}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{eqp.location}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={eqp.status} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDate(eqp.lastCalibrationDate)}
                        </td>
                        <td className={`px-4 py-3 text-xs ${dueDateClass || "text-muted-foreground"}`}>
                          {formatDate(eqp.nextCalibrationDue)}
                          {isOverdue && " (OVERDUE)"}
                          {isDueSoon && !isOverdue && ` (${daysLeft}d left)`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
