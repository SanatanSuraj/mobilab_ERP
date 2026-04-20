"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  enhancedWorkOrders,
  EnhancedWorkOrder,
  WOStatus,
  getWOProgress,
  isWOOverdue,
  getCompletedStages,
  formatDate,
} from "@/data/manufacturing-mock";
import {
  Factory,
  AlertTriangle,
  RefreshCcw,
  CheckCircle2,
  Clock,
} from "lucide-react";

type KanbanColumn = {
  key: WOStatus;
  label: string;
  colorClass: string;
  headerClass: string;
};

const KANBAN_COLUMNS: KanbanColumn[] = [
  { key: "PLANNED", label: "Planned", colorClass: "bg-blue-50 border-blue-200", headerClass: "bg-blue-100 text-blue-800" },
  { key: "MATERIAL_CHECK", label: "Material Check", colorClass: "bg-amber-50 border-amber-200", headerClass: "bg-amber-100 text-amber-800" },
  { key: "IN_PROGRESS", label: "In Progress", colorClass: "bg-green-50 border-green-200", headerClass: "bg-green-100 text-green-800" },
  { key: "QC_HOLD", label: "QC Hold", colorClass: "bg-orange-50 border-orange-200", headerClass: "bg-orange-100 text-orange-800" },
  { key: "REWORK", label: "Rework", colorClass: "bg-red-50 border-red-200", headerClass: "bg-red-100 text-red-800" },
];

const PRIORITY_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH: "bg-orange-400",
  NORMAL: "bg-gray-400",
  LOW: "bg-gray-300",
};

function WOCard({ wo }: { wo: EnhancedWorkOrder }) {
  const progress = getWOProgress(wo);
  const overdue = isWOOverdue(wo);
  const currentStage = wo.wipStages[wo.currentStageIndex];
  const priorityDot = PRIORITY_DOT[wo.priority] ?? "bg-gray-400";
  const initial = wo.assignedTo.charAt(0).toUpperCase();

  return (
    <div className="bg-white rounded-lg border shadow-sm p-3 space-y-2.5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full shrink-0 ${priorityDot}`} />
          <span className="font-mono font-bold text-xs">{wo.pid}</span>
        </div>
        <Badge variant="outline" className="text-xs px-1.5">{wo.priority}</Badge>
      </div>
      <div>
        <p className="text-sm font-medium truncate leading-tight">{wo.productName}</p>
        <p className="text-xs text-muted-foreground">Qty: {wo.quantity}</p>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Progress</span>
          <span className="tabular-nums font-medium">{progress}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>
      {currentStage && (
        <p className="text-xs text-muted-foreground truncate">
          Stage: {currentStage.stageName}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${overdue ? "text-red-600" : "text-muted-foreground"}`}>
          {overdue && <AlertTriangle className="h-3 w-3 inline mr-0.5" />}
          {formatDate(wo.targetDate)}
        </span>
        <div className="flex items-center gap-1">
          <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
            {initial}
          </div>
          <span className="text-xs text-muted-foreground">{wo.assignedTo.split(" ")[0]}</span>
        </div>
      </div>
    </div>
  );
}

export default function WIPTrackerPage() {
  const activeWOs = useMemo(
    () => enhancedWorkOrders.filter((wo) => wo.status !== "COMPLETED" && wo.status !== "CANCELLED"),
    []
  );

  const totalActive = activeWOs.length;
  const inAssembly = activeWOs.filter((wo) => wo.status === "IN_PROGRESS").length;
  const inQCHold = activeWOs.filter((wo) => wo.status === "QC_HOLD").length;
  const inRework = activeWOs.filter((wo) => wo.status === "REWORK").length;
  const onTrack = activeWOs.filter(
    (wo) => !isWOOverdue(wo) && wo.status !== "QC_HOLD" && wo.status !== "REWORK"
  ).length;

  const inProgressWOs = activeWOs.filter((wo) => wo.status === "IN_PROGRESS");

  // QC Gates across all WOs
  const qcGateRows = useMemo(() => {
    const rows: Array<{
      pid: string;
      stageName: string;
      gateNum: number;
      status: string;
      qcResult: string;
      isFailed: boolean;
    }> = [];

    for (const wo of enhancedWorkOrders) {
      let gateNum = 0;
      for (const stage of wo.wipStages) {
        if (stage.requiresQCSignOff) {
          gateNum++;
          rows.push({
            pid: wo.pid,
            stageName: stage.stageName,
            gateNum,
            status: stage.status,
            qcResult: stage.qcResult ?? "Pending",
            isFailed: stage.qcResult === "FAIL",
          });
        }
      }
    }
    return rows;
  }, []);

  // Stage breakdown for IN_PROGRESS WOs
  const stageBreakdown = useMemo(() => {
    return inProgressWOs.map((wo) => {
      const currentStage = wo.wipStages[wo.currentStageIndex];
      const totalStages = wo.wipStages.length;
      const completedStages = getCompletedStages(wo);
      const remainingHours = currentStage?.expectedDurationHours ?? 0;
      // Sort: QC gate stages first, then by targetDate
      return {
        wo,
        currentStage,
        totalStages,
        completedStages,
        remainingHours,
        isQCGate: currentStage?.requiresQCSignOff ?? false,
      };
    }).sort((a, b) => {
      if (a.isQCGate && !b.isQCGate) return -1;
      if (!a.isQCGate && b.isQCGate) return 1;
      return new Date(a.wo.targetDate).getTime() - new Date(b.wo.targetDate).getTime();
    });
  }, [inProgressWOs]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="WIP Tracker"
        description="Real-time work-in-progress visibility across all active production orders"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Total Active WOs"
          value={String(totalActive)}
          icon={Factory}
          iconColor="text-blue-600"
          change="Non-completed/cancelled"
          trend="neutral"
        />
        <KPICard
          title="In Assembly"
          value={String(inAssembly)}
          icon={RefreshCcw}
          iconColor="text-green-600"
          change="IN_PROGRESS status"
          trend="neutral"
        />
        <KPICard
          title="QC Hold"
          value={String(inQCHold)}
          icon={AlertTriangle}
          iconColor="text-orange-500"
          change={inQCHold > 0 ? "Requires QC resolution" : "All clear"}
          trend={inQCHold > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="Rework"
          value={String(inRework)}
          icon={RefreshCcw}
          iconColor="text-red-600"
          change={inRework > 0 ? "Active rework in progress" : "None"}
          trend={inRework > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="On Track"
          value={String(onTrack)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="Not overdue, no holds"
          trend="up"
        />
      </div>

      {/* Live Production Board — Kanban */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Live Production Board
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {KANBAN_COLUMNS.map((col) => {
              const colWOs = activeWOs.filter((wo) => wo.status === col.key);
              return (
                <div key={col.key} className="flex-none w-60">
                  {/* Column Header */}
                  <div className={`rounded-t-lg px-3 py-2 flex items-center justify-between ${col.headerClass}`}>
                    <span className="font-semibold text-xs uppercase tracking-wide">{col.label}</span>
                    <Badge variant="outline" className="bg-white/60 text-xs font-bold border-0">
                      {colWOs.length}
                    </Badge>
                  </div>
                  {/* Column Body */}
                  <div className={`rounded-b-lg border border-t-0 p-2 space-y-2 min-h-[120px] ${col.colorClass}`}>
                    {colWOs.length === 0 ? (
                      <div className="flex items-center justify-center h-16 text-xs text-muted-foreground">
                        No orders
                      </div>
                    ) : (
                      colWOs.map((wo) => <WOCard key={wo.id} wo={wo} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Stage-level Breakdown for IN_PROGRESS WOs */}
      {stageBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stage-level Breakdown — In Progress</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>PID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Current Stage</TableHead>
                  <TableHead>Stage Progress</TableHead>
                  <TableHead>Expected Duration</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageBreakdown.map(({ wo, currentStage, totalStages, completedStages, remainingHours, isQCGate }) => (
                  <TableRow key={wo.id} className={isQCGate ? "bg-purple-50/40" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm">{wo.pid}</span>
                        {isQCGate && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-xs">
                            QC Gate
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{wo.productName}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {currentStage?.stageName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {completedStages}/{totalStages} stages
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <Clock className="h-3 w-3 inline mr-1" />
                      {remainingHours}h remaining
                    </TableCell>
                    <TableCell className="text-sm">{wo.assignedTo}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                      {currentStage?.notes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* QC Gates Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">QC Gates Status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>PID</TableHead>
                <TableHead>Stage Name</TableHead>
                <TableHead>QC Gate #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>QC Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {qcGateRows.map((row, idx) => (
                <TableRow key={idx} className={row.isFailed ? "bg-red-50" : ""}>
                  <TableCell>
                    <span className="font-mono font-bold text-sm">{row.pid}</span>
                  </TableCell>
                  <TableCell className="text-sm">{row.stageName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">QC Gate {row.gateNum}</Badge>
                  </TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell>
                    {row.qcResult === "PASS" ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">PASS</Badge>
                    ) : row.qcResult === "FAIL" ? (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs font-bold">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        FAIL
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">Pending</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {qcGateRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No QC gates found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
