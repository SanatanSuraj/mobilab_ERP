"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  salesInvoices,
  SalesInvoice,
  getFinCustomerById,
} from "@/data/finance-mock";
import { formatCurrency, formatDate } from "@/data/mock";
import { toast } from "sonner";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  IndianRupee,
  Plus,
  Info,
} from "lucide-react";

// Mock "DISPATCHED" challans for the challan selector
interface MockChallan {
  id: string;
  dcNumber: string;
  customer: string;
  amount: number;
  dispatchedDate: string;
  invoiceNumber: string;
}

const mockChallans: MockChallan[] = [
  {
    id: "dc1",
    dcNumber: "DC-2026-001",
    customer: "LifeCare Hospitals",
    amount: 284000,
    dispatchedDate: "2026-04-12",
    invoiceNumber: "INV-2026-041",
  },
  {
    id: "dc2",
    dcNumber: "DC-2026-002",
    customer: "Apollo Diagnostics",
    amount: 95000,
    dispatchedDate: "2026-04-15",
    invoiceNumber: "INV-2026-042",
  },
  {
    id: "dc3",
    dcNumber: "DC-2026-003",
    customer: "Max Healthcare",
    amount: 178500,
    dispatchedDate: "2026-04-17",
    invoiceNumber: "INV-2026-043",
  },
];

export default function SalesInvoicesPage() {
  const router = useRouter();
  const [challanDialogOpen, setChallanDialogOpen] = useState(false);
  const [generatedInvoices, setGeneratedInvoices] = useState<Set<string>>(new Set());

  const totalInvoiced = salesInvoices.reduce((sum, si) => sum + si.grandTotal, 0);
  const totalPaid = salesInvoices.reduce((sum, si) => sum + si.paidAmount, 0);
  const totalOutstanding = salesInvoices
    .filter((si) => si.status !== "paid" && si.status !== "cancelled")
    .reduce((sum, si) => sum + (si.grandTotal - si.paidAmount), 0);
  const overdueCount = salesInvoices.filter((si) => si.status === "overdue").length;

  function handleGenerateInvoice(challan: MockChallan) {
    setGeneratedInvoices((prev) => new Set([...prev, challan.id]));
    toast.success(
      `Invoice ${challan.invoiceNumber} auto-created from Challan ${challan.dcNumber}. Review and send to customer.`
    );
    setChallanDialogOpen(false);
  }

  const columns: Column<SalesInvoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      sortable: true,
      render: (inv) => (
        <span className="font-medium text-foreground">{inv.invoiceNumber}</span>
      ),
    },
    {
      key: "customerId",
      header: "Customer",
      render: (inv) => {
        const customer = getFinCustomerById(inv.customerId);
        return <span className="text-sm">{customer?.name ?? "Unknown"}</span>;
      },
    },
    {
      key: "invoiceDate",
      header: "Invoice Date",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground text-sm">{formatDate(inv.invoiceDate)}</span>
      ),
    },
    {
      key: "dueDate",
      header: "Due Date",
      sortable: true,
      render: (inv) => (
        <span className="text-muted-foreground text-sm">{formatDate(inv.dueDate)}</span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      className: "text-right",
      sortable: true,
      render: (inv) => (
        <span className={`font-semibold tabular-nums ${inv.status === "overdue" ? "text-red-600" : ""}`}>
          {formatCurrency(inv.grandTotal)}
        </span>
      ),
    },
    {
      key: "paidAmount",
      header: "Paid",
      className: "text-right",
      render: (inv) => (
        <span className="tabular-nums text-muted-foreground">
          {formatCurrency(inv.paidAmount)}
        </span>
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
      {/* Challan selector dialog */}
      <Dialog open={challanDialogOpen} onOpenChange={setChallanDialogOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Create Invoice from Delivery Challan</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Select a dispatched challan to auto-generate a GST-correct invoice with zero re-entry.
          </p>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Challan #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Dispatched</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockChallans.map((challan) => {
                  const alreadyGenerated = generatedInvoices.has(challan.id);
                  return (
                    <TableRow key={challan.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {challan.dcNumber}
                      </TableCell>
                      <TableCell className="text-sm">{challan.customer}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {formatCurrency(challan.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(challan.dispatchedDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                          DISPATCHED
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {alreadyGenerated ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Generated
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            onClick={() => handleGenerateInvoice(challan)}
                          >
                            Generate Invoice
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <PageHeader
        title="Sales Invoices"
        description="Manage GST-compliant sales invoices"
        actions={
          <Button onClick={() => setChallanDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        }
      />

      {/* Info banner: invoices are auto-generated from challans */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-start gap-3">
        <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-blue-800">
            Invoices are auto-generated from Delivery Challans
          </p>
          <p className="text-xs text-blue-700 mt-0.5">
            To create a new invoice: first dispatch the goods via a Delivery Challan, then use
            &ldquo;Generate Invoice&rdquo; from the Challan record. This ensures zero manual re-entry and
            GST-correct data.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Invoiced"
          value={formatCurrency(totalInvoiced)}
          icon={FileText}
          iconColor="text-blue-600"
          change={`${salesInvoices.length} invoices`}
          trend="neutral"
        />
        <KPICard
          title="Total Paid"
          value={formatCurrency(totalPaid)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change={`${salesInvoices.filter((s) => s.status === "paid").length} invoices`}
          trend="up"
        />
        <KPICard
          title="Outstanding"
          value={formatCurrency(totalOutstanding)}
          icon={IndianRupee}
          iconColor="text-amber-600"
          change={`${salesInvoices.filter((s) => s.status !== "paid" && s.status !== "cancelled").length} pending`}
          trend="neutral"
        />
        <KPICard
          title="Overdue"
          value={String(overdueCount)}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={overdueCount > 0 ? "Needs follow-up" : "All clear"}
          trend={overdueCount > 0 ? "down" : "up"}
        />
      </div>

      <DataTable<SalesInvoice>
        data={salesInvoices}
        columns={columns}
        searchKey="invoiceNumber"
        searchPlaceholder="Search by invoice number..."
        onRowClick={(item) => router.push(`/finance/sales-invoices/${item.id}`)}
      />
    </div>
  );
}
