"use client";

// TODO(phase-5): /accounting/invoices/[id] uses the legacy prototype invoice model.
// The real per-invoice data lives in the Finance backend (see
// /finance/sales-invoices/[id], which consumes useApiSalesInvoice and already
// supports post/void/payment workflows). This page should either redirect to
// /finance/sales-invoices/[id] or be rewritten against the finance-api hooks
// with the legacy `Invoice` shape mapped from SalesInvoice.
// Mock import left in place until the routing/IA decision is made.

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  invoices,
  getActivitiesForEntity,
  formatCurrency,
  formatDate,
} from "@/data/mock";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar,
  Building2,
  CreditCard,
  FileText,
  Receipt,
} from "lucide-react";

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const invoice = invoices.find((inv) => inv.id === id);
  const [status, setStatus] = useState(invoice?.status ?? "draft");

  if (!invoice) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="text-center space-y-2">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-lg font-medium">Invoice not found</p>
          <Button variant="outline" onClick={() => router.push("/accounting/invoices")}>
            Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  const invoiceActivities = getActivitiesForEntity("invoice", invoice.id);

  function handleRecordPayment() {
    setStatus("paid");
    toast.success("Payment recorded successfully", {
      description: `${invoice!.invoiceNumber} marked as paid - ${formatCurrency(invoice!.total)}`,
    });
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/accounting/invoices")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title={invoice.invoiceNumber}
          description={`Invoice for ${invoice.customer}`}
          actions={
            status !== "paid" ? (
              <Button onClick={handleRecordPayment}>
                <CreditCard className="h-4 w-4 mr-2" />
                Record Payment
              </Button>
            ) : (
              <StatusBadge status="paid" />
            )
          }
        />
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="space-y-6 mt-4">
            {/* Header Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted/50">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Customer</p>
                    <p className="text-sm font-medium">{invoice.customer}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted/50">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Issued</p>
                    <p className="text-sm font-medium">
                      {formatDate(invoice.issuedDate)}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted/50">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Due Date</p>
                    <p className="text-sm font-medium">
                      {formatDate(invoice.dueDate)}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-muted/50">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <StatusBadge status={status} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Line Items */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Line Items
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {item.description}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(item.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatCurrency(item.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Separator />

                <div className="p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="tabular-nums">
                      {formatCurrency(invoice.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax (18% GST)</span>
                    <span className="tabular-nums">
                      {formatCurrency(invoice.tax)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">
                      {formatCurrency(invoice.total)}
                    </span>
                  </div>
                  {invoice.paidAmount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Paid</span>
                      <span className="tabular-nums">
                        {formatCurrency(invoice.paidAmount)}
                      </span>
                    </div>
                  )}
                  {invoice.total - invoice.paidAmount > 0 && status !== "paid" && (
                    <div className="flex justify-between text-sm font-semibold text-amber-600">
                      <span>Balance Due</span>
                      <span className="tabular-nums">
                        {formatCurrency(invoice.total - invoice.paidAmount)}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <div className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">
                  Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityFeed activities={invoiceActivities} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
