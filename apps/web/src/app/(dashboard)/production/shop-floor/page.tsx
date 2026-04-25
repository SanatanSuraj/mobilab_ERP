"use client";

/**
 * Shop Floor — live view of active work orders.
 *
 * Reads /production/work-orders with status filters. The WO row carries
 * currentStageIndex, reworkCount, startedAt, targetDate — enough to
 * render an at-a-glance ops view without fanning out to /stages for
 * every row. WO statuses are the live signal; per-stage drilldown
 * happens on the WO detail page.
 *
 * Reuses useApiWorkOrders + useApiProducts — no new backend endpoints.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApiProducts,
  useApiWorkOrders,
} from "@/hooks/useProductionApi";
import type {
  WorkOrder,
  WoPriority,
  WoStatus,
} from "@instigenie/contracts";
import {
  Activity,
  AlertTriangle,
  Hammer,
  CheckCircle2,
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

function isOverdue(targetIso: string | null): boolean {
  if (!targetIso) return false;
  const t = new Date(targetIso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

const ACTIVE_STATUSES: ReadonlyArray<WoStatus> = [
  "MATERIAL_CHECK",
  "IN_PROGRESS",
  "QC_HOLD",
];

type ActiveStatus = (typeof ACTIVE_STATUSES)[number] | "all";
type PriorityFilter = WoPriority | "all";

export default function ShopFloorPage() {
  const productsQuery = useApiProducts({ limit: 100 });

  const [statusFilter, setStatusFilter] = useState<ActiveStatus>("IN_PROGRESS");
  const [priority, setPriority] = useState<PriorityFilter>("all");

  // Fan out one query per active status when statusFilter==="all".
  // Each one is cheap (under 100 rows) and React Query will dedupe.
  const inProgressQuery = useApiWorkOrders(
    useMemo(
      () => ({
        status: "IN_PROGRESS" as WoStatus,
        priority: priority === "all" ? undefined : priority,
        limit: 100,
        sortBy: "startedAt" as const,
        sortDir: "desc" as const,
      }),
      [priority]
    )
  );
  const matCheckQuery = useApiWorkOrders(
    useMemo(
      () => ({
        status: "MATERIAL_CHECK" as WoStatus,
        priority: priority === "all" ? undefined : priority,
        limit: 100,
      }),
      [priority]
    )
  );
  const qcHoldQuery = useApiWorkOrders(
    useMemo(
      () => ({
        status: "QC_HOLD" as WoStatus,
        priority: priority === "all" ? undefined : priority,
        limit: 100,
      }),
      [priority]
    )
  );

  const isLoading =
    inProgressQuery.isLoading ||
    matCheckQuery.isLoading ||
    qcHoldQuery.isLoading ||
    productsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Shop Floor"
          description="Live view of active work on each production line"
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

  const inProgress = inProgressQuery.data?.data ?? [];
  const matCheck = matCheckQuery.data?.data ?? [];
  const qcHold = qcHoldQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const allActive = [...matCheck, ...inProgress, ...qcHold];

  const rows: WorkOrder[] =
    statusFilter === "all"
      ? allActive
      : statusFilter === "IN_PROGRESS"
        ? inProgress
        : statusFilter === "MATERIAL_CHECK"
          ? matCheck
          : qcHold;

  const totalActive = allActive.length;
  const overdueCount = allActive.filter((w) => isOverdue(w.targetDate)).length;
  const reworkCount = allActive.filter((w) => w.reworkCount > 0).length;
  const qcHoldCount = qcHold.length;

  const columns: Column<WorkOrder>[] = [
    {
      key: "pid",
      header: "WO #",
      sortable: true,
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.pid}</span>
      ),
    },
    {
      key: "product",
      header: "Product",
      render: (r) => {
        const p = productById.get(r.productId);
        return (
          <div>
            <p className="text-sm leading-tight">{p?.name ?? "—"}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {p?.productCode ?? r.productId.slice(0, 8)}
            </p>
          </div>
        );
      },
    },
    {
      key: "quantity",
      header: "Qty",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono">
          {Number(r.quantity).toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      key: "currentStageIndex",
      header: "Stage",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          #{r.currentStageIndex + 1}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "priority",
      header: "Priority",
      render: (r) => <StatusBadge status={r.priority} />,
    },
    {
      key: "reworkCount",
      header: "Rework",
      className: "text-right",
      render: (r) =>
        r.reworkCount > 0 ? (
          <span className="text-xs font-mono font-semibold text-amber-700">
            {r.reworkCount}×
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "startedAt",
      header: "Started",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.startedAt)}
        </span>
      ),
    },
    {
      key: "targetDate",
      header: "Target",
      render: (r) => {
        const overdue = isOverdue(r.targetDate);
        return (
          <span
            className={`text-xs ${
              overdue ? "text-red-600 font-semibold" : "text-muted-foreground"
            }`}
          >
            {r.targetDate ?? "—"}
            {overdue && " ⚠"}
          </span>
        );
      },
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Shop Floor"
        description="Live view of active work on each production line"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active WOs"
          value={String(totalActive)}
          icon={Activity}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Overdue"
          value={String(overdueCount)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
        <KPICard
          title="In Rework"
          value={String(reworkCount)}
          icon={Hammer}
          iconColor="text-amber-600"
        />
        <KPICard
          title="QC Hold"
          value={String(qcHoldCount)}
          icon={CheckCircle2}
          iconColor="text-orange-600"
        />
      </div>

      <DataTable<WorkOrder>
        data={rows}
        columns={columns}
        searchKey="pid"
        searchPlaceholder="Search WO #..."
        pageSize={20}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter((v ?? "IN_PROGRESS") as ActiveStatus)
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Active</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="MATERIAL_CHECK">Material Check</SelectItem>
                <SelectItem value="QC_HOLD">QC Hold</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={priority}
              onValueChange={(v) =>
                setPriority((v ?? "all") as PriorityFilter)
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
    </div>
  );
}
