"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import {
  enhancedQuotations,
  getAccountById,
  type EnhancedQuotation,
} from "@/data/crm-mock";
import { formatCurrency, formatDate } from "@/data/mock";
import { FileText, Clock, Send, CheckCircle } from "lucide-react";

export default function QuotationsPage() {
  const router = useRouter();

  const totalQuotations = enhancedQuotations.length;
  const pendingApproval = enhancedQuotations.filter(
    (q) => q.approvalStatus === "pending"
  ).length;
  const sentCount = enhancedQuotations.filter((q) => q.status === "sent").length;
  const acceptedCount = enhancedQuotations.filter(
    (q) => q.status === "accepted"
  ).length;

  const columns: Column<EnhancedQuotation>[] = [
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
      key: "accountId",
      header: "Account",
      render: (q) => {
        const account = getAccountById(q.accountId);
        return (
          <span className="text-sm">{account?.name ?? "Unknown"}</span>
        );
      },
    },
    {
      key: "dealId",
      header: "Deal",
      render: (q) => (
        <Link
          href={`/crm/deals/${q.dealId}`}
          className="text-sm text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {q.dealId}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (q) => <StatusBadge status={q.status} />,
    },
    {
      key: "currentVersion",
      header: "Version",
      render: (q) => (
        <span className="text-sm text-muted-foreground">
          v{q.currentVersion}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      sortable: true,
      className: "text-right",
      render: (q) => {
        const currentVer = q.versions.find(
          (v) => v.version === q.currentVersion
        );
        return (
          <span className="text-sm font-medium">
            {currentVer ? formatCurrency(currentVer.grandTotal) : "--"}
          </span>
        );
      },
    },
    {
      key: "validUntil",
      header: "Valid Until",
      sortable: true,
      render: (q) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(q.validUntil)}
        </span>
      ),
    },
    {
      key: "requiresApproval",
      header: "Approval",
      render: (q) =>
        q.requiresApproval && q.approvalStatus === "pending" ? (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
          >
            Pending Manager Approval
          </Badge>
        ) : q.requiresApproval && q.approvalStatus === "approved" ? (
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
        description="Manage customer quotations with versioning and approvals"
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

      <DataTable<EnhancedQuotation>
        data={enhancedQuotations}
        columns={columns}
        searchKey="quotationNumber"
        searchPlaceholder="Search by quotation number..."
        onRowClick={(q) => router.push(`/crm/quotations/${q.id}`)}
      />
    </div>
  );
}
