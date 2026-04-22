"use client";

/**
 * Stock Ledger — reads /inventory/stock/ledger.
 *
 * Append-only log of every stock movement. The API returns one row per
 * transaction with a signed quantity (positive = receipt, negative = issue).
 * This page is the audit surface: sort by postedAt desc, filter by item /
 * warehouse / txn_type / date range.
 *
 * Phase 2 does NOT expose posting arbitrary ledger rows from this page —
 * that goes through the module-specific endpoints (GRN receipt, WO issue,
 * adjustment) once those land. The API does expose POST /inventory/stock/ledger
 * for opening balances + adjustments; plumbing that to a dialog is a
 * Phase 3 task.
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
import {
  STOCK_TXN_TYPES,
  type StockLedgerEntry,
  type StockTxnType,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  SlidersHorizontal,
} from "lucide-react";

function parseQty(q: string | null | undefined): number {
  if (!q) return 0;
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

const TXN_TYPE_TONE: Record<StockTxnType, string> = {
  OPENING_BALANCE: "bg-slate-50 text-slate-700 border-slate-200",
  GRN_RECEIPT: "bg-green-50 text-green-700 border-green-200",
  WO_ISSUE: "bg-red-50 text-red-700 border-red-200",
  WO_RETURN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  WO_OUTPUT: "bg-green-50 text-green-700 border-green-200",
  ADJUSTMENT: "bg-orange-50 text-orange-700 border-orange-200",
  TRANSFER_OUT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  TRANSFER_IN: "bg-indigo-50 text-indigo-700 border-indigo-200",
  SCRAP: "bg-red-50 text-red-700 border-red-200",
  RTV_OUT: "bg-red-50 text-red-700 border-red-200",
  CUSTOMER_ISSUE: "bg-red-50 text-red-700 border-red-200",
  CUSTOMER_RETURN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVERSAL: "bg-amber-50 text-amber-700 border-amber-200",
};

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

export default function StockLedgerPage() {
  const warehousesQuery = useApiWarehouses({ limit: 100 });
  const itemsQuery = useApiItems({ limit: 200 });

  const [warehouseId, setWarehouseId] = useState<string>("all");
  const [itemId, setItemId] = useState<string>("all");
  const [txnType, setTxnType] = useState<StockTxnType | "all">("all");

  const query = useMemo(
    () => ({
      limit: 100,
      sortBy: "postedAt" as const,
      sortDir: "desc" as const,
      warehouseId: warehouseId === "all" ? undefined : warehouseId,
      itemId: itemId === "all" ? undefined : itemId,
      txnType: txnType === "all" ? undefined : txnType,
    }),
    [warehouseId, itemId, txnType]
  );

  const ledgerQuery = useApiStockLedger(query);

  if (ledgerQuery.isLoading) {
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

  if (ledgerQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load ledger</p>
            <p className="text-red-700 mt-1">
              {ledgerQuery.error instanceof Error
                ? ledgerQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const rows = ledgerQuery.data?.data ?? [];
  const items = itemsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];

  // Lookup maps for display — ledger rows don't embed joins.
  const itemBySku = new Map(items.map((i) => [i.id, i]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.id, w]));

  const receiptCount = rows.filter((r) => parseQty(r.quantity) > 0).length;
  const issueCount = rows.filter((r) => parseQty(r.quantity) < 0).length;
  const adjustmentCount = rows.filter(
    (r) => r.txnType === "ADJUSTMENT" || r.txnType === "REVERSAL"
  ).length;

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
          className={`text-xs ${TXN_TYPE_TONE[r.txnType]}`}
        >
          {r.txnType.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "item",
      header: "Item",
      render: (r) => {
        const item = itemBySku.get(r.itemId);
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
        const wh = warehouseByCode.get(r.warehouseId);
        return (
          <span className="text-sm text-muted-foreground">
            {wh ? `${wh.code}` : r.warehouseId.slice(0, 8)}
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
            className={`text-sm font-semibold ${
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
      key: "refDocType",
      header: "Ref",
      render: (r) => (
        <div className="text-xs">
          <p className="text-muted-foreground">{r.refDocType ?? "—"}</p>
          {r.batchNo && (
            <p className="font-mono text-[10px]">{r.batchNo}</p>
          )}
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (r) => (
        <span className="text-xs text-muted-foreground line-clamp-1">
          {r.reason ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Stock Ledger"
        description="Append-only audit log of every inventory movement"
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Entries"
          value={String(rows.length)}
          icon={BookOpen}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Receipts"
          value={String(receiptCount)}
          icon={ArrowDownToLine}
          iconColor="text-green-600"
        />
        <KPICard
          title="Issues"
          value={String(issueCount)}
          icon={ArrowUpFromLine}
          iconColor="text-red-600"
        />
        <KPICard
          title="Adjustments"
          value={String(adjustmentCount)}
          icon={SlidersHorizontal}
          iconColor="text-orange-600"
        />
      </div>

      <DataTable<StockLedgerEntry>
        data={rows}
        columns={columns}
        searchPlaceholder="Search ledger..."
        pageSize={15}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={txnType}
              onValueChange={(v) =>
                setTxnType((v ?? "all") as StockTxnType | "all")
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Txn Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {STOCK_TXN_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, " ")}
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
            <Select value={itemId} onValueChange={(v) => setItemId(v ?? "all")}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Items</SelectItem>
                {items.map((i) => (
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
