"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Factory,
  ShieldCheck,
  Clock,
  BarChart3,
} from "lucide-react";
import { useApiWorkOrders } from "@/hooks/useProductionApi";
import { formatDate } from "@/lib/format";
import type { WorkOrder } from "@instigenie/contracts";

/**
 * Production shop-floor dashboard — live data from /production/work-orders.
 *
 * Device-ID registry, scrap ledger, and OEE aggregation are not yet exposed
 * by the real API, so the panels that relied on those mocks have been
 * removed. When those endpoints land, add the KPI slots + tables back.
 */

const ACTIVE_STATUSES: WorkOrder["status"][] = [
  "PLANNED",
  "MATERIAL_CHECK",
  "IN_PROGRESS",
  "REWORK",
];

function isOverdue(wo: WorkOrder): boolean {
  if (!wo.targetDate) return false;
  if (wo.status === "COMPLETED" || wo.status === "CANCELLED") return false;
  return new Date(wo.targetDate) < new Date();
}

export function ProductionDashboard() {
  const workOrdersQuery = useApiWorkOrders({ limit: 100 });

  const workOrders = useMemo(
    () => workOrdersQuery.data?.data ?? [],
    [workOrdersQuery.data?.data]
  );

  const openWOs = useMemo(
    () => workOrders.filter((w) => ACTIVE_STATUSES.includes(w.status)).length,
    [workOrders]
  );

  const qcHolds = useMemo(
    () => workOrders.filter((w) => w.status === "QC_HOLD"),
    [workOrders]
  );

  const overdueWOs = useMemo(
    () => workOrders.filter(isOverdue).length,
    [workOrders]
  );

  const completedWOs = useMemo(
    () => workOrders.filter((w) => w.status === "COMPLETED").length,
    [workOrders]
  );

  if (workOrdersQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {qcHolds.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {qcHolds.length} Work Order{qcHolds.length > 1 ? "s" : ""} on QC
              hold
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {qcHolds.map((w) => w.pid).join(", ")}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Open Work Orders"
          value={String(openWOs)}
          icon={Factory}
          trend="neutral"
          iconColor="text-blue-600"
        />
        <KPICard
          title="QC Holds"
          value={String(qcHolds.length)}
          icon={ShieldCheck}
          trend={qcHolds.length > 0 ? "down" : "up"}
          iconColor={qcHolds.length > 0 ? "text-red-600" : "text-green-600"}
        />
        <KPICard
          title="Overdue WOs"
          value={String(overdueWOs)}
          icon={Clock}
          trend={overdueWOs > 0 ? "down" : "up"}
          iconColor={overdueWOs > 0 ? "text-red-600" : "text-green-600"}
        />
        <KPICard
          title="Completed"
          value={String(completedWOs)}
          icon={BarChart3}
          trend="up"
          iconColor="text-green-600"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Work Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {workOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No work orders yet.
            </p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>WO#</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Rework</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workOrders.map((wo) => {
                    const overdue = isOverdue(wo);
                    return (
                      <TableRow key={wo.id}>
                        <TableCell className="font-mono text-xs">
                          {wo.pid}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {wo.quantity}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={wo.status} />
                        </TableCell>
                        <TableCell className="text-xs">{wo.priority}</TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {wo.reworkCount > 0 ? wo.reworkCount : "—"}
                        </TableCell>
                        <TableCell
                          className={`text-xs ${
                            overdue
                              ? "text-red-600 font-medium"
                              : "text-muted-foreground"
                          }`}
                        >
                          {wo.targetDate ? formatDate(wo.targetDate) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
