"use client";

/**
 * Customer portal — invoice detail. Reads the curated
 * PortalInvoiceSummary projection only (no internal lines / notes /
 * cancelledBy). The detail surface is intentionally minimal: header
 * card + amounts breakdown. Lines aren't exposed because the portal
 * contract doesn't include them; that's a deliberate scoping choice.
 */

import Link from "next/link";
import { useParams } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiPortalInvoice } from "@/hooks/usePortalApi";
import type { InvoiceStatus, PortalInvoiceSummary } from "@instigenie/contracts";
import { AlertCircle, ArrowLeft, CalendarDays, FileText, Hash } from "lucide-react";

function formatINR(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TONE: Record<InvoiceStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  POSTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

function balance(inv: PortalInvoiceSummary): string {
  const total = Number(inv.grandTotal);
  const paid = Number(inv.amountPaid);
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return inv.grandTotal;
  return (total - paid).toFixed(2);
}

export default function PortalInvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const invoiceQuery = useApiPortalInvoice(invoiceId);

  if (invoiceQuery.isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (invoiceQuery.isError || !invoiceQuery.data) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Link
          href="/portal/invoices"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Invoices
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Invoice not found</p>
            <p className="text-red-700 mt-1">
              {invoiceQuery.error instanceof Error
                ? invoiceQuery.error.message
                : "The invoice you're looking for doesn't exist or you don't have access to it."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const invoice = invoiceQuery.data;
  const balanceDue = balance(invoice);
  const isFullyPaid = Number(balanceDue) <= 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Link
        href="/portal/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Invoices
      </Link>

      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title={`Invoice ${invoice.invoiceNumber}`}
          description={`Issued ${formatDate(invoice.invoiceDate)}`}
        />
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[invoice.status]}`}
        >
          {invoice.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Hash className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Invoice number</p>
                <p className="font-mono">{invoice.invoiceNumber}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Currency</p>
                <p>{invoice.currency}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Invoice date</p>
                <p>{formatDate(invoice.invoiceDate)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Due date</p>
                <p>{formatDate(invoice.dueDate)}</p>
              </div>
            </div>
            {invoice.postedAt ? (
              <div className="flex items-start gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Posted</p>
                  <p>{formatDate(invoice.postedAt)}</p>
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Amounts</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-mono">{formatINR(invoice.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="font-mono">{formatINR(invoice.taxTotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="font-mono">
                {Number(invoice.discountTotal) > 0
                  ? `−${formatINR(invoice.discountTotal)}`
                  : formatINR(invoice.discountTotal)}
              </dd>
            </div>
            <div className="border-t pt-2 flex items-center justify-between">
              <dt className="font-medium">Grand total</dt>
              <dd className="font-mono font-semibold">
                {formatINR(invoice.grandTotal)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Amount paid</dt>
              <dd className="font-mono text-emerald-700">
                {formatINR(invoice.amountPaid)}
              </dd>
            </div>
            <div className="border-t pt-2 flex items-center justify-between">
              <dt className="font-medium">Balance due</dt>
              <dd
                className={`font-mono font-semibold ${
                  isFullyPaid ? "text-emerald-700" : ""
                }`}
              >
                {formatINR(balanceDue)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {!isFullyPaid && invoice.status === "POSTED" ? (
        <p className="text-xs text-muted-foreground">
          Outstanding balance? Contact your account manager for payment options.
        </p>
      ) : null}
    </div>
  );
}
