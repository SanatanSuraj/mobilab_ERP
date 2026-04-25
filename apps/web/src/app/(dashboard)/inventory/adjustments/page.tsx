"use client";

/**
 * Stock Adjustments — reads /inventory/stock/ledger?txnType=ADJUSTMENT.
 *
 * Adjustments are a thin slice of the ledger filtered to ADJUSTMENT and
 * REVERSAL transactions. The full ledger view lives at /inventory/ledger;
 * this page narrows to cycle-count / shrinkage / write-off rows so ops
 * teams can audit physical-inventory corrections without scrolling past
 * receipts and issues.
 *
 * Reuses useApiStockLedger — no new backend endpoint.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApiItems,
  useApiStockLedger,
  useApiWarehouses,
} from "@/hooks/useInventoryApi";
import type { StockLedgerEntry, StockTxnType } from "@instigenie/contracts";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ScrollText,
  SlidersHorizontal,
} from "lucide-react";

function parseQty(q: string | null | undefined): number {
  if (!q) return 0;
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
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

type AdjFilter = "ADJUSTMENT" | "REVERSAL" | "all";

export default function AdjustmentsPage() {
  const warehousesQuery = useApiWarehouses({ limit: 100 });
  const itemsQuery = useApiItems({ limit: 200 });

  const [warehouseId, setWarehouseId] = useState<string>("all");
  const [adjFilter, setAdjFilter] = useState<AdjFilter>("ADJUSTMENT");

  // Single txnType filter on the API; "all" client-merges ADJUSTMENT + REVERSAL.
  // We always pull ADJUSTMENT from the API and union REVERSAL when "all" is
  // selected. Two queries in flight — both are cheap and cached.
  const adjQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        warehouseId: warehouseId === "all" ? undefined : warehouseId,
        txnType: "ADJUSTMENT" as StockTxnType,
      }),
      [warehouseId]
    )
  );
  const revQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        warehouseId: warehouseId === "all" ? undefined : warehouseId,
        txnType: "REVERSAL" as StockTxnType,
      }),
      [warehouseId]
    )
  );

  const isLoading = adjQuery.isLoading || revQuery.isLoading;

  if (isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Stock Adjustments"
          description="Cycle-count and physical-inventory adjustments"
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

  const adjRows = adjQuery.data?.data ?? [];
  const revRows = revQuery.data?.data ?? [];

  const allRows = [...adjRows, ...revRows].sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
  );

  const rows: StockLedgerEntry[] =
    adjFilter === "ADJUSTMENT"
      ? adjRows
      : adjFilter === "REVERSAL"
        ? revRows
        : allRows;

  const items = itemsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const totalAdjustments = adjRows.length;
  const writeOffs = adjRows.filter((r) => parseQty(r.quantity) < 0).length;
  const writeOns = adjRows.filter((r) => parseQty(r.quantity) > 0).length;
  const reversals = revRows.length;

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
      key: "txnType",
      header: "Type",
      render: (r) => (
        <Badge
          variant="outline"
          className={`text-xs ${
            r.txnType === "REVERSAL"
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-orange-50 text-orange-700 border-orange-200"
          }`}
        >
          {r.txnType}
        </Badge>
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
          <span className="text-sm text-muted-foreground">
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
        const q = parseQty(r.quantity);
        return (
          <span
            className={`text-sm font-mono font-semibold ${
              q >= 0 ? "text-green-700" : "text-red-600"
            }`}
          >
            {q > 0 ? "+" : ""}
            {q.toLocaleString("en-IN")}
            <span className="text-xs text-muted-foreground ml-1">{r.uom}</span>
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
        title="Stock Adjustments"
        description="Cycle-count and physical-inventory adjustments"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Adjustments"
          value={String(totalAdjustments)}
          icon={SlidersHorizontal}
          iconColor="text-orange-600"
        />
        <KPICard
          title="Write-offs"
          value={String(writeOffs)}
          icon={ArrowUpFromLine}
          iconColor="text-red-600"
        />
        <KPICard
          title="Write-ons"
          value={String(writeOns)}
          icon={ArrowDownToLine}
          iconColor="text-green-600"
        />
        <KPICard
          title="Reversals"
          value={String(reversals)}
          icon={ScrollText}
          iconColor="text-amber-600"
        />
      </div>

      <DataTable<StockLedgerEntry>
        data={rows}
        columns={columns}
        searchPlaceholder="Search by reason..."
        pageSize={15}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={adjFilter}
              onValueChange={(v) => setAdjFilter((v ?? "ADJUSTMENT") as AdjFilter)}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADJUSTMENT">Adjustments</SelectItem>
                <SelectItem value="REVERSAL">Reversals</SelectItem>
                <SelectItem value="all">Both</SelectItem>
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
          </div>
        }
      />
    </div>
  );
}
