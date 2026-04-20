"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, IndianRupee, ClipboardList, FileText } from "lucide-react";
import { salesInvoices, purchaseOrders, getFinCustomerById, getVendorById } from "@/data/finance-mock";
import { formatCurrency, formatDate, currentMonthPrefix, isOverdue } from "@/lib/format";

export function FinanceDashboard() {
  // Live today — never hardcoded
  const currentMonth = useMemo(() => currentMonthPrefix(), []);

  const openInvoices = useMemo(
    () => salesInvoices.filter((si) => si.status !== "paid" && si.status !== "cancelled"),
    []
  );

  const totalReceivables = useMemo(
    () => openInvoices.reduce((s, si) => s + (si.grandTotal - si.paidAmount), 0),
    [openInvoices]
  );

  const overdueInvoices = useMemo(
    () => salesInvoices.filter((si) => si.status === "overdue"),
    []
  );

  const posPendingApproval = useMemo(
    () => purchaseOrders.filter((po) => po.status === "pending_approval"),
    []
  );

  // GST computed from current calendar month — not hardcoded "2026-04"
  const monthlyGST = useMemo(
    () =>
      salesInvoices
        .filter((si) => si.invoiceDate.startsWith(currentMonth))
        .reduce((s, si) => s + si.totalTax, 0),
    [currentMonth]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Receivables" value={formatCurrency(totalReceivables)} icon={IndianRupee} trend="neutral" iconColor="text-blue-600" />
        <KPICard title="Overdue Invoices" value={String(overdueInvoices.length)} icon={AlertTriangle} trend={overdueInvoices.length > 0 ? "down" : "up"} iconColor={overdueInvoices.length > 0 ? "text-red-600" : "text-green-600"} />
        <KPICard title="POs Pending Approval" value={String(posPendingApproval.length)} icon={ClipboardList} trend="neutral" iconColor="text-amber-600" />
        <KPICard title="Monthly GST Liability" value={formatCurrency(monthlyGST)} icon={FileText} trend="neutral" iconColor="text-purple-600" change={currentMonth} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Open Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Invoice#</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openInvoices.map((inv) => {
                    const customer = getFinCustomerById(inv.customerId);
                    const overdue = isOverdue(inv.dueDate);
                    return (
                      <TableRow key={inv.id} className={overdue ? "bg-red-50/40" : ""}>
                        <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                        <TableCell className="text-sm">{customer?.name ?? "—"}</TableCell>
                        <TableCell className={`text-right text-sm font-semibold tabular-nums ${overdue ? "text-red-600" : ""}`}>
                          {formatCurrency(inv.grandTotal)}
                        </TableCell>
                        <TableCell className={`text-xs ${overdue ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {formatDate(inv.dueDate)}
                        </TableCell>
                        <TableCell><StatusBadge status={inv.status} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">POs Pending Approval</CardTitle>
          </CardHeader>
          <CardContent>
            {posPendingApproval.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No POs pending approval.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>PO#</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Days Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {posPendingApproval.map((po) => {
                      // Fix: show vendor name via lookup, not raw vendorId
                      const vendor = getVendorById(po.vendorId);
                      const daysPending = Math.round(
                        (Date.now() - new Date(po.createdAt).getTime()) / (1000 * 60 * 60 * 24)
                      );
                      return (
                        <TableRow key={po.id}>
                          <TableCell className="font-mono text-xs">{po.poNumber}</TableCell>
                          <TableCell className="text-sm">{vendor?.name ?? po.vendorId}</TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">
                            {formatCurrency(po.grandTotal)}
                          </TableCell>
                          <TableCell className={`text-right text-xs tabular-nums font-medium ${daysPending > 7 ? "text-red-600" : ""}`}>
                            {daysPending}d
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
