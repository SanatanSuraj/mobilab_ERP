"use client";

/**
 * Stock Transfers — paired TRANSFER_OUT / TRANSFER_IN rows on stock_ledger.
 *
 * The full request → approve → ship → receive workflow needs its own
 * stock_transfers table (Phase-5). Until then we read what we have:
 * the ledger already records the move. Each transfer surfaces as a
 * single row by joining the OUT (source warehouse, negative qty) and
 * IN (destination warehouse, positive qty) pair on shared ref_doc_id.
 *
 * Reuses useApiStockLedger — no new endpoint.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import type { StockTxnType } from "@instigenie/contracts";
import {
  ArrowLeftRight,
  CheckCircle2,
  Truck,
  Warehouse,
} from "lucide-react";

interface TransferRow {
  refDocId: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  fromWh: string;
  toWh: string;
  quantity: number;
  uom: string;
  status: "COMPLETED" | "IN_TRANSIT";
  postedAt: string;
  reason: string | null;
}

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

type StatusFilter = "all" | "COMPLETED" | "IN_TRANSIT";

export default function TransfersPage() {
  const itemsQuery = useApiItems({ limit: 200 });
  const warehousesQuery = useApiWarehouses({ limit: 100 });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const outQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        txnType: "TRANSFER_OUT" as StockTxnType,
      }),
      []
    )
  );
  const inQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        txnType: "TRANSFER_IN" as StockTxnType,
      }),
      []
    )
  );

  if (
    outQuery.isLoading ||
    inQuery.isLoading ||
    itemsQuery.isLoading ||
    warehousesQuery.isLoading
  ) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Stock Transfers"
          description="Inter-warehouse stock moves and in-transit stock"
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

  const outs = outQuery.data?.data ?? [];
  const ins = inQuery.data?.data ?? [];
  const items = itemsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  // Match OUT → IN by (ref_doc_id, item_id). If both legs exist the
  // transfer is COMPLETED; OUT-only means in-transit.
  const inByKey = new Map<string, (typeof ins)[number]>();
  for (const i of ins) {
    if (!i.refDocId) continue;
    inByKey.set(`${i.refDocId}::${i.itemId}`, i);
  }

  const allRows: TransferRow[] = outs.map((o) => {
    const fromWh = warehouseById.get(o.warehouseId);
    const item = itemById.get(o.itemId);
    const matchedIn = o.refDocId
      ? inByKey.get(`${o.refDocId}::${o.itemId}`)
      : undefined;
    const toWh = matchedIn
      ? warehouseById.get(matchedIn.warehouseId)
      : undefined;
    return {
      refDocId: o.refDocId ?? o.id,
      itemId: o.itemId,
      itemName: item?.name ?? o.itemId.slice(0, 8),
      itemSku: item?.sku ?? "—",
      fromWh: fromWh?.code ?? o.warehouseId.slice(0, 8),
      toWh: toWh?.code ?? "in transit",
      quantity: Math.abs(parseQty(o.quantity)),
      uom: o.uom,
      status: matchedIn ? "COMPLETED" : "IN_TRANSIT",
      postedAt: o.postedAt,
      reason: o.reason,
    };
  });

  const rows =
    statusFilter === "all"
      ? allRows
      : allRows.filter((r) => r.status === statusFilter);

  const totalTransfers = allRows.length;
  const completed = allRows.filter((r) => r.status === "COMPLETED").length;
  const inTransit = allRows.filter((r) => r.status === "IN_TRANSIT").length;
  const whCount = warehouses.length;

  const columns: Column<TransferRow>[] = [
    {
      key: "refDocId",
      header: "Transfer #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">
          {r.refDocId.slice(-8).toUpperCase()}
        </span>
      ),
    },
    {
      key: "item",
      header: "Item",
      render: (r) => (
        <div>
          <p className="text-sm leading-tight">{r.itemName}</p>
          <p className="font-mono text-xs text-muted-foreground">{r.itemSku}</p>
        </div>
      ),
    },
    {
      key: "from",
      header: "From",
      render: (r) => (
        <span className="text-xs font-mono text-muted-foreground">
          {r.fromWh}
        </span>
      ),
    },
    {
      key: "to",
      header: "To",
      render: (r) => (
        <span className="text-xs font-mono text-muted-foreground">{r.toWh}</span>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono font-semibold">
          {r.quantity.toLocaleString("en-IN")}
          <span className="text-xs text-muted-foreground ml-1">{r.uom}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge
          variant="outline"
          className={`text-xs ${
            r.status === "COMPLETED"
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          }`}
        >
          {r.status === "COMPLETED" ? "Completed" : "In Transit"}
        </Badge>
      ),
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
    {
      key: "postedAt",
      header: "Posted",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.postedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Stock Transfers"
        description="Inter-warehouse stock moves and in-transit stock"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Transfers"
          value={String(totalTransfers)}
          icon={ArrowLeftRight}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Completed"
          value={String(completed)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="In Transit"
          value={String(inTransit)}
          icon={Truck}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Warehouses"
          value={String(whCount)}
          icon={Warehouse}
          iconColor="text-purple-600"
        />
      </div>

      <DataTable<TransferRow>
        data={rows}
        columns={columns}
        searchKey="refDocId"
        searchPlaceholder="Search transfer #..."
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
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
