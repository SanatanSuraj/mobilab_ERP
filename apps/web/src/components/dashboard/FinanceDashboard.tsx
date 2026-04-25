"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  IndianRupee,
  ClipboardList,
  FileText,
} from "lucide-react";
import { useApiSalesInvoices } from "@/hooks/useFinanceApi";
import { useApiPurchaseOrders, useApiVendors } from "@/hooks/useProcurementApi";
import {
  formatCurrency,
  formatDate,
  currentMonthPrefix,
  isOverdue,
} from "@/lib/format";
import type { SalesInvoice } from "@instigenie/contracts";

/**
 * Finance dashboard — live data from /finance/sales-invoices and
 * /procurement/purchase-orders.
 *
 * Contract shape deltas vs the old mock:
 *   - Invoice status is DRAFT / POSTED / CANCELLED (no "paid"/"overdue"):
 *     we derive paid from `amountPaid >= grandTotal` and overdue from
 *     `dueDate < today` on POSTED invoices.
 *   - PO "pending approval" maps to status === "PENDING_APPROVAL" (upper).
 *   - Money fields (grandTotal, amountPaid, taxTotal) are decimal strings.
 */

function toNumber(v: string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isOpenInvoice(si: SalesInvoice): boolean {
  if (si.status !== "POSTED") return false;
  return toNumber(si.amountPaid) < toNumber(si.grandTotal);
}

export function FinanceDashboard() {
  const currentMonth = useMemo(() => currentMonthPrefix(), []);

  const invoicesQuery = useApiSalesInvoices({ limit: 100 });
  const posQuery = useApiPurchaseOrders({
    status: "PENDING_APPROVAL",
    limit: 50,
  });
  const vendorsQuery = useApiVendors({ limit: 100 });

  const invoices = useMemo(
    () => invoicesQuery.data?.data ?? [],
    [invoicesQuery.data?.data]
  );
  const posPendingApproval = useMemo(
    () => posQuery.data?.data ?? [],
    [posQuery.data?.data]
  );

  const vendorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendorsQuery.data?.data ?? []) map.set(v.id, v.name);
    return map;
  }, [vendorsQuery.data?.data]);

  const openInvoices = useMemo(() => invoices.filter(isOpenInvoice), [invoices]);

  const totalReceivables = useMemo(
    () =>
      openInvoices.reduce(
        (s, si) => s + (toNumber(si.grandTotal) - toNumber(si.amountPaid)),
        0
      ),
    [openInvoices]
  );

  const overdueInvoices = useMemo(
    () =>
      openInvoices.filter((si) => si.dueDate && isOverdue(si.dueDate)),
    [openInvoices]
  );

  const monthlyGST = useMemo(
    () =>
      invoices
        .filter(
          (si) =>
            si.status === "POSTED" && si.invoiceDate.startsWith(currentMonth)
        )
        .reduce((s, si) => s + toNumber(si.taxTotal), 0),
    [invoices, currentMonth]
  );

  const isLoading =
    invoicesQuery.isLoading || posQuery.isLoading || vendorsQuery.isLoading;
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Receivables"
          value={formatCurrency(totalReceivables)}
          icon={IndianRupee}
          trend="neutral"
          iconColor="text-blue-600"
        />
        <KPICard
          title="Overdue Invoices"
          value={String(overdueInvoices.length)}
          icon={AlertTriangle}
          trend={overdueInvoices.length > 0 ? "down" : "up"}
          iconColor={
            overdueInvoices.length > 0 ? "text-red-600" : "text-green-600"
          }
        />
        <KPICard
          title="POs Pending Approval"
          value={String(posPendingApproval.length)}
          icon={ClipboardList}
          trend="neutral"
          iconColor="text-amber-600"
        />
        <KPICard
          title="Monthly GST Liability"
          value={formatCurrency(monthlyGST)}
          icon={FileText}
          trend="neutral"
          iconColor="text-purple-600"
          change={currentMonth}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Open Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No open invoices.
              </p>
            ) : (
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
                    {openInvoices.slice(0, 10).map((inv) => {
                      const overdue = inv.dueDate
                        ? isOverdue(inv.dueDate)
                        : false;
                      return (
                        <TableRow
                          key={inv.id}
                          className={overdue ? "bg-red-50/40" : ""}
                        >
                          <TableCell className="font-mono text-xs">
                            {inv.invoiceNumber}
                          </TableCell>
                          <TableCell className="text-sm">
                            {inv.customerName ?? "—"}
                          </TableCell>
                          <TableCell
                            className={`text-right text-sm font-semibold tabular-nums ${
                              overdue ? "text-red-600" : ""
                            }`}
                          >
                            {formatCurrency(toNumber(inv.grandTotal))}
                          </TableCell>
                          <TableCell
                            className={`text-xs ${
                              overdue
                                ? "text-red-600 font-medium"
                                : "text-muted-foreground"
                            }`}
                          >
                            {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              status={overdue ? "OVERDUE" : inv.status}
                            />
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              POs Pending Approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            {posPendingApproval.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No POs pending approval.
              </p>
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
                      const vendorName =
                        vendorById.get(po.vendorId) ??
                        po.vendorId.slice(0, 8);
                      const daysPending = Math.round(
                        (Date.now() - new Date(po.createdAt).getTime()) /
                          (1000 * 60 * 60 * 24)
                      );
                      return (
                        <TableRow key={po.id}>
                          <TableCell className="font-mono text-xs">
                            {po.poNumber}
                          </TableCell>
                          <TableCell className="text-sm">
                            {vendorName}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">
                            {formatCurrency(toNumber(po.grandTotal))}
                          </TableCell>
                          <TableCell
                            className={`text-right text-xs tabular-nums font-medium ${
                              daysPending > 7 ? "text-red-600" : ""
                            }`}
                          >
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
