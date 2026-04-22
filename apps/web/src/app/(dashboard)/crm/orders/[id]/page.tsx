"use client";

import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/data/mock";
import {
  useApiFinanceApproveSalesOrder,
  useApiSalesOrder,
  useApiTransitionSalesOrderStatus,
} from "@/hooks/useCrmApi";
import type { SalesOrder, SalesOrderStatus } from "@instigenie/contracts";
import {
  ArrowLeft,
  Building2,
  User,
  Calendar,
  Hash,
  CheckCircle,
  Send,
  AlertCircle,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Sales order detail — /crm/orders/:id via useApiSalesOrder.
 *
 * Real-API backed. Actions wired:
 *   - Transition status (DRAFT → CONFIRMED → PROCESSING → DISPATCHED →
 *     IN_TRANSIT → DELIVERED, or → CANCELLED where allowed)
 *   - Finance approve (orthogonal to status; stamps finance_approved_by)
 *
 * Deferred: inline edits, delivery challan generation, work-order creation
 * from SO. WO conversion is a Phase 3 manufacturing feature, not sales.
 */

function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const NEXT_STATUSES: Partial<Record<SalesOrderStatus, SalesOrderStatus[]>> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["IN_TRANSIT"],
  IN_TRANSIT: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : null;

  const orderQuery = useApiSalesOrder(id ?? undefined);
  const transitionStatus = useApiTransitionSalesOrderStatus(id ?? "");
  const financeApprove = useApiFinanceApproveSalesOrder(id ?? "");

  if (orderQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Order not found</p>
            <p className="text-red-700 mt-1">
              {orderQuery.error instanceof Error
                ? orderQuery.error.message
                : "No sales order with this id"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push("/crm/orders")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to orders
        </Button>
      </div>
    );
  }

  const order: SalesOrder = orderQuery.data;
  const allowedTransitions = NEXT_STATUSES[order.status] ?? [];

  const handleTransition = (status: SalesOrderStatus): void => {
    transitionStatus.mutate(
      { status, expectedVersion: order.version },
      {
        onSuccess: () =>
          toast.success(`Order transitioned to ${status}`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to transition"
          ),
      }
    );
  };

  const handleFinanceApprove = (): void => {
    financeApprove.mutate(
      { expectedVersion: order.version },
      {
        onSuccess: () => toast.success("Order finance-approved"),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to approve"
          ),
      }
    );
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/crm/orders")}
        className="-ml-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to orders
      </Button>

      <PageHeader
        title={order.orderNumber}
        description={`${order.company} — ${order.contactName}`}
        actions={
          <>
            <StatusBadge status={order.status} />
            {order.financeApprovedAt && (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-200"
              >
                Finance Approved
              </Badge>
            )}
          </>
        }
      />

      {/* Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Company</p>
              <p className="text-sm font-medium">{order.company}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <User className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Contact</p>
              <p className="text-sm font-medium">{order.contactName}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">
                Expected Delivery
              </p>
              <p className="text-sm font-medium">
                {order.expectedDelivery
                  ? formatDate(order.expectedDelivery)
                  : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Version</p>
              <p className="text-sm font-medium">v{order.version}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {allowedTransitions.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === "CANCELLED" ? "destructive" : "outline"}
              onClick={() => handleTransition(s)}
              disabled={transitionStatus.isPending}
            >
              <Send className="h-4 w-4 mr-2" />
              Move to {s}
            </Button>
          ))}
          {!order.financeApprovedAt && (
            <Button
              size="sm"
              onClick={handleFinanceApprove}
              disabled={financeApprove.isPending}
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Finance Approve
            </Button>
          )}
          {allowedTransitions.length === 0 && order.financeApprovedAt && (
            <p className="text-sm text-muted-foreground">
              No available actions for status {order.status}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Discount %</TableHead>
                <TableHead className="text-right">Tax %</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{li.productName}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {li.productCode}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {li.quantity}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {formatCurrency(toNumber(li.unitPrice))}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {li.discountPct}%
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {li.taxPct}%
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {formatCurrency(toNumber(li.lineTotal))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 ml-auto w-full max-w-sm space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(toNumber(order.subtotal))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(toNumber(order.taxAmount))}</span>
            </div>
            <div className="flex justify-between text-base font-semibold border-t pt-2">
              <span>Grand Total</span>
              <span>{formatCurrency(toNumber(order.grandTotal))}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {order.quotationId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source Quotation</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="link"
              className="p-0 h-auto"
              onClick={() =>
                router.push(`/crm/quotations/${order.quotationId}`)
              }
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              View source quotation
            </Button>
          </CardContent>
        </Card>
      )}

      {order.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
