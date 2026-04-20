"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, AlertCircle, Factory, ShieldCheck, Clock, BarChart3 } from "lucide-react";
import {
  mobiWorkOrders,
  mobiDeviceIDs,
  scrapEntries,
  getOnHoldWOs,
  getOEEAvg,
  isWOOverdue,
  getWOProgress,
} from "@/data/mobilab-mock";
import { formatCurrency, formatDate, currentMonthPrefix } from "@/lib/format";

export function ProductionDashboard() {
  const onHoldWOs = useMemo(() => getOnHoldWOs(), []);

  const reworkLimitDevices = useMemo(
    () => mobiDeviceIDs.filter((d) => d.status === "REWORK_LIMIT_EXCEEDED"),
    []
  );

  const openWOs = useMemo(
    () =>
      mobiWorkOrders.filter(
        (w) => w.status !== "COMPLETED" && w.status !== "CANCELLED"
      ).length,
    []
  );

  const qcHolds = useMemo(
    () =>
      mobiWorkOrders.filter(
        (w) => w.status === "QC_IN_PROGRESS" || w.status === "QC_HANDOVER_PENDING"
      ).length,
    []
  );

  const overdueWOs = useMemo(
    () => mobiWorkOrders.filter((w) => isWOOverdue(w)).length,
    []
  );

  const oeeAvg = useMemo(() => getOEEAvg(), []);

  // Live current month — never hardcoded
  const thisMonthScrap = useMemo(() => {
    const month = currentMonthPrefix();
    return scrapEntries.filter((s) => s.scrappedAt.startsWith(month));
  }, []);

  return (
    <div className="space-y-6">
      {onHoldWOs.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {onHoldWOs.length} WO{onHoldWOs.length > 1 ? "s" : ""} on hold —{" "}
              {onHoldWOs[0]?.onHoldReason?.slice(0, 80) ?? ""}
            </p>
          </div>
        </div>
      )}
      {reworkLimitDevices.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">
              {reworkLimitDevices.length} device(s) with REWORK_LIMIT_EXCEEDED — initiate scrap write-off
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              {reworkLimitDevices.map((d) => d.deviceId).join(", ")}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Open Work Orders" value={String(openWOs)} icon={Factory} trend="neutral" iconColor="text-blue-600" />
        <KPICard title="QC Holds" value={String(qcHolds)} icon={ShieldCheck} trend={qcHolds > 0 ? "down" : "up"} iconColor={qcHolds > 0 ? "text-red-600" : "text-green-600"} />
        <KPICard title="Overdue WOs" value={String(overdueWOs)} icon={Clock} trend={overdueWOs > 0 ? "down" : "up"} iconColor={overdueWOs > 0 ? "text-red-600" : "text-green-600"} />
        <KPICard title="OEE %" value={`${oeeAvg}%`} icon={BarChart3} trend={oeeAvg >= 75 ? "up" : "down"} iconColor={oeeAvg >= 75 ? "text-green-600" : "text-amber-600"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Work Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>WO#</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mobiWorkOrders.map((wo) => {
                    const pct = getWOProgress(wo);
                    const overdue = isWOOverdue(wo);
                    return (
                      <TableRow key={wo.id}>
                        <TableCell className="font-mono text-xs">{wo.woNumber}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {wo.productCodes.map((pc) => (
                              <Badge key={pc} variant="outline" className="text-xs px-1 py-0">{pc}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell><StatusBadge status={wo.status} /></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <Progress value={pct} className="h-1.5 flex-1" />
                            <span className="text-xs text-muted-foreground w-6">{pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{wo.lineAssignments.length}</TableCell>
                        <TableCell className={`text-xs ${overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {formatDate(wo.targetEndDate)}
                        </TableCell>
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
            <CardTitle className="text-base font-semibold">Scrap (April 2026)</CardTitle>
          </CardHeader>
          <CardContent>
            {thisMonthScrap.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No scrap this month.</p>
            ) : (
              <div className="space-y-3">
                {thisMonthScrap.map((s) => (
                  <div key={s.id} className="p-3 rounded-lg border space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium">{s.deviceId ?? s.scrapNumber}</span>
                      <StatusBadge status={s.rootCause} />
                    </div>
                    <p className="text-xs text-muted-foreground">{s.rootCauseDescription.slice(0, 60)}…</p>
                    <p className="text-sm font-semibold text-red-600">{formatCurrency(s.scrapValueINR)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
