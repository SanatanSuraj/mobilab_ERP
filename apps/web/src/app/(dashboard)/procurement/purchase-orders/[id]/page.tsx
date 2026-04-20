"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  purchaseOrders,
  PurchaseOrder,
  POStatus,
  formatCurrency,
  formatDate,
} from "@/data/procurement-mock";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Upload,
  Download,
  FileText,
  Send,
} from "lucide-react";

export default function PODetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const found = purchaseOrders.find((p) => p.id === params.id);
  const [po, setPO] = useState<PurchaseOrder | null>(found ?? null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [uploadPIOpen, setUploadPIOpen] = useState(false);
  const [piRef, setPIRef] = useState("");

  if (!po) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <p className="text-muted-foreground">Purchase Order not found.</p>
        <Button variant="outline" onClick={() => router.push("/procurement/purchase-orders")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Purchase Orders
        </Button>
      </div>
    );
  }

  function approveFinance() {
    if (!po) return;
    setPO({
      ...po,
      status: "APPROVED" as POStatus,
      approvedAt: new Date().toISOString(),
      approvalLogs: po.approvalLogs.map((log) =>
        log.action === "PENDING"
          ? {
              ...log,
              action: "APPROVED" as const,
              note: "Finance approved",
              actionedAt: new Date().toISOString(),
            }
          : log
      ),
    });
  }

  function approveMgmt() {
    if (!po) return;
    setPO({
      ...po,
      status: "APPROVED" as POStatus,
      approvedAt: new Date().toISOString(),
      approvalLogs: po.approvalLogs.map((log) =>
        log.action === "PENDING"
          ? {
              ...log,
              action: "APPROVED" as const,
              note: "Management approved",
              actionedAt: new Date().toISOString(),
            }
          : log
      ),
    });
  }

  function handleReject() {
    if (!po) return;
    setPO({
      ...po,
      status: "CANCELLED" as POStatus,
      approvalLogs: po.approvalLogs.map((log) =>
        log.action === "PENDING"
          ? {
              ...log,
              action: "REJECTED" as const,
              note: rejectReason,
              actionedAt: new Date().toISOString(),
            }
          : log
      ),
    });
    setRejectOpen(false);
    setRejectReason("");
  }

  function markSentToVendor() {
    if (!po) return;
    setPO({
      ...po,
      status: "PO_SENT" as POStatus,
      sentAt: new Date().toISOString(),
    });
  }

  function handleUploadPI() {
    if (!po || !piRef) return;
    setPO({
      ...po,
      proformaUploaded: true,
      proformaInvoiceRef: piRef,
    });
    setUploadPIOpen(false);
    setPIRef("");
  }

  const linkedIndentIds = po.lines
    .filter((l) => l.indentId)
    .map((l) => l.indentId as string);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2"
          onClick={() => router.push("/procurement/purchase-orders")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Purchase Orders
        </Button>
        <PageHeader
          title={po.poNumber}
          description={`Created by ${po.createdBy} on ${formatDate(po.createdAt)}`}
          actions={<StatusBadge status={po.status} className="text-sm px-3 py-1" />}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: 2/3 */}
        <div className="col-span-2 space-y-6">
          {/* PO Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PO Information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Vendor</dt>
                  <dd className="font-semibold">{po.vendorName}</dd>
                  <dd className="font-mono text-xs text-muted-foreground">
                    GSTIN: {po.vendorGstin}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Warehouse</dt>
                  <dd className="font-semibold">{po.warehouseName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Required Delivery</dt>
                  <dd className="font-semibold">
                    {formatDate(po.requiredDeliveryDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Cost Centre</dt>
                  <dd className="font-mono font-semibold">{po.costCentre}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created By</dt>
                  <dd>{po.createdBy}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created At</dt>
                  <dd>{formatDate(po.createdAt)}</dd>
                </div>
                {po.approvedAt && (
                  <div>
                    <dt className="text-muted-foreground">Approved At</dt>
                    <dd>{formatDate(po.approvedAt)}</dd>
                  </div>
                )}
                {po.sentAt && (
                  <div>
                    <dt className="text-muted-foreground">Sent At</dt>
                    <dd>{formatDate(po.sentAt)}</dd>
                  </div>
                )}
                {po.notes && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd className="text-foreground">{po.notes}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Item Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Qty Ordered</TableHead>
                    <TableHead className="text-right">Qty Received</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead className="text-right">GST %</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                    <TableHead>Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.lines.map((line) => {
                    const progress =
                      line.qty > 0
                        ? Math.round((line.qtyReceived / line.qty) * 100)
                        : 0;
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs">
                          {line.itemCode}
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {line.itemName}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {line.qty}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {line.qtyReceived}
                        </TableCell>
                        <TableCell className="text-sm">{line.unit}</TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(line.unitPrice)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {line.hsnCode}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {line.gstRate}%
                        </TableCell>
                        <TableCell className="text-right font-semibold text-sm">
                          {formatCurrency(line.lineTotal)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-[80px]">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8">
                              {progress}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {po.lines.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center py-6 text-muted-foreground"
                      >
                        No line items
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {/* Footer totals */}
              <div className="border-t p-4">
                <div className="flex justify-end">
                  <dl className="space-y-1 text-sm min-w-[240px]">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Subtotal</dt>
                      <dd>{formatCurrency(po.subtotal)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">GST</dt>
                      <dd>{formatCurrency(po.gstAmount)}</dd>
                    </div>
                    <div className="flex justify-between font-bold text-base border-t pt-1 mt-1">
                      <dt>Total</dt>
                      <dd>{formatCurrency(po.totalValue)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Approval Trail */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Approval Trail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {po.approvalLogs.map((log, idx) => (
                  <div key={log.id} className="flex gap-4">
                    {/* Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {log.action === "APPROVED" && (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      )}
                      {log.action === "REJECTED" && (
                        <XCircle className="h-5 w-5 text-red-600" />
                      )}
                      {log.action === "PENDING" && (
                        <Clock className="h-5 w-5 text-amber-500" />
                      )}
                      {log.action === "ESCALATED" && (
                        <CheckCircle2 className="h-5 w-5 text-blue-600" />
                      )}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">
                          {log.approver}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {log.role}
                        </Badge>
                        <Badge
                          className={
                            log.action === "APPROVED"
                              ? "bg-green-100 text-green-700 border-green-200 text-xs"
                              : log.action === "REJECTED"
                              ? "bg-red-100 text-red-700 border-red-200 text-xs"
                              : log.action === "PENDING"
                              ? "bg-amber-100 text-amber-700 border-amber-200 text-xs"
                              : "bg-blue-100 text-blue-700 border-blue-200 text-xs"
                          }
                        >
                          {log.action}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Threshold: {log.threshold}
                      </p>
                      {log.note && (
                        <p className="text-sm mt-1 text-foreground">
                          {log.note}
                        </p>
                      )}
                      {log.actionedAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(log.actionedAt)}
                        </p>
                      )}
                    </div>
                    {/* Connector line */}
                    {idx < po.approvalLogs.length - 1 && (
                      <div className="absolute left-[1.125rem] top-5 bottom-0 w-px bg-border" />
                    )}
                  </div>
                ))}
                {po.approvalLogs.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    No approval activity yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: 1/3 */}
        <div className="space-y-6">
          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {po.status === "PENDING_FINANCE" && (
                <>
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    onClick={approveFinance}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve (Finance)
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => setRejectOpen(true)}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </>
              )}
              {po.status === "PENDING_MGMT" && (
                <>
                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    onClick={approveMgmt}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve (Management)
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => setRejectOpen(true)}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </>
              )}
              {po.status === "APPROVED" && (
                <Button
                  className="w-full"
                  onClick={markSentToVendor}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Mark as Sent to Vendor
                </Button>
              )}
              {po.status !== "PENDING_FINANCE" &&
                po.status !== "PENDING_MGMT" &&
                po.status !== "APPROVED" && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No actions available for current status.
                  </p>
                )}
            </CardContent>
          </Card>

          {/* Proforma Invoice */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Proforma Invoice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {po.proformaUploaded ? (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-green-600" />
                    <span className="font-mono font-medium">
                      {po.proformaInvoiceRef}
                    </span>
                  </div>
                  <Badge className="bg-green-100 text-green-700 border-green-200">
                    PI Received
                  </Badge>
                  <Button variant="outline" size="sm" className="w-full">
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    No proforma invoice uploaded yet.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setUploadPIOpen(true)}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload PI
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Linked Indents */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Linked Indents</CardTitle>
            </CardHeader>
            <CardContent>
              {linkedIndentIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No linked indents.
                </p>
              ) : (
                <div className="space-y-2">
                  {linkedIndentIds.map((indentId) => (
                    <div
                      key={indentId}
                      className="flex items-center gap-2 text-sm"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                      <span className="font-mono text-indigo-600 font-medium text-xs">
                        {indentId}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Please provide a reason for rejecting{" "}
              <span className="font-mono font-medium">{po.poNumber}</span>.
            </p>
            <div className="space-y-1.5">
              <Label>Rejection Reason</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="State the reason for rejection..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleReject}
              disabled={!rejectReason.trim()}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload PI Dialog */}
      <Dialog open={uploadPIOpen} onOpenChange={setUploadPIOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Upload Proforma Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>PI Reference Number</Label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={piRef}
                onChange={(e) => setPIRef(e.target.value)}
                placeholder="e.g. PI-VND-2026-001"
              />
            </div>
            <div className="space-y-1.5">
              <Label>File (mock)</Label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                <Upload className="h-6 w-6 mx-auto mb-2 opacity-40" />
                Click to select file (demo only)
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadPIOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUploadPI} disabled={!piRef.trim()}>
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
