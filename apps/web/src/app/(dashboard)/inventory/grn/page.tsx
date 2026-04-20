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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  grns,
  warehouses,
  formatCurrency,
  formatDate,
  Grn,
  GrnLineItem,
} from "@/data/inventory-mock";
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  DollarSign,
  Plus,
} from "lucide-react";

const warehouseOptions = ["All", ...warehouses.map((w) => w.name)];
const statusOptions = ["All", "DRAFT", "CONFIRMED", "PARTIALLY_QC", "QC_DONE"];

function getQcStatus(line: GrnLineItem): { label: string; color: string } {
  if (line.rejectedQty > 0 && line.acceptedQty > 0) {
    return { label: "Partial Pass", color: "text-amber-600" };
  }
  if (line.rejectedQty > 0 && line.acceptedQty === 0) {
    return { label: "Failed", color: "text-red-600" };
  }
  if (line.acceptedQty === line.receivedQty && line.acceptedQty > 0) {
    return { label: "Passed", color: "text-green-600" };
  }
  return { label: "Pending", color: "text-amber-600" };
}

export default function GrnPage() {
  const [warehouseFilter, setWarehouseFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedGrn, setSelectedGrn] = useState<Grn | null>(null);
  const [newGrnOpen, setNewGrnOpen] = useState(false);

  // New GRN form state
  const [formVendor, setFormVendor] = useState("");
  const [formPo, setFormPo] = useState("");
  const [formWarehouse, setFormWarehouse] = useState(warehouses[0].id);
  const [formReceivedBy, setFormReceivedBy] = useState("");

  const filtered = useMemo(() => {
    return grns.filter((g) => {
      const matchWh =
        warehouseFilter === "All" || g.warehouseName === warehouseFilter;
      const matchSt =
        statusFilter === "All" || g.status === statusFilter;
      return matchWh && matchSt;
    });
  }, [warehouseFilter, statusFilter]);

  const totalValue = grns.reduce((sum, g) => sum + g.totalValue, 0);
  const qcDoneCount = grns.filter((g) => g.status === "QC_DONE").length;
  const partialOrPendingCount = grns.filter(
    (g) => g.status === "PARTIALLY_QC" || g.status === "CONFIRMED" || g.status === "DRAFT"
  ).length;

  const columns: Column<Grn>[] = [
    {
      key: "grnNumber",
      header: "GRN Number",
      sortable: true,
      render: (g) => (
        <span className="font-mono font-bold text-sm">{g.grnNumber}</span>
      ),
    },
    {
      key: "vendorName",
      header: "Vendor Name",
      sortable: true,
      render: (g) => <span className="text-sm">{g.vendorName}</span>,
    },
    {
      key: "poNumber",
      header: "PO Number",
      render: (g) => (
        <span className="font-mono text-xs text-muted-foreground">
          {g.poNumber}
        </span>
      ),
    },
    {
      key: "warehouseName",
      header: "Warehouse",
      sortable: true,
      render: (g) => <span className="text-sm">{g.warehouseName}</span>,
    },
    {
      key: "receivedDate",
      header: "Received Date",
      sortable: true,
      render: (g) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(g.receivedDate)}
        </span>
      ),
    },
    {
      key: "lines",
      header: "Items",
      render: (g) => (
        <span className="text-sm font-medium">{g.lines.length}</span>
      ),
    },
    {
      key: "totalValue",
      header: "Total Value",
      className: "text-right",
      render: (g) => (
        <span className="text-sm font-medium text-right block">
          {formatCurrency(g.totalValue)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (g) => <StatusBadge status={g.status} />,
    },
    {
      key: "receivedBy",
      header: "Received By",
      render: (g) => (
        <span className="text-sm text-muted-foreground">{g.receivedBy}</span>
      ),
    },
  ];

  function handleSaveNewGrn() {
    // Demo: just close dialog
    setNewGrnOpen(false);
    setFormVendor("");
    setFormPo("");
    setFormWarehouse(warehouses[0].id);
    setFormReceivedBy("");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Goods Receipt Notes"
        description="Track all inward goods receipts from vendors"
        actions={
          <Button onClick={() => setNewGrnOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New GRN
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total GRNs"
          value={String(grns.length)}
          icon={ClipboardList}
          iconColor="text-blue-600"
        />
        <KPICard
          title="QC Done"
          value={String(qcDoneCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Partially QC / Pending"
          value={String(partialOrPendingCount)}
          icon={Clock}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Total Value Received"
          value={formatCurrency(totalValue)}
          icon={DollarSign}
          iconColor="text-emerald-600"
        />
      </div>

      {/* Filters + Table */}
      <DataTable<Grn>
        data={filtered}
        columns={columns}
        searchKey="grnNumber"
        searchPlaceholder="Search by GRN number..."
        onRowClick={(g) => setSelectedGrn(g)}
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={warehouseFilter}
              onValueChange={(v) => setWarehouseFilter(v ?? "All")}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Warehouse" />
              </SelectTrigger>
              <SelectContent>
                {warehouseOptions.map((w) => (
                  <SelectItem key={w} value={w}>
                    {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v ?? "All")}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "All" ? "All Statuses" : s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* GRN Detail Dialog */}
      <Dialog
        open={!!selectedGrn}
        onOpenChange={(open) => { if (!open) setSelectedGrn(null); }}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-lg">
              {selectedGrn?.grnNumber}
            </DialogTitle>
          </DialogHeader>

          {selectedGrn && (
            <div className="space-y-5">
              {/* Header info grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Vendor</p>
                  <p className="font-medium">{selectedGrn.vendorName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">PO Number</p>
                  <p className="font-mono font-medium">{selectedGrn.poNumber}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Warehouse</p>
                  <p className="font-medium">{selectedGrn.warehouseName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Received Date</p>
                  <p className="font-medium">{formatDate(selectedGrn.receivedDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Received By</p>
                  <p className="font-medium">{selectedGrn.receivedBy}</p>
                </div>
                {selectedGrn.inspectedBy && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Inspected By</p>
                    <p className="font-medium">{selectedGrn.inspectedBy}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Status</p>
                  <StatusBadge status={selectedGrn.status} />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Total Value</p>
                  <p className="font-semibold text-base">
                    {formatCurrency(selectedGrn.totalValue)}
                  </p>
                </div>
                {selectedGrn.remarks && (
                  <div className="col-span-2 md:col-span-3">
                    <p className="text-muted-foreground text-xs mb-0.5">Remarks</p>
                    <p className="text-sm italic">{selectedGrn.remarks}</p>
                  </div>
                )}
              </div>

              {/* Lines table */}
              <div>
                <p className="text-sm font-semibold mb-2">
                  Line Items ({selectedGrn.lines.length})
                </p>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Ordered</TableHead>
                        <TableHead className="text-right">Received</TableHead>
                        <TableHead className="text-right">Accepted</TableHead>
                        <TableHead className="text-right">Rejected</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Batch #</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right">Total Cost</TableHead>
                        <TableHead>QC Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedGrn.lines.map((line) => {
                        const qc = getQcStatus(line);
                        return (
                          <TableRow key={line.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {line.itemCode}
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {line.itemName}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {line.orderedQty}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {line.receivedQty}
                            </TableCell>
                            <TableCell className="text-right text-sm text-green-700">
                              {line.acceptedQty}
                            </TableCell>
                            <TableCell
                              className={`text-right text-sm font-medium ${
                                line.rejectedQty > 0
                                  ? "text-red-600"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {line.rejectedQty}
                            </TableCell>
                            <TableCell className="text-sm">{line.unit}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {line.batchNumber ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {line.expiryDate
                                ? formatDate(line.expiryDate)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {formatCurrency(line.unitCost)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {formatCurrency(line.totalCost)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`text-xs font-semibold ${qc.color}`}
                              >
                                {qc.label}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedGrn(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New GRN Dialog */}
      <Dialog open={newGrnOpen} onOpenChange={setNewGrnOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Goods Receipt Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Vendor Name</label>
              <Input
                placeholder="e.g. Sysmex India Pvt Ltd"
                value={formVendor}
                onChange={(e) => setFormVendor(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">PO Number</label>
              <Input
                placeholder="e.g. MLB-PO-2026-015"
                value={formPo}
                onChange={(e) => setFormPo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Warehouse</label>
              <Select
                value={formWarehouse}
                onValueChange={(v) => setFormWarehouse(v ?? warehouses[0].id)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Received By</label>
              <Input
                placeholder="e.g. Ranjit Bora"
                value={formReceivedBy}
                onChange={(e) => setFormReceivedBy(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewGrnOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNewGrn}>Save GRN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
