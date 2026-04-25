"use client";

/**
 * Scrap & COPQ — reads /inventory/stock/ledger?txnType=SCRAP.
 *
 * Scrap is just a slice of the ledger. The ledger row carries unit_cost
 * (captured at the time the scrap was posted), so cost-of-poor-quality
 * (COPQ) is a sum over |quantity| * unit_cost across recent scrap rows.
 *
 * Reuses useApiStockLedger — no new backend endpoint needed.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApiItems,
  useApiStockLedger,
  useApiWarehouses,
} from "@/hooks/useInventoryApi";
import type { StockLedgerEntry } from "@instigenie/contracts";
import { Trash2, IndianRupee, Package, Calendar } from "lucide-react";

function parseQty(q: string | null | undefined): number {
  if (!q) return 0;
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

function parseCost(c: string | null | undefined): number {
  if (!c) return 0;
  const n = Number(c);
  return Number.isFinite(n) ? n : 0;
}

function formatINR(n: number): string {
  if (n >= 10_00_000)
    return `₹${(n / 1_00_000).toLocaleString("en-IN", {
      maximumFractionDigits: 1,
    })}L`;
  if (n >= 1000) return `₹${n.toLocaleString("en-IN")}`;
  return `₹${n.toFixed(2)}`;
}

function formatDate(iso: string): string {
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

type Range = "7d" | "30d" | "90d" | "all";

function rangeToFromDate(r: Range): string | undefined {
  if (r === "all") return undefined;
  const days = r === "7d" ? 7 : r === "30d" ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function ScrapPage() {
  const itemsQuery = useApiItems({ limit: 200 });
  const warehousesQuery = useApiWarehouses({ limit: 100 });

  const [range, setRange] = useState<Range>("30d");

  const ledgerQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        txnType: "SCRAP" as const,
        from: rangeToFromDate(range),
      }),
      [range]
    )
  );

  if (ledgerQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Scrap & COPQ"
          description="Scrap entries and Cost of Poor Quality tracking"
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

  const rows = ledgerQuery.data?.data ?? [];
  const items = itemsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const totalCount = rows.length;
  const totalUnits = rows.reduce((acc, r) => acc + Math.abs(parseQty(r.quantity)), 0);
  const totalCopq = rows.reduce(
    (acc, r) => acc + Math.abs(parseQty(r.quantity)) * parseCost(r.unitCost),
    0
  );
  const distinctItems = new Set(rows.map((r) => r.itemId)).size;

  const columns: Column<StockLedgerEntry>[] = [
    {
      key: "postedAt",
      header: "Posted",
      sortable: true,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.postedAt)}
        </span>
      ),
    },
    {
      key: "item",
      header: "Item",
      render: (r) => {
        const item = itemById.get(r.itemId);
        return (
          <div>
            <p className="text-sm font-medium leading-tight">
              {item?.name ?? r.itemId.slice(0, 8)}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {item?.sku ?? "—"}
            </p>
          </div>
        );
      },
    },
    {
      key: "warehouse",
      header: "Warehouse",
      render: (r) => {
        const wh = warehouseById.get(r.warehouseId);
        return (
          <span className="text-xs text-muted-foreground">
            {wh ? wh.code : r.warehouseId.slice(0, 8)}
          </span>
        );
      },
    },
    {
      key: "quantity",
      header: "Qty",
      sortable: true,
      className: "text-right",
      render: (r) => {
        const q = Math.abs(parseQty(r.quantity));
        return (
          <span className="text-sm font-mono font-semibold text-red-600">
            {q.toLocaleString("en-IN")}
            <span className="text-xs text-muted-foreground ml-1">{r.uom}</span>
          </span>
        );
      },
    },
    {
      key: "cost",
      header: "COPQ",
      className: "text-right",
      render: (r) => {
        const cost =
          Math.abs(parseQty(r.quantity)) * parseCost(r.unitCost);
        return (
          <span className="text-sm font-mono text-amber-700">
            {cost > 0 ? formatINR(cost) : "—"}
          </span>
        );
      },
    },
    {
      key: "reason",
      header: "Reason",
      render: (r) => (
        <span className="text-xs text-muted-foreground line-clamp-2">
          {r.reason ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Scrap & COPQ"
        description="Scrap entries and Cost of Poor Quality tracking"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Scrap Entries"
          value={String(totalCount)}
          icon={Trash2}
          iconColor="text-red-600"
        />
        <KPICard
          title="Units Scrapped"
          value={totalUnits.toLocaleString("en-IN")}
          icon={Package}
          iconColor="text-orange-600"
        />
        <KPICard
          title="COPQ"
          value={formatINR(totalCopq)}
          icon={IndianRupee}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Items Affected"
          value={String(distinctItems)}
          icon={Calendar}
          iconColor="text-slate-600"
        />
      </div>

      <DataTable<StockLedgerEntry>
        data={rows}
        columns={columns}
        searchPlaceholder="Search by reason..."
        pageSize={15}
        actions={
          <Select value={range} onValueChange={(v) => setRange((v ?? "30d") as Range)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
