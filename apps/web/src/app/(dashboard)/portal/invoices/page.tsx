"use client";

/**
 * Customer portal — invoice history. Uses the curated
 * PortalInvoiceSummary projection (no internal notes / signatureHash /
 * cancelledBy fields). Server-enforced scoping via account_id; only
 * the status filter is exposed on the client.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiPortalInvoices } from "@/hooks/usePortalApi";
import {
  INVOICE_STATUSES,
  type InvoiceStatus,
  type PortalInvoiceSummary,
} from "@instigenie/contracts";
import { AlertCircle, ArrowLeft } from "lucide-react";

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
  AWAITING_APPROVAL: "bg-purple-50 text-purple-700 border-purple-200",
  POSTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

function balanceDue(inv: PortalInvoiceSummary): string {
  const total = Number(inv.grandTotal);
  const paid = Number(inv.amountPaid);
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return inv.grandTotal;
  return (total - paid).toFixed(2);
}

export default function PortalInvoicesPage() {
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");

  const query = useMemo(
    () => ({
      limit: 100,
      sortBy: "createdAt",
      sortDir: "desc" as const,
      status: status === "all" ? undefined : status,
    }),
    [status],
  );

  const invoicesQuery = useApiPortalInvoices(query);

  const columns: Column<PortalInvoiceSummary>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      render: (i) => (
        <Link
          href={`/portal/invoices/${i.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {i.invoiceNumber}
        </Link>
      ),
    },
    {
      key: "invoiceDate",
      header: "Date",
      render: (i) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(i.invoiceDate)}
        </span>
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (i) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(i.dueDate)}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      render: (i) => (
        <span className="font-mono text-sm">{formatINR(i.grandTotal)}</span>
      ),
    },
    {
      key: "amountPaid",
      header: "Paid",
      render: (i) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatINR(i.amountPaid)}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      render: (i) => {
        const due = balanceDue(i);
        const isPaid = Number(due) <= 0;
        return (
          <span
            className={`font-mono text-sm ${
              isPaid ? "text-emerald-700" : "text-foreground"
            }`}
          >
            {formatINR(due)}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (i) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[i.status]}`}
        >
          {i.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Portal
      </Link>

      <PageHeader
        title="Invoices"
        description="Posted invoices and payment status"
      />

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={status}
            onValueChange={(v) =>
              setStatus(!v ? "all" : (v as InvoiceStatus | "all"))
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {invoicesQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : invoicesQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load invoices</p>
            <p className="text-red-700 mt-1">
              {invoicesQuery.error instanceof Error
                ? invoicesQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      ) : (
        <>
          <DataTable<PortalInvoiceSummary>
            data={invoicesQuery.data?.data ?? []}
            columns={columns}
            pageSize={25}
          />
          <p className="text-xs text-muted-foreground">
            Showing {(invoicesQuery.data?.data.length ?? 0).toLocaleString()} of{" "}
            {(invoicesQuery.data?.total ?? 0).toLocaleString()} invoice
            {invoicesQuery.data?.total === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </div>
  );
}
