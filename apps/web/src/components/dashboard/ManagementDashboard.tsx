"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, TrendingUp, DollarSign, Factory, BarChart3 } from "lucide-react";
import { deals, getUserById } from "@/data/mock";
import {
  mobiWorkOrders,
  getOnHoldWOs,
  getOEEAvg,
  isWOOverdue,
  getWOProgress,
} from "@/data/mobilab-mock";
import { formatCurrency, formatDate, daysDiff } from "@/lib/format";

export function ManagementDashboard() {
  // Live "today" — never hardcoded
  const today = useMemo(() => new Date(), []);

  const pipelineValue = useMemo(
    () =>
      deals
        .filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost")
        .reduce((s, d) => s + d.value, 0),
    []
  );

  const revenue = useMemo(
    () =>
      deals
        .filter((d) => d.stage === "closed_won")
        .reduce((s, d) => s + d.value, 0),
    []
  );

  const activeWOs = useMemo(
    () =>
      mobiWorkOrders.filter(
        (w) => w.status === "IN_PROGRESS" || w.status === "RM_ISSUED"
      ).length,
    []
  );

  const oeeAvg = useMemo(() => getOEEAvg(), []);
  const onHoldWOs = useMemo(() => getOnHoldWOs(), []);

  const topDeals = useMemo(
    () =>
      [...deals]
        .filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost")
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    []
  );

  return (
    <div className="space-y-6">
      {onHoldWOs.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {onHoldWOs.length} Work Order{onHoldWOs.length > 1 ? "s" : ""} ON HOLD
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {onHoldWOs.map((w) => w.woNumber).join(", ")} — requires management attention.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Pipeline Value" value={formatCurrency(pipelineValue)} icon={TrendingUp} trend="up" iconColor="text-blue-600" />
        <KPICard title="Revenue (Won Deals)" value={formatCurrency(revenue)} icon={DollarSign} trend="up" iconColor="text-green-600" />
        <KPICard title="Active Work Orders" value={String(activeWOs)} icon={Factory} trend="neutral" iconColor="text-amber-600" />
        <KPICard title="OEE Avg" value={`${oeeAvg}%`} icon={BarChart3} trend={oeeAvg >= 75 ? "up" : "down"} iconColor={oeeAvg >= 75 ? "text-green-600" : "text-red-600"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Top Active Deals</CardTitle>
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
                  {topDeals.map((deal) => {
                    const rep = getUserById(deal.assignedTo);
                    return (
                      <TableRow key={deal.id}>
                        <TableCell className="text-sm font-medium">{deal.company}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{deal.title}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {formatCurrency(deal.value)}
                        </TableCell>
                        <TableCell><StatusBadge status={deal.stage} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{rep?.name ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Work Orders (RAG)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>WO#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mobiWorkOrders.map((wo) => {
                    const overdue = isWOOverdue(wo);
                    const pct = getWOProgress(wo);
                    // daysDiff: negative = future (days remaining), positive = past (overdue)
                    const daysRemaining = -daysDiff(today, wo.targetEndDate);
                    return (
                      <TableRow key={wo.id}>
                        <TableCell className="font-mono text-xs">{wo.woNumber}</TableCell>
                        <TableCell className="text-xs">{wo.productCodes.join("+")}</TableCell>
                        <TableCell><StatusBadge status={wo.status} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <Progress value={pct} className="h-1.5 flex-1" />
                            <span className="text-xs tabular-nums text-muted-foreground w-8">{pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell className={`text-right text-xs font-medium tabular-nums ${overdue ? "text-red-600" : ""}`}>
                          {overdue ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d`}
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
    </div>
  );
}
