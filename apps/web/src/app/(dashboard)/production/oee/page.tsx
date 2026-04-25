"use client";

/**
 * OEE — derives Quality from qc_inspections and Performance/Availability
 * proxies from work_order status counts.
 *
 * True OEE wants line-level downtime and cycle-time telemetry, neither of
 * which is captured yet. This page computes the closest honest
 * approximation we can support today:
 *   - Quality   = passed / (passed + failed) over qc_inspections
 *   - Performance = completed / (completed + cancelled) over WOs
 *   - Availability = active / (active + on-hold) over WOs (QC_HOLD,
 *     MATERIAL_CHECK count as halted)
 *
 * Reuses useApiWorkOrders + useApiQcInspections — no new endpoints.
 */

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApiProducts,
  useApiWorkOrders,
} from "@/hooks/useProductionApi";
import { useApiQcInspections } from "@/hooks/useQcApi";
import type { WorkOrder } from "@instigenie/contracts";
import { Activity, Gauge, ShieldCheck, Trophy } from "lucide-react";

interface ProductOee {
  productId: string;
  productName: string;
  productSku: string;
  totalWos: number;
  active: number;
  completed: number;
  passes: number;
  fails: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

function pct(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function tone(p: number): string {
  if (p >= 85) return "text-green-700";
  if (p >= 60) return "text-amber-700";
  return "text-red-600";
}

export default function OeePage() {
  const productsQuery = useApiProducts({ limit: 100 });
  const wosQuery = useApiWorkOrders(
    useMemo(() => ({ limit: 200, sortBy: "createdAt" as const, sortDir: "desc" as const }), [])
  );
  const inspsQuery = useApiQcInspections(
    useMemo(() => ({ limit: 200 }), [])
  );

  if (productsQuery.isLoading || wosQuery.isLoading || inspsQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="OEE — Overall Equipment Effectiveness"
          description="Availability × Performance × Quality, by line"
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

  const wos = wosQuery.data?.data ?? [];
  const insps = inspsQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  const productById = new Map(products.map((p) => [p.id, p]));

  // Roll up per product. Aggregate WOs into active/halted/completed buckets.
  const byProduct = new Map<string, ProductOee>();

  function ensureRow(productId: string): ProductOee {
    const existing = byProduct.get(productId);
    if (existing) return existing;
    const p = productById.get(productId);
    const row: ProductOee = {
      productId,
      productName: p?.name ?? productId.slice(0, 8),
      productSku: p?.productCode ?? "—",
      totalWos: 0,
      active: 0,
      completed: 0,
      passes: 0,
      fails: 0,
      availability: 0,
      performance: 0,
      quality: 0,
      oee: 0,
    };
    byProduct.set(productId, row);
    return row;
  }

  for (const w of wos) {
    const r = ensureRow(w.productId);
    r.totalWos += 1;
    if (w.status === "IN_PROGRESS") r.active += 1;
    if (w.status === "COMPLETED") r.completed += 1;
  }

  for (const i of insps) {
    if (!i.productId) continue;
    const r = ensureRow(i.productId);
    if (i.status === "PASSED") r.passes += 1;
    else if (i.status === "FAILED") r.fails += 1;
  }

  for (const r of byProduct.values()) {
    const halted = r.totalWos - r.active - r.completed;
    r.availability = pct(r.active + r.completed, r.active + r.completed + halted);
    r.performance = pct(r.completed, r.totalWos);
    r.quality = pct(r.passes, r.passes + r.fails);
    r.oee = Math.round((r.availability * r.performance * r.quality) / 10000);
  }

  const rows = Array.from(byProduct.values()).sort((a, b) => b.totalWos - a.totalWos);

  // Aggregate KPIs across the org.
  const totalWos = wos.length;
  const activeWos = wos.filter((w: WorkOrder) => w.status === "IN_PROGRESS").length;
  const completedWos = wos.filter((w: WorkOrder) => w.status === "COMPLETED").length;
  const haltedWos = totalWos - activeWos - completedWos;
  const passes = insps.filter((i) => i.status === "PASSED").length;
  const fails = insps.filter((i) => i.status === "FAILED").length;

  const orgAvailability = pct(activeWos + completedWos, activeWos + completedWos + haltedWos);
  const orgPerformance = pct(completedWos, totalWos);
  const orgQuality = pct(passes, passes + fails);
  const orgOee = Math.round((orgAvailability * orgPerformance * orgQuality) / 10000);

  const columns: Column<ProductOee>[] = [
    {
      key: "product",
      header: "Product",
      render: (r) => (
        <div>
          <p className="text-sm leading-tight">{r.productName}</p>
          <p className="font-mono text-xs text-muted-foreground">{r.productSku}</p>
        </div>
      ),
    },
    {
      key: "totalWos",
      header: "WOs",
      className: "text-right",
      render: (r) => <span className="text-sm font-mono">{r.totalWos}</span>,
    },
    {
      key: "active",
      header: "Active",
      className: "text-right",
      render: (r) => <span className="text-sm font-mono">{r.active}</span>,
    },
    {
      key: "completed",
      header: "Completed",
      className: "text-right",
      render: (r) => <span className="text-sm font-mono">{r.completed}</span>,
    },
    {
      key: "availability",
      header: "Availability",
      className: "text-right",
      render: (r) => (
        <span className={`text-sm font-mono font-semibold ${tone(r.availability)}`}>
          {r.availability}%
        </span>
      ),
    },
    {
      key: "performance",
      header: "Performance",
      className: "text-right",
      render: (r) => (
        <span className={`text-sm font-mono font-semibold ${tone(r.performance)}`}>
          {r.performance}%
        </span>
      ),
    },
    {
      key: "quality",
      header: "Quality",
      className: "text-right",
      render: (r) => (
        <span className={`text-sm font-mono font-semibold ${tone(r.quality)}`}>
          {r.quality}%
        </span>
      ),
    },
    {
      key: "oee",
      header: "OEE",
      className: "text-right",
      render: (r) => (
        <span className={`text-sm font-mono font-bold ${tone(r.oee)}`}>
          {r.oee}%
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="OEE — Overall Equipment Effectiveness"
        description="Availability × Performance × Quality, by line"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="OEE"
          value={`${orgOee}%`}
          icon={Trophy}
          iconColor={tone(orgOee)}
        />
        <KPICard
          title="Availability"
          value={`${orgAvailability}%`}
          icon={Activity}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Performance"
          value={`${orgPerformance}%`}
          icon={Gauge}
          iconColor="text-purple-600"
        />
        <KPICard
          title="Quality"
          value={`${orgQuality}%`}
          icon={ShieldCheck}
          iconColor="text-green-600"
        />
      </div>

      <DataTable<ProductOee>
        data={rows}
        columns={columns}
        searchKey="productSku"
        searchPlaceholder="Search by product SKU..."
        pageSize={15}
      />
    </div>
  );
}
