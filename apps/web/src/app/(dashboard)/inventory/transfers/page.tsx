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
  stockTransfers,
  warehouses,
  invItems,
  formatCurrency,
  formatDate,
  StockTransfer,
} from "@/data/inventory-mock";
import {
  ArrowLeftRight,
  Truck,
  CheckCircle2,
  FileClock,
  Plus,
} from "lucide-react";

const STATUS_OPTIONS = [
  "All",
  "DRAFT",
  "APPROVED",
  "IN_TRANSIT",
  "RECEIVED",
  "DISCREPANCY",
];

export default function TransfersPage() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);
  const [newTransferOpen, setNewTransferOpen] = useState(false);

  // New Transfer form state
  const [formFrom, setFormFrom] = useState(warehouses[0].id);
  const [formTo, setFormTo] = useState(warehouses[1].id);
  const [formItem, setFormItem] = useState(invItems[0].id);
  const [formQty, setFormQty] = useState("");
  const [formRemarks, setFormRemarks] = useState("");

  const filtered = useMemo(() => {
    if (statusFilter === "All") return stockTransfers;
    return stockTransfers.filter((t) => t.status === statusFilter);
  }, [statusFilter]);

  const inTransitCount = stockTransfers.filter((t) => t.status === "IN_TRANSIT").length;
  const receivedCount = stockTransfers.filter((t) => t.status === "RECEIVED").length;
  const draftPendingCount = stockTransfers.filter(
    (t) => t.status === "DRAFT" || t.status === "APPROVED"
  ).length;

  const columns: Column<StockTransfer>[] = [
    {
      key: "transferNumber",
      header: "Transfer Number",
      sortable: true,
      render: (t) => (
        <span className="font-mono font-semibold text-sm">{t.transferNumber}</span>
      ),
    },
    {
      key: "fromWarehouseName",
      header: "From → To",
      render: (t) => (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">{t.fromWarehouseName}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium">{t.toWarehouseName}</span>
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (t) => (
        <span className="text-sm text-muted-foreground">{formatDate(t.createdAt)}</span>
      ),
    },
    {
      key: "shippedAt",
      header: "Shipped",
      render: (t) => (
        <span className="text-sm text-muted-foreground">
          {t.shippedAt ? formatDate(t.shippedAt) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: "lines",
      header: "Items",
      render: (t) => (
        <span className="text-sm font-medium">{t.lines.length}</span>
      ),
    },
    {
      key: "totalValue",
      header: "Total Value",
      className: "text-right",
      render: (t) => (
        <span className="text-sm font-medium text-right block">
          {formatCurrency(t.totalValue)}
        </span>
      ),
    },
    {
      key: "eWayBillRequired",
      header: "E-Way Bill",
      render: (t) => {
        if (t.eWayBillNumber) {
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {t.eWayBillNumber}
            </span>
          );
        }
        if (t.eWayBillRequired) {
          return (
            <Badge
              variant="outline"
              className="text-xs bg-amber-50 text-amber-700 border-amber-200"
            >
              Required
            </Badge>
          );
        }
        return <span className="text-muted-foreground text-sm">—</span>;
      },
    },
    {
      key: "requestedBy",
      header: "Requested By",
      render: (t) => (
        <span className="text-sm text-muted-foreground">{t.requestedBy}</span>
      ),
    },
    {
      key: "id",
      header: "Actions",
      render: (t) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedTransfer(t);
          }}
        >
          View Details
        </Button>
      ),
    },
  ];

  function handleSaveNewTransfer() {
    setNewTransferOpen(false);
    setFormFrom(warehouses[0].id);
    setFormTo(warehouses[1].id);
    setFormItem(invItems[0].id);
    setFormQty("");
    setFormRemarks("");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Inter-Warehouse Transfers"
        description="Manage stock movements between Guwahati HQ and Noida"
        actions={
          <Button onClick={() => setNewTransferOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Transfer
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Transfers"
          value={String(stockTransfers.length)}
          icon={ArrowLeftRight}
          iconColor="text-blue-600"
        />
        <KPICard
          title="In Transit"
          value={String(inTransitCount)}
          icon={Truck}
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Completed (Received)"
          value={String(receivedCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Draft / Pending"
          value={String(draftPendingCount)}
          icon={FileClock}
          iconColor="text-amber-600"
        />
      </div>

      {/* Filter + Table */}
      <DataTable<StockTransfer>
        data={filtered}
        columns={columns}
        searchKey="transferNumber"
        searchPlaceholder="Search by transfer number..."
        onRowClick={(t) => setSelectedTransfer(t)}
        actions={
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? "All")}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "All" ? "All Statuses" : s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* Transfer Detail Dialog */}
      <Dialog
        open={!!selectedTransfer}
        onOpenChange={(open) => { if (!open) setSelectedTransfer(null); }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-lg">
              {selectedTransfer?.transferNumber}
            </DialogTitle>
          </DialogHeader>

          {selectedTransfer && (
            <div className="space-y-5">
              {/* Header info */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">From</p>
                  <p className="font-medium">{selectedTransfer.fromWarehouseName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">To</p>
                  <p className="font-medium">{selectedTransfer.toWarehouseName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Status</p>
                  <StatusBadge status={selectedTransfer.status} />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Created</p>
                  <p className="font-medium">{formatDate(selectedTransfer.createdAt)}</p>
                </div>
                {selectedTransfer.shippedAt && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Shipped</p>
                    <p className="font-medium">{formatDate(selectedTransfer.shippedAt)}</p>
                  </div>
                )}
                {selectedTransfer.receivedAt && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Received</p>
                    <p className="font-medium">{formatDate(selectedTransfer.receivedAt)}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Requested By</p>
                  <p className="font-medium">{selectedTransfer.requestedBy}</p>
                </div>
                {selectedTransfer.approvedBy && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Approved By</p>
                    <p className="font-medium">{selectedTransfer.approvedBy}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Total Value</p>
                  <p className="font-semibold text-base">
                    {formatCurrency(selectedTransfer.totalValue)}
                  </p>
                </div>
                {selectedTransfer.eWayBillNumber && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">E-Way Bill</p>
                    <p className="font-mono font-medium text-sm">
                      {selectedTransfer.eWayBillNumber}
                    </p>
                  </div>
                )}
                {selectedTransfer.remarks && (
                  <div className="col-span-2 md:col-span-3">
                    <p className="text-muted-foreground text-xs mb-0.5">Remarks</p>
                    <p className="text-sm italic">{selectedTransfer.remarks}</p>
                  </div>
                )}
              </div>

              {/* Lines table */}
              <div>
                <p className="text-sm font-semibold mb-2">
                  Transfer Lines ({selectedTransfer.lines.length})
                </p>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Requested</TableHead>
                        <TableHead className="text-right">Shipped</TableHead>
                        <TableHead className="text-right">Received</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Batch</TableHead>
                        <TableHead>Discrepancy</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedTransfer.lines.map((line) => {
                        const hasDiscrepancy =
                          line.shippedQty !== undefined &&
                          line.receivedQty !== undefined &&
                          line.shippedQty !== line.receivedQty;
                        const diff =
                          line.shippedQty !== undefined &&
                          line.receivedQty !== undefined
                            ? line.receivedQty - line.shippedQty
                            : null;

                        return (
                          <TableRow key={line.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {line.itemCode}
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {line.itemName}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {line.requestedQty}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {line.shippedQty ?? "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {line.receivedQty ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm">{line.unit}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {line.batchNumber ?? "—"}
                            </TableCell>
                            <TableCell>
                              {hasDiscrepancy && diff !== null ? (
                                <span className="text-xs font-semibold text-red-600">
                                  {diff > 0 ? `+${diff}` : diff} units
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
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
            <Button variant="outline" onClick={() => setSelectedTransfer(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Transfer Dialog */}
      <Dialog open={newTransferOpen} onOpenChange={setNewTransferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Inter-Warehouse Transfer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">From Warehouse</label>
              <Select
                value={formFrom}
                onValueChange={(v) => setFormFrom(v ?? warehouses[0].id)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select source warehouse" />
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
              <label className="text-sm font-medium">To Warehouse</label>
              <Select
                value={formTo}
                onValueChange={(v) => setFormTo(v ?? warehouses[1].id)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select destination warehouse" />
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
              <label className="text-sm font-medium">Item</label>
              <Select
                value={formItem}
                onValueChange={(v) => setFormItem(v ?? invItems[0].id)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {invItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Quantity</label>
              <Input
                type="number"
                placeholder="Enter quantity"
                value={formQty}
                onChange={(e) => setFormQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Remarks</label>
              <Input
                placeholder="Optional remarks"
                value={formRemarks}
                onChange={(e) => setFormRemarks(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTransferOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveNewTransfer}>Save Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
