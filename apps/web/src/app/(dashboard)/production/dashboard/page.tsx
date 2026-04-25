"use client";

/**
 * Manufacturing dashboard — backed by real APIs.
 *
 *   GET /production/overview     → { totalWorkOrders, activeWip, completedToday,
 *                                    oee, scrapRate, machineUtilization,
 *                                    notImplemented[] }
 *   GET /production/work-orders  → enriched WO list (header + product + stages)
 *
 * `oee`, `scrapRate`, and `machineUtilization` come back null because the
 * source tables (oee_records, scrap_entries, machine_utilization) don't
 * exist yet. The dashboard surfaces only the data that IS backed — the
 * KPI tile shows OEE as "—" if the value is null, and the OEE / scrap /
 * machine-utilization sections that previously rendered placeholder
 * cards have been removed (FULL GO audit).
 *
 * No `@/data/*` imports — every datum on this page is server-derived.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApiProductionOverview,
  useApiWorkOrders,
} from "@/hooks/useProductionApi";
import type { WoStatus, WorkOrderListItem } from "@instigenie/contracts";
import {
  AlertCircle,
  Activity,
  BarChart3,
  ClipboardList,
  Package,
} from "lucide-react";

const ACTIVE_WO_STATUSES: ReadonlySet<WoStatus> = new Set([
  "MATERIAL_CHECK",
  "IN_PROGRESS",
  "QC_HOLD",
  "REWORK",
]);

const STATUS_TONE: Record<WoStatus, string> = {
  PLANNED: "bg-gray-50 text-gray-700 border-gray-200",
  MATERIAL_CHECK: "bg-amber-50 text-amber-700 border-amber-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  QC_HOLD: "bg-purple-50 text-purple-700 border-purple-200",
  REWORK: "bg-orange-50 text-orange-700 border-orange-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

const PRIORITY_TONE: Record<string, string> = {
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  NORMAL: "bg-gray-50 text-gray-700 border-gray-200",
  LOW: "bg-slate-50 text-slate-600 border-slate-200",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysFromNow(targetDate: string | null): number | null {
  if (!targetDate) return null;
  const t = new Date(targetDate);
  if (Number.isNaN(t.getTime())) return null;
  const now = new Date();
  return Math.ceil((t.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function ProductionDashboardPage() {
  const router = useRouter();

  const overviewQuery = useApiProductionOverview();
  const woQuery = useApiWorkOrders({ limit: 100 });

  const overview = overviewQuery.data;
  const workOrders: WorkOrderListItem[] = woQuery.data?.data ?? [];

  const activeWOs = useMemo(
    () => workOrders.filter((wo) => ACTIVE_WO_STATUSES.has(wo.status)),
    [workOrders]
  );

  const onHoldWOs = useMemo(
    () => workOrders.filter((wo) => wo.status === "QC_HOLD"),
    [workOrders]
  );

  // ─── Loading ────────────────────────────────────────────────────────────
  if (overviewQuery.isLoading || woQuery.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────
  if (overviewQuery.isError || woQuery.isError) {
    const err = overviewQuery.error ?? woQuery.error;
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load manufacturing dashboard
            </p>
            <p className="text-red-700 mt-1">
              {err instanceof Error ? err.message : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <PageHeader
        title="Manufacturing Dashboard"
        description="Live counts from the work-orders pipeline."
      />

      {/* QC-Hold Banners */}
      {onHoldWOs.map((wo) => (
        <div
          key={wo.id}
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">QC HOLD — </span>
            <span className="font-mono text-amber-800">{wo.pid}</span>
            <span className="ml-2 text-amber-800">
              {wo.productCode} · {wo.productName}
            </span>
          </div>
        </div>
      ))}

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Work Orders"
          value={String(overview?.totalWorkOrders ?? 0)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change={`${overview?.activeWip ?? 0} active`}
          trend="neutral"
        />
        <KPICard
          title="Active WIP"
          value={String(overview?.activeWip ?? 0)}
          icon={Package}
          iconColor="text-indigo-600"
          change={`${onHoldWOs.length} on QC hold`}
          trend={onHoldWOs.length > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="Completed Today"
          value={String(overview?.completedToday ?? 0)}
          icon={Activity}
          iconColor="text-green-600"
          change="from work_orders"
          trend="neutral"
        />
        <KPICard
          title="OEE (Avg)"
          value={overview?.oee == null ? "—" : `${overview.oee}%`}
          icon={BarChart3}
          iconColor="text-muted-foreground"
          change={
            overview?.notImplemented.includes("oee")
              ? "Not implemented — needs oee_records"
              : "Target ≥ 75%"
          }
          trend="neutral"
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
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Product
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Family
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Qty
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Priority
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                        Target
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                        Days Remaining
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activeWOs.map((wo) => {
                      const dr = daysFromNow(wo.targetDate);
                      const isOverdue = dr !== null && dr < 0;
                      return (
                        <tr
                          key={wo.id}
                          className={`hover:bg-muted/30 transition-colors cursor-pointer ${
                            wo.status === "QC_HOLD" ? "bg-amber-50/40" : ""
                          } ${isOverdue ? "bg-red-50/40" : ""}`}
                          onClick={() =>
                            router.push(`/production/work-orders/${wo.id}`)
                          }
                        >
                          <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                            {wo.pid}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{wo.productName}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {wo.productCode}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {wo.productFamily}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {wo.quantity}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={`text-xs whitespace-nowrap ${STATUS_TONE[wo.status]}`}
                            >
                              {wo.status.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={`text-xs ${PRIORITY_TONE[wo.priority] ?? ""}`}
                            >
                              {wo.priority}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {formatDate(wo.targetDate)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right text-sm font-medium ${
                              isOverdue
                                ? "text-red-700"
                                : dr !== null && dr <= 5
                                ? "text-amber-700"
                                : "text-muted-foreground"
                            }`}
                          >
                            {dr === null
                              ? "—"
                              : isOverdue
                              ? `${Math.abs(dr)}d overdue`
                              : `${dr}d`}
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

      {/*
       * OEE / Scrap / Machine-utilization sections previously rendered
       * <AwaitingBackend/> placeholders against tables that don't exist
       * yet (oee_records, scrap_entries, machine_utilization). Per the
       * production-readiness audit (zero-conditions FULL GO) those
       * stub cards have been removed — the dashboard now renders only
       * surfaces backed by real data. The KPI row above still surfaces
       * `overview.oee` if the backing table is added later (the value
       * is returned as null today and shows as "—").
       */}
    </div>
  );
}
