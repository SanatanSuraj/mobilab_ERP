"use client";

/**
 * QC Dashboard — aggregates /qc/inspections by status, kind and verdict.
 *
 * Single inspections list (sorted by createdAt desc) is enough for KPIs
 * and a recent-fails table. Findings detail and per-WO drill-down lives
 * on the individual inspection pages.
 *
 * Reuses useApiQcInspections — no new backend endpoint.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiQcInspections } from "@/hooks/useQcApi";
import type { QcInspection, QcInspectionKind } from "@instigenie/contracts";
import {
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  AlertTriangle,
} from "lucide-react";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type KindFilter = QcInspectionKind | "all";

export default function QCDashboardPage() {
  const [kind, setKind] = useState<KindFilter>("all");

  const inspectionsQuery = useApiQcInspections(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "createdAt" as const,
        sortDir: "desc" as const,
        kind: kind === "all" ? undefined : kind,
      }),
      [kind]
    )
  );

  if (inspectionsQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="QC Dashboard"
          description="Incoming, WIP, NCR, CAPA, and equipment at a glance"
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

  const rows = inspectionsQuery.data?.data ?? [];

  const totalCount = rows.length;
  const passCount = rows.filter((r) => r.status === "PASSED").length;
  const failCount = rows.filter((r) => r.status === "FAILED").length;
  const inProgressCount = rows.filter(
    (r) => r.status === "IN_PROGRESS" || r.status === "DRAFT"
  ).length;
  const finalised = passCount + failCount;
  const passRate = finalised === 0 ? 0 : Math.round((passCount / finalised) * 100);

  const byKind: Record<QcInspectionKind, number> = {
    IQC: 0,
    SUB_QC: 0,
    FINAL_QC: 0,
  };
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

  const fails = rows.filter((r) => r.status === "FAILED").slice(0, 25);

  const columns: Column<QcInspection>[] = [
    {
      key: "inspectionNumber",
      header: "Inspection #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.inspectionNumber}</span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (r) => <StatusBadge status={r.kind} />,
    },
    {
      key: "templateName",
      header: "Template",
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.templateName ?? r.templateCode ?? "—"}
        </span>
      ),
    },
    {
      key: "sourceLabel",
      header: "Source",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.sourceLabel ?? `${r.sourceType}`}
        </span>
      ),
    },
    {
      key: "verdict",
      header: "Verdict",
      render: (r) =>
        r.verdict ? (
          <StatusBadge status={r.verdict} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "completedAt",
      header: "Completed",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.completedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="QC Dashboard"
        description="Incoming, WIP, NCR, CAPA, and equipment at a glance"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Inspections"
          value={String(totalCount)}
          icon={ClipboardCheck}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Pass Rate"
          value={`${passRate}%`}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="In Progress"
          value={String(inProgressCount)}
          icon={AlertTriangle}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Fails"
          value={String(failCount)}
          icon={XCircle}
          iconColor="text-red-600"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title="IQC (Incoming)"
          value={String(byKind.IQC)}
          icon={ClipboardCheck}
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Sub-Assembly QC"
          value={String(byKind.SUB_QC)}
          icon={ClipboardCheck}
          iconColor="text-purple-600"
        />
        <KPICard
          title="Final QC"
          value={String(byKind.FINAL_QC)}
          icon={ClipboardCheck}
          iconColor="text-teal-600"
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Recent Fails</h2>
        <DataTable<QcInspection>
          data={fails}
          columns={columns}
          searchKey="inspectionNumber"
          searchPlaceholder="Search inspection #..."
          pageSize={10}
          actions={
            <Select value={kind} onValueChange={(v) => setKind((v ?? "all") as KindFilter)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Kinds</SelectItem>
                <SelectItem value="IQC">Incoming (IQC)</SelectItem>
                <SelectItem value="SUB_QC">Sub-Assembly</SelectItem>
                <SelectItem value="FINAL_QC">Final QC</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </div>
    </div>
  );
}
