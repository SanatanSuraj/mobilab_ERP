"use client";

/**
 * Return to Vendor (RTV) — derives from stock_ledger rows where
 * txn_type = 'RTV_OUT'.
 *
 * The full RTV workflow (create → ship → debit-note settlement) is
 * Phase-5 and will land its own table. Until then the ledger is the
 * source of truth: every RTV_OUT row is exactly the "issue" leg of an
 * RTV, with ref_doc_id pointing at the vendor.
 *
 * Reuses useApiStockLedger + useApiVendors — no new endpoint.
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
import { useApiVendors } from "@/hooks/useProcurementApi";
import type { StockLedgerEntry, StockTxnType } from "@instigenie/contracts";
import {
  Undo2,
  Building2,
  PackageX,
  IndianRupee,
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
    });
  } catch {
    return iso;
  }
}

function inr(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function ReturnsPage() {
  const itemsQuery = useApiItems({ limit: 200 });
  const warehousesQuery = useApiWarehouses({ limit: 100 });
  const vendorsQuery = useApiVendors({ limit: 100 });
  const [vendorId, setVendorId] = useState<string>("all");

  const rtvQuery = useApiStockLedger(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "postedAt" as const,
        sortDir: "desc" as const,
        txnType: "RTV_OUT" as StockTxnType,
      }),
      []
    )
  );

  if (
    rtvQuery.isLoading ||
    itemsQuery.isLoading ||
    warehousesQuery.isLoading ||
    vendorsQuery.isLoading
  ) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Return to Vendor (RTV)"
          description="Goods returned to vendors against rejected GRN lines"
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

  const allRtvs = rtvQuery.data?.data ?? [];
  const items = itemsQuery.data?.data ?? [];
  const warehouses = warehousesQuery.data?.data ?? [];
  const vendors = vendorsQuery.data?.data ?? [];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const rows =
    vendorId === "all"
      ? allRtvs
      : allRtvs.filter((r) => r.refDocId === vendorId);

  const totalRtvs = allRtvs.length;
  const distinctVendors = new Set(allRtvs.map((r) => r.refDocId)).size;
  const totalUnits = allRtvs.reduce(
    (acc, r) => acc + Math.abs(parseQty(r.quantity)),
    0
  );
  const totalValue = allRtvs.reduce((acc, r) => {
    const cost = r.unitCost ? Number(r.unitCost) : 0;
    return acc + Math.abs(parseQty(r.quantity)) * (Number.isFinite(cost) ? cost : 0);
  }, 0);

  const columns: Column<StockLedgerEntry>[] = [
    {
      key: "id",
      header: "RTV #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">
          RTV-{r.id.slice(-8).toUpperCase()}
        </span>
      ),
    },
    {
      key: "vendor",
      header: "Vendor",
      render: (r) => {
        const vendor = r.refDocId ? vendorById.get(r.refDocId) : undefined;
        return (
          <div>
            <p className="text-sm leading-tight">{vendor?.name ?? "—"}</p>
            {vendor?.gstin && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {vendor.gstin}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "item",
      header: "Item",
      render: (r) => {
        const item = itemById.get(r.itemId);
        return (
          <div>
            <p className="text-sm leading-tight">
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
      header: "From",
      render: (r) => {
        const wh = warehouseById.get(r.warehouseId);
        return (
          <span className="text-xs font-mono text-muted-foreground">
            {wh?.code ?? r.warehouseId.slice(0, 8)}
          </span>
        );
      },
    },
    {
      key: "quantity",
      header: "Qty",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono font-semibold text-red-700">
          {Math.abs(parseQty(r.quantity)).toLocaleString("en-IN")}
          <span className="text-xs text-muted-foreground ml-1">{r.uom}</span>
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      className: "text-right",
      render: (r) => {
        const cost = r.unitCost ? Number(r.unitCost) : 0;
        const v = Math.abs(parseQty(r.quantity)) * (Number.isFinite(cost) ? cost : 0);
        return (
          <span className="text-sm font-mono">{v > 0 ? inr(v) : "—"}</span>
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
        title="Return to Vendor (RTV)"
        description="Goods returned to vendors against rejected GRN lines"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total RTVs"
          value={String(totalRtvs)}
          icon={Undo2}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Vendors"
          value={String(distinctVendors)}
          icon={Building2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Units Returned"
          value={totalUnits.toLocaleString("en-IN")}
          icon={PackageX}
          iconColor="text-red-600"
        />
        <KPICard
          title="Total Value"
          value={inr(totalValue)}
          icon={IndianRupee}
          iconColor="text-purple-600"
        />
      </div>

      <DataTable<StockLedgerEntry>
        data={rows}
        columns={columns}
        searchPlaceholder="Search by reason..."
        pageSize={15}
        actions={
          <Select value={vendorId} onValueChange={(v) => setVendorId(v ?? "all")}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vendors</SelectItem>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.code} — {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
