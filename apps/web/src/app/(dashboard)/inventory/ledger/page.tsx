"use client";

import { useState, useMemo } from "react";
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
import {
  stockLedger,
  invItems,
  getInvItemById,
  formatDate,
  StockLedgerEntry,
  LedgerTxnType,
} from "@/data/inventory-mock";
import {
  BookOpen,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
} from "lucide-react";

// Warehouse & zone maps
const WAREHOUSE_MAP: Record<string, string> = {
  wh1: "Guwahati HQ",
  wh2: "Noida",
};

const ZONE_MAP: Record<string, string> = {
  z1: "Raw Materials",
  z2: "WIP",
  z3: "Finished Goods",
  z4: "Quarantine",
  z5: "Rejection",
  z6: "Returns",
  z7: "Raw Materials (Noida)",
  z8: "FG (Noida)",
  z9: "Quarantine (Noida)",
  z10: "Returns (Noida)",
};

// Badge styling per txn type
const TXN_TYPE_STYLES: Record<LedgerTxnType, string> = {
  IN: "bg-green-50 text-green-700 border-green-200",
  OUT: "bg-red-50 text-red-700 border-red-200",
  TRANSFER_IN: "bg-indigo-50 text-indigo-700 border-indigo-200",
  TRANSFER_OUT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ADJUSTMENT: "bg-orange-50 text-orange-700 border-orange-200",
  RESERVATION: "bg-amber-50 text-amber-700 border-amber-200",
  RESERVATION_RELEASE: "bg-gray-50 text-gray-600 border-gray-200",
  RETURN: "bg-purple-50 text-purple-700 border-purple-200",
};

const TXN_TYPE_OPTIONS: string[] = [
  "All",
  "IN",
  "OUT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "ADJUSTMENT",
  "RESERVATION",
  "RESERVATION_RELEASE",
  "RETURN",
];

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${date}, ${time}`;
}

export default function LedgerPage() {
  const [itemFilter, setItemFilter] = useState("All");
  const [warehouseFilter, setWarehouseFilter] = useState("All");
  const [txnTypeFilter, setTxnTypeFilter] = useState("All");

  const itemOptions = useMemo(() => {
    return [
      "All",
      ...invItems.map((i) => `${i.id}|${i.name}`),
    ];
  }, []);

  const warehouseOptions = ["All", ...Object.entries(WAREHOUSE_MAP).map(([id, name]) => `${id}|${name}`)];

  const filtered = useMemo(() => {
    return stockLedger.filter((entry) => {
      const matchItem =
        itemFilter === "All" || entry.itemId === itemFilter.split("|")[0];
      const matchWh =
        warehouseFilter === "All" || entry.warehouseId === warehouseFilter.split("|")[0];
      const matchType =
        txnTypeFilter === "All" || entry.txnType === txnTypeFilter;
      return matchItem && matchWh && matchType;
    });
  }, [itemFilter, warehouseFilter, txnTypeFilter]);

  const inCount = stockLedger.filter((e) => e.qty > 0).length;
  const outCount = stockLedger.filter((e) => e.qty < 0).length;
  const adjCount = stockLedger.filter((e) => e.txnType === "ADJUSTMENT").length;

  const columns: Column<StockLedgerEntry>[] = [
    {
      key: "id",
      header: "Txn ID",
      render: (e) => (
        <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
      ),
    },
    {
      key: "txnAt",
      header: "Date & Time",
      sortable: true,
      render: (e) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDateTime(e.txnAt)}
        </span>
      ),
    },
    {
      key: "itemId",
      header: "Item",
      render: (e) => {
        const item = getInvItemById(e.itemId);
        return (
          <div>
            <p className="text-sm font-medium">{item?.name ?? e.itemId}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {item?.itemCode ?? ""}
            </p>
          </div>
        );
      },
    },
    {
      key: "warehouseId",
      header: "Warehouse / Zone",
      render: (e) => (
        <div>
          <p className="text-sm">{WAREHOUSE_MAP[e.warehouseId] ?? e.warehouseId}</p>
          <p className="text-xs text-muted-foreground">
            {ZONE_MAP[e.zoneId] ?? e.zoneId}
          </p>
        </div>
      ),
    },
    {
      key: "txnType",
      header: "Txn Type",
      render: (e) => (
        <Badge
          variant="outline"
          className={`text-xs font-medium ${TXN_TYPE_STYLES[e.txnType]}`}
        >
          {e.txnType.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      className: "text-right",
      render: (e) => (
        <span
          className={`text-sm font-semibold ${
            e.qty > 0 ? "text-green-600" : "text-red-600"
          }`}
        >
          {e.qty > 0 ? `+${e.qty}` : `${e.qty}`}
        </span>
      ),
    },
    {
      key: "balanceQty",
      header: "Balance",
      className: "text-right",
      render: (e) => (
        <span className="text-sm font-medium">{e.balanceQty}</span>
      ),
    },
    {
      key: "refDocId",
      header: "Reference",
      render: (e) => (
        <div>
          <p className="text-xs text-muted-foreground">{e.refDocType}</p>
          <p className="text-sm font-mono font-medium">{e.refDocId}</p>
        </div>
      ),
    },
    {
      key: "batchId",
      header: "Batch / Serial",
      render: (e) => (
        <span className="text-xs text-muted-foreground font-mono">
          {e.batchId ?? e.serialId ?? "—"}
        </span>
      ),
    },
    {
      key: "createdBy",
      header: "Created By",
      render: (e) => (
        <span className="text-sm text-muted-foreground">{e.createdBy}</span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Stock Ledger"
        description="Complete transaction history — append-only audit trail"
      />

      {/* Append-only notice */}
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This ledger is append-only. Balances are computed from transaction
        history and cannot be modified directly.
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Transactions"
          value={String(stockLedger.length)}
          icon={BookOpen}
          iconColor="text-blue-600"
        />
        <KPICard
          title="IN Transactions"
          value={String(inCount)}
          icon={ArrowDownToLine}
          iconColor="text-green-600"
        />
        <KPICard
          title="OUT Transactions"
          value={String(outCount)}
          icon={ArrowUpFromLine}
          iconColor="text-red-600"
        />
        <KPICard
          title="Adjustments"
          value={String(adjCount)}
          icon={SlidersHorizontal}
          iconColor="text-orange-600"
        />
      </div>

      {/* Filter + Table */}
      <DataTable<StockLedgerEntry>
        data={filtered}
        columns={columns}
        searchKey="refDocId"
        searchPlaceholder="Search by reference doc..."
        pageSize={12}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={itemFilter}
              onValueChange={(v) => setItemFilter(v ?? "All")}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All Items" />
              </SelectTrigger>
              <SelectContent>
                {itemOptions.map((opt) => {
                  const [id, name] = opt.includes("|")
                    ? opt.split("|")
                    : [opt, opt];
                  return (
                    <SelectItem key={opt} value={opt}>
                      {name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select
              value={warehouseFilter}
              onValueChange={(v) => setWarehouseFilter(v ?? "All")}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Warehouses" />
              </SelectTrigger>
              <SelectContent>
                {warehouseOptions.map((opt) => {
                  const [, name] = opt.includes("|")
                    ? opt.split("|")
                    : [opt, opt];
                  return (
                    <SelectItem key={opt} value={opt}>
                      {name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select
              value={txnTypeFilter}
              onValueChange={(v) => setTxnTypeFilter(v ?? "All")}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                {TXN_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t === "All" ? "All Types" : t.replace(/_/g, " ")}
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
