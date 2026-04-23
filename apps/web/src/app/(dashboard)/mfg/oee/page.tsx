"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  oeeRecords,
  downtimeEntries,
  copqRecords,
  getOEEAvg,
  formatCurrency,
  mobiOperators,
  OEERecord,
  DowntimeEntry,
  COPQRecord,
  AssemblyLine,
} from "@/data/instigenie-mock";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  DollarSign,
  Zap,
  AlertTriangle,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function oeeColorClass(oee: number): string {
  if (oee >= 85) return "text-green-700 bg-green-50";
  if (oee >= 75) return "text-amber-700 bg-amber-50";
  return "text-red-700 bg-red-50";
}

function oeeRowClass(oee: number): string {
  if (oee >= 85) return "bg-green-50/40";
  if (oee >= 75) return "bg-amber-50/40";
  if (oee > 0) return "bg-red-50/40";
  return "";
}

function formatMinutes(hours: number): string {
  return `${Math.round(hours * 60)} min`;
}

function getOperatorName(operatorId: string): string {
  const op = mobiOperators.find((o) => o.id === operatorId);
  return op?.name ?? operatorId;
}

// ─── OEE Formula Card ─────────────────────────────────────────────────────────

function OEEFormulaCard() {
  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-5 w-5 text-blue-600" />
          <h2 className="text-sm font-semibold text-blue-900">
            OEE Formula Reference
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex flex-col items-center rounded-lg border border-blue-200 bg-white px-4 py-2 text-center min-w-[90px]">
            <span className="text-xs text-muted-foreground mb-0.5">OEE</span>
            <span className="font-bold text-blue-700 text-base">OEE%</span>
          </div>
          <span className="text-lg font-bold text-blue-700">=</span>
          <div className="flex flex-col items-center rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-center min-w-[100px]">
            <span className="text-xs text-muted-foreground mb-0.5">
              Availability
            </span>
            <span className="font-bold text-green-700 text-base">A%</span>
            <span className="text-[10px] text-muted-foreground">
              Run / Planned Time
            </span>
          </div>
          <span className="text-lg font-bold text-muted-foreground">×</span>
          <div className="flex flex-col items-center rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-center min-w-[100px]">
            <span className="text-xs text-muted-foreground mb-0.5">
              Performance
            </span>
            <span className="font-bold text-amber-700 text-base">P%</span>
            <span className="text-[10px] text-muted-foreground">
              Actual / Theoretical
            </span>
          </div>
          <span className="text-lg font-bold text-muted-foreground">×</span>
          <div className="flex flex-col items-center rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-center min-w-[100px]">
            <span className="text-xs text-muted-foreground mb-0.5">
              Quality
            </span>
            <span className="font-bold text-indigo-700 text-base">Q%</span>
            <span className="text-[10px] text-muted-foreground">
              FPY Units / Started
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-green-500" />
              <span className="text-xs text-muted-foreground">
                ≥ 85% World class
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-amber-400" />
              <span className="text-xs text-muted-foreground">75–85% Good</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-sm bg-red-500" />
              <span className="text-xs text-muted-foreground">
                &lt; 75% Needs attention
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── OEE Records Table ────────────────────────────────────────────────────────

function OEERecordsTable({ records }: { records: OEERecord[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-base font-semibold">OEE Records</h2>
        <p className="text-xs text-muted-foreground">
          Per shift / line snapshot — rows highlighted by OEE performance band
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Line
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Shift
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Planned (hr)
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Run (hr)
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Downtime (hr)
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Avail%
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Perf%
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Quality%
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  OEE%
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map((rec) => (
                <tr
                  key={rec.id}
                  className={`hover:opacity-90 transition-opacity ${oeeRowClass(rec.oee)}`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {rec.date}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={rec.line} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={rec.shift} />
                  </td>
                  <td className="px-4 py-3 text-xs text-right">
                    {rec.availableHours}h
                  </td>
                  <td className="px-4 py-3 text-xs text-right">
                    {(rec.availableHours - rec.downtimeHours).toFixed(1)}h
                  </td>
                  <td className="px-4 py-3 text-xs text-right text-red-600">
                    {rec.downtimeHours > 0 ? `${rec.downtimeHours}h` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-right font-medium text-green-700">
                    {rec.availability}%
                  </td>
                  <td className="px-4 py-3 text-xs text-right font-medium text-amber-700">
                    {rec.performance}%
                  </td>
                  <td className="px-4 py-3 text-xs text-right font-medium text-indigo-700">
                    {rec.quality}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${oeeColorClass(
                        rec.oee
                      )}`}
                    >
                      {rec.oee}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Line Comparison ──────────────────────────────────────────────────────────

function LineComparison({ records }: { records: OEERecord[] }) {
  const lines: AssemblyLine[] = ["L1", "L2", "L3", "L4", "L5"];

  const lineSummaries = useMemo(() => {
    return lines
      .map((line) => {
        const lineRecords = records.filter((r) => r.line === line);
        if (lineRecords.length === 0) return null;
        const avgOEE =
          Math.round(
            lineRecords.reduce((s, r) => s + r.oee, 0) / lineRecords.length
          );
        const avgAvail = Math.round(
          lineRecords.reduce((s, r) => s + r.availability, 0) /
            lineRecords.length
        );
        const avgPerf = Math.round(
          lineRecords.reduce((s, r) => s + r.performance, 0) /
            lineRecords.length
        );
        const avgQuality = Math.round(
          lineRecords.reduce((s, r) => s + r.quality, 0) / lineRecords.length
        );
        const totalDowntime = lineRecords.reduce(
          (s, r) => s + r.downtimeHours,
          0
        );
        return {
          line,
          shifts: lineRecords.length,
          avgOEE,
          avgAvail,
          avgPerf,
          avgQuality,
          totalDowntime,
        };
      })
      .filter(
        (
          s
        ): s is {
          line: AssemblyLine;
          shifts: number;
          avgOEE: number;
          avgAvail: number;
          avgPerf: number;
          avgQuality: number;
          totalDowntime: number;
        } => s !== null
      )
      .sort((a, b) => b.avgOEE - a.avgOEE);
  }, [records]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Line Comparison</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Average OEE and component metrics per assembly line
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Line
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Shifts Recorded
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Avg Avail%
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Avg Perf%
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Avg Quality%
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Total Downtime
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Avg OEE%
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground w-36">
                  vs Target (85%)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lineSummaries.map((summary) => {
                const gap = summary.avgOEE - 85;
                const barPct = Math.min(
                  Math.round((summary.avgOEE / 100) * 100),
                  100
                );
                return (
                  <tr
                    key={summary.line}
                    className={`hover:opacity-90 ${oeeRowClass(summary.avgOEE)}`}
                  >
                    <td className="px-4 py-3">
                      <StatusBadge status={summary.line} />
                    </td>
                    <td className="px-4 py-3 text-xs text-right text-muted-foreground">
                      {summary.shifts}
                    </td>
                    <td className="px-4 py-3 text-xs text-right font-medium text-green-700">
                      {summary.avgAvail}%
                    </td>
                    <td className="px-4 py-3 text-xs text-right font-medium text-amber-700">
                      {summary.avgPerf}%
                    </td>
                    <td className="px-4 py-3 text-xs text-right font-medium text-indigo-700">
                      {summary.avgQuality}%
                    </td>
                    <td className="px-4 py-3 text-xs text-right text-red-600">
                      {summary.totalDowntime > 0
                        ? `${summary.totalDowntime.toFixed(1)}h`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${oeeColorClass(
                          summary.avgOEE
                        )}`}
                      >
                        {summary.avgOEE}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        <div className="relative h-2 w-32 rounded-full bg-gray-200 overflow-hidden">
                          {/* Target marker */}
                          <div
                            className="absolute top-0 h-full w-0.5 bg-gray-500 z-10"
                            style={{ left: "85%" }}
                          />
                          <div
                            className={`h-full rounded-full ${
                              summary.avgOEE >= 85
                                ? "bg-green-500"
                                : summary.avgOEE >= 75
                                ? "bg-amber-400"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span
                          className={`text-[10px] font-medium ${
                            gap >= 0 ? "text-green-700" : "text-red-600"
                          }`}
                        >
                          {gap >= 0 ? `+${gap}` : gap}pp vs target
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Downtime Log ─────────────────────────────────────────────────────────────

function DowntimeLog({ entries }: { entries: DowntimeEntry[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-semibold">Downtime Log</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          All recorded downtime events impacting line availability
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  DT#
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  WO#
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Line
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Category
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Duration
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Reported By
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Units Impacted
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Description
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Started
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {entry.downtimeNumber}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {entry.workOrderId ? (
                      <span>
                        {entry.workOrderId.replace("mwo-", "WO-2026-0")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.line} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.category} />
                  </td>
                  <td className="px-4 py-3 text-xs text-right font-medium">
                    {entry.durationHours !== undefined
                      ? formatMinutes(entry.durationHours)
                      : <span className="text-muted-foreground">Ongoing</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {entry.reportedBy}
                  </td>
                  <td className="px-4 py-3 text-xs text-right">
                    {entry.impactedUnits !== undefined ? (
                      <span
                        className={
                          entry.impactedUnits > 0 ? "font-semibold text-red-600" : ""
                        }
                      >
                        {entry.impactedUnits}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[240px]">
                    <span className="line-clamp-2">{entry.description}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {entry.startedAt.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── COPQ Summary Cards + Table ───────────────────────────────────────────────

function COPQSummary({ records }: { records: COPQRecord[] }) {
  const totals = useMemo(
    () => ({
      scrap: records.reduce((s, r) => s + r.scrapCostINR, 0),
      rework: records.reduce((s, r) => s + r.reworkLabourCostINR, 0),
      appraisal: records.reduce((s, r) => s + r.appraisalCostINR, 0),
      prevention: records.reduce((s, r) => s + r.preventionCostINR, 0),
      total: records.reduce((s, r) => s + r.totalCOPQINR, 0),
    }),
    [records]
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">COPQ Summary</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Cost of Poor Quality — aggregate across all recorded periods
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Scrap Cost</p>
            <p className="text-sm font-bold text-red-700">
              {formatCurrency(totals.scrap)}
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Rework Labour</p>
            <p className="text-sm font-bold text-amber-700">
              {formatCurrency(totals.rework)}
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Appraisal</p>
            <p className="text-sm font-bold text-blue-700">
              {formatCurrency(totals.appraisal)}
            </p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Prevention</p>
            <p className="text-sm font-bold text-green-700">
              {formatCurrency(totals.prevention)}
            </p>
          </div>
          <div className="rounded-lg border-2 border-gray-400 bg-white p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Total COPQ</p>
            <p className="text-sm font-bold text-foreground">
              {formatCurrency(totals.total)}
            </p>
          </div>
        </div>

        {/* Per-period table */}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">
                  Period (WO#)
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Batch Qty
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Scrap (₹)
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Rework Labour (₹)
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Appraisal (₹)
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Prevention (₹)
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Total COPQ (₹)
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  % of Revenue
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map((rec) => (
                <tr key={rec.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {rec.workOrderNumber}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right">
                    {rec.batchQty}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right text-red-700 font-medium">
                    {formatCurrency(rec.scrapCostINR)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right text-amber-700">
                    {formatCurrency(rec.reworkLabourCostINR)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right text-blue-700">
                    {formatCurrency(rec.appraisalCostINR)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right text-green-700">
                    {formatCurrency(rec.preventionCostINR)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right font-bold">
                    {formatCurrency(rec.totalCOPQINR)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right">
                    <span
                      className={`font-semibold ${
                        rec.copqPercent > 20
                          ? "text-red-700"
                          : rec.copqPercent > 10
                          ? "text-amber-700"
                          : "text-green-700"
                      }`}
                    >
                      {rec.copqPercent}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OEEPage() {
  const avgOEE = getOEEAvg();

  const bestLine = useMemo(() => {
    if (oeeRecords.length === 0) return null;
    return oeeRecords.reduce((best, rec) =>
      rec.oee > best.oee ? rec : best
    );
  }, []);

  const worstLine = useMemo(() => {
    if (oeeRecords.length === 0) return null;
    return oeeRecords.reduce((worst, rec) =>
      rec.oee < worst.oee ? rec : worst
    );
  }, []);

  const oeeTarget = 85;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="OEE & COPQ Analytics"
        description="Overall Equipment Effectiveness · Cost of Poor Quality · Line Performance — ISO 13485 / IEC 62304"
      />

      {/* OEE Formula Card */}
      <OEEFormulaCard />

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Avg OEE%"
          value={`${avgOEE}%`}
          icon={Activity}
          iconColor={
            avgOEE >= 85
              ? "text-green-600"
              : avgOEE >= 75
              ? "text-amber-600"
              : "text-red-600"
          }
        />
        <KPICard
          title="Best Line OEE"
          value={
            bestLine
              ? `${bestLine.oee}% (${bestLine.line})`
              : "—"
          }
          icon={TrendingUp}
          iconColor="text-green-600"
        />
        <KPICard
          title="Worst Line OEE"
          value={
            worstLine
              ? `${worstLine.oee}% (${worstLine.line})`
              : "—"
          }
          icon={TrendingDown}
          iconColor="text-red-600"
        />
        <KPICard
          title="Target OEE"
          value={`${oeeTarget}%`}
          icon={Target}
          iconColor="text-blue-600"
        />
      </div>

      {/* OEE Records Table */}
      <OEERecordsTable records={oeeRecords} />

      {/* Line Comparison */}
      <LineComparison records={oeeRecords} />

      {/* Downtime Log */}
      <DowntimeLog entries={downtimeEntries} />

      {/* COPQ Summary */}
      <COPQSummary records={copqRecords} />
    </div>
  );
}
