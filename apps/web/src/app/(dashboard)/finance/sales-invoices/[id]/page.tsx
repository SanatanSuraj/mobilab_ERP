"use client";

/**
 * Sales Invoice Detail — reads /finance/sales-invoices/:id via
 * useApiSalesInvoice which returns the `SalesInvoiceWithLines` envelope
 * (header + embedded `lines[]`).
 *
 * Surfaces:
 *   - Header summary (customer, dates, totals, version)
 *   - Line items table with add/update/delete (DRAFT-only, client-guarded)
 *   - Post / Cancel lifecycle actions with optimistic concurrency
 *   - Payment recording for POSTED invoices (CUSTOMER_RECEIPT)
 *
 * Concurrency: the server enforces version-based optimistic locking
 * (`expectedVersion`). The page always passes the version from the latest
 * cached header. On a 409 stale-version error, the user is prompted to refresh.
 */

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiAddSalesInvoiceLine,
  useApiCancelSalesInvoice,
  useApiCreatePayment,
  useApiCustomerLedger,
  useApiDeleteSalesInvoiceLine,
  useApiPostSalesInvoice,
  useApiSalesInvoice,
} from "@/hooks/useFinanceApi";
import type { InvoiceStatus } from "@mobilab/contracts";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  CalendarDays,
  CreditCard,
  FileText,
  Hash,
  Loader2,
  MapPin,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";

// ─── Display helpers ─────────────────────────────────────────────────────────

function formatMoney(value: string, currency = "INR"): string {
  const n = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TONE: Record<InvoiceStatus, string> = {
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  POSTED: "bg-blue-50 text-blue-700 border-blue-200",
  CANCELLED: "bg-gray-50 text-gray-600 border-gray-200",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SalesInvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;

  const invoiceQuery = useApiSalesInvoice(invoiceId);
  const ledgerQuery = useApiCustomerLedger({
    limit: 20,
    customerId: invoiceQuery.data?.customerId ?? undefined,
  });

  const addLine = useApiAddSalesInvoiceLine(invoiceId);
  const deleteLine = useApiDeleteSalesInvoiceLine(invoiceId);
  const postInvoice = useApiPostSalesInvoice(invoiceId);
  const cancelInvoice = useApiCancelSalesInvoice(invoiceId);
  const createPayment = useApiCreatePayment();

  // Dialog state
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // Line-form state
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [linePrice, setLinePrice] = useState("0");
  const [lineTaxPct, setLineTaxPct] = useState("18");
  const [lineDiscPct, setLineDiscPct] = useState("0");
  const [lineHsn, setLineHsn] = useState("");
  const [lineError, setLineError] = useState<string | null>(null);

  // Payment-form state
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [payMode, setPayMode] = useState<
    "CASH" | "BANK_TRANSFER" | "CHEQUE" | "UPI" | "CARD" | "OTHER"
  >("BANK_TRANSFER");
  const [payReference, setPayReference] = useState("");
  const [payError, setPayError] = useState<string | null>(null);

  // Cancel-form state
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  // ─── Loading / error shells ──────────────────────────────────────────────
  if (invoiceQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-4">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-6 w-80" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (invoiceQuery.isError || !invoiceQuery.data) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load invoice</p>
            <p className="text-red-700 mt-1">
              {invoiceQuery.error instanceof Error
                ? invoiceQuery.error.message
                : "Not found or access denied"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => router.push("/finance/sales-invoices")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Sales Invoices
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const invoice = invoiceQuery.data;
  const lines = invoice.lines ?? [];
  const outstanding =
    Number(invoice.grandTotal) - Number(invoice.amountPaid);
  const isDraft = invoice.status === "DRAFT";
  const isPosted = invoice.status === "POSTED";
  const isCancelled = invoice.status === "CANCELLED";

  // ─── Handlers ────────────────────────────────────────────────────────────

  const resetLineForm = (): void => {
    setLineDesc("");
    setLineQty("1");
    setLinePrice("0");
    setLineTaxPct("18");
    setLineDiscPct("0");
    setLineHsn("");
    setLineError(null);
  };

  const handleAddLine = async (): Promise<void> => {
    setLineError(null);
    if (!lineDesc.trim()) {
      setLineError("description is required");
      return;
    }
    try {
      await addLine.mutateAsync({
        description: lineDesc.trim(),
        quantity: lineQty,
        unitPrice: linePrice,
        taxRatePercent: lineTaxPct,
        discountPercent: lineDiscPct,
        hsnSac: lineHsn.trim() || undefined,
      });
      setLineDialogOpen(false);
      resetLineForm();
    } catch (err) {
      setLineError(err instanceof Error ? err.message : "failed to add line");
    }
  };

  const handleDeleteLine = async (lineId: string): Promise<void> => {
    if (!confirm("Delete this line?")) return;
    try {
      await deleteLine.mutateAsync(lineId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "failed to delete line");
    }
  };

  const handlePost = async (): Promise<void> => {
    try {
      await postInvoice.mutateAsync({
        expectedVersion: invoice.version,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "failed to post invoice");
    }
  };

  const handleCancel = async (): Promise<void> => {
    setCancelError(null);
    try {
      await cancelInvoice.mutateAsync({
        expectedVersion: invoice.version,
        reason: cancelReason.trim() || undefined,
      });
      setCancelDialogOpen(false);
      setCancelReason("");
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : "failed to cancel invoice",
      );
    }
  };

  const handleRecordPayment = async (): Promise<void> => {
    setPayError(null);
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setPayError("enter a positive amount");
      return;
    }
    if (!invoice.customerId) {
      setPayError("invoice has no linked customer — cannot record payment");
      return;
    }
    try {
      await createPayment.mutateAsync({
        paymentType: "CUSTOMER_RECEIPT",
        customerId: invoice.customerId,
        paymentDate: payDate,
        amount: payAmount,
        mode: payMode,
        referenceNo: payReference.trim() || undefined,
        appliedTo: [
          {
            invoiceType: "SALES_INVOICE",
            invoiceId: invoice.id,
            amountApplied: payAmount,
          },
        ],
      });
      setPaymentDialogOpen(false);
      setPayAmount("");
      setPayReference("");
    } catch (err) {
      setPayError(
        err instanceof Error ? err.message : "failed to record payment",
      );
    }
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Line-add dialog */}
      <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add Invoice Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Description *</Label>
              <Input
                value={lineDesc}
                onChange={(e) => setLineDesc(e.target.value)}
                placeholder="Product or service"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity *</Label>
                <Input
                  value={lineQty}
                  onChange={(e) => setLineQty(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit Price *</Label>
                <Input
                  value={linePrice}
                  onChange={(e) => setLinePrice(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tax Rate %</Label>
                <Input
                  value={lineTaxPct}
                  onChange={(e) => setLineTaxPct(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Discount %</Label>
                <Input
                  value={lineDiscPct}
                  onChange={(e) => setLineDiscPct(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">HSN / SAC Code</Label>
              <Input
                value={lineHsn}
                onChange={(e) => setLineHsn(e.target.value)}
                placeholder="8471"
              />
            </div>
            {lineError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {lineError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setLineDialogOpen(false);
                resetLineForm();
              }}
              disabled={addLine.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleAddLine} disabled={addLine.isPending}>
              {addLine.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Adding…
                </>
              ) : (
                <>Add Line</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Record Customer Payment</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Applies to this invoice. Outstanding:{" "}
            <strong>{formatMoney(String(outstanding), invoice.currency)}</strong>
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Amount *</Label>
                <Input
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date *</Label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mode</Label>
              <select
                value={payMode}
                onChange={(e) =>
                  setPayMode(
                    e.target.value as
                      | "CASH"
                      | "BANK_TRANSFER"
                      | "CHEQUE"
                      | "UPI"
                      | "CARD"
                      | "OTHER",
                  )
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="UPI">UPI</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reference No.</Label>
              <Input
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                placeholder="UTR / Cheque # / Txn ID"
              />
            </div>
            {payError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {payError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPaymentDialogOpen(false)}
              disabled={createPayment.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRecordPayment}
              disabled={createPayment.isPending}
            >
              {createPayment.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Recording…
                </>
              ) : (
                <>Record Payment</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Cancel Invoice</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Cancelling a POSTED invoice appends an ADJUSTMENT credit for the
            unpaid portion. This is not reversible.
          </p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Why is this being cancelled?"
              />
            </div>
            {cancelError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {cancelError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCancelDialogOpen(false)}
              disabled={cancelInvoice.isPending}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelInvoice.isPending}
            >
              {cancelInvoice.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Cancelling…
                </>
              ) : (
                <>Cancel Invoice</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/finance/sales-invoices")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Sales Invoices
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <Badge
              variant="outline"
              className={`text-xs ${STATUS_TONE[invoice.status]}`}
            >
              {invoice.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              v{invoice.version}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {invoice.customerName ?? "—"}
            {invoice.customerGstin && (
              <span className="ml-2 text-xs font-mono">
                GSTIN: {invoice.customerGstin}
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              Issued: {formatDate(invoice.invoiceDate)}
            </span>
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              Due: {formatDate(invoice.dueDate)}
            </span>
            {invoice.salesOrderId && (
              <span className="flex items-center gap-1 font-mono">
                <Hash className="h-3 w-3" />
                SO: {invoice.salesOrderId.slice(0, 8)}
              </span>
            )}
            {invoice.workOrderId && (
              <span className="flex items-center gap-1 font-mono">
                <Hash className="h-3 w-3" />
                WO: {invoice.workOrderId.slice(0, 8)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDraft && (
            <Button
              onClick={handlePost}
              disabled={postInvoice.isPending || lines.length === 0}
              size="sm"
            >
              {postInvoice.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Posting…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  Post Invoice
                </>
              )}
            </Button>
          )}
          {isPosted && invoice.customerId && outstanding > 0 && (
            <Button
              size="sm"
              onClick={() => {
                setPayAmount(String(outstanding.toFixed(2)));
                setPaymentDialogOpen(true);
              }}
            >
              <CreditCard className="h-4 w-4 mr-1" />
              Record Payment
            </Button>
          )}
          {!isCancelled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelDialogOpen(true)}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="ledger">Customer Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Customer Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium">
                    {invoice.customerName ?? "—"}
                  </p>
                  {invoice.customerGstin && (
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                      GSTIN: {invoice.customerGstin}
                    </p>
                  )}
                </div>
                {invoice.customerAddress && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm">{invoice.customerAddress}</p>
                      {invoice.placeOfSupply && (
                        <p className="text-xs text-muted-foreground">
                          Supply: {invoice.placeOfSupply}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {invoice.customerId && (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    ID: {invoice.customerId}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Invoice Summary Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Invoice Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Currency</span>
                  <Badge variant="outline" className="text-xs">
                    <ArrowRightLeft className="h-3 w-3 mr-1" />
                    {invoice.currency}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">
                    {formatMoney(invoice.subtotal, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="tabular-nums">
                    {formatMoney(invoice.discountTotal, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="tabular-nums">
                    {formatMoney(invoice.taxTotal, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2 font-bold text-base">
                  <span>Grand Total</span>
                  <span className="tabular-nums">
                    {formatMoney(invoice.grandTotal, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="font-medium text-green-700 tabular-nums">
                    {formatMoney(invoice.amountPaid, invoice.currency)}
                  </span>
                </div>
                {outstanding > 0 && (
                  <div className="flex justify-between text-sm border-t pt-2">
                    <span className="text-muted-foreground">Balance Due</span>
                    <span className="font-semibold text-red-600 tabular-nums">
                      {formatMoney(String(outstanding), invoice.currency)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Line Items */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Line Items</CardTitle>
              {isDraft && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLineDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Line
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>HSN</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      {isDraft && <TableHead className="w-10"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={isDraft ? 10 : 9}
                          className="text-center text-muted-foreground py-6"
                        >
                          No line items yet
                        </TableCell>
                      </TableRow>
                    )}
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {line.sequenceNumber}
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {line.description}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {line.hsnSac ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {line.quantity}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatMoney(line.unitPrice, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                          {line.discountPercent}%
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatMoney(line.lineSubtotal, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                          {formatMoney(line.lineTax, invoice.currency)}
                          <span className="ml-1 text-[10px]">
                            ({line.taxRatePercent}%)
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums">
                          {formatMoney(line.lineTotal, invoice.currency)}
                        </TableCell>
                        {isDraft && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleDeleteLine(line.id)}
                              disabled={deleteLine.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {isDraft && lines.length === 0 && (
                <div className="text-xs text-muted-foreground mt-3">
                  Add at least one line before posting.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Customer Ledger (most recent 20)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!invoice.customerId && (
                <p className="text-sm text-muted-foreground">
                  No linked customer — ledger unavailable.
                </p>
              )}
              {invoice.customerId && ledgerQuery.isLoading && (
                <Skeleton className="h-40 w-full" />
              )}
              {invoice.customerId && ledgerQuery.isError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  Failed to load ledger.
                </div>
              )}
              {invoice.customerId &&
                ledgerQuery.data &&
                ledgerQuery.data.data.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No ledger activity for this customer yet.
                  </p>
                )}
              {invoice.customerId &&
                ledgerQuery.data &&
                ledgerQuery.data.data.length > 0 && (
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ledgerQuery.data.data.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs">
                              {formatDate(e.entryDate)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {e.entryType.replace(/_/g, " ")}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono">
                              {e.referenceNumber ?? "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {Number(e.debit) > 0
                                ? formatMoney(e.debit, e.currency)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {Number(e.credit) > 0
                                ? formatMoney(e.credit, e.currency)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium tabular-nums">
                              {formatMoney(e.runningBalance, e.currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
