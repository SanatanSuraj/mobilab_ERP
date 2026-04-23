"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  enhancedWorkOrders,
  ecns,
  getWOProgress,
  isWOOverdue,
  getCompletedStages,
  formatDate,
} from "@/data/manufacturing-mock";
import {
  ClipboardList,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";

export default function ManufacturingDashboardPage() {
  const router = useRouter();

  const allWOs = enhancedWorkOrders;
  const openStatuses = ["PLANNED", "MATERIAL_CHECK", "IN_PROGRESS", "QC_HOLD", "REWORK"];
  const openWOs = allWOs.filter((wo) => openStatuses.includes(wo.status));
  const inProgressWOs = allWOs.filter((wo) => wo.status === "IN_PROGRESS");
  const qcHoldReworkWOs = allWOs.filter((wo) => wo.status === "QC_HOLD" || wo.status === "REWORK");

  const now = new Date();
  const thisMonthCompleted = allWOs.filter((wo) => {
    if (wo.status !== "COMPLETED" || !wo.completedAt) return false;
    const d = new Date(wo.completedAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const overdueWOs = allWOs.filter((wo) => isWOOverdue(wo));

  const activeWOs = allWOs.filter(
    (wo) => wo.status !== "COMPLETED" && wo.status !== "CANCELLED"
  );

  // Product family distribution
  const familyCounts: Record<string, number> = {};
  allWOs.forEach((wo) => {
    familyCounts[wo.productFamily] = (familyCounts[wo.productFamily] || 0) + 1;
  });
  const familyMax = Math.max(...Object.values(familyCounts), 1);

  // Stage distribution
  const stageCounts: Record<string, number> = {
    PLANNED: 0,
    MATERIAL_CHECK: 0,
    IN_PROGRESS: 0,
    QC_HOLD: 0,
    REWORK: 0,
  };
  allWOs.forEach((wo) => {
    if (stageCounts[wo.status] !== undefined) stageCounts[wo.status]++;
  });
  const stageMax = Math.max(...Object.values(stageCounts), 1);

  // Rework stats
  const reworkWOs = allWOs.filter((wo) => wo.reworkCount > 0);
  const totalReworks = allWOs.reduce((sum, wo) => sum + wo.reworkCount, 0);
  const reworkRate = allWOs.length > 0 ? Math.round((reworkWOs.length / allWOs.length) * 100) : 0;

  // ECN alerts: IN_REVIEW or APPROVED
  const ecnAlerts = ecns.filter(
    (ecn) => ecn.status === "IN_REVIEW" || ecn.status === "APPROVED"
  );

  const familyColors: Record<string, string> = {
    INSTIGENIE_INSTRUMENT: "bg-blue-500",
    CBL_DEVICE: "bg-purple-500",
    REAGENT: "bg-teal-500",
  };
  const familyLabels: Record<string, string> = {
    INSTIGENIE_INSTRUMENT: "Instigenie Instrument",
    CBL_DEVICE: "CBL Device",
    REAGENT: "Reagent",
  };
  const stageColors: Record<string, string> = {
    PLANNED: "bg-blue-400",
    MATERIAL_CHECK: "bg-amber-400",
    IN_PROGRESS: "bg-orange-400",
    QC_HOLD: "bg-red-400",
    REWORK: "bg-rose-500",
  };

  function getDaysRelative(dateStr: string) {
    const target = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Manufacturing"
        description="Production lifecycle — BOM → Work Order → WIP → Finished Goods"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="Open Work Orders"
          value={String(openWOs.length)}
          icon={ClipboardList}
          iconColor="text-blue-600"
          change="PLANNED + MATERIAL_CHECK + IN_PROGRESS + QC + REWORK"
          trend="neutral"
        />
        <KPICard
          title="In Progress"
          value={String(inProgressWOs.length)}
          icon={Loader2}
          iconColor="text-amber-600"
          change="Currently on floor"
          trend="neutral"
        />
        <KPICard
          title="QC Hold / Rework"
          value={String(qcHoldReworkWOs.length)}
          icon={AlertTriangle}
          iconColor="text-orange-600"
          change={qcHoldReworkWOs.length > 0 ? "Needs attention" : "All clear"}
          trend={qcHoldReworkWOs.length > 0 ? "down" : "up"}
        />
        <KPICard
          title="Completed (Month)"
          value={String(thisMonthCompleted.length)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="This calendar month"
          trend="up"
        />
        <KPICard
          title="Overdue"
          value={String(overdueWOs.length)}
          icon={Clock}
          iconColor="text-red-600"
          change={overdueWOs.length > 0 ? "Immediate action needed" : "On schedule"}
          trend={overdueWOs.length > 0 ? "down" : "up"}
        />
      </div>

      {/* ECN Alerts */}
      {ecnAlerts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">ECN Alerts</h2>
          <div className="space-y-2">
            {ecnAlerts.map((ecn) => (
              <div
                key={ecn.id}
                className={`flex items-start gap-4 p-4 rounded-lg border ${
                  ecn.status === "APPROVED" && ecn.isUrgent
                    ? "border-red-200 bg-red-50"
                    : ecn.status === "APPROVED"
                    ? "border-orange-200 bg-orange-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <AlertCircle
                  className={`h-5 w-5 mt-0.5 shrink-0 ${
                    ecn.status === "APPROVED" && ecn.isUrgent
                      ? "text-red-600"
                      : ecn.status === "APPROVED"
                      ? "text-orange-600"
                      : "text-amber-600"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold">{ecn.ecnNumber}</span>
                    <StatusBadge status={ecn.status} />
                    {ecn.isUrgent && (
                      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">URGENT</Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium mt-0.5">{ecn.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Affects: {ecn.affectedProductNames.join(", ")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/manufacturing/ecn/${ecn.id}`)}
                  className="shrink-0"
                >
                  View ECN
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Work Orders */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Active Work Orders</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {activeWOs.map((wo) => {
            const progress = getWOProgress(wo);
            const completedStages = getCompletedStages(wo);
            const overdue = isWOOverdue(wo);
            const daysRelative = getDaysRelative(wo.targetDate);
            const currentStage = wo.wipStages[wo.currentStageIndex];

            return (
              <Card key={wo.id} className={`hover:shadow-md transition-shadow ${overdue ? "border-red-200" : ""}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm">{wo.pid}</span>
                      <StatusBadge
                        status={wo.priority}
                        className={
                          wo.priority === "CRITICAL"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : wo.priority === "HIGH"
                            ? "bg-orange-50 text-orange-700 border-orange-200"
                            : "bg-gray-50 text-gray-600 border-gray-200"
                        }
                      />
                    </div>
                    <StatusBadge status={wo.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{wo.productName}</span>
                    <Badge
                      variant="outline"
                      className={
                        wo.productFamily === "INSTIGENIE_INSTRUMENT"
                          ? "bg-blue-50 text-blue-700 border-blue-200 text-xs"
                          : wo.productFamily === "CBL_DEVICE"
                          ? "bg-purple-50 text-purple-700 border-purple-200 text-xs"
                          : "bg-teal-50 text-teal-700 border-teal-200 text-xs"
                      }
                    >
                      {wo.productFamily.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">BOM {wo.bomVersion}</span>
                  </div>

                  {/* Progress */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        Stage {completedStages} of {wo.wipStages.length} complete
                      </span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  {/* Current Stage */}
                  {currentStage && (
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          currentStage.status === "IN_PROGRESS"
                            ? "bg-amber-500 animate-pulse"
                            : currentStage.status === "QC_HOLD"
                            ? "bg-red-500"
                            : currentStage.status === "REWORK"
                            ? "bg-orange-500"
                            : "bg-gray-300"
                        }`}
                      />
                      <span className="text-muted-foreground">Current:</span>
                      <span className="font-medium">{currentStage.stageName}</span>
                    </div>
                  )}

                  {/* Footer row */}
                  <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>Qty: <strong className="text-foreground">{wo.quantity}</strong></span>
                      <span>By: <strong className="text-foreground">{wo.assignedTo}</strong></span>
                      {wo.deviceSerials.length > 0 && (
                        <span>{wo.deviceSerials.length} serials</span>
                      )}
                    </div>
                    <div
                      className={`font-medium ${overdue ? "text-red-600" : "text-muted-foreground"}`}
                    >
                      {overdue
                        ? `${Math.abs(daysRelative)}d overdue`
                        : daysRelative === 0
                        ? "Due today"
                        : `${daysRelative}d remaining`}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push(`/manufacturing/work-orders/${wo.id}`)}
                  >
                    View Details
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Production Metrics */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Production Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* By Product Family */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">By Product Family</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(familyCounts).map(([family, count]) => (
                <div key={family} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{familyLabels[family] ?? family}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${familyColors[family] ?? "bg-gray-400"}`}
                      style={{ width: `${(count / familyMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Stage Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Stage Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(stageCounts).map(([status, count]) => (
                <div key={status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{status.replace(/_/g, " ")}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${stageColors[status] ?? "bg-gray-400"}`}
                      style={{ width: `${stageMax > 0 ? (count / stageMax) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Rework Rate */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Rework Rate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-3xl font-bold">{reworkRate}%</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {reworkWOs.length} of {allWOs.length} WOs have rework
                </div>
                <div className="text-xs text-muted-foreground">
                  Total rework events: {totalReworks}
                </div>
              </div>
              {reworkWOs.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">WOs with Rework</div>
                  {reworkWOs.map((wo) => (
                    <div
                      key={wo.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span
                        className="font-mono text-blue-600 cursor-pointer hover:underline"
                        onClick={() => router.push(`/manufacturing/work-orders/${wo.id}`)}
                      >
                        {wo.pid}
                      </span>
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
                        ↺ {wo.reworkCount}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              {reworkWOs.length === 0 && (
                <div className="text-center text-xs text-green-600 font-medium">
                  No rework events recorded
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
