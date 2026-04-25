"use client";

/**
 * Batch Manufacturing Records (BMR) — derives from work_orders + qc_inspections.
 *
 * A BMR is the per-WO compliance record: lot/batch identity + the recipe
 * (BOM) + step-by-step sign-offs. The minimal compliance view here lists
 * every WO together with its QC inspection counts (pass/fail/total) so
 * auditors can spot WOs that progressed without proper QC.
 *
 * Reuses useApiWorkOrders + useApiQcInspections — no new endpoints.
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
import {
  useApiProducts,
  useApiWorkOrders,
} from "@/hooks/useProductionApi";
import { useApiQcInspections } from "@/hooks/useQcApi";
import type { WorkOrder, WoStatus } from "@instigenie/contracts";
import { FileCheck2, FileWarning, ShieldCheck, Beaker } from "lucide-react";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

type StatusFilter = WoStatus | "all";

export default function BmrPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const productsQuery = useApiProducts({ limit: 100 });
  const workOrdersQuery = useApiWorkOrders(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "createdAt" as const,
        sortDir: "desc" as const,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
      [statusFilter]
    )
  );
  const inspectionsQuery = useApiQcInspections(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "createdAt" as const,
        sortDir: "desc" as const,
      }),
      []
    )
  );

  const isLoading =
    workOrdersQuery.isLoading ||
    inspectionsQuery.isLoading ||
    productsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Batch Manufacturing Records (BMR)"
          description="GMP compliance record for each manufactured batch"
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

  const wos = workOrdersQuery.data?.data ?? [];
  const insps = inspectionsQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const inspByWoId = new Map<string, { pass: number; fail: number; total: number }>();
  for (const i of insps) {
    if (!i.workOrderId) continue;
    const e = inspByWoId.get(i.workOrderId) ?? { pass: 0, fail: 0, total: 0 };
    e.total += 1;
    if (i.status === "PASSED") e.pass += 1;
    else if (i.status === "FAILED") e.fail += 1;
    inspByWoId.set(i.workOrderId, e);
  }

  const totalBmrs = wos.length;
  const compliant = wos.filter((w) => {
    const e = inspByWoId.get(w.id);
    return e && e.fail === 0 && e.total > 0;
  }).length;
  const withFails = wos.filter((w) => {
    const e = inspByWoId.get(w.id);
    return e && e.fail > 0;
  }).length;
  const noQc = wos.filter((w) => !inspByWoId.has(w.id)).length;

  const columns: Column<WorkOrder>[] = [
    {
      key: "pid",
      header: "WO / Batch #",
      render: (r) => (
        <div>
          <p className="font-mono text-xs font-bold">{r.pid}</p>
          {r.lotNumber && (
            <p className="font-mono text-[10px] text-muted-foreground">
              Lot: {r.lotNumber}
            </p>
          )}
        </div>
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
      key: "bom",
      header: "BOM",
      render: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {r.bomVersionLabel}
        </span>
      ),
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
      key: "status",
      header: "WO Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "qc",
      header: "QC",
      render: (r) => {
        const e = inspByWoId.get(r.id);
        if (!e) return <span className="text-xs text-muted-foreground">No QC</span>;
        return (
          <span className="text-xs">
            <span className="text-green-700 font-mono">{e.pass}</span>
            {e.fail > 0 && (
              <>
                {" / "}
                <span className="text-red-600 font-mono">{e.fail} fail</span>
              </>
            )}
          </span>
        );
      },
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
        title="Batch Manufacturing Records (BMR)"
        description="GMP compliance record for each manufactured batch"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total BMRs"
          value={String(totalBmrs)}
          icon={FileCheck2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Compliant"
          value={String(compliant)}
          icon={ShieldCheck}
          iconColor="text-green-600"
        />
        <KPICard
          title="With Fails"
          value={String(withFails)}
          icon={FileWarning}
          iconColor="text-red-600"
        />
        <KPICard
          title="No QC Recorded"
          value={String(noQc)}
          icon={Beaker}
          iconColor="text-amber-600"
        />
      </div>

      <DataTable<WorkOrder>
        data={wos}
        columns={columns}
        searchKey="pid"
        searchPlaceholder="Search WO / batch #..."
        pageSize={15}
        actions={
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter((v ?? "all") as StatusFilter)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
              <SelectItem value="QC_HOLD">QC Hold</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
              <SelectItem value="PLANNED">Planned</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
