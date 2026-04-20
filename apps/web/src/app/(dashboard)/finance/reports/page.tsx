"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, Clock, AlertCircle, IndianRupee, Building2 } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  getReceivablesAgeing,
  getPayablesAgeing,
  salesInvoices,
  purchaseInvoices,
  getFinCustomerById,
  getVendorById,
} from "@/data/finance-mock";
import { formatCurrency } from "@/data/mock";

interface PLRow {
  label: string;
  amount: number;
  isHeader?: boolean;
  isBold?: boolean;
  indent?: boolean;
}

export default function FinancialReportsPage() {
  // P&L mock data derived from invoices
  const plData = useMemo((): PLRow[] => {
    const revenue = salesInvoices.reduce((sum, si) => sum + si.subtotal, 0);
    const cogs = Math.round(revenue * 0.45);
    const grossProfit = revenue - cogs;
    const salaries = 480000;
    const rent = 120000;
    const utilities = 35000;
    const marketing = 65000;
    const depreciation = 42000;
    const totalOpex = salaries + rent + utilities + marketing + depreciation;
    const operatingProfit = grossProfit - totalOpex;
    const otherIncome = 18500;
    const pbt = operatingProfit + otherIncome;
    const tax = Math.round(pbt * 0.25);
    const pat = pbt - tax;

    return [
      { label: "Revenue", amount: 0, isHeader: true },
      { label: "Sales Revenue", amount: revenue, indent: true },
      { label: "Total Revenue", amount: revenue, isBold: true },
      { label: "", amount: 0 },
      { label: "Cost of Goods Sold", amount: 0, isHeader: true },
      { label: "Material & Manufacturing Costs", amount: cogs, indent: true },
      { label: "Total COGS", amount: cogs, isBold: true },
      { label: "", amount: 0 },
      { label: "Gross Profit", amount: grossProfit, isBold: true },
      { label: "", amount: 0 },
      { label: "Operating Expenses", amount: 0, isHeader: true },
      { label: "Salaries & Wages", amount: salaries, indent: true },
      { label: "Rent & Facilities", amount: rent, indent: true },
      { label: "Utilities", amount: utilities, indent: true },
      { label: "Marketing & Sales", amount: marketing, indent: true },
      { label: "Depreciation", amount: depreciation, indent: true },
      { label: "Total Operating Expenses", amount: totalOpex, isBold: true },
      { label: "", amount: 0 },
      { label: "Operating Profit (EBIT)", amount: operatingProfit, isBold: true },
      { label: "", amount: 0 },
      { label: "Other Income", amount: otherIncome, indent: true },
      { label: "", amount: 0 },
      { label: "Profit Before Tax (PBT)", amount: pbt, isBold: true },
      { label: "Income Tax (25%)", amount: tax, indent: true },
      { label: "", amount: 0 },
      { label: "Profit After Tax (PAT)", amount: pat, isBold: true },
    ];
  }, []);

  const receivablesAgeing = useMemo(() => getReceivablesAgeing(), []);
  const payablesAgeing = useMemo(() => getPayablesAgeing(), []);

  // Outstanding invoices grouped by customer
  const receivablesBreakdown = useMemo(() => {
    const outstanding = salesInvoices.filter(
      (si) => si.status !== "paid" && si.status !== "cancelled"
    );
    const grouped: Record<string, { customer: string; invoices: typeof outstanding }> = {};
    outstanding.forEach((si) => {
      const cust = getFinCustomerById(si.customerId);
      const name = cust?.name ?? "Unknown";
      if (!grouped[si.customerId]) {
        grouped[si.customerId] = { customer: name, invoices: [] };
      }
      grouped[si.customerId].invoices.push(si);
    });
    return Object.values(grouped);
  }, []);

  // Outstanding purchase invoices grouped by vendor
  const payablesBreakdown = useMemo(() => {
    const outstanding = purchaseInvoices.filter((pi) => pi.status !== "paid");
    const grouped: Record<string, { vendor: string; invoices: typeof outstanding }> = {};
    outstanding.forEach((pi) => {
      const vend = getVendorById(pi.vendorId);
      const name = vend?.name ?? "Unknown";
      if (!grouped[pi.vendorId]) {
        grouped[pi.vendorId] = { vendor: name, invoices: [] };
      }
      grouped[pi.vendorId].invoices.push(pi);
    });
    return Object.values(grouped);
  }, []);

  const ageingIcons = [Clock, AlertCircle, AlertCircle, AlertCircle];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Financial Reports"
        description="Profit & Loss, Receivables Ageing, and Payables Ageing"
      />

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">P&L Statement</TabsTrigger>
          <TabsTrigger value="receivables">Receivables Ageing</TabsTrigger>
          <TabsTrigger value="payables">Payables Ageing</TabsTrigger>
        </TabsList>

        {/* P&L Tab */}
        <TabsContent value="pl" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Profit & Loss Statement</CardTitle>
              <p className="text-xs text-muted-foreground">For the period Jan 2026 - Feb 2026</p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right w-[180px]">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plData.map((row, idx) => {
                    if (row.label === "" && row.amount === 0) {
                      return (
                        <TableRow key={idx} className="hover:bg-transparent">
                          <TableCell colSpan={2} className="py-1" />
                        </TableRow>
                      );
                    }
                    return (
                      <TableRow
                        key={idx}
                        className={row.isBold ? "bg-muted/20 hover:bg-muted/30" : ""}
                      >
                        <TableCell
                          className={`text-sm ${row.isHeader ? "font-semibold text-muted-foreground uppercase text-xs tracking-wide" : ""} ${row.isBold ? "font-semibold" : ""} ${row.indent ? "pl-8" : ""}`}
                        >
                          {row.label}
                        </TableCell>
                        <TableCell className={`text-right text-sm ${row.isBold ? "font-semibold" : ""} ${row.isHeader ? "" : ""}`}>
                          {row.isHeader ? "" : formatCurrency(row.amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Receivables Ageing Tab */}
        <TabsContent value="receivables" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {receivablesAgeing.map((bucket, idx) => (
              <KPICard
                key={bucket.label}
                title={`${bucket.label} (${bucket.range})`}
                value={formatCurrency(bucket.amount)}
                change={`${bucket.count} invoice${bucket.count !== 1 ? "s" : ""}`}
                trend="neutral"
                icon={ageingIcons[idx]}
              />
            ))}
          </div>

          {receivablesBreakdown.map((group) => (
            <Card key={group.customer}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {group.customer}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Invoice No.</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="text-sm font-mono">{inv.invoiceNumber}</TableCell>
                        <TableCell className="text-sm">{inv.invoiceDate}</TableCell>
                        <TableCell className="text-sm">{inv.dueDate}</TableCell>
                        <TableCell><StatusBadge status={inv.status} /></TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(inv.grandTotal)}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(inv.paidAmount)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatCurrency(inv.grandTotal - inv.paidAmount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Payables Ageing Tab */}
        <TabsContent value="payables" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {payablesAgeing.map((bucket, idx) => (
              <KPICard
                key={bucket.label}
                title={`${bucket.label} (${bucket.range})`}
                value={formatCurrency(bucket.amount)}
                change={`${bucket.count} invoice${bucket.count !== 1 ? "s" : ""}`}
                trend="neutral"
                icon={ageingIcons[idx]}
              />
            ))}
          </div>

          {payablesBreakdown.map((group) => (
            <Card key={group.vendor}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {group.vendor}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Invoice No.</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>PO Ref</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="text-sm font-mono">{inv.invoiceNumber}</TableCell>
                        <TableCell className="text-sm">{inv.invoiceDate}</TableCell>
                        <TableCell className="text-sm">{inv.dueDate}</TableCell>
                        <TableCell className="text-sm font-mono">{inv.poRef}</TableCell>
                        <TableCell><StatusBadge status={inv.status} /></TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatCurrency(inv.grandTotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
