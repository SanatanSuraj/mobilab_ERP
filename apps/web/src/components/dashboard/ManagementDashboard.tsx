"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  TrendingUp,
  DollarSign,
  Factory,
  BarChart3,
} from "lucide-react";
import { useApiDeals } from "@/hooks/useCrmApi";
import { useApiWorkOrders } from "@/hooks/useProductionApi";
import { formatCurrency } from "@/lib/format";
import type { Deal, WorkOrder } from "@instigenie/contracts";

/**
 * Management dashboard — live data from /crm/deals + /production/work-orders.
 *
 * Deliberately leaves OEE as 0 for now: there's no `/production/oee` endpoint
 * wired to React Query yet. Plug it in when the hook lands; the KPI slot is
 * already there.
 *
 * Mock → real shape deltas:
 *   - `stage`/`status` strings are UPPER_CASE (CLOSED_WON, IN_PROGRESS, ...).
 *   - `value` on Deal is a decimal string; we parse with Number() for sums.
 *   - `assignedTo` is a uuid (or null). No users endpoint exists for name
 *     lookup yet, so the Rep column falls back to "Unassigned" / uuid prefix.
 */

function toNumber(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const OPEN_STAGES: Deal["stage"][] = ["DISCOVERY", "PROPOSAL", "NEGOTIATION"];
const ACTIVE_WO_STATUSES: WorkOrder["status"][] = [
  "IN_PROGRESS",
  "MATERIAL_CHECK",
];

export function ManagementDashboard() {
  const dealsQuery = useApiDeals({ limit: 100 });
  const workOrdersQuery = useApiWorkOrders({ limit: 100 });

  const deals = useMemo(
    () => dealsQuery.data?.data ?? [],
    [dealsQuery.data?.data]
  );
  const workOrders = useMemo(
    () => workOrdersQuery.data?.data ?? [],
    [workOrdersQuery.data?.data]
  );

  const pipelineValue = useMemo(
    () =>
      deals
        .filter((d) => OPEN_STAGES.includes(d.stage))
        .reduce((s, d) => s + toNumber(d.value), 0),
    [deals]
  );

  const revenue = useMemo(
    () =>
      deals
        .filter((d) => d.stage === "CLOSED_WON")
        .reduce((s, d) => s + toNumber(d.value), 0),
    [deals]
  );

  const activeWOs = useMemo(
    () => workOrders.filter((w) => ACTIVE_WO_STATUSES.includes(w.status)).length,
    [workOrders]
  );

  const onHoldWOs = useMemo(
    () => workOrders.filter((w) => w.status === "QC_HOLD"),
    [workOrders]
  );

  const topDeals = useMemo(
    () =>
      [...deals]
        .filter((d) => OPEN_STAGES.includes(d.stage))
        .sort((a, b) => toNumber(b.value) - toNumber(a.value))
        .slice(0, 5),
    [deals]
  );

  const isLoading = dealsQuery.isLoading || workOrdersQuery.isLoading;
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {onHoldWOs.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {onHoldWOs.length} Work Order{onHoldWOs.length > 1 ? "s" : ""} on
              QC hold
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {onHoldWOs.map((w) => w.pid).join(", ")} — requires management
              attention.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Pipeline Value"
          value={formatCurrency(pipelineValue)}
          icon={TrendingUp}
          trend="up"
          iconColor="text-blue-600"
        />
        <KPICard
          title="Revenue (Won Deals)"
          value={formatCurrency(revenue)}
          icon={DollarSign}
          trend="up"
          iconColor="text-green-600"
        />
        <KPICard
          title="Active Work Orders"
          value={String(activeWOs)}
          icon={Factory}
          trend="neutral"
          iconColor="text-amber-600"
        />
        <KPICard
          title="OEE Avg"
          value="—"
          icon={BarChart3}
          trend="neutral"
          iconColor="text-muted-foreground"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Top Active Deals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Company</TableHead>
                    <TableHead>Deal</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Rep</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topDeals.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        No active deals yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    topDeals.map((deal) => (
                      <TableRow key={deal.id}>
                        <TableCell className="text-sm font-medium">
                          {deal.company}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {deal.title}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {formatCurrency(toNumber(deal.value))}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={deal.stage} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {deal.assignedTo
                            ? deal.assignedTo.slice(0, 8)
                            : "Unassigned"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Work Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>WO#</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workOrders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-xs text-muted-foreground py-6"
                      >
                        No work orders yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    workOrders.slice(0, 8).map((wo) => (
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
                        <TableCell className="text-xs text-muted-foreground">
                          {wo.targetDate
                            ? new Date(wo.targetDate).toLocaleDateString(
                                "en-IN",
                                {
                                  day: "2-digit",
                                  month: "short",
                                }
                              )
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
