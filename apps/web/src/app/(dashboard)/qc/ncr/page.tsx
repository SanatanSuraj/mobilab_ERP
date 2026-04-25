"use client";

/**
 * NCR — Non-Conformance Reports.
 *
 * The dedicated NCR workflow (Open → Investigation → Disposition → Closed
 * with explicit CAPA linkage) doesn't have its own table yet. Until it
 * does, the NCR log is the set of FAILED qc_inspections — every NCR in
 * the spec is rooted in a QC failure, so the failed-inspection list is
 * the lower bound on what an NCR register would show.
 *
 * Reuses useApiQcInspections — no new endpoint.
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
import { AlertTriangle, FileWarning, ClipboardList, Hourglass } from "lucide-react";

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

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

type KindFilter = QcInspectionKind | "all";

export default function NCRPage() {
  const [kind, setKind] = useState<KindFilter>("all");

  const failedQuery = useApiQcInspections(
    useMemo(
      () => ({
        limit: 100,
        sortBy: "createdAt" as const,
        sortDir: "desc" as const,
        verdict: "FAIL" as const,
        kind: kind === "all" ? undefined : kind,
      }),
      [kind]
    )
  );

  if (failedQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="NCR — Non-Conformance Reports"
          description="Linked to incoming QC failures, WIP gate failures, and final QC rejections"
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

  const rows = failedQuery.data?.data ?? [];

  const totalNcrs = rows.length;
  const openNcrs = rows.filter((r) => r.status !== "PASSED" && r.status !== "FAILED")
    .length;
  const closed = rows.filter((r) => r.status === "FAILED" && r.completedAt !== null).length;
  const overdue = rows.filter((r) => {
    const a = ageDays(r.createdAt);
    return a !== null && a > 7 && r.status !== "PASSED";
  }).length;

  const columns: Column<QcInspection>[] = [
    {
      key: "inspectionNumber",
      header: "NCR / Inspection #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.inspectionNumber}</span>
      ),
    },
    {
      key: "kind",
      header: "Origin",
      render: (r) => <StatusBadge status={r.kind} />,
    },
    {
      key: "sourceLabel",
      header: "Source",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.sourceLabel ?? r.sourceType}
        </span>
      ),
    },
    {
      key: "verdictNotes",
      header: "Disposition Notes",
      render: (r) => (
        <span className="text-xs text-muted-foreground line-clamp-2">
          {r.verdictNotes ?? r.notes ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "completedAt",
      header: "Closed",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.completedAt)}
        </span>
      ),
    },
    {
      key: "age",
      header: "Age",
      render: (r) => {
        const a = ageDays(r.createdAt);
        if (a === null) return <span className="text-xs text-muted-foreground">—</span>;
        const overdueRow = a > 7 && r.status !== "PASSED";
        return (
          <span
            className={`text-xs font-mono ${
              overdueRow ? "text-red-600 font-semibold" : "text-muted-foreground"
            }`}
          >
            {a}d
          </span>
        );
      },
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="NCR — Non-Conformance Reports"
        description="Failed inspections requiring disposition / CAPA linkage"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total NCRs"
          value={String(totalNcrs)}
          icon={FileWarning}
          iconColor="text-red-600"
        />
        <KPICard
          title="Open"
          value={String(openNcrs)}
          icon={Hourglass}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Closed"
          value={String(closed)}
          icon={ClipboardList}
          iconColor="text-green-700"
        />
        <KPICard
          title="Overdue (>7d)"
          value={String(overdue)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
      </div>

      <DataTable<QcInspection>
        data={rows}
        columns={columns}
        searchKey="inspectionNumber"
        searchPlaceholder="Search NCR / inspection #..."
        pageSize={15}
        actions={
          <Select value={kind} onValueChange={(v) => setKind((v ?? "all") as KindFilter)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Origin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Origins</SelectItem>
              <SelectItem value="IQC">Incoming (IQC)</SelectItem>
              <SelectItem value="SUB_QC">Sub-Assembly</SelectItem>
              <SelectItem value="FINAL_QC">Final QC</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
