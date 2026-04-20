"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  salesInvoices,
  getFinCustomerById,
  getFinActivitiesForEntity,
} from "@/data/finance-mock";
import { Activity, formatCurrency, formatDate } from "@/data/mock";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  FileText,
  Send,
  CreditCard,
  Eye,
  MapPin,
  Hash,
  ArrowRightLeft,
} from "lucide-react";

export default function SalesInvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  const invoice = salesInvoices.find((si) => si.id === invoiceId);

  if (!invoice) {
    return (
      <div className="p-6">
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold mb-2">Invoice not found</h2>
          <p className="text-muted-foreground mb-4">
            The invoice you are looking for does not exist.
          </p>
          <Button variant="outline" onClick={() => router.push("/finance/sales-invoices")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Sales Invoices
          </Button>
        </div>
      </div>
    );
  }

  const customer = getFinCustomerById(invoice.customerId);
  const finActs = getFinActivitiesForEntity("sales_invoice", invoice.id);
  const adaptedActivities = finActs.map((a) => ({
    ...a,
    entityType: a.entityType as Activity["entityType"],
  })) as Activity[];

  const outstanding = invoice.grandTotal - invoice.paidAmount;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/finance/sales-invoices")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Sales Invoices
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {customer?.name ?? "Unknown Customer"}
            {customer?.gstin && (
              <span className="ml-2 text-xs">GSTIN: {customer.gstin}</span>
            )}
          </p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              Issued: {formatDate(invoice.invoiceDate)}
            </span>
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              Due: {formatDate(invoice.dueDate)}
            </span>
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              SO: {invoice.salesOrderRef}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              toast.success("Invoice marked as Sent");
            }}
          >
            <Send className="h-4 w-4 mr-1" />
            Mark as Sent
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              toast.success("Payment recorded successfully");
            }}
          >
            <CreditCard className="h-4 w-4 mr-1" />
            Record Payment
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPdfPreview(!showPdfPreview)}
          >
            <Eye className="h-4 w-4 mr-1" />
            PDF Preview
          </Button>
        </div>
      </div>

      {/* PDF Preview Card */}
      {showPdfPreview && (
        <Card className="mb-6 border-dashed">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Invoice Preview</h3>
              <Button variant="ghost" size="sm" onClick={() => setShowPdfPreview(false)}>
                Close
              </Button>
            </div>
            <div className="bg-white border rounded-lg p-8 text-sm space-y-4">
              <div className="flex justify-between">
                <div>
                  <p className="text-lg font-bold">TAX INVOICE</p>
                  <p className="text-muted-foreground">{invoice.invoiceNumber}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">Acme BioTech Pvt Ltd</p>
                  <p className="text-muted-foreground text-xs">GSTIN: 27AABCA1234B1Z5</p>
                  <p className="text-muted-foreground text-xs">Mumbai, Maharashtra</p>
                </div>
              </div>
              <div className="border-t pt-3 flex justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Bill To:</p>
                  <p className="font-medium">{customer?.name}</p>
                  <p className="text-xs text-muted-foreground">{customer?.address}</p>
                  <p className="text-xs text-muted-foreground">GSTIN: {customer?.gstin}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Date: {formatDate(invoice.invoiceDate)}</p>
                  <p className="text-xs text-muted-foreground">Due: {formatDate(invoice.dueDate)}</p>
                  <p className="text-xs text-muted-foreground">Supply: {invoice.placeOfSupply}</p>
                </div>
              </div>
              <div className="border-t pt-3 text-center">
                <p className="text-2xl font-bold">{formatCurrency(invoice.grandTotal)}</p>
                <p className="text-xs text-muted-foreground">
                  Paid: {formatCurrency(invoice.paidAmount)} | Balance: {formatCurrency(outstanding)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Customer Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium">{customer?.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    GSTIN: {customer?.gstin}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm">{customer?.address}</p>
                    <p className="text-xs text-muted-foreground">{customer?.state}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{customer?.contactPerson}</span>
                  <span>|</span>
                  <span>{customer?.email}</span>
                </div>
              </CardContent>
            </Card>

            {/* Invoice Summary Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Invoice Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Supply Type</span>
                  <Badge variant="outline" className="text-xs">
                    <ArrowRightLeft className="h-3 w-3 mr-1" />
                    {invoice.supplyType === "intra_state" ? "Intra-State" : "Inter-State"}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Place of Supply</span>
                  <span className="font-medium">{invoice.placeOfSupply}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Grand Total</span>
                  <span className="font-bold text-lg">{formatCurrency(invoice.grandTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Paid Amount</span>
                  <span className="font-medium text-green-600">{formatCurrency(invoice.paidAmount)}</span>
                </div>
                {outstanding > 0 && (
                  <div className="flex justify-between text-sm border-t pt-2">
                    <span className="text-muted-foreground">Balance Due</span>
                    <span className="font-semibold text-red-600">{formatCurrency(outstanding)}</span>
                  </div>
                )}
                {invoice.ewayBillId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">E-Way Bill</span>
                    <span className="font-medium">{invoice.ewayBillId}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Line Items */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Description</TableHead>
                      <TableHead>HSN</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Taxable Amt</TableHead>
                      {invoice.supplyType === "intra_state" ? (
                        <>
                          <TableHead className="text-right">CGST</TableHead>
                          <TableHead className="text-right">SGST</TableHead>
                        </>
                      ) : (
                        <TableHead className="text-right">IGST</TableHead>
                      )}
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium text-sm">{item.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.hsnCode}</TableCell>
                        <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(item.taxableAmount)}</TableCell>
                        {invoice.supplyType === "intra_state" ? (
                          <>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {formatCurrency(item.cgst)}
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {formatCurrency(item.sgst)}
                            </TableCell>
                          </>
                        ) : (
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {formatCurrency(item.igst)}
                          </TableCell>
                        )}
                        <TableCell className="text-right text-sm font-medium">
                          {formatCurrency(item.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Tax Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tax Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-w-sm ml-auto space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(invoice.subtotal)}</span>
                </div>
                {invoice.supplyType === "intra_state" ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">CGST</span>
                      <span className="tabular-nums">{formatCurrency(invoice.totalCgst)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">SGST</span>
                      <span className="tabular-nums">{formatCurrency(invoice.totalSgst)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">IGST</span>
                    <span className="tabular-nums">{formatCurrency(invoice.totalIgst)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-muted-foreground">Total Tax</span>
                  <span className="tabular-nums">{formatCurrency(invoice.totalTax)}</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2 font-bold text-base">
                  <span>Grand Total</span>
                  <span className="tabular-nums">{formatCurrency(invoice.grandTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed activities={adaptedActivities} maxHeight="600px" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
