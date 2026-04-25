"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useApiQcInspections } from "@/hooks/useQcApi";
import type { QcInspection } from "@instigenie/contracts";
import { formatDate } from "@/lib/format";

/**
 * Incoming (IQC) inspections — filters /qc/inspections?kind=IQC. The
 * specialised AQL-sampling + countersign workflow from the old mock page
 * isn't in the contract yet; this view shows the generic inspection stream
 * until those endpoints ship.
 */

export default function QcInwardPage() {
  const inspectionsQuery = useApiQcInspections({ kind: "IQC", limit: 200 });
  const inspections = useMemo(
    () => inspectionsQuery.data?.data ?? [],
    [inspectionsQuery.data?.data]
  );

  const counts = useMemo(
    () => ({
      pending: inspections.filter(
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
      header: "Source",
      render: (i) => (
        <span className="text-sm">
          {i.sourceLabel ?? i.sourceType ?? "—"}
        </span>
      ),
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
      key: "sampleSize",
      header: "Sample",
      render: (i) => (
        <span className="text-xs tabular-nums">{i.sampleSize ?? "—"}</span>
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
        i.verdict ? <StatusBadge status={i.verdict} /> : <span className="text-xs text-muted-foreground">—</span>,
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
          title="Incoming QC Inspections"
          description="IQC — receipt inspections against purchase orders"
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
        title="Incoming QC Inspections"
        description="IQC — receipt inspections against purchase orders"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Pending"
          value={String(counts.pending)}
          icon={ClipboardList}
          trend={counts.pending > 0 ? "down" : "up"}
          iconColor="text-amber-600"
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
