"use client";

/**
 * Item Master — reads /inventory/items via useApiItems.
 *
 * Contract deltas vs the older mock (InvItem in src/data/inventory-mock.ts):
 *   - `sku` replaces `itemCode`. Display unchanged.
 *   - `trackingType` derived from `isSerialised` / `isBatched` booleans.
 *   - `unitCost` is a decimal string (NUMERIC(18,2)); parsed for display only.
 *   - Wire-level fields `description`, `defaultWarehouseId`, `shelfLifeDays`,
 *     `version`, soft-delete `deletedAt` aren't shown in the list; surface
 *     them when the detail page lands (Phase 3).
 *
 * Create dialog posts to /inventory/items via useApiCreateItem.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useApiCreateItem,
  useApiItems,
} from "@/hooks/useInventoryApi";
import {
  ITEM_CATEGORIES,
  ITEM_UOMS,
  type Item,
  type ItemCategory,
  type ItemUom,
} from "@mobilab/contracts";
import {
  AlertCircle,
  Cpu,
  Grid3x3,
  Layers,
  Package,
  Plus,
} from "lucide-react";

function formatMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function trackingLabel(item: Item): {
  label: string;
  tone: "purple" | "blue" | "gray";
} {
  if (item.isSerialised) return { label: "Serial", tone: "purple" };
  if (item.isBatched) return { label: "Batch", tone: "blue" };
  return { label: "None", tone: "gray" };
}

const TONE_STYLES: Record<"purple" | "blue" | "gray", string> = {
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  gray: "bg-gray-50 text-gray-700 border-gray-200",
};

export default function ItemMasterPage() {
  // ─── Filters ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "all">("all");
  const [uom, setUom] = useState<ItemUom | "all">("all");
  const [active, setActive] = useState<"all" | "true" | "false">("all");

  // Stable query object so react-query doesn't re-fetch on every keystroke.
  const query = useMemo(
    () => ({
      limit: 100,
      search: search.trim() || undefined,
      category: category === "all" ? undefined : category,
      uom: uom === "all" ? undefined : uom,
      isActive: active === "all" ? undefined : active === "true",
    }),
    [search, category, uom, active]
  );

  const itemsQuery = useApiItems(query);
  const createItem = useApiCreateItem();

  // ─── Create dialog state ────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<ItemCategory>("RAW_MATERIAL");
  const [newUom, setNewUom] = useState<ItemUom>("EA");
  const [newUnitCost, setNewUnitCost] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── Loading / error shells ─────────────────────────────────────────────
  if (itemsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (itemsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load items</p>
            <p className="text-red-700 mt-1">
              {itemsQuery.error instanceof Error
                ? itemsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const items = itemsQuery.data?.data ?? [];
  const total = itemsQuery.data?.meta.total ?? items.length;

  // KPI aggregates (from the current page — not strictly "total" but
  // meaningful with a 100-row list). Real global counts would need
  // dedicated endpoints.
  const serialCount = items.filter((i) => i.isSerialised).length;
  const batchCount = items.filter((i) => i.isBatched).length;
  const otherCount = items.length - serialCount - batchCount;

  const columns: Column<Item>[] = [
    {
      key: "sku",
      header: "SKU",
      sortable: true,
      render: (i) => (
        <span className="font-mono text-xs text-blue-700">{i.sku}</span>
      ),
    },
    {
      key: "name",
      header: "Item Name",
      sortable: true,
      render: (i) => (
        <div>
          <p className="text-sm font-medium leading-tight">{i.name}</p>
          {i.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {i.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      render: (i) => (
        <span className="text-sm text-muted-foreground">
          {i.category.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "uom",
      header: "UoM",
      render: (i) => (
        <span className="text-xs text-muted-foreground">{i.uom}</span>
      ),
    },
    {
      key: "tracking",
      header: "Tracking",
      render: (i) => {
        const t = trackingLabel(i);
        return (
          <Badge
            variant="outline"
            className={`text-xs ${TONE_STYLES[t.tone]}`}
          >
            {t.label}
          </Badge>
        );
      },
    },
    {
      key: "hsnCode",
      header: "HSN",
      render: (i) => (
        <span className="font-mono text-xs text-muted-foreground">
          {i.hsnCode ?? "—"}
        </span>
      ),
    },
    {
      key: "unitCost",
      header: "Unit Cost",
      sortable: true,
      className: "text-right",
      render: (i) => (
        <span className="text-sm font-medium text-right block">
          {formatMoney(i.unitCost)}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (i) =>
        i.isActive ? (
          <Badge
            variant="outline"
            className="text-xs bg-green-50 text-green-700 border-green-200"
          >
            Active
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-xs bg-gray-50 text-gray-600 border-gray-200"
          >
            Inactive
          </Badge>
        ),
    },
  ];

  async function handleSave(): Promise<void> {
    setSaveError(null);
    try {
      await createItem.mutateAsync({
        sku: newSku.trim(),
        name: newName.trim(),
        category: newCategory,
        uom: newUom,
        unitCost: newUnitCost.trim() || "0",
        // Zod defaults these server-side; TS still wants them because
        // z.infer<> produces the post-parse OUTPUT type.
        isActive: true,
        isSerialised: false,
        isBatched: false,
      });
      setDialogOpen(false);
      setNewSku("");
      setNewName("");
      setNewCategory("RAW_MATERIAL");
      setNewUom("EA");
      setNewUnitCost("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Item Master"
        description="Manage all inventory items and their tracking configuration"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Items"
          value={String(total)}
          icon={Package}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Serial Tracked"
          value={String(serialCount)}
          change="Individual serialization"
          trend="neutral"
          icon={Cpu}
          iconColor="text-purple-600"
        />
        <KPICard
          title="Batch Tracked"
          value={String(batchCount)}
          change="Lot / batch control"
          trend="neutral"
          icon={Layers}
          iconColor="text-blue-600"
        />
        <KPICard
          title="No Tracking"
          value={String(otherCount)}
          change="Quantity-only items"
          trend="neutral"
          icon={Grid3x3}
          iconColor="text-gray-500"
        />
      </div>

      <DataTable<Item>
        data={items}
        columns={columns}
        searchKey="name"
        searchPlaceholder="Search items..."
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search SKU / name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select
              value={category}
              onValueChange={(v) =>
                setCategory((v ?? "all") as ItemCategory | "all")
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {ITEM_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={uom}
              onValueChange={(v) => setUom((v ?? "all") as ItemUom | "all")}
            >
              <SelectTrigger className="w-28">
                <SelectValue placeholder="UoM" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All UoM</SelectItem>
                {ITEM_UOMS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={active}
              onValueChange={(v) =>
                setActive((v ?? "all") as "all" | "true" | "false")
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Item
            </Button>
          </div>
        }
      />

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">SKU</label>
                <Input
                  placeholder="e.g. RES-1K"
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Unit Cost (₹)</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newUnitCost}
                  onChange={(e) => setNewUnitCost(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Item Name</label>
              <Input
                placeholder="e.g. Resistor 1kΩ 1/4W"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={newCategory}
                  onValueChange={(v) =>
                    setNewCategory((v ?? "RAW_MATERIAL") as ItemCategory)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">UoM</label>
                <Select
                  value={newUom}
                  onValueChange={(v) => setNewUom((v ?? "EA") as ItemUom)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_UOMS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createItem.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                createItem.isPending || !newSku.trim() || !newName.trim()
              }
            >
              {createItem.isPending ? "Saving…" : "Save Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
