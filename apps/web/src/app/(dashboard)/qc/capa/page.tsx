"use client";

/**
 * CAPA — Corrective and Preventive Actions register.
 *
 * One row per raised CAPA, sourced from NCR / audit / complaint / internal.
 * Read-only Phase-5 surface; the link to a parent NCR is text-only for now.
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
import { useApiQcCapaActions } from "@/hooks/useQcApi";
import type {
  QcCapaAction,
  CapaSeverity,
  CapaStatus,
} from "@instigenie/contracts";
import {
  ClipboardCheck,
  AlertOctagon,
  Hourglass,
  CheckCircle2,
} from "lucide-react";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - Date.now()) / 86400000);
}

type SeverityFilter = CapaSeverity | "all";
type StatusFilter = CapaStatus | "all";

const OPEN_STATES: CapaStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION"];

export default function CAPAPage() {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const query = useApiQcCapaActions(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "createdAt" as const,
        sortDir: "desc" as const,
        severity: severity === "all" ? undefined : severity,
        status: status === "all" ? undefined : status,
      }),
      [severity, status],
    ),
  );

  if (query.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="CAPA — Corrective & Preventive Actions"
          description="ISO 13485 §8.5 — corrective and preventive actions register"
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

  const rows = query.data?.data ?? [];

  const total = rows.length;
  const open = rows.filter((r) => OPEN_STATES.includes(r.status)).length;
  const closed = rows.filter((r) => r.status === "CLOSED").length;
  const overdue = rows.filter((r) => {
    const d = daysUntil(r.dueDate);
    return d !== null && d < 0 && OPEN_STATES.includes(r.status);
  }).length;

  const columns: Column<QcCapaAction>[] = [
    {
      key: "capaNumber",
      header: "CAPA #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.capaNumber}</span>
      ),
    },
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <div className="space-y-0.5">
          <div className="text-sm font-medium line-clamp-1">{r.title}</div>
          {r.sourceRef && (
            <div className="text-xs text-muted-foreground">
              Linked: {r.sourceRef}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "sourceType",
      header: "Source",
      render: (r) => <StatusBadge status={r.sourceType} />,
    },
    {
      key: "actionType",
      header: "Type",
      render: (r) => <StatusBadge status={r.actionType} />,
    },
    {
      key: "severity",
      header: "Severity",
      render: (r) => <StatusBadge status={r.severity} />,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "ownerName",
      header: "Owner",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.ownerName ?? "—"}
        </span>
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (r) => {
        if (!r.dueDate) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const d = daysUntil(r.dueDate);
        const overdueRow =
          d !== null && d < 0 && OPEN_STATES.includes(r.status);
        return (
          <div className="space-y-0.5">
            <div className="text-xs font-mono">{formatDate(r.dueDate)}</div>
            {d !== null && OPEN_STATES.includes(r.status) && (
              <div
                className={`text-[11px] ${
                  overdueRow
                    ? "text-red-600 font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                {overdueRow ? `${Math.abs(d)}d overdue` : `${d}d to go`}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "closedAt",
      header: "Closed",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.closedAt ? formatDate(r.closedAt) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="CAPA — Corrective & Preventive Actions"
        description="ISO 13485 §8.5 — corrective and preventive actions register"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total CAPAs"
          value={String(total)}
          icon={ClipboardCheck}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Open"
          value={String(open)}
          icon={Hourglass}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Closed"
          value={String(closed)}
          icon={CheckCircle2}
          iconColor="text-green-700"
        />
        <KPICard
          title="Overdue"
          value={String(overdue)}
          icon={AlertOctagon}
          iconColor="text-red-600"
        />
      </div>

      <DataTable<QcCapaAction>
        data={rows}
        columns={columns}
        searchKey="capaNumber"
        searchPlaceholder="Search CAPA # or title..."
        pageSize={15}
        actions={
          <div className="flex gap-2">
            <Select
              value={severity}
              onValueChange={(v) =>
                setSeverity((v ?? "all") as SeverityFilter)
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(v) => setStatus((v ?? "all") as StatusFilter)}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="PENDING_VERIFICATION">
                  Pending Verification
                </SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
    </div>
  );
}
