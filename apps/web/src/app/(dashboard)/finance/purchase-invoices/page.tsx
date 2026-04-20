"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import {
  purchaseInvoices,
  PurchaseInvoice,
  getVendorById,
} from "@/data/finance-mock";
import { formatCurrency, formatDate } from "@/data/mock";
import {
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";

export default function PurchaseInvoicesPage() {
  const totalPIs = purchaseInvoices.length;
  const matchedCount = purchaseInvoices.filter(
    (pi) => pi.status === "matched" || pi.status === "approved" || pi.status === "paid"
  ).length;
  const pendingMatchCount = purchaseInvoices.filter(
    (pi) => pi.status === "pending_match"
  ).length;
  const disputedCount = purchaseInvoices.filter(
    (pi) => pi.status === "disputed"
  ).length;

  const columns: Column<PurchaseInvoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      sortable: true,
      render: (inv) => (
        <span className="font-medium text-foreground">{inv.invoiceNumber}</span>
      ),
    },
    {
      key: "vendorId",
      header: "Vendor",
      render: (inv) => {
        const vendor = getVendorById(inv.vendorId);
        return <span className="text-sm">{vendor?.name ?? "Unknown"}</span>;
      },
    },
    {
      key: "poRef",
      header: "PO Ref",
      render: (inv) => (
        <span className="text-sm text-muted-foreground">{inv.poRef}</span>
      ),
    },
    {
      key: "grnRef",
      header: "GRN Ref",
      render: (inv) => (
        <span className="text-sm text-muted-foreground">
          {inv.grnRef || "-"}
        </span>
      ),
    },
    {
      key: "invoiceDate",
      header: "Date",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(inv.invoiceDate)}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      className: "text-right",
      sortable: true,
      render: (inv) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(inv.grandTotal)}
        </span>
      ),
    },
    {
      key: "matchStatus",
      header: "3-Way Match",
      render: (inv) => (
        <div className="flex items-center gap-2">
          <MatchIndicator label="PO" matched={inv.matchStatus.po} />
          <MatchIndicator label="GRN" matched={inv.matchStatus.grn} />
          <MatchIndicator label="INV" matched={inv.matchStatus.invoice} />
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (inv) => <StatusBadge status={inv.status} />,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Purchase Invoices"
        description="Vendor invoices with 3-way match verification"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total PIs"
          value={String(totalPIs)}
          icon={FileText}
          iconColor="text-blue-600"
          change={`${formatCurrency(purchaseInvoices.reduce((s, p) => s + p.grandTotal, 0))} value`}
          trend="neutral"
        />
        <KPICard
          title="Matched"
          value={String(matchedCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change="PO + GRN + Invoice verified"
          trend="up"
        />
        <KPICard
          title="Pending Match"
          value={String(pendingMatchCount)}
          icon={Clock}
          iconColor="text-amber-600"
          change="Awaiting verification"
          trend="neutral"
        />
        <KPICard
          title="Disputed"
          value={String(disputedCount)}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={disputedCount > 0 ? "Needs resolution" : "All clear"}
          trend={disputedCount > 0 ? "down" : "up"}
        />
      </div>

      <DataTable<PurchaseInvoice>
        data={purchaseInvoices}
        columns={columns}
        searchKey="invoiceNumber"
        searchPlaceholder="Search by invoice number..."
      />
    </div>
  );
}

function MatchIndicator({ label, matched }: { label: string; matched: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {matched ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <X className="h-3.5 w-3.5 text-red-500" />
      )}
      <span className={`text-xs ${matched ? "text-green-700" : "text-red-600"}`}>
        {label}
      </span>
    </div>
  );
}
