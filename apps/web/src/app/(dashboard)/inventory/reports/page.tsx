"use client";

/**
 * Inventory reports.
 *
 * Server returns a single rollup keyed on a date window (defaults to last
 * 90d when from/to omitted). All math is server-side; the page is just a
 * KPI + movement + top-movers layout with date pickers.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { DataTable, Column } from "@/components/shared/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiInventoryReports } from "@/hooks/useInventoryApi";
import type { InventoryReports } from "@instigenie/contracts";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  IndianRupee,
  Layers,
  Loader2,
  Package,
  Recycle,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trash2,
} from "lucide-react";

type MoverRow = InventoryReports["topMovers"][number];

function fmtMoney(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function fmtQty(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function InventoryReportsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [fromInput, setFromInput] = useState(ninetyAgo);
  const [toInput, setToInput] = useState(today);
  const [committed, setCommitted] = useState<{
    from: string;
    to: string;
  }>({ from: ninetyAgo, to: today });

  const query = useApiInventoryReports(committed);
  const data = query.data;

  const dirty = fromInput !== committed.from || toInput !== committed.to;

  function apply() {
    setCommitted({ from: fromInput, to: toInput });
  }

  function reset() {
    setFromInput(ninetyAgo);
    setToInput(today);
    setCommitted({ from: ninetyAgo, to: today });
  }

  const moverColumns: Column<MoverRow>[] = useMemo(
    () => [
      {
        key: "sku",
        header: "SKU",
        render: (r) => (
          <span className="font-mono text-xs font-bold text-blue-600">
            {r.sku}
          </span>
        ),
      },
      {
        key: "name",
        header: "Item",
        render: (r) => <span className="text-sm">{r.name}</span>,
      },
      {
        key: "category",
        header: "Category",
        render: (r) => (
          <span className="text-xs text-muted-foreground">{r.category}</span>
        ),
      },
      {
        key: "movedQty",
        header: "Moved Qty",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm font-semibold">
            {fmtQty(r.movedQty)}
          </span>
        ),
      },
      {
        key: "txnCount",
        header: "Transactions",
        className: "text-right",
        render: (r) => (
          <span className="tabular-nums text-sm text-muted-foreground">
            {r.txnCount}
          </span>
        ),
      },
    ],
    [],
  );

  if (query.isLoading && !data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Inventory Reports"
          description="Stock valuation, movement, and top movers"
        />
        <Skeleton className="h-20" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Inventory Reports"
          description="Stock valuation, movement, and top movers"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load inventory reports.{" "}
            {query.error ? String(query.error) : ""}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Inventory Reports"
        description="Stock valuation, movement, and top movers"
      />

      {/* Date range */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                className="w-44"
                max={toInput}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                className="w-44"
                min={fromInput}
                max={today}
              />
            </div>
            <Button onClick={apply} disabled={!dirty}>
              {query.isFetching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Apply
            </Button>
            <Button variant="ghost" onClick={reset} className="text-xs">
              Last 90 days
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              Window:{" "}
              <span className="font-mono">
                {data.from} → {data.to}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Valuation KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active Items"
          value={data.valuation.activeItems.toLocaleString("en-IN")}
          icon={Package}
          iconColor="text-blue-600"
        />
        <KPICard
          title="On-Hand Qty"
          value={fmtQty(data.valuation.onHandQty)}
          icon={Layers}
          iconColor="text-cyan-600"
        />
        <KPICard
          title="On-Hand Value"
          value={fmtMoney(data.valuation.onHandValue)}
          icon={IndianRupee}
          iconColor="text-green-600"
        />
        <KPICard
          title="Low Stock Items"
          value={data.valuation.lowStockItems.toLocaleString("en-IN")}
          icon={AlertTriangle}
          iconColor={
            data.valuation.lowStockItems > 0
              ? "text-orange-600"
              : "text-gray-500"
          }
        />
      </div>

      {/* Valuation breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <IndianRupee className="h-4 w-4" />
            Stock Valuation Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              On-Hand Value
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtMoney(data.valuation.onHandValue)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Reserved Value
            </div>
            <div className="text-2xl font-bold tabular-nums text-amber-600">
              {fmtMoney(data.valuation.reservedValue)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Available Value
            </div>
            <div className="text-2xl font-bold tabular-nums text-green-600">
              {fmtMoney(data.valuation.availableValue)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Movement breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Movement (window) — {data.movement.totalTxns.toLocaleString("en-IN")} transactions
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-5 gap-4 p-6 pt-0">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <ArrowDownCircle className="h-3 w-3 text-green-600" />
              Receipts
            </div>
            <div className="text-lg font-bold tabular-nums text-green-600">
              {fmtQty(data.movement.receipts)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <ArrowUpCircle className="h-3 w-3 text-red-600" />
              Issues
            </div>
            <div className="text-lg font-bold tabular-nums text-red-600">
              {fmtQty(data.movement.issues)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Recycle className="h-3 w-3 text-blue-600" />
              Adjustments
            </div>
            <div className="text-lg font-bold tabular-nums text-blue-600">
              {fmtQty(data.movement.adjustments)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-purple-600" />
              Transfers
            </div>
            <div className="text-lg font-bold tabular-nums text-purple-600">
              {fmtQty(data.movement.transfers)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Trash2 className="h-3 w-3 text-orange-600" />
              Scrap
            </div>
            <div className="text-lg font-bold tabular-nums text-orange-600">
              {fmtQty(data.movement.scrap)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top movers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="h-4 w-4" />
            Top Movers by Movement Volume
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<MoverRow>
            data={data.topMovers}
            columns={moverColumns}
            pageSize={10}
          />
        </CardContent>
      </Card>
    </div>
  );
}
