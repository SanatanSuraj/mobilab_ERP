"use client";

// TODO(phase-5): Scrap / COPQ (Cost of Poor Quality) tracking has no backend
// routes yet. Expected routes:
//   GET  /mfg/scrap-entries?from=&to=&rootCause=
//   POST /mfg/scrap-entries - log a scrap event with root-cause + quantity
//   GET  /mfg/copq-records?period=YYYY-MM
// Mock imports left in place until the scrap/COPQ slice ships in
// apps/api/src/modules/mfg.

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  scrapEntries,
  copqRecords,
  getTotalScrapValue,
  formatCurrency,
  formatDate,
  ScrapEntry,
  ScrapRootCause,
  COPQRecord,
} from "@/data/instigenie-mock";
import {
  AlertTriangle,
  TrendingDown,
  DollarSign,
  Package,
  ShieldAlert,
  BarChart3,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rootCauseLabel(rc: ScrapRootCause): string {
  switch (rc) {
    case "OC_FITMENT":
      return "OC Fitment";
    case "PCB_ASSEMBLY_ERROR":
      return "PCB Assembly Error";
    case "INCOMING_MATERIAL":
      return "Incoming Material";
    case "DIMENSIONAL":
      return "Dimensional";
    case "PROCESS_ERROR":
      return "Process Error";
    case "HANDLING_ESD":
      return "Handling / ESD";
    case "FIRMWARE_ERROR":
      return "Firmware Error";
    case "OTHER":
      return "Other";
    default:
      return rc;
  }
}

interface ParetoRow {
  rootCause: ScrapRootCause;
  totalUnits: number;
  totalValue: number;
  entryCount: number;
}

function buildPareto(entries: ScrapEntry[]): ParetoRow[] {
  const map = new Map<ScrapRootCause, ParetoRow>();
  for (const entry of entries) {
    const existing = map.get(entry.rootCause);
    if (existing) {
      existing.totalUnits += entry.qtyScrap;
      existing.totalValue += entry.scrapValueINR;
      existing.entryCount += 1;
    } else {
      map.set(entry.rootCause, {
        rootCause: entry.rootCause,
        totalUnits: entry.qtyScrap,
        totalValue: entry.scrapValueINR,
        entryCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalValue - a.totalValue);
}

// ─── Alert Banner ─────────────────────────────────────────────────────────────

function CAPAAlertBanner() {
  const needsCapa = scrapEntries.filter(
    (e) => e.autoCAPATriggered && !e.linkedCAPANumber
  );
  if (needsCapa.length === 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
      <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
      <span className="text-sm font-semibold text-red-700">
        {needsCapa.length} entr{needsCapa.length !== 1 ? "ies" : "y"} require
        CAPA — action needed
      </span>
    </div>
  );
}

// ─── Scrap Log Table ──────────────────────────────────────────────────────────

function ScrapLogTable({ entries }: { entries: ScrapEntry[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <h2 className="text-base font-semibold">Scrap Log</h2>
        <p className="text-xs text-muted-foreground">
          All scrapped items with root cause and CAPA linkage
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Scrap #
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Unit / Item
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  WO#
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Root Cause
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Stage Lost
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Qty
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Scrap Value (₹)
                </th>
                <th className="px-4 py-3 text-center font-medium text-xs text-muted-foreground">
                  CAPA Req?
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  CAPA ID
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {entry.scrapNumber}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {entry.deviceId ? (
                      <div>
                        <p className="font-mono font-medium text-blue-700">
                          {entry.deviceId}
                        </p>
                        <p className="text-muted-foreground leading-snug mt-0.5">
                          {entry.itemName}
                        </p>
                      </div>
                    ) : (
                      <span>{entry.itemName}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {entry.workOrderNumber}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.rootCause} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {entry.stageName}
                  </td>
                  <td className="px-4 py-3 text-xs text-right font-medium">
                    {entry.qtyScrap}
                  </td>
                  <td className="px-4 py-3 text-xs text-right font-semibold text-red-700">
                    {formatCurrency(entry.scrapValueINR)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {entry.autoCAPATriggered ? (
                      <Badge
                        variant="outline"
                        className="text-xs bg-red-50 text-red-700 border-red-200"
                      >
                        Yes
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs bg-gray-50 text-gray-500 border-gray-200"
                      >
                        No
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {entry.linkedCAPANumber ? (
                      <span className="font-mono font-medium text-indigo-700">
                        {entry.linkedCAPANumber}
                      </span>
                    ) : entry.autoCAPATriggered ? (
                      <Badge
                        variant="outline"
                        className="text-xs bg-red-50 text-red-700 border-red-200"
                      >
                        Not Raised
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatDate(entry.scrappedAt)}
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

// ─── Root Cause Pareto ────────────────────────────────────────────────────────

function RootCausePareto({ paretoRows }: { paretoRows: ParetoRow[] }) {
  const maxValue = paretoRows[0]?.totalValue ?? 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Root Cause Pareto</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Ranked by total scrap value — highest impact first
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Rank
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                  Root Cause
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Entries
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Units Scrapped
                </th>
                <th className="px-4 py-3 text-right font-medium text-xs text-muted-foreground">
                  Total Value (₹)
                </th>
                <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground w-36">
                  Impact Bar
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {paretoRows.map((row, idx) => {
                const pct = Math.round((row.totalValue / maxValue) * 100);
                return (
                  <tr key={row.rootCause} className="hover:bg-muted/20">
                    <td className="px-4 py-3 text-xs font-bold text-muted-foreground">
                      #{idx + 1}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.rootCause} />
                    </td>
                    <td className="px-4 py-3 text-xs text-right">
                      {row.entryCount}
                    </td>
                    <td className="px-4 py-3 text-xs text-right font-medium">
                      {row.totalUnits}
                    </td>
                    <td className="px-4 py-3 text-xs text-right font-semibold text-red-700">
                      {formatCurrency(row.totalValue)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-32 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-red-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground mt-0.5 block">
                        {pct}%
                      </span>
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

// ─── COPQ Impact ──────────────────────────────────────────────────────────────

function COPQSection({ records }: { records: COPQRecord[] }) {
  const totals = useMemo(
    () => ({
      scrap: records.reduce((s, r) => s + r.scrapCostINR, 0),
      rework: records.reduce((s, r) => s + r.reworkLabourCostINR, 0),
      appraisal: records.reduce((s, r) => s + r.appraisalCostINR, 0),
      prevention: records.reduce((s, r) => s + r.preventionCostINR, 0),
      total: records.reduce((s, r) => s + r.totalCOPQINR, 0),
      revenue: records.reduce((s, r) => s + r.standardBatchCostINR, 0),
    }),
    [records]
  );

  const overallPct =
    totals.revenue > 0
      ? ((totals.total / totals.revenue) * 100).toFixed(1)
      : "0";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">
            COPQ Impact — Cost of Poor Quality
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Aggregate across all work orders
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
          <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">
              Total COPQ ({overallPct}%)
            </p>
            <p className="text-sm font-bold text-foreground">
              {formatCurrency(totals.total)}
            </p>
          </div>
        </div>

        {/* Per-WO table */}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">
                  WO#
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Batch Qty
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">
                  Scrap Cost (₹)
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
              {/* Totals row */}
              <tr className="bg-muted/40 font-semibold border-t-2">
                <td className="px-4 py-2.5 text-xs">Total</td>
                <td className="px-4 py-2.5 text-xs text-right">
                  {records.reduce((s, r) => s + r.batchQty, 0)}
                </td>
                <td className="px-4 py-2.5 text-xs text-right text-red-700">
                  {formatCurrency(totals.scrap)}
                </td>
                <td className="px-4 py-2.5 text-xs text-right text-amber-700">
                  {formatCurrency(totals.rework)}
                </td>
                <td className="px-4 py-2.5 text-xs text-right text-blue-700">
                  {formatCurrency(totals.appraisal)}
                </td>
                <td className="px-4 py-2.5 text-xs text-right text-green-700">
                  {formatCurrency(totals.prevention)}
                </td>
                <td className="px-4 py-2.5 text-xs text-right">
                  {formatCurrency(totals.total)}
                </td>
                <td className="px-4 py-2.5 text-xs text-right">
                  <span
                    className={`font-bold ${
                      parseFloat(overallPct) > 20
                        ? "text-red-700"
                        : "text-amber-700"
                    }`}
                  >
                    {overallPct}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ScrapPage() {
  const totalScrapValue = getTotalScrapValue();
  const totalUnits = scrapEntries.reduce((s, e) => s + e.qtyScrap, 0);
  const avgValuePerUnit =
    totalUnits > 0 ? Math.round(totalScrapValue / totalUnits) : 0;
  const capaTriggeredCount = scrapEntries.filter(
    (e) => e.autoCAPATriggered
  ).length;

  const paretoRows = useMemo(() => buildPareto(scrapEntries), []);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Scrap & CAPA Impact"
        description="Scrap log, root cause analysis, and Cost of Poor Quality (COPQ) — ISO 13485 §8.3"
      />

      {/* CAPA alert banner */}
      <CAPAAlertBanner />

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Scrap Value"
          value={formatCurrency(totalScrapValue)}
          icon={TrendingDown}
          iconColor="text-red-600"
        />
        <KPICard
          title="Total Units Scrapped"
          value={String(totalUnits)}
          icon={Package}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Avg Value / Unit"
          value={formatCurrency(avgValuePerUnit)}
          icon={DollarSign}
          iconColor="text-orange-600"
        />
        <KPICard
          title="CAPA Triggered"
          value={String(capaTriggeredCount)}
          icon={ShieldAlert}
          iconColor="text-indigo-600"
        />
      </div>

      {/* Scrap Log */}
      <ScrapLogTable entries={scrapEntries} />

      {/* Root Cause Pareto */}
      <RootCausePareto paretoRows={paretoRows} />

      {/* COPQ Impact */}
      <COPQSection records={copqRecords} />
    </div>
  );
}
