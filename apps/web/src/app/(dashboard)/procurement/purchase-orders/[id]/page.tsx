"use client";

/**
 * PO detail — reads /procurement/purchase-orders/:id (returns
 * PurchaseOrderWithLines) via useApiPurchaseOrder.
 *
 * Capabilities:
 *   - Add / update / delete line items (while PO is in DRAFT status);
 *     server recomputes subtotal/tax_total/discount_total/grand_total.
 *   - Status transitions:
 *       DRAFT → PENDING_APPROVAL
 *       PENDING_APPROVAL → APPROVED  (approval workflow collapses to a
 *                                     single step in Phase 2)
 *       APPROVED → SENT              (service stamps sentAt)
 *       DRAFT | PENDING_APPROVAL | APPROVED → CANCELLED
 *         (service stamps cancelledAt + cancelReason)
 *   - Everything uses optimistic concurrency via `expectedVersion`; 409
 *     bubbles up as an ApiProblem.
 *
 * Deltas vs mock:
 *   - Approval logs + finance/mgmt dual-sign + proforma-invoice upload
 *     are Phase 3. The mock flow squashes into a single APPROVED state.
 *   - totalValue is derived from `grandTotal` (decimal string).
 */

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Skeleton } from "@/components/ui/skeleton";
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
  useApiAddPoLine,
  useApiDeletePoLine,
  useApiPurchaseOrder,
  useApiUpdatePurchaseOrder,
  useApiVendor,
} from "@/hooks/useProcurementApi";
import { useApiItems } from "@/hooks/useInventoryApi";
import type { PoStatus } from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

function formatMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw ?? "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TONE: Record<PoStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PARTIALLY_RECEIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RECEIVED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default function PoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const poQuery = useApiPurchaseOrder(id);
  const po = poQuery.data;
  const vendorQuery = useApiVendor(po?.vendorId);

  const itemsQuery = useApiItems({ limit: 200, isActive: true });
  const items = itemsQuery.data?.data ?? [];

  const updatePo = useApiUpdatePurchaseOrder(id);
  const addLine = useApiAddPoLine(id);
  const deleteLine = useApiDeletePoLine(id);

  // Dialog state
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // Line form
  const [formItemId, setFormItemId] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formUom, setFormUom] = useState("");
  const [formUnitPrice, setFormUnitPrice] = useState("");
  const [formDiscount, setFormDiscount] = useState("0");
  const [formTax, setFormTax] = useState("0");
  const [lineError, setLineError] = useState<string | null>(null);

  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === formItemId),
    [items, formItemId]
  );

  if (poQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (poQuery.isError || !po) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              {poQuery.isError
                ? "Failed to load purchase order"
                : "Purchase order not found"}
            </p>
            {poQuery.isError && (
              <p className="text-red-700 mt-1">
                {poQuery.error instanceof Error
                  ? poQuery.error.message
                  : "Unknown error"}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/procurement/purchase-orders")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Purchase Orders
        </Button>
      </div>
    );
  }

  const vendor = vendorQuery.data;
  const editable = po.status === "DRAFT";

  async function changeStatus(next: PoStatus): Promise<void> {
    if (!po) return;
    setActionError(null);
    try {
      await updatePo.mutateAsync({
        status: next,
        expectedVersion: po.version,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Status update failed");
    }
  }

  async function cancelPo(): Promise<void> {
    if (!po) return;
    setActionError(null);
    try {
      await updatePo.mutateAsync({
        status: "CANCELLED",
        cancelReason: cancelReason.trim() || undefined,
        expectedVersion: po.version,
      });
      setCancelDialogOpen(false);
      setCancelReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  async function handleAddLine(): Promise<void> {
    setLineError(null);
    if (!formItemId || !formQty || !formUom || !formUnitPrice) {
      setLineError("Item, quantity, UoM and unit price are required.");
      return;
    }
    try {
      await addLine.mutateAsync({
        itemId: formItemId,
        quantity: formQty,
        uom: formUom,
        unitPrice: formUnitPrice,
        discountPct: formDiscount || "0",
        taxPct: formTax || "0",
      });
      setLineDialogOpen(false);
      setFormItemId("");
      setFormQty("");
      setFormUom("");
      setFormUnitPrice("");
      setFormDiscount("0");
      setFormTax("0");
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "Add line failed");
    }
  }

  async function handleDeleteLine(lineId: string): Promise<void> {
    setActionError(null);
    try {
      await deleteLine.mutateAsync(lineId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const canSubmit = po.status === "DRAFT" && po.lines.length > 0;
  const canApprove = po.status === "PENDING_APPROVAL";
  const canSend = po.status === "APPROVED";
  const canCancel =
    po.status === "DRAFT" ||
    po.status === "PENDING_APPROVAL" ||
    po.status === "APPROVED";

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Back button */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/procurement/purchase-orders")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Purchase Orders
        </Button>
      </div>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {po.poNumber}
            </h1>
            <Badge
              variant="outline"
              className={`text-xs whitespace-nowrap ${STATUS_TONE[po.status]}`}
            >
              {po.status.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {po.currency}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {vendor ? vendor.name : "…"} · Ordered {formatDate(po.orderDate)}
            {po.expectedDate && ` · Expected ${formatDate(po.expectedDate)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canSubmit && (
            <Button
              size="sm"
              onClick={() => changeStatus("PENDING_APPROVAL")}
              disabled={updatePo.isPending}
            >
              Submit for Approval
            </Button>
          )}
          {canApprove && (
            <Button
              size="sm"
              onClick={() => changeStatus("APPROVED")}
              disabled={updatePo.isPending}
              className="gap-1"
            >
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
          )}
          {canSend && (
            <Button
              size="sm"
              onClick={() => changeStatus("SENT")}
              disabled={updatePo.isPending}
              className="gap-1"
            >
              <Send className="h-4 w-4" /> Mark Sent
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50 gap-1"
              onClick={() => setCancelDialogOpen(true)}
              disabled={updatePo.isPending}
            >
              <Ban className="h-4 w-4" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left: header info */}
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PO Header</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Vendor
                </p>
                <p className="font-medium">{vendor?.name ?? "—"}</p>
                {vendor?.gstin && (
                  <p className="text-xs text-muted-foreground font-mono">
                    {vendor.gstin}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Payment Terms
                </p>
                <p>Net {po.paymentTermsDays} days</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Order Date
                </p>
                <p>{formatDate(po.orderDate)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Expected Date
                </p>
                <p>{formatDate(po.expectedDate)}</p>
              </div>
              {po.approvedAt && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Approved
                  </p>
                  <p>{formatDate(po.approvedAt)}</p>
                </div>
              )}
              {po.sentAt && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Sent
                  </p>
                  <p>{formatDate(po.sentAt)}</p>
                </div>
              )}
              {po.cancelledAt && (
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Cancelled
                  </p>
                  <p>{formatDate(po.cancelledAt)}</p>
                  {po.cancelReason && (
                    <p className="text-xs text-red-600 mt-0.5">
                      {po.cancelReason}
                    </p>
                  )}
                </div>
              )}
              {po.notes && (
                <div className="col-span-2 pt-2 border-t">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Notes
                  </p>
                  <p>{po.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Line Items
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({po.lines.length})
                </span>
              </CardTitle>
              {editable && (
                <Button
                  size="sm"
                  onClick={() => setLineDialogOpen(true)}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" /> Add Line
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {po.lines.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No line items yet. Click "Add Line" to add the first one.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-10 text-xs">#</TableHead>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-right text-xs">Qty</TableHead>
                      <TableHead className="text-right text-xs">Unit Price</TableHead>
                      <TableHead className="text-right text-xs">Disc %</TableHead>
                      <TableHead className="text-right text-xs">Tax %</TableHead>
                      <TableHead className="text-right text-xs">Total</TableHead>
                      <TableHead className="text-right text-xs">Received</TableHead>
                      {editable && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {po.lines.map((line) => {
                      const item = items.find((i) => i.id === line.itemId);
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {line.lineNo}
                          </TableCell>
                          <TableCell className="text-sm">
                            <p className="font-medium">
                              {item?.name ?? line.itemId.slice(0, 8)}
                            </p>
                            {item && (
                              <p className="text-xs font-mono text-muted-foreground">
                                {item.sku}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {line.quantity} {line.uom}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {formatMoney(line.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {line.discountPct}%
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {line.taxPct}%
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatMoney(line.lineTotal)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {line.receivedQty}
                          </TableCell>
                          {editable && (
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-red-600"
                                disabled={deleteLine.isPending}
                                onClick={() => handleDeleteLine(line.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: totals */}
        <div className="col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatMoney(po.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-medium text-red-600">
                  − {formatMoney(po.discountTotal)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span className="font-medium">{formatMoney(po.taxTotal)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t font-bold">
                <span>Grand Total</span>
                <span>{formatMoney(po.grandTotal)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono">{po.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDate(po.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last updated</span>
                <span>{formatDate(po.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add line dialog */}
      <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add PO Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {lineError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                {lineError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Item</Label>
              <Select
                value={formItemId}
                onValueChange={(v) => {
                  setFormItemId(v ?? "");
                  const item = items.find((i) => i.id === v);
                  if (item) {
                    setFormUom(item.uom);
                    setFormUnitPrice(item.unitCost);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item..." />
                </SelectTrigger>
                <SelectContent>
                  {items.map((it) => (
                    <SelectItem key={it.id} value={it.id}>
                      {it.sku} — {it.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Qty</Label>
                <Input
                  type="number"
                  value={formQty}
                  onChange={(e) => setFormQty(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>UoM</Label>
                <Input
                  value={formUom}
                  onChange={(e) => setFormUom(e.target.value)}
                  placeholder={selectedItem?.uom ?? "EA"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Price (₹)</Label>
                <Input
                  type="number"
                  value={formUnitPrice}
                  onChange={(e) => setFormUnitPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Discount %</Label>
                <Input
                  type="number"
                  value={formDiscount}
                  onChange={(e) => setFormDiscount(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tax %</Label>
                <Input
                  type="number"
                  value={formTax}
                  onChange={(e) => setFormTax(e.target.value)}
                  placeholder="18"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLineDialogOpen(false)}
              disabled={addLine.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleAddLine} disabled={addLine.isPending}>
              {addLine.isPending ? "Adding…" : "Add Line"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This will flip the PO to CANCELLED. Optionally note the reason.
            </p>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder="e.g. Vendor out of stock"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={updatePo.isPending}
            >
              Keep Open
            </Button>
            <Button
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50"
              onClick={cancelPo}
              disabled={updatePo.isPending}
            >
              {updatePo.isPending ? "Cancelling…" : "Confirm Cancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
