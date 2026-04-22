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
  useApiApproveQuotation,
  useApiConvertQuotation,
  useApiQuotation,
  useApiTransitionQuotationStatus,
} from "@/hooks/useCrmApi";
import type { Quotation, QuotationStatus } from "@instigenie/contracts";
import {
  ArrowLeft,
  Building2,
  User,
  Calendar,
  Hash,
  CheckCircle,
  Send,
  AlertCircle,
  ArrowRightCircle,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Quotation detail — /crm/quotations/:id via useApiQuotation.
 *
 * Real-API backed. Actions wired:
 *   - Transition status (DRAFT → SENT, SENT → ACCEPTED, etc.)
 *   - Approve (from AWAITING_APPROVAL, with quotations:approve perm)
 *   - Convert to Sales Order (from ACCEPTED, with quotations:convert_to_so
 *     perm). On success, navigates to the new SO.
 *
 * Deferred (Phase 3): inline header edits, PDF preview, email/whatsapp
 * dispatch, revision history. The version counter is the optimistic-lock
 * version (monotonic), not a historical revision — the old prototype
 * confused these.
 */

function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const NEXT_STATUSES: Partial<Record<QuotationStatus, QuotationStatus[]>> = {
  DRAFT: ["SENT"],
  AWAITING_APPROVAL: [],
  APPROVED: ["SENT", "EXPIRED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CONVERTED: [],
};

export default function QuotationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : null;

  const quotationQuery = useApiQuotation(id ?? undefined);
  const transitionStatus = useApiTransitionQuotationStatus(id ?? "");
  const approve = useApiApproveQuotation(id ?? "");
  const convert = useApiConvertQuotation(id ?? "");

  if (quotationQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (quotationQuery.isError || !quotationQuery.data) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Quotation not found</p>
            <p className="text-red-700 mt-1">
              {quotationQuery.error instanceof Error
                ? quotationQuery.error.message
                : "No quotation with this id"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push("/crm/quotations")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to quotations
        </Button>
      </div>
    );
  }

  const quotation: Quotation = quotationQuery.data;
  const allowedTransitions = NEXT_STATUSES[quotation.status] ?? [];

  const handleTransition = (status: QuotationStatus): void => {
    const reason =
      status === "REJECTED"
        ? window.prompt("Rejection reason?") ?? ""
        : undefined;
    if (status === "REJECTED" && !reason) {
      toast.error("Reason is required for REJECTED");
      return;
    }
    transitionStatus.mutate(
      {
        status,
        expectedVersion: quotation.version,
        ...(reason ? { reason } : {}),
      },
      {
        onSuccess: () =>
          toast.success(`Quotation transitioned to ${status}`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to transition"
          ),
      }
    );
  };

  const handleApprove = (): void => {
    approve.mutate(
      { expectedVersion: quotation.version },
      {
        onSuccess: () => toast.success("Quotation approved"),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to approve"
          ),
      }
    );
  };

  const handleConvert = (): void => {
    convert.mutate(
      { expectedVersion: quotation.version },
      {
        onSuccess: (res) => {
          toast.success(
            `Converted to sales order ${res.salesOrder.orderNumber}`
          );
          router.push(`/crm/orders/${res.salesOrder.id}`);
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to convert"
          ),
      }
    );
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/crm/quotations")}
        className="-ml-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to quotations
      </Button>

      <PageHeader
        title={quotation.quotationNumber}
        description={`${quotation.company} — ${quotation.contactName}`}
        actions={
          <>
            <StatusBadge status={quotation.status} />
            {quotation.requiresApproval && (
              <Badge
                variant="outline"
                className={
                  quotation.approvedAt
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }
              >
                {quotation.approvedAt
                  ? "Manager Approved"
                  : "Requires Approval"}
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
              <p className="text-sm font-medium">{quotation.company}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <User className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Contact</p>
              <p className="text-sm font-medium">{quotation.contactName}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Valid Until</p>
              <p className="text-sm font-medium">
                {quotation.validUntil ? formatDate(quotation.validUntil) : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Version</p>
              <p className="text-sm font-medium">v{quotation.version}</p>
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
          {quotation.status === "AWAITING_APPROVAL" && (
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={approve.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve
            </Button>
          )}
          {allowedTransitions.map((s) => (
            <Button
              key={s}
              size="sm"
              variant="outline"
              onClick={() => handleTransition(s)}
              disabled={transitionStatus.isPending}
            >
              <Send className="h-4 w-4 mr-2" />
              Move to {s}
            </Button>
          ))}
          {quotation.status === "ACCEPTED" && (
            <Button
              size="sm"
              onClick={handleConvert}
              disabled={convert.isPending}
            >
              <ArrowRightCircle className="h-4 w-4 mr-2" />
              Convert to Sales Order
            </Button>
          )}
          {allowedTransitions.length === 0 &&
            quotation.status !== "AWAITING_APPROVAL" &&
            quotation.status !== "ACCEPTED" && (
              <p className="text-sm text-muted-foreground">
                No available actions for status {quotation.status}.
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
              {quotation.lineItems.map((li) => (
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
              <span>{formatCurrency(toNumber(quotation.subtotal))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(toNumber(quotation.taxAmount))}</span>
            </div>
            <div className="flex justify-between text-base font-semibold border-t pt-2">
              <span>Grand Total</span>
              <span>{formatCurrency(toNumber(quotation.grandTotal))}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {quotation.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{quotation.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
