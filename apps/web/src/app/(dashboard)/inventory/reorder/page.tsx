"use client";

/**
 * Reorder Alerts — reads /inventory/stock/summary?lowStockOnly=true.
 *
 * The summary table already carries the reorder_level from
 * item_warehouse_bindings, so a single query with lowStockOnly=true
 * gives every (item, warehouse) pair where available <= reorder_level
 * (or available <= 0 when no binding exists). No new endpoint required.
 */

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { useApiStockSummary } from "@/hooks/useInventoryApi";
import type { StockSummaryRow } from "@instigenie/contracts";
import { AlertTriangle, PackageX, ShoppingCart, Bell } from "lucide-react";

function parseQty(q: string | null | undefined): number {
  if (!q) return 0;
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

interface ReorderRow extends StockSummaryRow {
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
}

function severityFor(row: StockSummaryRow): ReorderRow["severity"] {
  const available = parseQty(row.available);
  const reorderLevel = parseQty(row.reorderLevel);
  if (available <= 0) return "CRITICAL";
  if (reorderLevel > 0 && available <= reorderLevel * 0.5) return "HIGH";
  return "MEDIUM";
}

export default function ReorderPage() {
  const query = useMemo(
    () => ({ limit: 200, lowStockOnly: true as const }),
    []
  );
  const summaryQuery = useApiStockSummary(query);

  const rows: ReorderRow[] = useMemo(
    () =>
      (summaryQuery.data?.data ?? []).map((r) => ({
        ...r,
        severity: severityFor(r),
      })),
    [summaryQuery.data?.data]
  );

  const counts = useMemo(
    () => ({
      total: rows.length,
      critical: rows.filter((r) => r.severity === "CRITICAL").length,
      stockout: rows.filter((r) => parseQty(r.available) <= 0).length,
      high: rows.filter((r) => r.severity === "HIGH").length,
    }),
    [rows]
  );

  const columns: Column<ReorderRow>[] = [
    {
      key: "itemSku",
      header: "Item Code",
      sortable: true,
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.itemSku}</span>
      ),
    },
    {
      key: "itemName",
      header: "Name",
      render: (r) => <span className="text-sm">{r.itemName}</span>,
    },
    {
      key: "itemCategory",
      header: "Category",
      render: (r) => <StatusBadge status={r.itemCategory} />,
    },
    {
      key: "warehouseCode",
      header: "Warehouse",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.warehouseCode} · {r.warehouseName}
        </span>
      ),
    },
    {
      key: "available",
      header: "Available",
      render: (r) => {
        const available = parseQty(r.available);
        return (
          <span
            className={`text-xs font-mono font-bold ${
              available <= 0
                ? "text-red-600"
                : available <= parseQty(r.reorderLevel) * 0.5
                  ? "text-amber-600"
                  : ""
            }`}
          >
            {available} {r.itemUom}
          </span>
        );
      },
    },
    {
      key: "onHand",
      header: "On Hand",
      render: (r) => (
        <span className="text-xs font-mono text-muted-foreground">
          {parseQty(r.onHand)}
        </span>
      ),
    },
    {
      key: "reorderLevel",
      header: "Reorder Level",
      render: (r) => (
        <span className="text-xs font-mono text-muted-foreground">
          {parseQty(r.reorderLevel)}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (r) => <StatusBadge status={r.severity} />,
    },
  ];

  if (summaryQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Reorder Alerts"
          description="Items at or below their reorder level"
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
        title="Reorder Alerts"
        description="Items at or below their reorder level"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Open Alerts"
          value={String(counts.total)}
          icon={Bell}
          trend="neutral"
          iconColor="text-amber-600"
        />
        <KPICard
          title="Critical"
          value={String(counts.critical)}
          icon={AlertTriangle}
          trend="down"
          iconColor="text-red-600"
        />
        <KPICard
          title="Stock-outs"
          value={String(counts.stockout)}
          icon={PackageX}
          trend="down"
          iconColor="text-red-600"
        />
        <KPICard
          title="High Priority"
          value={String(counts.high)}
          icon={ShoppingCart}
          trend="neutral"
          iconColor="text-orange-600"
        />
      </div>

      <DataTable<ReorderRow>
        data={rows}
        columns={columns}
        searchKey="itemSku"
        searchPlaceholder="Search by item code..."
      />
    </div>
  );
}
