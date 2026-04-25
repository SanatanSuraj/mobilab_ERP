"use client";

/**
 * Serial Number Register — derives from stock_ledger rows where serial_no
 * is populated.
 *
 * The dedicated `device_instances` table tracks finished devices through
 * their post-dispatch lifecycle (warranty, RMA, install). Until that
 * surface ships an HTTP route, the ledger gives us the dispatched-serial
 * trail we need: every CUSTOMER_ISSUE / WO_OUTPUT row carries serial_no,
 * which is the unit of audit.
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
import type { StockLedgerEntry, StockTxnType } from "@instigenie/contracts";
import {
  Barcode,
  PackageCheck,
  Boxes,
  Truck,
} from "lucide-react";

function formatDate(iso: string): string {
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

type StatusFilter = "all" | "DISPATCHED" | "IN_STOCK";

export default function SerialsPage() {
  const itemsQuery = useApiItems({ limit: 200 });
  const warehousesQuery = useApiWarehouses({ limit: 100 });
  const [itemId, setItemId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // CUSTOMER_ISSUE = dispatched serials (negative qty).
  // WO_OUTPUT     = freshly built serials (positive qty, in stock).
  const dispatchedQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        txnType: "CUSTOMER_ISSUE" as StockTxnType,
        itemId: itemId === "all" ? undefined : itemId,
      }),
      [itemId]
    )
  );
  const builtQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        txnType: "WO_OUTPUT" as StockTxnType,
        itemId: itemId === "all" ? undefined : itemId,
      }),
      [itemId]
    )
  );

  if (
    dispatchedQuery.isLoading ||
    builtQuery.isLoading ||
    itemsQuery.isLoading ||
    warehousesQuery.isLoading
  ) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Serial Number Register"
          description="Track individual instrument serials through their complete lifecycle"
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

  const dispatched = (dispatchedQuery.data?.data ?? []).filter(
    (r) => r.serialNo
  );
  const built = (builtQuery.data?.data ?? []).filter((r) => r.serialNo);

  // De-dupe by serial_no — a serial may be built (WO_OUTPUT) AND dispatched
  // (CUSTOMER_ISSUE). The dispatched row is the authoritative latest state.
  const dispatchedSerials = new Set(dispatched.map((r) => r.serialNo!));
  const inStock = built.filter((r) => !dispatchedSerials.has(r.serialNo!));

  const allRows = [
    ...dispatched.map((r) => ({ row: r, status: "DISPATCHED" as const })),
    ...inStock.map((r) => ({ row: r, status: "IN_STOCK" as const })),
  ].sort(
    (a, b) =>
      new Date(b.row.postedAt).getTime() - new Date(a.row.postedAt).getTime()
  );

  const rows =
    statusFilter === "all"
      ? allRows
      : allRows.filter((r) => r.status === statusFilter);

  const items = itemsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  const serialisedItems = items.filter((i) => i.isSerialised);

  const totalSerials = allRows.length;
  const dispatchedCount = dispatched.length;
  const inStockCount = inStock.length;
  const itemsWithSerials = new Set(allRows.map((r) => r.row.itemId)).size;

  type Row = (typeof allRows)[number];
  const columns: Column<Row>[] = [
    {
      key: "serial",
      header: "Serial #",
      render: ({ row }) => (
        <span className="font-mono text-xs font-bold">{row.serialNo}</span>
      ),
    },
    {
      key: "item",
      header: "Item",
      render: ({ row }) => {
        const item = itemById.get(row.itemId);
        return (
          <div>
            <p className="text-sm leading-tight">
              {item?.name ?? row.itemId.slice(0, 8)}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {item?.sku ?? "—"}
            </p>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: ({ status }) => (
        <Badge
          variant="outline"
          className={`text-xs ${
            status === "DISPATCHED"
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : "bg-green-50 text-green-700 border-green-200"
          }`}
        >
          {status === "DISPATCHED" ? "Dispatched" : "In Stock"}
        </Badge>
      ),
    },
    {
      key: "warehouse",
      header: "Warehouse",
      render: ({ row }) => {
        const wh = warehouseById.get(row.warehouseId);
        return (
          <span className="text-xs text-muted-foreground">
            {wh ? wh.code : row.warehouseId.slice(0, 8)}
          </span>
        );
      },
    },
    {
      key: "destination",
      header: "Destination / Reason",
      render: ({ row }) => (
        <span className="text-xs text-muted-foreground line-clamp-2">
          {row.reason ?? "—"}
        </span>
      ),
    },
    {
      key: "postedAt",
      header: "Date",
      render: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.postedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Serial Number Register"
        description="Track individual instrument serials through their complete lifecycle"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Serials"
          value={String(totalSerials)}
          icon={Barcode}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Dispatched"
          value={String(dispatchedCount)}
          icon={Truck}
          iconColor="text-amber-600"
        />
        <KPICard
          title="In Stock"
          value={String(inStockCount)}
          icon={PackageCheck}
          iconColor="text-green-600"
        />
        <KPICard
          title="Serialised SKUs"
          value={String(itemsWithSerials)}
          icon={Boxes}
          iconColor="text-purple-600"
        />
      </div>

      <DataTable<Row>
        data={rows}
        columns={columns}
        searchPlaceholder="Search serial / reason..."
        pageSize={15}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter((v ?? "all") as StatusFilter)
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="DISPATCHED">Dispatched</SelectItem>
                <SelectItem value="IN_STOCK">In Stock</SelectItem>
              </SelectContent>
            </Select>
            <Select value={itemId} onValueChange={(v) => setItemId(v ?? "all")}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Serialised Items</SelectItem>
                {serialisedItems.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.sku} — {i.name}
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
