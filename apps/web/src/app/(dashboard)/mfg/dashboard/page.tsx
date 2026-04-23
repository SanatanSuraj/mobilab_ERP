"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ProductBadge } from "@/components/shared/product-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  getActiveWOs,
  getOnHoldWOs,
  getWOProgress,
  getOEEAvg,
  getTotalScrapValue,
  formatCurrency,
  formatDate,
  mobiWorkOrders,
  oeeRecords,
  scrapEntries,
  mobiDeviceIDs,
  isFinishedDevice,
  isFinishedDeviceCode,
  isModule,
  isModuleCode,
} from "@/data/instigenie-mock";
import {
  AlertCircle,
  Activity,
  Package,
  TrendingDown,
  BarChart3,
  ClipboardList,
} from "lucide-react";

export default function MfgDashboardPage() {
  const activeWOs = useMemo(() => getActiveWOs(), []);
  const onHoldWOs = useMemo(() => getOnHoldWOs(), []);
  const oeeAvg = useMemo(() => getOEEAvg(), []);
  const totalScrapValue = useMemo(() => getTotalScrapValue(), []);

  // Units in production today, split by kind (Device=MCC only, Module=MBA/MBM/MBC/CFG)
  const { devicesInProduction, modulesInProduction } = useMemo(() => {
    let devices = 0;
    let modules = 0;
    for (const d of mobiDeviceIDs) {
      if (d.status !== "IN_PRODUCTION") continue;
      if (isFinishedDevice(d)) devices++;
      else if (isModule(d)) modules++;
    }
    return { devicesInProduction: devices, modulesInProduction: modules };
  }, []);

  // Last 4 OEE records for trend table
  const recentOEE = useMemo(
    () =>
      [...oeeRecords]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 4),
    []
  );

  // Pre-compute completed Device (MCC) vs Module (MBA/MBM/MBC/CFG) counts per WO
  // so the Active WO table can show "Devices" and "Modules" columns without per-row filters.
  const completedUnitsByWO = useMemo(() => {
    const map = new Map<string, { devices: number; modules: number }>();
    for (const d of mobiDeviceIDs) {
      if (
        d.status === "FINAL_QC_PASS" ||
        d.status === "RELEASED" ||
        d.status === "DISPATCHED"
      ) {
        const prev = map.get(d.workOrderId) ?? { devices: 0, modules: 0 };
        if (isFinishedDevice(d)) prev.devices++;
        else if (isModule(d)) prev.modules++;
        map.set(d.workOrderId, prev);
      }
    }
    return map;
  }, []);

  return (
    <div className="space-y-8 p-6">
      <PageHeader
        title="Manufacturing Dashboard — Instigenie"
        description="Mobicase Diagnostic Suite | ISO 13485 | Guwahati Plant"
      />

      {/* On-Hold Alert Banners */}
      {onHoldWOs.map((wo) => (
        <div
          key={wo.id}
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">ON HOLD — </span>
            <span className="font-mono text-amber-800">{wo.woNumber}</span>
            {wo.onHoldReason && (
              <span className="ml-1 text-amber-800">
                {" "}
                &mdash; {wo.onHoldReason}
              </span>
            )}
          </div>
        </div>
      ))}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active Work Orders"
          value={String(activeWOs.length)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change={`${onHoldWOs.length} on hold`}
          trend={onHoldWOs.length > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="Units in Production"
          value={String(devicesInProduction + modulesInProduction)}
          icon={Package}
          iconColor="text-indigo-600"
          change={`${devicesInProduction} Device · ${modulesInProduction} Module`}
          trend="neutral"
        />
        <KPICard
          title="OEE (Avg)"
          value={`${oeeAvg}%`}
          icon={BarChart3}
          iconColor={oeeAvg >= 75 ? "text-green-600" : "text-red-600"}
          change={oeeAvg >= 75 ? "Target met (≥75%)" : "Below target (<75%)"}
          trend={oeeAvg >= 75 ? "up" : "down"}
        />
        <KPICard
          title="Total Scrap Value"
          value={formatCurrency(totalScrapValue)}
          icon={TrendingDown}
          iconColor="text-red-600"
          change="All recorded scrap entries"
          trend="down"
        />
      </div>

      {/* Active Work Orders Table */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Active Work Orders</h2>
        <Card>
          <CardContent className="p-0">
            {activeWOs.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                No active work orders
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        WO #
                      </th>
                      <th
                        className="text-left px-4 py-3 font-medium text-muted-foreground"
                        title="Finished device — MCC (Mobicase)"
                      >
                        Device
                      </th>
                      <th
                        className="text-left px-4 py-3 font-medium text-muted-foreground"
                        title="Sub-assembly modules — MBA, MBM, MBC, CFG"
                      >
                        Module
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Planned
                      </th>
                      <th
                        className="text-right px-4 py-3 font-medium text-muted-foreground"
                        title="Finished devices (MCC) completed on this WO"
                      >
                        Devices ✓
                      </th>
                      <th
                        className="text-right px-4 py-3 font-medium text-muted-foreground"
                        title="Sub-assembly modules (MBA/MBM/MBC/CFG) completed on this WO"
                      >
                        Modules ✓
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Lines
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Progress
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Days Remaining
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activeWOs.map((wo) => {
                      const progress = getWOProgress(wo);
                      const today = new Date("2026-04-17");
                      const end = new Date(wo.targetEndDate);
                      const daysRemaining = Math.ceil(
                        (end.getTime() - today.getTime()) /
                          (1000 * 60 * 60 * 24)
                      );

                      // Use pre-computed map — O(1) lookup instead of O(n) filter
                      const completed = completedUnitsByWO.get(wo.id) ?? { devices: 0, modules: 0 };

                      const isOverdue = daysRemaining < 0;
                      const isOnHold = wo.status === "ON_HOLD";

                      return (
                        <tr
                          key={wo.id}
                          className={`hover:bg-muted/30 transition-colors ${
                            isOnHold ? "bg-amber-50/40" : ""
                          } ${isOverdue ? "bg-red-50/40" : ""}`}
                        >
                          <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                            {wo.woNumber}
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const deviceCodes = wo.productCodes.filter(isFinishedDeviceCode);
                              if (deviceCodes.length === 0)
                                return <span className="text-muted-foreground text-xs">—</span>;
                              return (
                                <div className="flex gap-1 flex-wrap">
                                  {deviceCodes.map((pc) => (
                                    <ProductBadge key={pc} productCode={pc} />
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const moduleCodes = wo.productCodes
                                .filter(isModuleCode)
                                .slice()
                                .sort((a, b) => a.localeCompare(b));
                              if (moduleCodes.length === 0)
                                return <span className="text-muted-foreground text-xs">—</span>;
                              return (
                                <div className="flex gap-1 flex-wrap">
                                  {moduleCodes.map((pc) => (
                                    <ProductBadge key={pc} productCode={pc} />
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {wo.batchQty}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-indigo-700">
                            {completed.devices}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-slate-700">
                            {completed.modules}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={wo.status} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {wo.lineAssignments.map((la) => (
                                <StatusBadge key={la.line} status={la.line} />
                              ))}
                              {wo.lineAssignments.length === 0 && (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-sm font-semibold">
                                {progress}%
                              </span>
                              <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    progress >= 80
                                      ? "bg-green-500"
                                      : progress >= 40
                                      ? "bg-amber-500"
                                      : "bg-red-500"
                                  }`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td
                            className={`px-4 py-3 text-right text-sm font-medium ${
                              isOverdue
                                ? "text-red-700"
                                : daysRemaining <= 5
                                ? "text-amber-700"
                                : "text-muted-foreground"
                            }`}
                          >
                            {isOverdue
                              ? `${Math.abs(daysRemaining)}d overdue`
                              : `${daysRemaining}d`}
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

      {/* Two-column: OEE Trend + Scrap This Month */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* OEE Trend */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">OEE Trend</h2>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Date
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Line
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Avail%
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Perf%
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Qual%
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        OEE%
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentOEE.map((rec) => {
                      const isLow = rec.oee < 75;
                      return (
                        <tr
                          key={rec.id}
                          className={`hover:bg-muted/30 transition-colors ${
                            isLow ? "bg-red-50/60" : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {formatDate(rec.date)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={rec.line} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {rec.availability}%
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {rec.performance}%
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">
                            {rec.quality}%
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono text-xs font-bold ${
                              isLow ? "text-red-700" : "text-green-700"
                            }`}
                          >
                            {rec.oee}%
                            {isLow && (
                              <span className="ml-1 text-red-500">▼</span>
                            )}
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

        {/* Scrap This Month */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Scrap This Month</h2>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </div>
          <Card>
            <CardContent className="p-0">
              {scrapEntries.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No scrap entries
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                          Unit ID
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                          Root Cause
                        </th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                          Value (₹)
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                          CAPA
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {scrapEntries.map((s) => (
                        <tr
                          key={s.id}
                          className="hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="font-mono text-xs font-medium text-red-700">
                              {s.deviceId ?? "—"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {s.scrapNumber}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={s.rootCause} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-red-700">
                            {formatCurrency(s.scrapValueINR)}
                          </td>
                          <td className="px-4 py-3">
                            {s.linkedCAPANumber ? (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                {s.linkedCAPANumber}
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                                None
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t">
                      <tr>
                        <td
                          className="px-4 py-2 text-xs font-semibold text-muted-foreground"
                          colSpan={2}
                        >
                          Total
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-sm font-bold text-red-700">
                          {formatCurrency(totalScrapValue)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
