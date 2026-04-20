"use client";

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  invItems,
  formatCurrency,
  InvItem,
  TrackingType,
  ItemStatus,
  AbcClass,
} from "@/data/inventory-mock";
import { Package, Cpu, Layers, Grid3x3, Plus } from "lucide-react";

export default function ItemMasterPage() {
  const [search, setSearch] = useState("");
  const [trackingFilter, setTrackingFilter] = useState<TrackingType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ItemStatus | "all">("all");
  const [abcFilter, setAbcFilter] = useState<AbcClass | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  // New item form state (demo only)
  const [newItemName, setNewItemName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newTracking, setNewTracking] = useState<TrackingType>("NONE");
  const [newUnit, setNewUnit] = useState("");
  const [newCost, setNewCost] = useState("");

  const serialCount = useMemo(() => invItems.filter((i) => i.trackingType === "SERIAL").length, []);
  const batchCount = useMemo(() => invItems.filter((i) => i.trackingType === "BATCH").length, []);
  const noneCount = useMemo(() => invItems.filter((i) => i.trackingType === "NONE").length, []);

  const filtered = useMemo(() => {
    return invItems.filter((item) => {
      const matchSearch =
        !search ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.itemCode.toLowerCase().includes(search.toLowerCase()) ||
        item.category.toLowerCase().includes(search.toLowerCase());
      const matchTracking = trackingFilter === "all" || item.trackingType === trackingFilter;
      const matchStatus = statusFilter === "all" || item.status === statusFilter;
      const matchAbc = abcFilter === "all" || item.abcClass === abcFilter;
      return matchSearch && matchTracking && matchStatus && matchAbc;
    });
  }, [search, trackingFilter, statusFilter, abcFilter]);

  const columns: Column<InvItem>[] = [
    {
      key: "itemCode",
      header: "Item Code",
      sortable: true,
      render: (item) => (
        <span className="font-mono text-xs text-blue-700 cursor-pointer hover:underline">
          {item.itemCode}
        </span>
      ),
    },
    {
      key: "name",
      header: "Item Name",
      sortable: true,
      render: (item) => (
        <div>
          <p className="text-sm font-medium leading-tight">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.subCategory}</p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      render: (item) => <span className="text-sm">{item.category}</span>,
    },
    {
      key: "trackingType",
      header: "Tracking",
      render: (item) => <StatusBadge status={item.trackingType} />,
    },
    {
      key: "abcClass",
      header: "ABC",
      render: (item) => <StatusBadge status={item.abcClass} />,
    },
    {
      key: "hsnCode",
      header: "HSN Code",
      render: (item) => (
        <span className="font-mono text-xs text-muted-foreground">{item.hsnCode}</span>
      ),
    },
    {
      key: "standardCost",
      header: "Std Cost",
      sortable: true,
      className: "text-right",
      render: (item) => (
        <span className="text-sm font-medium text-right block">
          {formatCurrency(item.standardCost)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: "flags",
      header: "Flags",
      render: (item) => (
        <div className="flex items-center gap-1 flex-wrap">
          {item.isSlowMoving && (
            <Badge
              variant="outline"
              className="text-xs bg-amber-50 text-amber-700 border-amber-200"
            >
              Slow Moving
            </Badge>
          )}
          {item.isDeadStock && (
            <Badge
              variant="outline"
              className="text-xs bg-red-50 text-red-700 border-red-200"
            >
              Dead Stock
            </Badge>
          )}
          {!item.isSlowMoving && !item.isDeadStock && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
  ];

  function handleSave() {
    setDialogOpen(false);
    setNewItemName("");
    setNewCategory("");
    setNewTracking("NONE");
    setNewUnit("");
    setNewCost("");
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
          value={String(invItems.length)}
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
          value={String(noneCount)}
          change="Quantity-only items"
          trend="neutral"
          icon={Grid3x3}
          iconColor="text-gray-500"
        />
      </div>

      {/* DataTable with filter bar built into actions */}
      <DataTable<InvItem>
        data={filtered}
        columns={columns}
        searchKey="name"
        searchPlaceholder="Search items..."
        pageSize={10}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search code / name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
            <Select
              value={trackingFilter}
              onValueChange={(v) =>
                setTrackingFilter((v ?? "all") as TrackingType | "all")
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Tracking" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="SERIAL">Serial</SelectItem>
                <SelectItem value="BATCH">Batch</SelectItem>
                <SelectItem value="NONE">None</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter((v ?? "all") as ItemStatus | "all")
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={abcFilter}
              onValueChange={(v) =>
                setAbcFilter((v ?? "all") as AbcClass | "all")
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue placeholder="ABC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ABC</SelectItem>
                <SelectItem value="A">Class A</SelectItem>
                <SelectItem value="B">Class B</SelectItem>
                <SelectItem value="C">Class C</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Item
            </Button>
          </div>
        }
      />

      {/* New Item Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Inventory Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Item Name</label>
              <Input
                placeholder="e.g. Hematology Reagent Kit"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Input
                placeholder="e.g. Reagents"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tracking Type</label>
              <Select
                value={newTracking}
                onValueChange={(v) => setNewTracking((v ?? "NONE") as TrackingType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tracking type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  <SelectItem value="BATCH">Batch</SelectItem>
                  <SelectItem value="SERIAL">Serial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Unit</label>
                <Input
                  placeholder="e.g. KIT, PCS, BTL"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Standard Cost (INR)</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newCost}
                  onChange={(e) => setNewCost(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
