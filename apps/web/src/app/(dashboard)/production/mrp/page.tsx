"use client";

/**
 * Material Requirements Planning.
 *
 * Single GET /production/mrp aggregation: open WOs × bom_lines × stock × open
 * POs, rolled up to one row per component item. Page is read-only — running
 * the engine = refetching the query.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { DataTable, Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiMrp } from "@/hooks/useProductionApi";
import type { MrpRow } from "@instigenie/contracts";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Package,
} from "lucide-react";

const CATEGORIES = [
  "RAW_MATERIAL",
  "SUB_ASSEMBLY",
  "FINISHED_GOOD",
  "CONSUMABLE",
  "PACKAGING",
  "SPARE_PART",
  "TOOL",
];

function fmtQty(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function isShort(row: MrpRow): boolean {
  return Number(row.shortage) > 0;
}

export default function MrpPage() {
  const query = useApiMrp();
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [shortageOnly, setShortageOnly] = useState(false);

  const rows: MrpRow[] = query.data ?? [];

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== "ALL" && r.category !== categoryFilter)
        return false;
      if (shortageOnly && !isShort(r)) return false;
      return true;
    });
  }, [rows, categoryFilter, shortageOnly]);

  const kpis = useMemo(() => {
    const totalItems = rows.length;
    const shortItems = rows.filter(isShort);
    const totalShortageQty = shortItems.reduce(
      (sum, r) => sum + Number(r.shortage),
      0,
    );
    const woAffected = shortItems.reduce(
      (sum, r) => Math.max(sum, r.woCount),
      0,
    );
    return {
      totalItems,
      itemsInShortage: shortItems.length,
      totalShortageQty,
      woAffected,
    };
  }, [rows]);

  const columns: Column<MrpRow>[] = [
    {
      key: "sku",
      header: "SKU",
      render: (r) => (
        <span className="font-mono text-xs text-blue-600 font-semibold">
          {r.sku}
        </span>
      ),
    },
    {
      key: "name",
      header: "Component",
      render: (r) => (
        <div className="space-y-0.5">
          <div className="text-sm font-medium line-clamp-1">{r.name}</div>
          <Badge variant="outline" className="text-[10px] font-normal">
            {r.category.replace(/_/g, " ")}
          </Badge>
        </div>
      ),
    },
    {
      key: "uom",
      header: "UOM",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.uom}</span>
      ),
    },
    {
      key: "requiredQty",
      header: "Required",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums text-sm">{fmtQty(r.requiredQty)}</span>
      ),
    },
    {
      key: "available",
      header: "Available",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {fmtQty(r.available)}
        </span>
      ),
    },
    {
      key: "onOrder",
      header: "On Order",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {fmtQty(r.onOrder)}
        </span>
      ),
    },
    {
      key: "shortage",
      header: "Shortage",
      className: "text-right",
      render: (r) => {
        const short = isShort(r);
        return (
          <span
            className={
              short
                ? "tabular-nums text-sm font-bold text-red-600"
                : "tabular-nums text-sm text-muted-foreground"
            }
          >
            {short ? fmtQty(r.shortage) : "—"}
          </span>
        );
      },
    },
    {
      key: "woCount",
      header: "WOs",
      className: "text-right",
      render: (r) => (
        <Badge variant="outline" className="font-mono text-xs">
          {r.woCount}
        </Badge>
      ),
    },
  ];

  if (query.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Material Requirements Planning (MRP)"
          description="Component shortages computed across every open work order"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="Material Requirements Planning (MRP)"
          description="Component shortages computed across every open work order"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-red-600">
            Failed to load MRP rollup. {String(query.error)}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Material Requirements Planning (MRP)"
        description="Component shortages computed across every open work order"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Components"
          value={kpis.totalItems.toLocaleString("en-IN")}
          icon={Boxes}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Items in Shortage"
          value={kpis.itemsInShortage.toLocaleString("en-IN")}
          icon={AlertTriangle}
          iconColor={kpis.itemsInShortage > 0 ? "text-red-600" : "text-green-600"}
          change={
            kpis.itemsInShortage > 0
              ? "Procurement action required"
              : "All needs covered"
          }
          trend={kpis.itemsInShortage > 0 ? "down" : "up"}
        />
        <KPICard
          title="Shortage Qty (sum)"
          value={kpis.totalShortageQty.toLocaleString("en-IN", {
            maximumFractionDigits: 3,
          })}
          icon={Package}
          iconColor="text-orange-600"
        />
        <KPICard
          title="WOs Touching a Short Item"
          value={kpis.woAffected.toLocaleString("en-IN")}
          icon={ClipboardList}
          iconColor="text-amber-600"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">
              Filters:
            </span>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Category</Label>
              <Select
                value={categoryFilter}
                onValueChange={(v) => setCategoryFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-52 h-8 text-xs">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Categories</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pl-3 border-l">
              <Switch
                checked={shortageOnly}
                onCheckedChange={(v: boolean) => setShortageOnly(v)}
                size="sm"
              />
              <Label className="text-sm cursor-pointer select-none">
                Show shortages only
              </Label>
            </div>
            {(categoryFilter !== "ALL" || shortageOnly) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setCategoryFilter("ALL");
                  setShortageOnly(false);
                }}
              >
                Clear filters
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length.toLocaleString("en-IN")} of{" "}
              {rows.length.toLocaleString("en-IN")} rows
            </span>
          </div>
        </CardContent>
      </Card>

      <DataTable<MrpRow>
        data={filtered}
        columns={columns}
        searchKey="sku"
        searchPlaceholder="Search by SKU..."
        pageSize={25}
      />
    </div>
  );
}
