"use client";

/**
 * PO detail — reads /procurement/purchase-orders/:id (returns
 * PurchaseOrderWithLines) via useApiPurchaseOrder.
 *
 * **Edit-in-place**: every header input and every line cell is a real form
 * control. A sticky "Save Changes" bar appears when the user dirties the
 * header; each line row has its own per-row save affordance so users can
 * commit an edit without impacting the rest.
 *
 * Capabilities:
 *   - Inline-edit header (vendor, dates, currency, payment term, shipping
 *     address, notes) while PO is in DRAFT status. Saves via
 *     useApiUpdatePurchaseOrder with `expectedVersion`.
 *   - Inline-edit lines (qty, UoM, unit price, discount%, tax%, description,
 *     notes) via useApiUpdatePoLine. Server recomputes header totals.
 *   - Add / delete line items (unchanged dialog flow).
 *   - Status transitions:
 *       DRAFT → PENDING_APPROVAL
 *       PENDING_APPROVAL → APPROVED
 *       APPROVED → SENT
 *       DRAFT | PENDING_APPROVAL | APPROVED → CANCELLED
 *   - All writes use optimistic concurrency via `expectedVersion`; 409
 *     bubbles up as an ApiProblem on the save bar.
 *
 * Once the PO leaves DRAFT status, inputs lock to read-only so we don't
 * surface edit affordances that would 409 on save.
 */

import { memo, use, useCallback, useEffect, useMemo, useState } from "react";
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
  useApiUpdatePoLine,
  useApiUpdatePurchaseOrder,
  useApiVendor,
  useApiVendors,
} from "@/hooks/useProcurementApi";
import { useApiItems, useApiWarehouses } from "@/hooks/useInventoryApi";
import type { Item, PoLine, PoStatus } from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Check,
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

// Normalise the server's ISO timestamp into the `YYYY-MM-DD` string that
// `<input type="date">` expects. The server returns ISO strings; a bare
// `value={po.orderDate}` leaves the input empty when the string has a
// time component.
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

const STATUS_TONE: Record<PoStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200",
  SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PARTIALLY_RECEIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RECEIVED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

const CURRENCY_OPTIONS = ["INR", "USD", "EUR", "GBP"] as const;

// ─── Component ──────────────────────────────────────────────────────────────

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

  const itemsQuery = useApiItems({ limit: 500, isActive: true });
  const items = itemsQuery.data?.data ?? [];

  const vendorsQuery = useApiVendors({ limit: 200, isActive: true });
  const vendors = vendorsQuery.data?.data ?? [];

  const warehousesQuery = useApiWarehouses({ limit: 100, isActive: true });
  const warehouses = warehousesQuery.data?.data ?? [];

  const updatePo = useApiUpdatePurchaseOrder(id);
  const addLine = useApiAddPoLine(id);
  const updateLine = useApiUpdatePoLine(id);
  const deleteLine = useApiDeletePoLine(id);

  // ─── Dialog state ────────────────────────────────────────────────────────
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const [formItemId, setFormItemId] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formUom, setFormUom] = useState("");
  const [formUnitPrice, setFormUnitPrice] = useState("");
  const [formDiscount, setFormDiscount] = useState("0");
  const [formTax, setFormTax] = useState("0");
  const [lineError, setLineError] = useState<string | null>(null);

  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // ─── Editable header draft ───────────────────────────────────────────────
  // We keep a local draft keyed to `po.updatedAt`. If the server data bumps
  // underneath us (another tab / GRN posting), we reseed so the draft
  // doesn't trample a concurrent change. Dirty detection compares draft to
  // the cached server view via JSON string — fine for a handful of fields.
  type HeaderDraft = {
    vendorId: string;
    currency: string;
    orderDate: string;
    expectedDate: string;
    deliveryWarehouseId: string;
    paymentTermsDays: string;
    shippingAddress: string;
    billingAddress: string;
    notes: string;
  };

  function draftFromPo(): HeaderDraft {
    return {
      vendorId: po?.vendorId ?? "",
      currency: po?.currency ?? "INR",
      orderDate: toDateInput(po?.orderDate),
      expectedDate: toDateInput(po?.expectedDate),
      deliveryWarehouseId: po?.deliveryWarehouseId ?? "",
      paymentTermsDays: String(po?.paymentTermsDays ?? 30),
      shippingAddress: po?.shippingAddress ?? "",
      billingAddress: po?.billingAddress ?? "",
      notes: po?.notes ?? "",
    };
  }

  const [draft, setDraft] = useState<HeaderDraft>(() => draftFromPo());

  // Reseed when the underlying PO changes (version bump, refetch).
  useEffect(() => {
    if (!po) return;
    setDraft(draftFromPo());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po?.id, po?.updatedAt, po?.version]);

  const isDirty = useMemo(() => {
    if (!po) return false;
    const server = {
      vendorId: po.vendorId,
      currency: po.currency,
      orderDate: toDateInput(po.orderDate),
      expectedDate: toDateInput(po.expectedDate),
      deliveryWarehouseId: po.deliveryWarehouseId ?? "",
      paymentTermsDays: String(po.paymentTermsDays),
      shippingAddress: po.shippingAddress ?? "",
      billingAddress: po.billingAddress ?? "",
      notes: po.notes ?? "",
    };
    return JSON.stringify(server) !== JSON.stringify(draft);
  }, [po, draft]);

  // Early returns — all hooks are above this line.
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

  // ─── Header save ────────────────────────────────────────────────────────
  async function saveHeader(): Promise<void> {
    if (!po) return;
    setActionError(null);
    try {
      await updatePo.mutateAsync({
        vendorId: draft.vendorId || undefined,
        currency: draft.currency || undefined,
        orderDate: draft.orderDate || undefined,
        expectedDate: draft.expectedDate || undefined,
        deliveryWarehouseId: draft.deliveryWarehouseId || undefined,
        paymentTermsDays: draft.paymentTermsDays
          ? Number.parseInt(draft.paymentTermsDays, 10)
          : undefined,
        shippingAddress: draft.shippingAddress || undefined,
        billingAddress: draft.billingAddress || undefined,
        notes: draft.notes || undefined,
        expectedVersion: po.version,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Save failed — please refresh."
      );
    }
  }

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

  // useCallback so EditableLineRow's React.memo bail-out keeps the row from
  // re-rendering on every parent state change (header edits, dialog opens,
  // etc.). deleteLine is a TanStack Query mutation result whose .mutateAsync
  // identity is stable, so this dep keeps the callback stable too.
  const handleDeleteLine = useCallback(
    async (lineId: string): Promise<void> => {
      setActionError(null);
      try {
        await deleteLine.mutateAsync(lineId);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Delete failed");
      }
    },
    [deleteLine],
  );

  const canSubmit = po.status === "DRAFT" && po.lines.length > 0;
  const canApprove = po.status === "PENDING_APPROVAL";
  const canSend = po.status === "APPROVED";
  const canCancel =
    po.status === "DRAFT" ||
    po.status === "PENDING_APPROVAL" ||
    po.status === "APPROVED";

  const selectedFormItem = items.find((i) => i.id === formItemId);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Back */}
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
        {/* Left */}
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">PO Header</CardTitle>
              {!editable && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-normal text-muted-foreground"
                >
                  Read-only ({po.status.replace(/_/g, " ")})
                </Badge>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              {/* Vendor */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Vendor
                </Label>
                {editable ? (
                  <Select
                    value={draft.vendorId}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, vendorId: v ?? "" }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select vendor…" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.code} — {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="font-medium">{vendor?.name ?? "—"}</p>
                )}
                {vendor?.gstin && (
                  <p className="text-xs text-muted-foreground font-mono">
                    {vendor.gstin}
                  </p>
                )}
              </div>

              {/* Payment Terms */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Payment Terms (days)
                </Label>
                {editable ? (
                  <Input
                    type="number"
                    value={draft.paymentTermsDays}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        paymentTermsDays: e.target.value,
                      }))
                    }
                    className="h-9"
                  />
                ) : (
                  <p>Net {po.paymentTermsDays} days</p>
                )}
              </div>

              {/* Order Date */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Order Date
                </Label>
                {editable ? (
                  <Input
                    type="date"
                    value={draft.orderDate}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, orderDate: e.target.value }))
                    }
                    className="h-9"
                  />
                ) : (
                  <p>{formatDate(po.orderDate)}</p>
                )}
              </div>

              {/* Expected Date */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Expected Date
                </Label>
                {editable ? (
                  <Input
                    type="date"
                    value={draft.expectedDate}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        expectedDate: e.target.value,
                      }))
                    }
                    className="h-9"
                  />
                ) : (
                  <p>{formatDate(po.expectedDate)}</p>
                )}
              </div>

              {/* Currency */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Currency
                </Label>
                {editable ? (
                  <Select
                    value={draft.currency}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, currency: v ?? "INR" }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p>{po.currency}</p>
                )}
              </div>

              {/* Delivery Warehouse */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Delivery Warehouse
                </Label>
                {editable ? (
                  <Select
                    value={draft.deliveryWarehouseId}
                    onValueChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        deliveryWarehouseId: v ?? "",
                      }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p>
                    {warehouses.find(
                      (w) => w.id === po.deliveryWarehouseId
                    )?.name ?? "—"}
                  </p>
                )}
              </div>

              {po.approvedAt && (
                <div>
                  <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                    Approved
                  </Label>
                  <p>{formatDate(po.approvedAt)}</p>
                </div>
              )}
              {po.sentAt && (
                <div>
                  <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                    Sent
                  </Label>
                  <p>{formatDate(po.sentAt)}</p>
                </div>
              )}
              {po.cancelledAt && (
                <div>
                  <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                    Cancelled
                  </Label>
                  <p>{formatDate(po.cancelledAt)}</p>
                  {po.cancelReason && (
                    <p className="text-xs text-red-600 mt-0.5">
                      {po.cancelReason}
                    </p>
                  )}
                </div>
              )}

              {/* Shipping Address */}
              <div className="col-span-2 space-y-1 pt-2 border-t">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Shipping Address
                </Label>
                {editable ? (
                  <Textarea
                    rows={2}
                    value={draft.shippingAddress}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        shippingAddress: e.target.value,
                      }))
                    }
                  />
                ) : (
                  <p className="whitespace-pre-line">
                    {po.shippingAddress ?? "—"}
                  </p>
                )}
              </div>

              {/* Billing Address */}
              <div className="col-span-2 space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Billing Address
                </Label>
                {editable ? (
                  <Textarea
                    rows={2}
                    value={draft.billingAddress}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        billingAddress: e.target.value,
                      }))
                    }
                  />
                ) : (
                  <p className="whitespace-pre-line">
                    {po.billingAddress ?? "—"}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div className="col-span-2 space-y-1">
                <Label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">
                  Notes
                </Label>
                {editable ? (
                  <Textarea
                    rows={3}
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, notes: e.target.value }))
                    }
                    placeholder="Internal notes…"
                  />
                ) : (
                  <p className="whitespace-pre-line">{po.notes ?? "—"}</p>
                )}
              </div>

              {/* Inline save bar */}
              {editable && (
                <div className="col-span-2 pt-3 border-t flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {isDirty
                      ? "Unsaved changes — click Save to commit."
                      : "No pending header changes."}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isDirty || updatePo.isPending}
                      onClick={() => setDraft(draftFromPo())}
                    >
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      disabled={!isDirty || updatePo.isPending}
                      onClick={saveHeader}
                      className="gap-1"
                    >
                      <Check className="h-4 w-4" />
                      {updatePo.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
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
                  No line items yet.{" "}
                  {editable && (
                    <>Click <b>Add Line</b> to add the first one.</>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-10 text-xs">#</TableHead>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-right text-xs">Qty</TableHead>
                      <TableHead className="text-xs">UoM</TableHead>
                      <TableHead className="text-right text-xs">
                        Unit Price
                      </TableHead>
                      <TableHead className="text-right text-xs">
                        Disc %
                      </TableHead>
                      <TableHead className="text-right text-xs">
                        Tax %
                      </TableHead>
                      <TableHead className="text-right text-xs">
                        Total
                      </TableHead>
                      <TableHead className="text-right text-xs">
                        Received
                      </TableHead>
                      {editable && <TableHead className="w-20 text-xs" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {po.lines.map((line) => (
                      <EditableLineRow
                        key={line.id}
                        line={line}
                        poVersion={po.version}
                        items={items}
                        editable={editable}
                        updateLine={updateLine}
                        onDelete={handleDeleteLine}
                        deleting={deleteLine.isPending}
                      />
                    ))}
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
                  placeholder={selectedFormItem?.uom ?? "EA"}
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

// ─── Editable line row ──────────────────────────────────────────────────────

type EditableLineRowProps = {
  line: PoLine;
  poVersion: number;
  items: Item[];
  editable: boolean;
  updateLine: ReturnType<typeof useApiUpdatePoLine>;
  /** Receives line.id so the parent can pass a stable handler reference
   *  (necessary for the React.memo wrapper below to actually skip
   *  re-renders when only sibling rows or unrelated parent state change). */
  onDelete: (lineId: string) => void;
  deleting: boolean;
};

/**
 * A per-row local draft, so editing one line doesn't invalidate edits in
 * progress on another. On "Save" we fire useApiUpdatePoLine which
 * invalidates the detail query — the draft reseeds via the `useEffect`
 * on `line.updatedAt`.
 *
 * (`poVersion` is passed in to force a re-seed on unrelated header saves
 *  that bump the parent version.)
 */
// Wrapped in React.memo so a parent re-render (header field edit, dialog
// open/close, totals refresh, etc.) doesn't redundantly re-render every
// row. With the parent's onDelete now useCallback'd, items referentially
// stable from useApiItems, and primitive props (editable, deleting,
// poVersion), the memo bail-out kicks in cleanly.
const EditableLineRow = memo(function EditableLineRow({
  line,
  poVersion,
  items,
  editable,
  updateLine,
  onDelete,
  deleting,
}: EditableLineRowProps): React.ReactElement {
  type LineDraft = {
    description: string;
    quantity: string;
    uom: string;
    unitPrice: string;
    discountPct: string;
    taxPct: string;
    notes: string;
  };

  function fromLine(): LineDraft {
    return {
      description: line.description ?? "",
      quantity: line.quantity,
      uom: line.uom,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
      taxPct: line.taxPct,
      notes: line.notes ?? "",
    };
  }

  const [draft, setDraft] = useState<LineDraft>(() => fromLine());

  useEffect(() => {
    setDraft(fromLine());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, line.updatedAt, poVersion]);

  const isDirty = useMemo(() => {
    return (
      draft.description !== (line.description ?? "") ||
      draft.quantity !== line.quantity ||
      draft.uom !== line.uom ||
      draft.unitPrice !== line.unitPrice ||
      draft.discountPct !== line.discountPct ||
      draft.taxPct !== line.taxPct ||
      draft.notes !== (line.notes ?? "")
    );
  }, [draft, line]);

  async function saveLine(): Promise<void> {
    await updateLine.mutateAsync({
      lineId: line.id,
      body: {
        description: draft.description,
        quantity: draft.quantity,
        uom: draft.uom,
        unitPrice: draft.unitPrice,
        discountPct: draft.discountPct,
        taxPct: draft.taxPct,
        notes: draft.notes,
      },
    });
  }

  const item = items.find((i) => i.id === line.itemId);

  return (
    <TableRow>
      <TableCell className="text-xs font-mono text-muted-foreground">
        {line.lineNo}
      </TableCell>
      <TableCell className="text-sm">
        <p className="font-medium">
          {item?.name ?? line.itemId.slice(0, 8)}
        </p>
        {item && (
          <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {editable ? (
          <Input
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
            className="h-8 min-w-[180px]"
            placeholder={item?.name ?? "—"}
          />
        ) : (
          <span>{line.description ?? "—"}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            type="number"
            value={draft.quantity}
            onChange={(e) =>
              setDraft((d) => ({ ...d, quantity: e.target.value }))
            }
            className="h-8 w-[80px] text-right"
          />
        ) : (
          <span className="text-sm">{line.quantity}</span>
        )}
      </TableCell>
      <TableCell>
        {editable ? (
          <Input
            value={draft.uom}
            onChange={(e) =>
              setDraft((d) => ({ ...d, uom: e.target.value }))
            }
            className="h-8 w-[70px]"
          />
        ) : (
          <span className="text-sm">{line.uom}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            type="number"
            value={draft.unitPrice}
            onChange={(e) =>
              setDraft((d) => ({ ...d, unitPrice: e.target.value }))
            }
            className="h-8 w-[100px] text-right"
          />
        ) : (
          <span className="text-sm">{formatMoney(line.unitPrice)}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            type="number"
            value={draft.discountPct}
            onChange={(e) =>
              setDraft((d) => ({ ...d, discountPct: e.target.value }))
            }
            className="h-8 w-[70px] text-right"
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            {line.discountPct}%
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <Input
            type="number"
            value={draft.taxPct}
            onChange={(e) =>
              setDraft((d) => ({ ...d, taxPct: e.target.value }))
            }
            className="h-8 w-[70px] text-right"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{line.taxPct}%</span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm font-medium">
        {formatMoney(line.lineTotal)}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        {line.receivedQty}
      </TableCell>
      {editable && (
        <TableCell>
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="icon"
              variant={isDirty ? "default" : "ghost"}
              className="h-7 w-7"
              disabled={!isDirty || updateLine.isPending}
              onClick={saveLine}
              aria-label={`Save line ${line.lineNo}`}
              title="Save line"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-red-600"
              disabled={deleting}
              onClick={() => onDelete(line.id)}
              aria-label={`Delete line ${line.lineNo}`}
              title="Delete line"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
});
