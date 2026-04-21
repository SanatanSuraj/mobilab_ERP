"use client";

/**
 * Stock Summary — reads /inventory/stock/summary.
 *
 * The summary table is the projection maintained by the DB trigger on
 * stock_ledger writes. Every row already carries item+warehouse joins
 * (sku, itemName, warehouseCode) plus the reorder_level from the binding,
 * so the UI can compute low-stock status without a second fetch.
 *
 * Filters pass straight through to the API:
 *   - search          server-side ILIKE across sku/name/warehouseCode
 *   - category        server-side
 *   - warehouseId     server-side
 *   - lowStockOnly    server-side (on_hand <= reorder_level)
 *
 * KPIs are computed from the current page's data rather than separate
 * endpoints — good enough for Phase 2 with the 100-row default cap.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApiStockSummary,
  useApiWarehouses,
} from "@/hooks/useInventoryApi";
import {
  ITEM_CATEGORIES,
  type ItemCategory,
  type StockSummaryRow,
} from "@mobilab/contracts";
import { AlertCircle, AlertTriangle, DollarSign, Package } from "lucide-react";

function parseQty(q: string | null | undefined): number {
  if (!q) return 0;
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function StockSummaryPage() {
  const warehousesQuery = useApiWarehouses({ limit: 100 });

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "all">("all");
  const [warehouseId, setWarehouseId] = useState<string>("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const query = useMemo(
    () => ({
      limit: 200,
      search: search.trim() || undefined,
      category: category === "all" ? undefined : category,
      warehouseId: warehouseId === "all" ? undefined : warehouseId,
      lowStockOnly: lowStockOnly || undefined,
    }),
    [search, category, warehouseId, lowStockOnly]
  );

  const summaryQuery = useApiStockSummary(query);

  if (summaryQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (summaryQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load stock</p>
            <p className="text-red-700 mt-1">
              {summaryQuery.error instanceof Error
                ? summaryQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const rows = summaryQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];

  const skuCount = new Set(rows.map((r) => r.itemId)).size;
  const lowCount = rows.filter((r) => {
    const level = parseQty(r.reorderLevel);
    return level > 0 && parseQty(r.onHand) <= level;
  }).length;
  // Rough valuation — we don't ship unit_cost on the summary row, so
  // valuation needs a separate items fetch for production use. For now,
  // 0 as a placeholder with a caveat in the KPI title.
  const totalOnHand = rows.reduce((acc, r) => acc + parseQty(r.onHand), 0);

  const columns: Column<StockSummaryRow>[] = [
    {
      key: "itemSku",
      header: "SKU",
      sortable: true,
      render: (r) => (
        <span className="font-mono text-xs text-blue-700">{r.itemSku}</span>
      ),
    },
    {
      key: "itemName",
      header: "Item",
      sortable: true,
      render: (r) => (
        <div>
          <p className="text-sm font-medium leading-tight">{r.itemName}</p>
          <p className="text-xs text-muted-foreground">
            {r.itemCategory.replace(/_/g, " ")}
          </p>
        </div>
      ),
    },
    {
      key: "warehouseCode",
      header: "Warehouse",
      render: (r) => (
        <span className="text-sm text-muted-foreground">{r.warehouseCode}</span>
      ),
    },
    {
      key: "onHand",
      header: "On Hand",
      sortable: true,
      className: "text-right",
      render: (r) => {
        const q = parseQty(r.onHand);
        const lvl = parseQty(r.reorderLevel);
        const low = lvl > 0 && q <= lvl;
        return (
          <span
            className={`text-sm font-semibold ${
              q === 0
                ? "text-red-600"
                : low
                  ? "text-amber-600"
                  : "text-foreground"
            }`}
          >
            {q.toLocaleString("en-IN")}
            <span className="text-xs text-muted-foreground ml-1">
              {r.itemUom}
            </span>
          </span>
        );
      },
    },
    {
      key: "reserved",
      header: "Reserved",
      className: "text-right",
      render: (r) => {
        const q = parseQty(r.reserved);
        return (
          <span className="text-sm text-muted-foreground">
            {q.toLocaleString("en-IN")}
          </span>
        );
      },
    },
    {
      key: "available",
      header: "Available",
      sortable: true,
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-medium">
          {parseQty(r.available).toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      key: "reorderLevel",
      header: "Reorder Lvl",
      className: "text-right",
      render: (r) => {
        const lvl = parseQty(r.reorderLevel);
        if (!r.reorderLevel || lvl === 0)
          return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {lvl.toLocaleString("en-IN")}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const q = parseQty(r.onHand);
        const lvl = parseQty(r.reorderLevel);
        if (q === 0) {
          return (
            <Badge
              variant="outline"
              className="text-xs bg-red-50 text-red-700 border-red-200"
            >
              Out of Stock
            </Badge>
          );
        }
        if (lvl > 0 && q <= lvl) {
          return (
            <Badge
              variant="outline"
              className="text-xs bg-amber-50 text-amber-700 border-amber-200"
            >
              Low Stock
            </Badge>
          );
        }
        return (
          <Badge
            variant="outline"
            className="text-xs bg-green-50 text-green-700 border-green-200"
          >
            In Stock
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Stock Summary"
        description="Live on-hand positions across every item & warehouse"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KPICard
          title="Unique SKUs"
          value={String(skuCount)}
          icon={Package}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Low-Stock Items"
          value={String(lowCount)}
          icon={AlertTriangle}
          iconColor="text-amber-600"
          trend={lowCount > 0 ? "down" : "neutral"}
        />
        <KPICard
          title="Total Units On Hand"
          value={formatMoney(totalOnHand).replace("₹", "")}
          icon={DollarSign}
          iconColor="text-green-600"
        />
      </div>

      <DataTable<StockSummaryRow>
        data={rows}
        columns={columns}
        searchKey="itemName"
        searchPlaceholder="Search items..."
        pageSize={15}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search SKU / name / warehouse..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <Select
              value={category}
              onValueChange={(v) =>
                setCategory((v ?? "all") as ItemCategory | "all")
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {ITEM_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={warehouseId}
              onValueChange={(v) => setWarehouseId(v ?? "all")}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={lowStockOnly ? "true" : "false"}
              onValueChange={(v) => setLowStockOnly(v === "true")}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">All Stock</SelectItem>
                <SelectItem value="true">Low Stock Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
    </div>
  );
}
