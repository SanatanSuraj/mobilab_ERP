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
import { Badge } from "@/components/ui/badge";
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
  ShieldCheck,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useApiQcInspections } from "@/hooks/useQcApi";
import type { QcInspection } from "@instigenie/contracts";

/**
 * QC dashboard — live data from /qc/inspections.
 *
 * Kind → bucket:
 *   - IQC       → "Incoming"
 *   - SUB_QC    → "WIP"
 *   - FINAL_QC  → "Final"
 *
 * CAPAs and equipment calibration panels are gone: no real API backs them.
 * Plug them back in when /qc/capas and /qc/equipment endpoints land.
 */

function kindLabel(k: QcInspection["kind"]): string {
  switch (k) {
    case "IQC":
      return "Incoming";
    case "SUB_QC":
      return "WIP";
    case "FINAL_QC":
      return "Final";
  }
}

export function QCDashboard() {
  const todayPrefix = useMemo(
    () => new Date().toISOString().slice(0, 10),
    []
  );

  const inspectionsQuery = useApiQcInspections({ limit: 100 });
  const inspections = useMemo(
    () => inspectionsQuery.data?.data ?? [],
    [inspectionsQuery.data?.data]
  );

  const pendingInspections = useMemo(
    () =>
      inspections.filter(
        (i) => i.status === "DRAFT" || i.status === "IN_PROGRESS"
      ),
    [inspections]
  );

  const completedToday = useMemo(
    () =>
      inspections.filter((i) => i.completedAt?.startsWith(todayPrefix)).length,
    [inspections, todayPrefix]
  );

  const failedCount = useMemo(
    () => inspections.filter((i) => i.status === "FAILED").length,
    [inspections]
  );

  const passedCount = useMemo(
    () => inspections.filter((i) => i.status === "PASSED").length,
    [inspections]
  );

  const queue = useMemo(
    () =>
      [...inspections]
        .sort((a, b) => {
          const rank = (s: QcInspection["status"]) =>
            s === "DRAFT" ? 0 : s === "IN_PROGRESS" ? 1 : 2;
          return rank(a.status) - rank(b.status);
        })
        .slice(0, 10),
    [inspections]
  );

  if (inspectionsQuery.isLoading) {
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Pending Inspections"
          value={String(pendingInspections.length)}
          icon={ShieldCheck}
          trend={pendingInspections.length > 0 ? "down" : "up"}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Completed Today"
          value={String(completedToday)}
          icon={ClipboardList}
          trend="up"
          iconColor="text-green-600"
        />
        <KPICard
          title="Failed"
          value={String(failedCount)}
          icon={AlertTriangle}
          trend={failedCount > 0 ? "down" : "up"}
          iconColor={failedCount > 0 ? "text-red-600" : "text-green-600"}
        />
        <KPICard
          title="Passed"
          value={String(passedCount)}
          icon={CheckCircle2}
          trend="up"
          iconColor="text-green-600"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Inspection Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No inspections yet.
            </p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Ref</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map((ins) => (
                    <TableRow key={ins.id}>
                      <TableCell className="font-mono text-xs">
                        {ins.inspectionNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {kindLabel(ins.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {ins.sourceLabel ??
                          ins.templateName ??
                          ins.templateCode ??
                          "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={ins.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
