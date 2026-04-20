"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  salesInvoices,
  purchaseInvoices,
  finPayments,
  finActivities,
  getFinCustomerById,
  getVendorById,
  getReceivablesAgeing,
  getPayablesAgeing,
} from "@/data/finance-mock";
import { formatCurrency } from "@/data/mock";
import {
  DollarSign,
  CreditCard,
  Landmark,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  FileText,
  ShoppingCart,
  Receipt,
  BarChart3,
} from "lucide-react";

const monthlyRevenue = [
  { month: "Oct", amount: 520000 },
  { month: "Nov", amount: 680000 },
  { month: "Dec", amount: 264320 },
  { month: "Jan", amount: 854026 },
  { month: "Feb", amount: 1699200 },
];

const cashFlowData = [
  { month: "Oct", incoming: 520000, outgoing: 310000 },
  { month: "Nov", incoming: 680000, outgoing: 420000 },
  { month: "Dec", incoming: 264320, outgoing: 180000 },
  { month: "Jan", incoming: 701800, outgoing: 354000 },
  { month: "Feb", incoming: 100000, outgoing: 168000 },
];

export default function FinanceOverviewPage() {
  const router = useRouter();

  const totalReceivables = salesInvoices
    .filter((si) => si.status !== "paid" && si.status !== "cancelled")
    .reduce((sum, si) => sum + (si.grandTotal - si.paidAmount), 0);

  const totalPayables = purchaseInvoices
    .filter((pi) => pi.status !== "paid")
    .reduce((sum, pi) => sum + pi.grandTotal, 0);

  const cashPosition = totalReceivables - totalPayables;

  const overdueCount = salesInvoices.filter((si) => si.status === "overdue").length;

  const recentActivities = [...finActivities]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const maxRevenue = Math.max(...monthlyRevenue.map((m) => m.amount));
  const maxCashFlow = Math.max(
    ...cashFlowData.flatMap((m) => [m.incoming, m.outgoing])
  );

  const quickLinks = [
    { label: "Sales Invoices", href: "/finance/sales-invoices", icon: FileText },
    { label: "Purchase Invoices", href: "/finance/purchase-invoices", icon: ShoppingCart },
    { label: "Payments", href: "/finance/reports", icon: CreditCard },
    { label: "GST Reports", href: "/finance/gst-reports", icon: Receipt },
    { label: "PO Approvals", href: "/finance/approvals", icon: BarChart3 },
    { label: "E-Way Bills", href: "/finance/eway-bills", icon: Landmark },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Finance Dashboard"
        description="Overview of receivables, payables, and cash position"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Receivables"
          value={formatCurrency(totalReceivables)}
          icon={DollarSign}
          iconColor="text-blue-600"
          change={`${salesInvoices.filter((s) => s.status !== "paid" && s.status !== "cancelled").length} invoices`}
          trend="neutral"
        />
        <KPICard
          title="Total Payables"
          value={formatCurrency(totalPayables)}
          icon={CreditCard}
          iconColor="text-orange-600"
          change={`${purchaseInvoices.filter((p) => p.status !== "paid").length} invoices`}
          trend="neutral"
        />
        <KPICard
          title="Cash Position"
          value={formatCurrency(cashPosition)}
          icon={Landmark}
          iconColor="text-green-600"
          change="Receivables - Payables"
          trend={cashPosition > 0 ? "up" : "down"}
        />
        <KPICard
          title="Overdue Invoices"
          value={String(overdueCount)}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={overdueCount > 0 ? "Requires follow-up" : "All clear"}
          trend={overdueCount > 0 ? "down" : "up"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trend */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Revenue Trend (Oct - Feb)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 h-48">
              {monthlyRevenue.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {formatCurrency(m.amount)}
                  </span>
                  <div
                    className="w-full bg-primary/80 rounded-t-md transition-all hover:bg-primary"
                    style={{ height: `${(m.amount / maxRevenue) * 140}px` }}
                  />
                  <span className="text-xs font-medium">{m.month}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Cash Flow */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Cash Flow (Incoming vs Outgoing)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 h-48">
              {cashFlowData.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                  <div className="flex gap-1 w-full items-end justify-center" style={{ height: "140px" }}>
                    <div
                      className="w-[45%] bg-green-500/80 rounded-t-md hover:bg-green-500 transition-all"
                      style={{ height: `${(m.incoming / maxCashFlow) * 140}px` }}
                      title={`In: ${formatCurrency(m.incoming)}`}
                    />
                    <div
                      className="w-[45%] bg-red-400/70 rounded-t-md hover:bg-red-400 transition-all"
                      style={{ height: `${(m.outgoing / maxCashFlow) * 140}px` }}
                      title={`Out: ${formatCurrency(m.outgoing)}`}
                    />
                  </div>
                  <span className="text-xs font-medium">{m.month}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 justify-center">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-green-500/80" />
                <span className="text-xs text-muted-foreground">Incoming</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-red-400/70" />
                <span className="text-xs text-muted-foreground">Outgoing</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Finance Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Activity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentActivities.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm max-w-[400px] truncate">
                      {a.content}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.type} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground capitalize">
                      {a.entityType.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(a.timestamp).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Quick Links */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Button
                  key={link.href}
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center gap-2"
                  onClick={() => router.push(link.href)}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs font-medium">{link.label}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
