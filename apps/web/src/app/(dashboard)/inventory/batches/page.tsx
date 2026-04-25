"use client";

/**
 * Batch / Lot Register — derives from stock_ledger rows where batch_no is
 * populated.
 *
 * Phase-2 batch tracking lives entirely on the ledger: GRN_RECEIPT and
 * WO_OUTPUT rows tag the batch they introduced; downstream WO_ISSUE /
 * SCRAP / TRANSFER rows reference the same batch_no. A dedicated
 * /inventory/batches table with expiry rollups is Phase-5; until then
 * the ledger is the source of truth.
 *
 * Reuses useApiStockLedger — no new endpoint.
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
import { Layers, Calendar, ArchiveX, Activity } from "lucide-react";

interface BatchRow {
  batchNo: string;
  itemId: string;
  itemName: string;
  itemSku: string;
  warehouseId: string;
  warehouseCode: string;
  totalReceived: number;
  totalIssued: number;
  available: number;
  uom: string;
  firstPostedAt: string;
  lastPostedAt: string;
  status: "ACTIVE" | "DEPLETED";
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
    });
  } catch {
    return iso;
  }
}

type StatusFilter = "all" | "ACTIVE" | "DEPLETED";

export default function BatchesPage() {
  const itemsQuery = useApiItems({ limit: 200 });
  const warehousesQuery = useApiWarehouses({ limit: 100 });
  const [itemId, setItemId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Pull a wide ledger window — batch rows are sparse (only GRN/WO_OUTPUT
  // and downstream issues carry batch_no). We filter client-side.
  const ledgerQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 500,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        itemId: itemId === "all" ? undefined : itemId,
      }),
      [itemId]
    )
  );

  if (
    ledgerQuery.isLoading ||
    itemsQuery.isLoading ||
    warehousesQuery.isLoading
  ) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Batch / Lot Register"
          description="Batch traceability across receipts, production output, and issues"
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

  const ledger = (ledgerQuery.data?.data ?? []).filter((r) => r.batchNo);
  const items = itemsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  const batchedItems = items.filter((i) => i.isBatched);

  // Roll up by (batch_no, item_id, warehouse_id). Same batch_no can in
  // theory exist for two items at two warehouses, so the composite key
  // matters.
  const byKey = new Map<string, BatchRow>();
  for (const r of ledger) {
    const key = `${r.batchNo!}::${r.itemId}::${r.warehouseId}`;
    const item = itemById.get(r.itemId);
    const wh = warehouseById.get(r.warehouseId);
    const existing = byKey.get(key);
    const qty = parseQty(r.quantity);
    if (existing) {
      if (qty > 0) existing.totalReceived += qty;
      else existing.totalIssued += Math.abs(qty);
      existing.available += qty;
      // postedAt sort is desc → first row we encounter is the latest.
      if (r.postedAt > existing.lastPostedAt) existing.lastPostedAt = r.postedAt;
      if (r.postedAt < existing.firstPostedAt)
        existing.firstPostedAt = r.postedAt;
    } else {
      byKey.set(key, {
        batchNo: r.batchNo!,
        itemId: r.itemId,
        itemName: item?.name ?? r.itemId.slice(0, 8),
        itemSku: item?.sku ?? "—",
        warehouseId: r.warehouseId,
        warehouseCode: wh?.code ?? r.warehouseId.slice(0, 8),
        totalReceived: qty > 0 ? qty : 0,
        totalIssued: qty < 0 ? Math.abs(qty) : 0,
        available: qty,
        uom: r.uom,
        firstPostedAt: r.postedAt,
        lastPostedAt: r.postedAt,
        status: "ACTIVE",
      });
    }
  }

  for (const row of byKey.values()) {
    row.status = row.available > 0 ? "ACTIVE" : "DEPLETED";
  }

  const allRows = Array.from(byKey.values()).sort(
    (a, b) =>
      new Date(b.lastPostedAt).getTime() - new Date(a.lastPostedAt).getTime()
  );
  const rows =
    statusFilter === "all"
      ? allRows
      : allRows.filter((r) => r.status === statusFilter);

  const totalBatches = allRows.length;
  const activeBatches = allRows.filter((r) => r.status === "ACTIVE").length;
  const depleted = allRows.filter((r) => r.status === "DEPLETED").length;
  const skuCount = new Set(allRows.map((r) => r.itemId)).size;

  const columns: Column<BatchRow>[] = [
    {
      key: "batchNo",
      header: "Batch / Lot",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.batchNo}</span>
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
      key: "warehouse",
      header: "Warehouse",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.warehouseCode}</span>
      ),
    },
    {
      key: "totalReceived",
      header: "Received",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono">
          {r.totalReceived.toLocaleString("en-IN")}
          <span className="text-xs text-muted-foreground ml-1">{r.uom}</span>
        </span>
      ),
    },
    {
      key: "totalIssued",
      header: "Issued",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono text-amber-700">
          {r.totalIssued.toLocaleString("en-IN")}
          <span className="text-xs text-muted-foreground ml-1">{r.uom}</span>
        </span>
      ),
    },
    {
      key: "available",
      header: "Available",
      className: "text-right",
      render: (r) => (
        <span
          className={`text-sm font-mono font-semibold ${
            r.available > 0 ? "text-green-700" : "text-muted-foreground"
          }`}
        >
          {r.available.toLocaleString("en-IN")}
          <span className="text-xs text-muted-foreground ml-1">{r.uom}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.status === "ACTIVE" ? (
          <span className="text-xs font-semibold text-green-700">Active</span>
        ) : (
          <span className="text-xs text-muted-foreground">Depleted</span>
        ),
    },
    {
      key: "lastPostedAt",
      header: "Last Move",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.lastPostedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Batch / Lot Register"
        description="Batch traceability across receipts, production output, and issues"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Batches"
          value={String(totalBatches)}
          icon={Layers}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Active"
          value={String(activeBatches)}
          icon={Activity}
          iconColor="text-green-600"
        />
        <KPICard
          title="Depleted"
          value={String(depleted)}
          icon={ArchiveX}
          iconColor="text-muted-foreground"
        />
        <KPICard
          title="Batched SKUs"
          value={String(skuCount)}
          icon={Calendar}
          iconColor="text-purple-600"
        />
      </div>

      <DataTable<BatchRow>
        data={rows}
        columns={columns}
        searchKey="batchNo"
        searchPlaceholder="Search batch / lot #..."
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
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="DEPLETED">Depleted</SelectItem>
              </SelectContent>
            </Select>
            <Select value={itemId} onValueChange={(v) => setItemId(v ?? "all")}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batched Items</SelectItem>
                {batchedItems.map((i) => (
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
