"use client";

/**
 * QC Equipment Calibration Registry — ISO 13485 §7.6.
 *
 * One row per piece of test equipment under calibration control. Status +
 * next_due_at drive overdue / due-soon flags. Read-only Phase-5 surface;
 * writes happen via SQL seed for now.
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
import { useApiQcEquipment } from "@/hooks/useQcApi";
import type {
  QcEquipment,
  QcEquipmentCategory,
  QcEquipmentStatus,
} from "@instigenie/contracts";
import { Gauge, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";

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

type CategoryFilter = QcEquipmentCategory | "all";
type StatusFilter = QcEquipmentStatus | "all";

export default function EquipmentCalibrationPage() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const query = useApiQcEquipment(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "nextDueAt" as const,
        sortDir: "asc" as const,
        category: category === "all" ? undefined : category,
        status: status === "all" ? undefined : status,
      }),
      [category, status],
    ),
  );

  if (query.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Equipment Calibration Registry"
          description="ISO 13485 §7.6 — traceable calibration for test equipment"
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
  const active = rows.filter((r) => r.status === "ACTIVE").length;
  const overdue = rows.filter((r) => {
    const d = daysUntil(r.nextDueAt);
    return d !== null && d < 0 && r.status !== "RETIRED";
  }).length;
  const dueSoon = rows.filter((r) => {
    const d = daysUntil(r.nextDueAt);
    return d !== null && d >= 0 && d <= 30 && r.status !== "RETIRED";
  }).length;

  const columns: Column<QcEquipment>[] = [
    {
      key: "assetCode",
      header: "Asset Code",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.assetCode}</span>
      ),
    },
    {
      key: "name",
      header: "Equipment",
      render: (r) => (
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">
            {r.manufacturer ?? "—"}
            {r.modelNumber ? ` · ${r.modelNumber}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (r) => <StatusBadge status={r.category} />,
    },
    {
      key: "location",
      header: "Location",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.location ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "lastCalibratedAt",
      header: "Last Cal.",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.lastCalibratedAt)}
        </span>
      ),
    },
    {
      key: "nextDueAt",
      header: "Next Due",
      render: (r) => {
        const d = daysUntil(r.nextDueAt);
        if (r.nextDueAt === null) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const overdueRow = d !== null && d < 0 && r.status !== "RETIRED";
        const dueSoonRow =
          d !== null && d >= 0 && d <= 30 && r.status !== "RETIRED";
        return (
          <div className="space-y-0.5">
            <div className="text-xs font-mono">{formatDate(r.nextDueAt)}</div>
            <div
              className={`text-[11px] ${
                overdueRow
                  ? "text-red-600 font-semibold"
                  : dueSoonRow
                    ? "text-amber-600"
                    : "text-muted-foreground"
              }`}
            >
              {d === null
                ? ""
                : overdueRow
                  ? `${Math.abs(d)}d overdue`
                  : `${d}d to go`}
            </div>
          </div>
        );
      },
    },
    {
      key: "calibrationIntervalDays",
      header: "Interval",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.calibrationIntervalDays}d
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Equipment Calibration Registry"
        description="ISO 13485 §7.6 — traceable calibration for test equipment"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Equipment"
          value={String(total)}
          icon={Gauge}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Active"
          value={String(active)}
          icon={CheckCircle2}
          iconColor="text-green-700"
        />
        <KPICard
          title="Overdue"
          value={String(overdue)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
        <KPICard
          title="Due in ≤30d"
          value={String(dueSoon)}
          icon={Wrench}
          iconColor="text-amber-600"
        />
      </div>

      <DataTable<QcEquipment>
        data={rows}
        columns={columns}
        searchKey="assetCode"
        searchPlaceholder="Search asset code or name..."
        pageSize={15}
        actions={
          <div className="flex gap-2">
            <Select
              value={category}
              onValueChange={(v) =>
                setCategory((v ?? "all") as CategoryFilter)
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="TEST_INSTRUMENT">Test Instrument</SelectItem>
                <SelectItem value="GAUGE">Gauge</SelectItem>
                <SelectItem value="METER">Meter</SelectItem>
                <SelectItem value="BALANCE">Balance</SelectItem>
                <SelectItem value="OVEN">Oven</SelectItem>
                <SelectItem value="CHAMBER">Chamber</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
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
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="IN_CALIBRATION">In Calibration</SelectItem>
                <SelectItem value="OUT_OF_SERVICE">Out of Service</SelectItem>
                <SelectItem value="RETIRED">Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
    </div>
  );
}
