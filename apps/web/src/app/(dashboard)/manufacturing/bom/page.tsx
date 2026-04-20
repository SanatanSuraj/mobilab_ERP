"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  boms,
  mfgProducts,
  BOM,
  formatCurrency,
  formatDate,
} from "@/data/manufacturing-mock";
import { FileText, CheckCircle2, Clock, Archive, Plus, Filter } from "lucide-react";

export default function BOMListPage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [productFilter, setProductFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Create BOM form state
  const [newProductId, setNewProductId] = useState("");
  const [newVersion, setNewVersion] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const totalBOMs = boms.length;
  const activeBOMs = boms.filter((b) => b.status === "ACTIVE").length;
  const draftBOMs = boms.filter((b) => b.status === "DRAFT").length;
  const supersededObsolete = boms.filter(
    (b) => b.status === "SUPERSEDED" || b.status === "OBSOLETE"
  ).length;

  const filtered = useMemo(() => {
    return boms.filter((b) => {
      if (productFilter !== "ALL" && b.productId !== productFilter) return false;
      if (statusFilter !== "ALL" && b.status !== statusFilter) return false;
      return true;
    });
  }, [productFilter, statusFilter]);

  const columns: Column<BOM>[] = [
    {
      key: "productCode",
      header: "Product Code",
      render: (bom) => (
        <span className="font-mono text-xs text-muted-foreground">{bom.productCode}</span>
      ),
    },
    {
      key: "productName",
      header: "Product",
      render: (bom) => {
        const product = mfgProducts.find((p) => p.id === bom.productId);
        return (
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-sm">{bom.productName}</span>
            {product && (
              <StatusBadge status={product.family} />
            )}
          </div>
        );
      },
    },
    {
      key: "version",
      header: "Version",
      render: (bom) => (
        <Badge variant="outline" className="font-mono font-bold text-xs">
          {bom.version}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (bom) => {
        if (bom.status === "SUPERSEDED") {
          return (
            <Badge variant="outline" className="bg-gray-50 text-gray-500 border-gray-200 text-xs">
              <span className="line-through">Superseded</span>
            </Badge>
          );
        }
        return <StatusBadge status={bom.status} />;
      },
    },
    {
      key: "lines",
      header: "Components",
      render: (bom) => (
        <span className="text-sm tabular-nums">{bom.lines.length} components</span>
      ),
    },
    {
      key: "criticalComponents",
      header: "Critical",
      render: (bom) => {
        const critCount = bom.lines.filter((l) => l.isCritical).length;
        if (critCount === 0) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs font-semibold">
            {critCount} critical
          </Badge>
        );
      },
    },
    {
      key: "totalStdCost",
      header: "Std Cost",
      className: "text-right",
      render: (bom) => (
        <span className="tabular-nums font-medium text-sm">{formatCurrency(bom.totalStdCost)}</span>
      ),
    },
    {
      key: "effectiveFrom",
      header: "Effective Period",
      render: (bom) => (
        <div className="text-xs text-muted-foreground">
          <span>{formatDate(bom.effectiveFrom)}</span>
          <span className="mx-1">→</span>
          <span>{bom.effectiveTo ? formatDate(bom.effectiveTo) : "Active"}</span>
        </div>
      ),
    },
    {
      key: "ecnRef",
      header: "ECN Ref",
      render: (bom) =>
        bom.ecnRef ? (
          <span className="font-mono text-xs text-muted-foreground">{bom.ecnRef}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "createdBy",
      header: "Created By",
      render: (bom) => (
        <span className="text-xs text-muted-foreground">{bom.createdBy}</span>
      ),
    },
    {
      key: "approvedBy",
      header: "Approved By",
      render: (bom) =>
        bom.approvedBy ? (
          <span className="text-xs">{bom.approvedBy}</span>
        ) : (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
            Pending
          </Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (bom) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/manufacturing/bom/${bom.id}`);
          }}
        >
          View BOM
        </Button>
      ),
    },
  ];

  function handleCreate() {
    // Simulate creation — close dialog and reset
    setOpen(false);
    setNewProductId("");
    setNewVersion("");
    setNewNotes("");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Bill of Materials"
        description="Versioned BOM management with ECN integration"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create BOM
          </Button>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title="Total BOMs"
          value={String(totalBOMs)}
          icon={FileText}
          iconColor="text-blue-600"
          change="All versions"
          trend="neutral"
        />
        <KPICard
          title="Active"
          value={String(activeBOMs)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="In production use"
          trend="up"
        />
        <KPICard
          title="Draft"
          value={String(draftBOMs)}
          icon={Clock}
          iconColor="text-amber-600"
          change="Pending approval"
          trend="neutral"
        />
        <KPICard
          title="Superseded / Obsolete"
          value={String(supersededObsolete)}
          icon={Archive}
          iconColor="text-gray-500"
          change="Historical versions"
          trend="neutral"
        />
      </div>

      {/* Filter Bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Product</Label>
              <Select
                value={productFilter}
                onValueChange={(v) => setProductFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="All Products" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Products</SelectItem>
                  {mfgProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.productCode} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v ?? "ALL")}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="SUPERSEDED">Superseded</SelectItem>
                  <SelectItem value="OBSOLETE">Obsolete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(productFilter !== "ALL" || statusFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setProductFilter("ALL");
                  setStatusFilter("ALL");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* BOM Table */}
      <DataTable<BOM>
        data={filtered}
        columns={columns}
        searchKey="productName"
        searchPlaceholder="Search by product name..."
        onRowClick={(bom) => router.push(`/manufacturing/bom/${bom.id}`)}
      />

      {/* Create BOM Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New BOM</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select
                value={newProductId}
                onValueChange={(v) => setNewProductId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product..." />
                </SelectTrigger>
                <SelectContent>
                  {mfgProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.productCode} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Version</Label>
              <Input
                placeholder="e.g. v4"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Describe the purpose of this BOM version..."
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newProductId || !newVersion}>
              Create Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
