"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/data/mock";
import { useApiQuotations } from "@/hooks/useCrmApi";
import type { Quotation } from "@mobilab/contracts";
import { FileText, Clock, Send, CheckCircle, AlertCircle } from "lucide-react";

/**
 * Quotations list — /crm/quotations via useApiQuotations.
 *
 * Contract deltas from the mock shape (src/data/crm-mock.ts):
 *   - Totals are decimal *strings* (NUMERIC(18,2)). toNumber() used only
 *     for display aggregates — all writes go through the contracts layer.
 *   - Status is UPPER_CASE (DRAFT, AWAITING_APPROVAL, APPROVED, SENT,
 *     ACCEPTED, REJECTED, EXPIRED, CONVERTED). StatusBadge handles it.
 *   - `requiresApproval` is a boolean; we surface "Awaiting" when status
 *     is AWAITING_APPROVAL, "Approved" once approvedAt is set.
 *   - No more `versions[]` array — quotations carry a single `version`
 *     column (optimistic concurrency counter), not a full revision log.
 */

function toNumber(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function QuotationsPage() {
  const router = useRouter();
  const quotationsQuery = useApiQuotations({ limit: 50 });

  if (quotationsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (quotationsQuery.isError) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load quotations
            </p>
            <p className="text-red-700 mt-1">
              {quotationsQuery.error instanceof Error
                ? quotationsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const quotations = quotationsQuery.data?.data ?? [];

  const totalQuotations = quotations.length;
  const pendingApproval = quotations.filter(
    (q) => q.status === "AWAITING_APPROVAL"
  ).length;
  const sentCount = quotations.filter((q) => q.status === "SENT").length;
  const acceptedCount = quotations.filter(
    (q) => q.status === "ACCEPTED" || q.status === "CONVERTED"
  ).length;

  const columns: Column<Quotation>[] = [
    {
      key: "quotationNumber",
      header: "Quotation #",
      sortable: true,
      render: (q) => (
        <span className="text-sm font-medium font-mono">
          {q.quotationNumber}
        </span>
      ),
    },
    {
      key: "company",
      header: "Company",
      render: (q) => <span className="text-sm">{q.company}</span>,
    },
    {
      key: "contactName",
      header: "Contact",
      render: (q) => (
        <span className="text-sm text-muted-foreground">{q.contactName}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (q) => <StatusBadge status={q.status} />,
    },
    {
      key: "version",
      header: "Version",
      render: (q) => (
        <span className="text-sm text-muted-foreground">v{q.version}</span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      sortable: true,
      className: "text-right",
      render: (q) => (
        <span className="text-sm font-medium">
          {formatCurrency(toNumber(q.grandTotal))}
        </span>
      ),
    },
    {
      key: "validUntil",
      header: "Valid Until",
      sortable: true,
      render: (q) => (
        <span className="text-sm text-muted-foreground">
          {q.validUntil ? formatDate(q.validUntil) : "—"}
        </span>
      ),
    },
    {
      key: "requiresApproval",
      header: "Approval",
      render: (q) =>
        q.requiresApproval && q.status === "AWAITING_APPROVAL" ? (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
          >
            Pending Manager Approval
          </Badge>
        ) : q.requiresApproval && q.approvedAt ? (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 text-xs"
          >
            Approved
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">&mdash;</span>
        ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Quotations"
        description="Manage customer quotations with approvals and conversion"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="Total Quotations"
          value={String(totalQuotations)}
          icon={FileText}
        />
        <KPICard
          title="Pending Approval"
          value={String(pendingApproval)}
          icon={Clock}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Sent"
          value={String(sentCount)}
          icon={Send}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Accepted"
          value={String(acceptedCount)}
          icon={CheckCircle}
          iconColor="text-green-600"
        />
      </div>

      <DataTable<Quotation>
        data={quotations}
        columns={columns}
        searchKey="quotationNumber"
        searchPlaceholder="Search by quotation number..."
        onRowClick={(q) => router.push(`/crm/quotations/${q.id}`)}
      />
    </div>
  );
}
