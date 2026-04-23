"use client";

// TODO(phase-5): QC reports aggregate across incoming / WIP / final / NCR /
// CAPA / equipment calibration. useApiQcInspections + useApiQcCerts exist for
// generic inspection data, but the specialized incoming/WIP/final breakdowns
// and NCR/CAPA rollups have no backend routes yet. Expected:
//   GET /qc/reports/pass-rate?stage=INCOMING|WIP|FINAL&period=
//   GET /qc/reports/ncr-trend?period=
//   GET /qc/reports/capa-cycle-time?period=
//   GET /qc/reports/calibration-status
// Mock imports left in place until the reporting slice ships in
// apps/api/src/modules/qc.

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  incomingInspections,
  wipInspections,
  ncrRecords,
  capaRecords,
  equipmentRecords,
  getDaysUntilCalibration,
  formatDate,
} from "@/data/qc-mock";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
  BarChart2,
  Wrench,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Tab Types ────────────────────────────────────────────────────────────────

type Tab = "incoming" | "wip" | "ncr-capa" | "calibration";

// ─── Tab Switcher ─────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "incoming", label: "Incoming QC Summary" },
  { id: "wip", label: "WIP Inspection Summary" },
  { id: "ncr-capa", label: "NCR & CAPA Analysis" },
  { id: "calibration", label: "Equipment Calibration Status" },
];

// ─── TAB 1: Incoming QC Summary ───────────────────────────────────────────────

function IncomingQCSummaryTab() {
  const total = incomingInspections.length;
  const aqlAccepted = incomingInspections.filter(
    (i) => i.aqlResult === "ACCEPT"
  ).length;
  const aqlRejected = incomingInspections.filter(
    (i) => i.aqlResult === "REJECT"
  ).length;
  const aqlMarginal = incomingInspections.filter(
    (i) => i.aqlResult === "MARGINAL"
  ).length;
  const completed = incomingInspections.filter((i) => i.overallResult !== null);
  const passed = completed.filter((i) => i.overallResult === "PASS").length;
  const passRate =
    completed.length > 0
      ? Math.round((passed / completed.length) * 100)
      : 0;

  // By vendor
  const byVendor = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; accepted: number; rejected: number; defects: number; passCount: number; completeCount: number }
    >();
    for (const ins of incomingInspections) {
      const existing = map.get(ins.vendorName) ?? {
        name: ins.vendorName,
        count: 0,
        accepted: 0,
        rejected: 0,
        defects: 0,
        passCount: 0,
        completeCount: 0,
      };
      existing.count++;
      if (ins.aqlResult === "ACCEPT") existing.accepted++;
      if (ins.aqlResult === "REJECT") existing.rejected++;
      existing.defects += ins.defectsFound;
      if (ins.overallResult !== null) {
        existing.completeCount++;
        if (ins.overallResult === "PASS") existing.passCount++;
      }
      map.set(ins.vendorName, existing);
    }
    return Array.from(map.values());
  }, []);

  // By item
  const byItem = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; passCount: number; completeCount: number }
    >();
    for (const ins of incomingInspections) {
      const existing = map.get(ins.itemName) ?? {
        name: ins.itemName,
        count: 0,
        passCount: 0,
        completeCount: 0,
      };
      existing.count++;
      if (ins.overallResult !== null) {
        existing.completeCount++;
        if (ins.overallResult === "PASS") existing.passCount++;
      }
      map.set(ins.itemName, existing);
    }
    return Array.from(map.values());
  }, []);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <KPICard
          title="Total Inspections"
          value={String(total)}
          icon={BarChart2}
          iconColor="text-primary"
        />
        <KPICard
          title="AQL Accepted"
          value={String(aqlAccepted)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="AQL Rejected"
          value={String(aqlRejected)}
          icon={XCircle}
          iconColor="text-red-600"
        />
        <KPICard
          title="AQL Marginal"
          value={String(aqlMarginal)}
          icon={AlertTriangle}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Pass Rate"
          value={`${passRate}%`}
          icon={ShieldCheck}
          iconColor="text-blue-600"
        />
      </div>

      {/* By Vendor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Breakdown by Vendor</CardTitle>
          <CardDescription>AQL outcomes per supplier</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor Name</TableHead>
                <TableHead className="text-right">Inspections</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead className="text-right">Rejected</TableHead>
                <TableHead className="text-right">Defects Found</TableHead>
                <TableHead className="text-right">Pass Rate %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byVendor.map((v) => {
                const rate =
                  v.completeCount > 0
                    ? Math.round((v.passCount / v.completeCount) * 100)
                    : null;
                return (
                  <TableRow key={v.name}>
                    <TableCell className="font-medium text-sm">{v.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.count}</TableCell>
                    <TableCell className="text-right tabular-nums text-green-700 font-semibold">
                      {v.accepted}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600 font-semibold">
                      {v.rejected}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.defects}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rate !== null ? (
                        <span
                          className={cn(
                            "font-semibold",
                            rate >= 90 ? "text-green-700" : "text-red-600"
                          )}
                        >
                          {rate}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* By Item */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Breakdown by Item</CardTitle>
          <CardDescription>Pass rate per material / component</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead className="text-right">Inspections</TableHead>
                <TableHead className="text-right">Pass Rate %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byItem.map((item) => {
                const rate =
                  item.completeCount > 0
                    ? Math.round((item.passCount / item.completeCount) * 100)
                    : null;
                return (
                  <TableRow key={item.name}>
                    <TableCell className="font-medium text-sm">{item.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rate !== null ? (
                        <span
                          className={cn(
                            "font-semibold",
                            rate >= 90 ? "text-green-700" : "text-red-600"
                          )}
                        >
                          {rate}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">In progress</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TAB 2: WIP Inspection Summary ───────────────────────────────────────────

function WIPInspectionSummaryTab() {
  const total = wipInspections.length;
  const passed = wipInspections.filter((w) => w.overallResult === "PASS").length;
  const failed = wipInspections.filter((w) => w.overallResult === "FAIL").length;
  const reworkCount = wipInspections.filter((w) => w.reworkRequired).length;

  // By Line
  const byLine = useMemo(() => {
    const LINES = ["L1", "L2", "L3", "L4", "L5"] as const;
    return LINES.map((line) => {
      const lineInspections = wipInspections.filter((w) => w.line === line);
      const linePassed = lineInspections.filter((w) => w.overallResult === "PASS").length;
      const lineFailed = lineInspections.filter((w) => w.overallResult === "FAIL").length;
      const lineRework = lineInspections.filter((w) => w.reworkRequired).length;
      const completed = lineInspections.filter((w) => w.overallResult !== null);
      const rate =
        completed.length > 0
          ? Math.round((linePassed / completed.length) * 100)
          : null;
      return {
        line,
        count: lineInspections.length,
        passed: linePassed,
        failed: lineFailed,
        rework: lineRework,
        rate,
      };
    }).filter((l) => l.count > 0);
  }, []);

  // By Stage
  const byStage = useMemo(() => {
    const map = new Map<
      string,
      { stage: string; total: number; pass: number; fail: number }
    >();
    for (const ins of wipInspections) {
      const existing = map.get(ins.stageName) ?? {
        stage: ins.stageName,
        total: 0,
        pass: 0,
        fail: 0,
      };
      existing.total++;
      if (ins.overallResult === "PASS") existing.pass++;
      if (ins.overallResult === "FAIL") existing.fail++;
      map.set(ins.stageName, existing);
    }
    return Array.from(map.values());
  }, []);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          title="Total WIP Inspections"
          value={String(total)}
          icon={BarChart2}
          iconColor="text-primary"
        />
        <KPICard
          title="Passed"
          value={String(passed)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Failed"
          value={String(failed)}
          icon={XCircle}
          iconColor="text-red-600"
        />
        <KPICard
          title="Rework Required"
          value={String(reworkCount)}
          icon={AlertTriangle}
          iconColor="text-orange-600"
        />
      </div>

      {/* By Line */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Breakdown by Production Line</CardTitle>
          <CardDescription>L1–L5 inspection outcomes</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Inspections</TableHead>
                <TableHead className="text-right">Passed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Pass Rate</TableHead>
                <TableHead className="text-right">Rework Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byLine.map((l) => (
                <TableRow key={l.line}>
                  <TableCell className="font-semibold">{l.line}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.count}</TableCell>
                  <TableCell className="text-right tabular-nums text-green-700 font-semibold">
                    {l.passed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-red-600 font-semibold">
                    {l.failed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.rate !== null ? (
                      <span
                        className={cn(
                          "font-semibold",
                          l.rate >= 90 ? "text-green-700" : "text-red-600"
                        )}
                      >
                        {l.rate}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span
                      className={cn(
                        "font-semibold",
                        l.rework > 0 ? "text-orange-600" : "text-muted-foreground"
                      )}
                    >
                      {l.rework}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* By Stage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Breakdown by Stage</CardTitle>
          <CardDescription>Gate checkpoint inspection rates</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Pass</TableHead>
                <TableHead className="text-right">Fail</TableHead>
                <TableHead className="text-right">Pass Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byStage.map((s) => {
                const completed = s.pass + s.fail;
                const rate =
                  completed > 0 ? Math.round((s.pass / completed) * 100) : null;
                return (
                  <TableRow key={s.stage}>
                    <TableCell className="font-medium text-sm">{s.stage}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.total}</TableCell>
                    <TableCell className="text-right tabular-nums text-green-700 font-semibold">
                      {s.pass}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600 font-semibold">
                      {s.fail}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rate !== null ? (
                        <span
                          className={cn(
                            "font-semibold",
                            rate >= 90 ? "text-green-700" : "text-red-600"
                          )}
                        >
                          {rate}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">In progress</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TAB 3: NCR & CAPA Analysis ──────────────────────────────────────────────

function NCRCAPAAnalysisTab() {
  const totalNCRs = ncrRecords.length;
  const openNCRs = ncrRecords.filter(
    (n) => n.status !== "CLOSED" && n.status !== "REJECTED"
  ).length;
  const totalCAPAs = capaRecords.length;
  const openCAPAs = capaRecords.filter((c) => c.status !== "CLOSED").length;
  const closedCAPAs = capaRecords.filter((c) => c.status === "CLOSED").length;
  const capaClosureRate =
    totalCAPAs > 0 ? Math.round((closedCAPAs / totalCAPAs) * 100) : 0;

  // NCR by source
  const ncrBySource = useMemo(() => {
    const SOURCES = [
      "INCOMING_QC",
      "WIP_INSPECTION",
      "FINAL_QC",
    ] as const;
    return SOURCES.map((source) => {
      const items = ncrRecords.filter((n) => n.source === source);
      const open = items.filter(
        (n) => n.status !== "CLOSED" && n.status !== "REJECTED"
      ).length;
      const closed = items.filter((n) => n.status === "CLOSED").length;
      const critical = items.filter((n) => n.severity === "CRITICAL").length;
      return { source, count: items.length, open, closed, critical };
    }).filter((s) => s.count > 0);
  }, []);

  // NCR by severity
  const ncrBySeverity = useMemo(() => {
    const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR"] as const;
    return SEVERITIES.map((sev) => {
      const items = ncrRecords.filter((n) => n.severity === sev);
      const capaLinked = items.filter((n) => n.linkedCAPAId).length;
      const closedItems = items.filter((n) => n.closedAt);
      const avgDays =
        closedItems.length > 0
          ? Math.round(
              closedItems.reduce((acc, n) => {
                if (!n.closedAt) return acc;
                const raised = new Date(n.raisedAt).getTime();
                const closed = new Date(n.closedAt).getTime();
                return acc + (closed - raised) / (1000 * 60 * 60 * 24);
              }, 0) / closedItems.length
            )
          : null;
      return { severity: sev, count: items.length, capaLinked, avgDays };
    }).filter((s) => s.count > 0);
  }, []);

  // CAPA by root cause category
  const capaByCategory = useMemo(() => {
    const map = new Map<
      string,
      { category: string; count: number; closed: number; effective: number }
    >();
    for (const capa of capaRecords) {
      const existing = map.get(capa.rootCauseCategory) ?? {
        category: capa.rootCauseCategory,
        count: 0,
        closed: 0,
        effective: 0,
      };
      existing.count++;
      if (capa.status === "CLOSED") existing.closed++;
      if (capa.effectivenessStatus === "EFFECTIVE") existing.effective++;
      map.set(capa.rootCauseCategory, existing);
    }
    return Array.from(map.values());
  }, []);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <KPICard
          title="Total NCRs"
          value={String(totalNCRs)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
        <KPICard
          title="Open NCRs"
          value={String(openNCRs)}
          icon={XCircle}
          iconColor="text-orange-600"
        />
        <KPICard
          title="Total CAPAs"
          value={String(totalCAPAs)}
          icon={ShieldCheck}
          iconColor="text-primary"
        />
        <KPICard
          title="Open CAPAs"
          value={String(openCAPAs)}
          icon={Clock}
          iconColor="text-amber-600"
        />
        <KPICard
          title="CAPA Closure Rate"
          value={`${capaClosureRate}%`}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
      </div>

      {/* NCR by Source */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">NCR Breakdown by Source</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Closed</TableHead>
                <TableHead className="text-right">CRITICAL Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ncrBySource.map((s) => (
                <TableRow key={s.source}>
                  <TableCell>
                    <StatusBadge status={s.source} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {s.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-red-600 font-semibold">
                    {s.open}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-green-700 font-semibold">
                    {s.closed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={cn("font-semibold", s.critical > 0 ? "text-red-600" : "text-muted-foreground")}>
                      {s.critical}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* NCR by Severity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">NCR Breakdown by Severity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">CAPA Linked</TableHead>
                <TableHead className="text-right">Avg Days to Close</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ncrBySeverity.map((s) => (
                <TableRow key={s.severity}>
                  <TableCell>
                    <StatusBadge status={s.severity} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {s.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-blue-700 font-semibold">
                    {s.capaLinked}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.avgDays !== null ? (
                      <span className="font-semibold">{s.avgDays}d</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">None closed</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CAPA by Root Cause Category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">CAPA Breakdown by Root Cause Category</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Closed</TableHead>
                <TableHead className="text-right">Effective</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {capaByCategory.map((c) => (
                <TableRow key={c.category}>
                  <TableCell className="font-medium text-sm">
                    {c.category.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {c.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-green-700 font-semibold">
                    {c.closed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={cn("font-semibold", c.effective > 0 ? "text-green-700" : "text-muted-foreground")}>
                      {c.effective}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TAB 4: Equipment Calibration Status ─────────────────────────────────────

function EquipmentCalibrationTab() {
  const total = equipmentRecords.length;
  const calibrated = equipmentRecords.filter(
    (e) => e.status === "CALIBRATED"
  ).length;
  const due = equipmentRecords.filter(
    (e) => e.status === "CALIBRATION_DUE"
  ).length;
  const overdue = equipmentRecords.filter(
    (e) => e.status === "CALIBRATION_OVERDUE"
  ).length;

  const sorted = useMemo(() => {
    return [...equipmentRecords].sort(
      (a, b) =>
        new Date(a.nextCalibrationDue).getTime() -
        new Date(b.nextCalibrationDue).getTime()
    );
  }, []);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          title="Total Equipment"
          value={String(total)}
          icon={Wrench}
          iconColor="text-primary"
        />
        <KPICard
          title="Calibrated"
          value={String(calibrated)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Calibration Due"
          value={String(due)}
          icon={Clock}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Overdue"
          value={String(overdue)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
      </div>

      {/* Equipment Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Equipment Calibration Register
          </CardTitle>
          <CardDescription>Sorted by next calibration due date (ascending)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next Due Date</TableHead>
                  <TableHead className="text-right">Days Until Due</TableHead>
                  <TableHead>Calibrated By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((eqp) => {
                  const days = getDaysUntilCalibration(eqp.nextCalibrationDue);
                  const isOverdue = eqp.status === "CALIBRATION_OVERDUE";
                  return (
                    <TableRow
                      key={eqp.id}
                      className={cn(isOverdue && "bg-red-50")}
                    >
                      <TableCell className="font-mono text-xs font-semibold">
                        {eqp.equipmentId}
                      </TableCell>
                      <TableCell className="font-medium text-sm max-w-[200px]">
                        {eqp.equipmentName}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={eqp.category} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {eqp.location}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={eqp.status} />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatDate(eqp.nextCalibrationDue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={cn(
                            "font-semibold text-sm",
                            days < 0
                              ? "text-red-600"
                              : days <= 30
                              ? "text-amber-600"
                              : "text-green-700"
                          )}
                        >
                          {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {eqp.calibratedBy}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QCReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("incoming");

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="QC Analytics & Reports"
        description="Instigenie-specific quality metrics — Incoming, WIP, NCR/CAPA, Calibration"
      />

      {/* Tab Switcher */}
      <div className="border-b flex gap-0 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "incoming" && <IncomingQCSummaryTab />}
        {activeTab === "wip" && <WIPInspectionSummaryTab />}
        {activeTab === "ncr-capa" && <NCRCAPAAnalysisTab />}
        {activeTab === "calibration" && <EquipmentCalibrationTab />}
      </div>
    </div>
  );
}
