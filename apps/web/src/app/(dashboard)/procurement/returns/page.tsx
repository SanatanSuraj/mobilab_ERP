"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import {
  rtvList,
  procurementGRNs,
  ReturnToVendor,
  RTVReason,
  RTVStatus,
  RTVLine,
  formatCurrency,
  formatDate,
} from "@/data/procurement-mock";
import {
  PackageX,
  FileX,
  Truck,
  ReceiptText,
  DollarSign,
  Plus,
  AlertTriangle,
} from "lucide-react";

const REASON_LABELS: Record<RTVReason, string> = {
  QC_REJECTION: "QC Rejection",
  WRONG_ITEM: "Wrong Item",
  EXCESS: "Excess",
  DAMAGED_IN_TRANSIT: "Damaged in Transit",
  EXPIRED: "Expired",
};

const REASON_BADGE_STYLE: Record<RTVReason, string> = {
  QC_REJECTION: "bg-red-50 text-red-700 border-red-200",
  EXPIRED: "bg-red-50 text-red-700 border-red-200",
  EXCESS: "bg-amber-50 text-amber-700 border-amber-200",
  WRONG_ITEM: "bg-orange-50 text-orange-700 border-orange-200",
  DAMAGED_IN_TRANSIT: "bg-orange-50 text-orange-700 border-orange-200",
};

function RTVDetailDialog({
  rtv,
  open,
  onOpenChange,
}: {
  rtv: ReturnToVendor;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>RTV Details — {rtv.rtvNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Header */}
          <div className="grid grid-cols-2 gap-3 text-sm bg-muted/40 rounded-lg p-3">
            <div>
              <span className="text-muted-foreground">RTV Number: </span>
              <span className="font-mono font-bold">{rtv.rtvNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Vendor: </span>
              <span className="font-medium">{rtv.vendorName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Inward: </span>
              <span className="font-mono">{rtv.inwardNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">PO: </span>
              <span className="font-mono">{rtv.poNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Reason: </span>
              <Badge
                variant="outline"
                className={`text-xs ${REASON_BADGE_STYLE[rtv.reason]}`}
              >
                {REASON_LABELS[rtv.reason]}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Status: </span>
              <StatusBadge status={rtv.status} />
            </div>
            <div>
              <span className="text-muted-foreground">Total Return Value: </span>
              <span className="font-bold text-red-700">
                {formatCurrency(rtv.totalReturnValue)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Created By: </span>
              <span>{rtv.createdBy}</span>
            </div>
          </div>

          {/* Lines */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Return Lines</h4>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Item Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Line Value</TableHead>
                    <TableHead>Reason Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rtv.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-xs">
                        {line.itemCode}
                      </TableCell>
                      <TableCell className="text-sm">{line.itemName}</TableCell>
                      <TableCell className="text-right font-medium">
                        {line.qtyReturned}
                      </TableCell>
                      <TableCell className="text-sm">{line.unit}</TableCell>
                      <TableCell className="text-right text-sm">
                        {formatCurrency(line.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-red-600">
                        {formatCurrency(line.lineValue)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {line.reasonDetail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Debit Note Callout */}
          {rtv.debitNoteCreated && rtv.debitNoteRef && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <span className="font-medium">→ Debit Note </span>
              <span className="font-mono font-bold">{rtv.debitNoteRef}</span>
              <span> created in Finance &amp; Accounting</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DebitNoteConfirmDialog({
  rtv,
  open,
  onOpenChange,
  onConfirm,
}: {
  rtv: ReturnToVendor;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Raise Debit Note</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Raise a debit note for{" "}
            <span className="font-semibold text-foreground">
              {rtv.rtvNumber}
            </span>
            ?
          </p>
          <p>
            Amount:{" "}
            <span className="font-bold text-red-700">
              {formatCurrency(rtv.totalReturnValue)}
            </span>
          </p>
          <p>Vendor: {rtv.vendorName}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm(rtv.id);
              onOpenChange(false);
            }}
          >
            Confirm &amp; Raise Debit Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReturnsPage() {
  const [rtvs, setRTVs] = useState<ReturnToVendor[]>(rtvList);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaved, setCreateSaved] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRTV, setSelectedRTV] = useState<ReturnToVendor | null>(null);

  const [debitOpen, setDebitOpen] = useState(false);
  const [debitRTV, setDebitRTV] = useState<ReturnToVendor | null>(null);

  // Create RTV form state
  const [selectedGRNId, setSelectedGRNId] = useState("");
  const [reason, setReason] = useState<RTVReason | "">("");
  const [itemName, setItemName] = useState("");
  const [qtyToReturn, setQtyToReturn] = useState<number>(0);
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [reasonDetail, setReasonDetail] = useState("");

  const selectedGRN = procurementGRNs.find((g) => g.id === selectedGRNId);

  function resetCreateForm() {
    setSelectedGRNId("");
    setReason("");
    setItemName("");
    setQtyToReturn(0);
    setUnitPrice(0);
    setReasonDetail("");
    setCreateSaved(false);
  }

  function handleCreateRTV() {
    if (!selectedGRN || !reason) return;
    const newRTV: ReturnToVendor = {
      id: `rtv${Date.now()}`,
      rtvNumber: `MLB-RTV-2026-00${rtvs.length + 3}`,
      inwardId: selectedGRN.inwardId,
      inwardNumber: selectedGRN.inwardNumber,
      grnId: selectedGRN.id,
      poNumber: selectedGRN.poNumber,
      vendorId: selectedGRN.vendorId,
      vendorName: selectedGRN.vendorName,
      reason: reason as RTVReason,
      status: "DRAFT",
      lines: [
        {
          id: `rtvl${Date.now()}`,
          itemId: `itm-new`,
          itemCode: "MLB-ITM-NEW",
          itemName,
          qtyReturned: qtyToReturn,
          unit: "PCS",
          unitPrice,
          lineValue: qtyToReturn * unitPrice,
          reasonDetail,
        },
      ],
      totalReturnValue: qtyToReturn * unitPrice,
      debitNoteCreated: false,
      createdBy: "Ranjit Bora",
      createdAt: new Date().toISOString(),
    };
    setRTVs((prev) => [newRTV, ...prev]);
    setCreateSaved(true);
  }

  function handleMarkDispatched(id: string) {
    setRTVs((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: "DISPATCHED" as RTVStatus, dispatchedAt: new Date().toISOString() }
          : r
      )
    );
  }

  function handleRaiseDebitNote(id: string) {
    setRTVs((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: "DEBIT_NOTE_RAISED" as RTVStatus,
              debitNoteCreated: true,
              debitNoteRef: `DN-2026-00${rtvs.length + 5}`,
            }
          : r
      )
    );
  }

  // KPIs
  const total = rtvs.length;
  const draft = rtvs.filter((r) => r.status === "DRAFT").length;
  const dispatched = rtvs.filter((r) => r.status === "DISPATCHED").length;
  const debitRaised = rtvs.filter(
    (r) => r.status === "DEBIT_NOTE_RAISED"
  ).length;
  const totalReturnValue = rtvs.reduce((s, r) => s + r.totalReturnValue, 0);

  const columns: Column<ReturnToVendor>[] = [
    {
      key: "rtvNumber",
      header: "RTV Number",
      render: (row) => (
        <span className="font-mono font-bold text-sm">{row.rtvNumber}</span>
      ),
    },
    {
      key: "refs",
      header: "Inward / PO",
      render: (row) => (
        <div>
          <div className="font-mono text-xs">{row.inwardNumber}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {row.poNumber}
          </div>
        </div>
      ),
    },
    { key: "vendorName", header: "Vendor" },
    {
      key: "reason",
      header: "Reason",
      render: (row) => (
        <Badge
          variant="outline"
          className={`text-xs ${REASON_BADGE_STYLE[row.reason]}`}
        >
          {REASON_LABELS[row.reason]}
        </Badge>
      ),
    },
    {
      key: "lines",
      header: "Return Lines",
      render: (row) => (
        <div className="text-xs space-y-0.5">
          {row.lines.map((line) => (
            <div key={line.id}>
              {line.itemName}{" "}
              <span className="font-medium">
                ×{line.qtyReturned} {line.unit}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "totalReturnValue",
      header: "Total Return Value",
      className: "text-right",
      render: (row) => (
        <span className="font-medium text-red-600 text-sm">
          {formatCurrency(row.totalReturnValue)}
        </span>
      ),
    },
    {
      key: "debitNote",
      header: "Debit Note",
      render: (row) =>
        row.debitNoteCreated && row.debitNoteRef ? (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 text-xs font-mono"
          >
            {row.debitNoteRef}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
          >
            Not Raised
          </Badge>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "createdBy",
      header: "Created By / Date",
      render: (row) => (
        <div className="text-sm">
          <div>{row.createdBy}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(row.createdAt)}
          </div>
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setSelectedRTV(row);
              setDetailOpen(true);
            }}
          >
            View
          </Button>
          {row.status === "DRAFT" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleMarkDispatched(row.id)}
            >
              Mark Dispatched
            </Button>
          )}
          {row.status === "DISPATCHED" && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setDebitRTV(row);
                setDebitOpen(true);
              }}
            >
              Raise Debit Note
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Returns (RTV)"
        description="Return rejected or excess goods to vendors with debit notes"
        actions={
          <Button
            onClick={() => {
              resetCreateForm();
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create RTV
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Total RTVs"
          value={String(total)}
          icon={PackageX}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Draft"
          value={String(draft)}
          icon={FileX}
          iconColor="text-gray-600"
        />
        <KPICard
          title="Dispatched"
          value={String(dispatched)}
          icon={Truck}
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Debit Note Raised"
          value={String(debitRaised)}
          icon={ReceiptText}
          iconColor="text-green-600"
        />
        <KPICard
          title="Total Return Value"
          value={formatCurrency(totalReturnValue)}
          icon={DollarSign}
          iconColor="text-red-600"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable
            data={rtvs}
            columns={columns}
            searchKey="vendorName"
            searchPlaceholder="Search by vendor…"
          />
        </CardContent>
      </Card>

      {/* Create RTV Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Return to Vendor (RTV)</DialogTitle>
          </DialogHeader>

          {createSaved ? (
            <div className="rounded-md bg-green-50 border border-green-200 p-4 text-green-800 text-sm font-medium">
              ✓ Finance notified to raise Debit Note
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>GRN Reference</Label>
                <Select
                  value={selectedGRNId}
                  onValueChange={(v) => setSelectedGRNId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select GRN…" />
                  </SelectTrigger>
                  <SelectContent>
                    {procurementGRNs.map((grn) => (
                      <SelectItem key={grn.id} value={grn.id}>
                        {grn.grnNumber} — {grn.vendorName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Vendor</Label>
                  <Input
                    value={selectedGRN?.vendorName ?? ""}
                    readOnly
                    className="bg-muted/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>PO Number</Label>
                  <Input
                    value={selectedGRN?.poNumber ?? ""}
                    readOnly
                    className="bg-muted/40"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select
                  value={reason}
                  onValueChange={(v) => setReason((v ?? "") as RTVReason | "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="QC_REJECTION">QC Rejection</SelectItem>
                    <SelectItem value="WRONG_ITEM">Wrong Item</SelectItem>
                    <SelectItem value="EXCESS">Excess</SelectItem>
                    <SelectItem value="DAMAGED_IN_TRANSIT">Damaged in Transit</SelectItem>
                    <SelectItem value="EXPIRED">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Item Name</Label>
                <Input
                  placeholder="Item name"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Qty to Return</Label>
                  <Input
                    type="number"
                    min={0}
                    value={qtyToReturn}
                    onChange={(e) => setQtyToReturn(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Unit Price (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Reason Detail</Label>
                <Textarea
                  placeholder="Describe the return reason in detail…"
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value)}
                  rows={3}
                />
              </div>

              {qtyToReturn > 0 && unitPrice > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm">
                  <span className="text-red-700 font-medium">Return Value: </span>
                  <span className="text-red-800 font-bold">
                    {formatCurrency(qtyToReturn * unitPrice)}
                  </span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
            {!createSaved && (
              <Button
                onClick={handleCreateRTV}
                disabled={!selectedGRNId || !reason || !itemName}
              >
                Create RTV
              </Button>
            )}
            {createSaved && (
              <Button
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateForm();
                }}
              >
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RTV Detail Dialog */}
      {selectedRTV && (
        <RTVDetailDialog
          rtv={selectedRTV}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      )}

      {/* Debit Note Confirm Dialog */}
      {debitRTV && (
        <DebitNoteConfirmDialog
          rtv={debitRTV}
          open={debitOpen}
          onOpenChange={setDebitOpen}
          onConfirm={handleRaiseDebitNote}
        />
      )}
    </div>
  );
}
