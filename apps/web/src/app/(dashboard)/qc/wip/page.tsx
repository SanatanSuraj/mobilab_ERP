"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useApiQcInspections } from "@/hooks/useQcApi";
import type { QcInspection } from "@instigenie/contracts";
import { formatDate } from "@/lib/format";

/**
 * WIP QC inspections — filters /qc/inspections?kind=SUB_QC. These are
 * in-process gate checks keyed to a WIP stage.
 */

export default function QcWipPage() {
  const inspectionsQuery = useApiQcInspections({ kind: "SUB_QC", limit: 200 });
  const inspections = useMemo(
    () => inspectionsQuery.data?.data ?? [],
    [inspectionsQuery.data?.data]
  );

  const counts = useMemo(
    () => ({
      active: inspections.filter(
        (i) => i.status === "DRAFT" || i.status === "IN_PROGRESS"
      ).length,
      passed: inspections.filter((i) => i.status === "PASSED").length,
      failed: inspections.filter((i) => i.status === "FAILED").length,
      total: inspections.length,
    }),
    [inspections]
  );

  const columns: Column<QcInspection>[] = [
    {
      key: "inspectionNumber",
      header: "Inspection#",
      sortable: true,
      render: (i) => (
        <span className="font-mono text-xs font-bold">{i.inspectionNumber}</span>
      ),
    },
    {
      key: "sourceLabel",
      header: "WIP Stage",
      render: (i) => <span className="text-sm">{i.sourceLabel ?? "—"}</span>,
    },
    {
      key: "templateName",
      header: "Template",
      render: (i) => (
        <span className="text-sm text-muted-foreground">
          {i.templateName ?? i.templateCode ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (i) => <StatusBadge status={i.status} />,
    },
    {
      key: "verdict",
      header: "Verdict",
      render: (i) =>
        i.verdict ? (
          <StatusBadge status={i.verdict} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "startedAt",
      header: "Started",
      render: (i) => (
        <span className="text-xs text-muted-foreground">
          {i.startedAt ? formatDate(i.startedAt) : "—"}
        </span>
      ),
    },
    {
      key: "completedAt",
      header: "Completed",
      render: (i) => (
        <span className="text-xs text-muted-foreground">
          {i.completedAt ? formatDate(i.completedAt) : "—"}
        </span>
      ),
    },
  ];

  if (inspectionsQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="WIP QC Inspections"
          description="In-process gate inspections tied to WIP stages"
        />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="WIP QC Inspections"
        description="In-process gate inspections tied to WIP stages"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active"
          value={String(counts.active)}
          icon={Activity}
          trend="neutral"
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Passed"
          value={String(counts.passed)}
          icon={CheckCircle2}
          trend="up"
          iconColor="text-green-600"
        />
        <KPICard
          title="Failed"
          value={String(counts.failed)}
          icon={XCircle}
          trend={counts.failed > 0 ? "down" : "up"}
          iconColor={counts.failed > 0 ? "text-red-600" : "text-green-600"}
        />
        <KPICard
          title="Total"
          value={String(counts.total)}
          icon={AlertTriangle}
          trend="neutral"
          iconColor="text-blue-600"
        />
      </div>

      <DataTable<QcInspection>
        data={inspections}
        columns={columns}
        searchKey="inspectionNumber"
        searchPlaceholder="Search by inspection number..."
      />
    </div>
  );
}
