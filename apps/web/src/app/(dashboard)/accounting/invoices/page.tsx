"use client";

// TODO(phase-5): /accounting/* uses the legacy prototype invoice/ledger model.
// The real data lives in the Finance backend (see /finance/sales-invoices and
// /finance/vendor-ledger pages, which already consume useApiSalesInvoices /
// useApiCustomerLedger / useApiVendorLedger). This page should either:
//   (a) redirect to /finance/sales-invoices, or
//   (b) be rewritten against the finance-api hooks with the legacy
//       `Invoice` shape mapped from SalesInvoice.
// Mock import left in place until the routing/IA decision is made.

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { invoices, Invoice, formatCurrency, formatDate } from "@/data/mock";
import { FileText, CheckCircle2, AlertTriangle, DollarSign } from "lucide-react";

export default function InvoicesPage() {
  const router = useRouter();

  const totalOutstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "draft")
    .reduce((sum, i) => sum + (i.total - i.paidAmount), 0);

  const totalPaid = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.paidAmount, 0);

  const overdueCount = invoices.filter((i) => i.status === "overdue").length;

  const columns: Column<Invoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      sortable: true,
      render: (inv) => (
        <span className="font-medium text-foreground">{inv.invoiceNumber}</span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortable: true,
    },
    {
      key: "status",
      header: "Status",
      render: (inv) => <StatusBadge status={inv.status} />,
    },
    {
      key: "subtotal",
      header: "Subtotal",
      className: "text-right",
      render: (inv) => (
        <span className="tabular-nums">{formatCurrency(inv.subtotal)}</span>
      ),
    },
    {
      key: "tax",
      header: "Tax",
      className: "text-right",
      render: (inv) => (
        <span className="tabular-nums text-muted-foreground">
          {formatCurrency(inv.tax)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      sortable: true,
      render: (inv) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(inv.total)}
        </span>
      ),
    },
    {
      key: "issuedDate",
      header: "Issued",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground">{formatDate(inv.issuedDate)}</span>
      ),
    },
    {
      key: "dueDate",
      header: "Due Date",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground">{formatDate(inv.dueDate)}</span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Invoices"
        description="Manage and track all customer invoices"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          title="Total Outstanding"
          value={formatCurrency(totalOutstanding)}
          icon={FileText}
          iconColor="text-amber-600"
          change={`${invoices.filter((i) => i.status === "sent" || i.status === "draft").length} invoices`}
          trend="neutral"
        />
        <KPICard
          title="Total Paid"
          value={formatCurrency(totalPaid)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change={`${invoices.filter((i) => i.status === "paid").length} invoices`}
          trend="up"
        />
        <KPICard
          title="Overdue"
          value={String(overdueCount)}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={overdueCount > 0 ? "Requires attention" : "All clear"}
          trend={overdueCount > 0 ? "down" : "up"}
        />
      </div>

      <DataTable<Invoice>
        data={invoices}
        columns={columns}
        searchKey="customer"
        searchPlaceholder="Search by customer..."
        onRowClick={(item) =>
          router.push(`/accounting/invoices/${item.id}`)
        }
      />
    </div>
  );
}
