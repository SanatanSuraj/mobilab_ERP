"use client";

// TODO(phase-5): GST reports (GSTR-1 outward, ITC inward) have no backend
// routes yet. Expected routes:
//   GET /finance/gst/gstr1?period=YYYY-MM  - outward supplies
//   GET /finance/gst/itc?period=YYYY-MM    - input tax credit
//   POST /finance/gst/gstr1/export         - generate JSON for portal upload
// Mock imports left in place until the GST slice ships in
// apps/api/src/modules/finance.

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Calculator, Receipt, IndianRupee } from "lucide-react";
import { gstr1Entries, itcEntries, salesInvoices } from "@/data/finance-mock";
import { formatCurrency } from "@/data/mock";

import type { GSTR1Entry, ITCEntry } from "@/data/finance-mock";

export default function GSTReportsPage() {
  // GSTR-1 totals
  const gstr1Totals = useMemo(() => {
    return gstr1Entries.reduce(
      (acc, e) => ({
        taxableValue: acc.taxableValue + e.taxableValue,
        cgst: acc.cgst + e.cgst,
        sgst: acc.sgst + e.sgst,
        igst: acc.igst + e.igst,
        totalTax: acc.totalTax + e.totalTax,
        invoiceValue: acc.invoiceValue + e.invoiceValue,
      }),
      { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, invoiceValue: 0 }
    );
  }, []);

  // GSTR-3B summary derived from mock data
  const gstr3bSummary = useMemo(() => {
    const totalOutward = salesInvoices.reduce((sum, si) => sum + si.subtotal, 0);
    const totalCgst = salesInvoices.reduce((sum, si) => sum + si.totalCgst, 0);
    const totalSgst = salesInvoices.reduce((sum, si) => sum + si.totalSgst, 0);
    const totalIgst = salesInvoices.reduce((sum, si) => sum + si.totalIgst, 0);
    const totalTaxLiability = totalCgst + totalSgst + totalIgst;
    const totalItcAvailable = itcEntries
      .filter((e) => e.status === "eligible")
      .reduce((sum, e) => sum + e.totalItc, 0);
    const netPayable = totalTaxLiability - totalItcAvailable;

    return {
      totalOutward,
      totalCgst,
      totalSgst,
      totalIgst,
      totalTaxLiability,
      totalItcAvailable,
      netPayable,
    };
  }, []);

  // ITC totals
  const itcTotals = useMemo(() => {
    return itcEntries.reduce(
      (acc, e) => ({
        taxableValue: acc.taxableValue + e.taxableValue,
        igst: acc.igst + e.igst,
        cgst: acc.cgst + e.cgst,
        sgst: acc.sgst + e.sgst,
        totalItc: acc.totalItc + e.totalItc,
      }),
      { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, totalItc: 0 }
    );
  }, []);

  const gstr1Columns: Column<GSTR1Entry>[] = [
    { key: "invoiceNumber", header: "Invoice No.", sortable: true, render: (e) => <span className="text-sm font-mono">{e.invoiceNumber}</span> },
    { key: "invoiceDate", header: "Date", sortable: true, render: (e) => <span className="text-sm">{e.invoiceDate}</span> },
    { key: "customerGstin", header: "Customer GSTIN", render: (e) => <span className="text-sm font-mono">{e.customerGstin}</span> },
    { key: "customerName", header: "Customer", render: (e) => <span className="text-sm">{e.customerName}</span> },
    { key: "taxableValue", header: "Taxable Value", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.taxableValue)}</span> },
    { key: "cgst", header: "CGST", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.cgst)}</span> },
    { key: "sgst", header: "SGST", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.sgst)}</span> },
    { key: "igst", header: "IGST", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.igst)}</span> },
    { key: "totalTax", header: "Total Tax", className: "text-right", render: (e) => <span className="text-sm font-medium">{formatCurrency(e.totalTax)}</span> },
    { key: "invoiceValue", header: "Invoice Value", className: "text-right", sortable: true, render: (e) => <span className="text-sm font-medium">{formatCurrency(e.invoiceValue)}</span> },
  ];

  const itcColumns: Column<ITCEntry>[] = [
    { key: "vendorGstin", header: "Vendor GSTIN", render: (e) => <span className="text-sm font-mono">{e.vendorGstin}</span> },
    { key: "vendorName", header: "Vendor Name", sortable: true, render: (e) => <span className="text-sm">{e.vendorName}</span> },
    { key: "invoiceNumber", header: "Invoice No.", render: (e) => <span className="text-sm font-mono">{e.invoiceNumber}</span> },
    { key: "invoiceDate", header: "Date", sortable: true, render: (e) => <span className="text-sm">{e.invoiceDate}</span> },
    { key: "taxableValue", header: "Taxable Value", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.taxableValue)}</span> },
    { key: "igst", header: "IGST", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.igst)}</span> },
    { key: "cgst", header: "CGST", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.cgst)}</span> },
    { key: "sgst", header: "SGST", className: "text-right", render: (e) => <span className="text-sm">{formatCurrency(e.sgst)}</span> },
    { key: "totalItc", header: "Total ITC", className: "text-right", render: (e) => <span className="text-sm font-medium">{formatCurrency(e.totalItc)}</span> },
    { key: "status", header: "Status", render: (e) => <StatusBadge status={e.status} /> },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="GST Reports"
        description="GSTR-1, GSTR-3B summary, and Input Tax Credit register"
      />

      <Tabs defaultValue="gstr1">
        <TabsList>
          <TabsTrigger value="gstr1">GSTR-1</TabsTrigger>
          <TabsTrigger value="gstr3b">GSTR-3B</TabsTrigger>
          <TabsTrigger value="itc">ITC Register</TabsTrigger>
        </TabsList>

        {/* GSTR-1 Tab */}
        <TabsContent value="gstr1" className="mt-4 space-y-4">
          <DataTable<GSTR1Entry>
            data={gstr1Entries}
            columns={gstr1Columns}
            searchKey="invoiceNumber"
            searchPlaceholder="Search by invoice number..."
            pageSize={10}
          />
          <Card>
            <CardContent className="p-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    <TableRow className="font-semibold bg-muted/30 hover:bg-muted/30">
                      <TableCell className="text-sm" colSpan={4}>Totals</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(gstr1Totals.taxableValue)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(gstr1Totals.cgst)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(gstr1Totals.sgst)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(gstr1Totals.igst)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(gstr1Totals.totalTax)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(gstr1Totals.invoiceValue)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* GSTR-3B Tab */}
        <TabsContent value="gstr3b" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  Total Outward Supplies
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(gstr3bSummary.totalOutward)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  Total Tax Liability
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(gstr3bSummary.totalTaxLiability)}</p>
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  <span>CGST: {formatCurrency(gstr3bSummary.totalCgst)}</span>
                  <span>SGST: {formatCurrency(gstr3bSummary.totalSgst)}</span>
                  <span>IGST: {formatCurrency(gstr3bSummary.totalIgst)}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  ITC Available
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-700">{formatCurrency(gstr3bSummary.totalItcAvailable)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <IndianRupee className="h-4 w-4" />
                  Net Tax Payable
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-amber-700">{formatCurrency(gstr3bSummary.netPayable)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">GSTR-3B Summary Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm">Total Outward Supplies (Taxable Value)</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(gstr3bSummary.totalOutward)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm pl-8">CGST</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(gstr3bSummary.totalCgst)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm pl-8">SGST</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(gstr3bSummary.totalSgst)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm pl-8">IGST</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(gstr3bSummary.totalIgst)}</TableCell>
                  </TableRow>
                  <TableRow className="font-medium">
                    <TableCell className="text-sm">Total Tax Liability</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(gstr3bSummary.totalTaxLiability)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm text-green-700">Less: ITC Available</TableCell>
                    <TableCell className="text-right text-sm text-green-700">{formatCurrency(gstr3bSummary.totalItcAvailable)}</TableCell>
                  </TableRow>
                  <TableRow className="font-bold bg-muted/30 hover:bg-muted/30">
                    <TableCell className="text-sm">Net Tax Payable</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(gstr3bSummary.netPayable)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ITC Register Tab */}
        <TabsContent value="itc" className="mt-4 space-y-4">
          <DataTable<ITCEntry>
            data={itcEntries}
            columns={itcColumns}
            searchKey="vendorName"
            searchPlaceholder="Search by vendor..."
            pageSize={10}
          />
          <Card>
            <CardContent className="p-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    <TableRow className="font-semibold bg-muted/30 hover:bg-muted/30">
                      <TableCell className="text-sm" colSpan={4}>Totals</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(itcTotals.taxableValue)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(itcTotals.igst)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(itcTotals.cgst)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(itcTotals.sgst)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(itcTotals.totalItc)}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
