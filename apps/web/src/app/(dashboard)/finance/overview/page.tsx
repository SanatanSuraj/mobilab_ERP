"use client";

/**
 * Finance Overview — reads /finance/overview via useApiFinanceOverview.
 *
 * Phase 2 surface:
 *   - AR/AP outstanding + 30/60/90 aging buckets
 *   - MTD revenue + expense totals
 *   - Per-status sales / purchase invoice counts
 *   - Recorded payment count
 *
 * Supplementary tables pull live data from the recent sales-invoices and
 * payments endpoints — no mock crossover. Money fields come off the wire as
 * decimal strings; we use `Number()` ONLY at the format site (Intl) to render.
 */

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  useApiFinanceOverview,
  useApiPayments,
  useApiSalesInvoices,
} from "@/hooks/useFinanceApi";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CreditCard,
  DollarSign,
  FileText,
  Landmark,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value: string, currency = "INR"): string {
  // Display-only — `Number()` is permitted for formatting per the architecture
  // (the ban applies to construction and math, not render output).
  const n = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FinanceOverviewPage() {
  const router = useRouter();

  const overview = useApiFinanceOverview();
  const recentInvoices = useApiSalesInvoices({ limit: 5 });
  const recentPayments = useApiPayments({ limit: 5 });

  const quickLinks = [
    { label: "Sales Invoices", href: "/finance/sales-invoices", icon: FileText },
    {
      label: "Purchase Invoices",
      href: "/finance/purchase-invoices",
      icon: ShoppingCart,
    },
    { label: "Payments", href: "/finance/payments", icon: CreditCard },
    { label: "Customer Ledger", href: "/finance/customer-ledger", icon: Landmark },
    { label: "Vendor Ledger", href: "/finance/vendor-ledger", icon: Receipt },
    { label: "Reports", href: "/finance/reports", icon: BarChart3 },
  ];

  if (overview.isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load finance overview
            </p>
            <p className="text-red-700 mt-1">
              {overview.error instanceof Error
                ? overview.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const kpi = overview.data;
  const cashPosition = Number(kpi.arOutstanding) - Number(kpi.apOutstanding);
  const arOverdueTotal =
    Number(kpi.arOverdue30) +
    Number(kpi.arOverdue60) +
    Number(kpi.arOverdue90);
  const apOverdueTotal =
    Number(kpi.apOverdue30) +
    Number(kpi.apOverdue60) +
    Number(kpi.apOverdue90);

  const invoices = recentInvoices.data?.data ?? [];
  const payments = recentPayments.data?.data ?? [];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Finance Dashboard"
        description="Overview of receivables, payables, and cash position"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="AR Outstanding"
          value={formatMoney(kpi.arOutstanding, kpi.currency)}
          icon={DollarSign}
          iconColor="text-blue-600"
          change={`${kpi.postedSalesInvoices} posted invoices`}
          trend="neutral"
        />
        <KPICard
          title="AP Outstanding"
          value={formatMoney(kpi.apOutstanding, kpi.currency)}
          icon={CreditCard}
          iconColor="text-orange-600"
          change={`${kpi.postedPurchaseInvoices} posted bills`}
          trend="neutral"
        />
        <KPICard
          title="Cash Position"
          value={formatMoney(String(cashPosition), kpi.currency)}
          icon={Landmark}
          iconColor="text-green-600"
          change="AR − AP"
          trend={cashPosition >= 0 ? "up" : "down"}
        />
        <KPICard
          title="AR Overdue"
          value={formatMoney(String(arOverdueTotal), kpi.currency)}
          icon={AlertTriangle}
          iconColor="text-red-600"
          change={arOverdueTotal > 0 ? "Requires follow-up" : "All clear"}
          trend={arOverdueTotal > 0 ? "down" : "up"}
        />
      </div>

      {/* MTD + Aging breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MTD */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Month-to-Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">MTD Revenue</p>
                <p className="text-lg font-semibold mt-1 text-green-700">
                  {formatMoney(kpi.mtdRevenue, kpi.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">MTD Expenses</p>
                <p className="text-lg font-semibold mt-1 text-red-700">
                  {formatMoney(kpi.mtdExpenses, kpi.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net (Rev − Exp)</p>
                <p className="text-lg font-semibold mt-1">
                  {formatMoney(
                    String(Number(kpi.mtdRevenue) - Number(kpi.mtdExpenses)),
                    kpi.currency,
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Draft invoices</p>
                <p className="text-lg font-semibold mt-1">
                  {kpi.draftSalesInvoices + kpi.draftPurchaseInvoices}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AR + AP Aging */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Aging
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">AR 30+ days</span>
                <span className="font-medium tabular-nums">
                  {formatMoney(kpi.arOverdue30, kpi.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">AR 60+ days</span>
                <span className="font-medium tabular-nums text-amber-700">
                  {formatMoney(kpi.arOverdue60, kpi.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">AR 90+ days</span>
                <span className="font-medium tabular-nums text-red-700">
                  {formatMoney(kpi.arOverdue90, kpi.currency)}
                </span>
              </div>
              <div className="border-t my-2" />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">AP 30+ days</span>
                <span className="font-medium tabular-nums">
                  {formatMoney(kpi.apOverdue30, kpi.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">AP 60+ days</span>
                <span className="font-medium tabular-nums text-amber-700">
                  {formatMoney(kpi.apOverdue60, kpi.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">AP 90+ days</span>
                <span className="font-medium tabular-nums text-red-700">
                  {formatMoney(kpi.apOverdue90, kpi.currency)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Sales Invoices */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Sales Invoices</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => router.push("/finance/sales-invoices")}
          >
            View all <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentInvoices.isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-6 text-muted-foreground"
                    >
                      <Skeleton className="h-4 w-32 mx-auto" />
                    </TableCell>
                  </TableRow>
                )}
                {!recentInvoices.isLoading && invoices.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-6 text-muted-foreground"
                    >
                      No invoices yet
                    </TableCell>
                  </TableRow>
                )}
                {invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/finance/sales-invoices/${inv.id}`)
                    }
                  >
                    <TableCell className="font-mono text-xs font-semibold text-blue-700">
                      {inv.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.customerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(inv.invoiceDate)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {formatMoney(inv.grandTotal, inv.currency)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {formatMoney(inv.amountPaid, inv.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          inv.status === "POSTED"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : inv.status === "CANCELLED"
                              ? "bg-gray-50 text-gray-600 border-gray-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                        }
                      >
                        {inv.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Payments */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Payments</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => router.push("/finance/payments")}
          >
            View all <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Payment #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPayments.isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-6 text-muted-foreground"
                    >
                      <Skeleton className="h-4 w-32 mx-auto" />
                    </TableCell>
                  </TableRow>
                )}
                {!recentPayments.isLoading && payments.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-6 text-muted-foreground"
                    >
                      No payments recorded yet
                    </TableCell>
                  </TableRow>
                )}
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs font-semibold text-blue-700">
                      {p.paymentNumber}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.paymentType === "CUSTOMER_RECEIPT"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-orange-50 text-orange-700 border-orange-200"
                        }
                      >
                        {p.paymentType === "CUSTOMER_RECEIPT"
                          ? "Receipt"
                          : "Payment"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.counterpartyName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(p.paymentDate)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.status === "RECORDED"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-gray-50 text-gray-600 border-gray-200"
                        }
                      >
                        {p.status}
                      </Badge>
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
