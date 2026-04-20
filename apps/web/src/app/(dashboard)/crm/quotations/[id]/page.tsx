"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  enhancedQuotations,
  getAccountById,
  getContactById,
  type EnhancedQuotation,
  type QuotationVersion,
} from "@/data/crm-mock";
import { getUserById, formatCurrency, formatDate } from "@/data/mock";
import {
  ArrowLeft,
  Mail,
  FileText,
  CheckCircle,
  AlertTriangle,
  Clock,
  Send,
  Download,
  User,
  Building2,
  Calendar,
  Hash,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export default function QuotationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const quotation = enhancedQuotations.find((q) => q.id === params.id);
  const [selectedVersion, setSelectedVersion] = useState<number>(
    quotation?.currentVersion ?? 1
  );
  const [sentVia, setSentVia] = useState(quotation?.sentVia);
  const [approvalStatus, setApprovalStatus] = useState(
    quotation?.approvalStatus
  );
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  if (!quotation) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Quotation not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  const account = getAccountById(quotation.accountId);
  const contact = getContactById(quotation.contactId);
  const version = quotation.versions.find((v) => v.version === selectedVersion);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/crm/quotations"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Quotations
      </Link>

      {/* Pending Approval Banner */}
      {quotation.requiresApproval && approvalStatus === "pending" && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Pending Manager Approval
            </p>
            <p className="text-xs text-amber-600">
              This quotation requires management approval before it can be sent
              to the customer.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title={quotation.quotationNumber}
        description={account?.name ?? ""}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={quotation.status} />
            {quotation.requiresApproval && approvalStatus && (
              <StatusBadge status={approvalStatus} />
            )}
          </div>
        }
      />

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSentVia("email");
            toast.success("Quotation sent via email to " + (contact?.email ?? "customer"));
          }}
        >
          <Mail className="h-4 w-4 mr-1.5" />
          Send via Email
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPdfPreview(!showPdfPreview)}
        >
          <FileText className="h-4 w-4 mr-1.5" />
          Generate PDF
        </Button>
        {quotation.requiresApproval && approvalStatus === "pending" && (
          <Button
            size="sm"
            onClick={() => {
              setApprovalStatus("approved");
              toast.success("Quotation approved successfully");
            }}
          >
            <CheckCircle className="h-4 w-4 mr-1.5" />
            Approve
          </Button>
        )}
        {sentVia && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Send className="h-3 w-3" />
            Sent via {sentVia}
          </span>
        )}
      </div>

      {/* PDF Preview card */}
      {showPdfPreview && (
        <Card className="border-dashed">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-red-500" />
                <span className="font-medium text-sm">
                  {quotation.quotationNumber}_v{selectedVersion}.pdf
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.success("PDF downloaded")}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Download
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-8 text-center space-y-2">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium">PDF Preview</p>
              <p className="text-xs text-muted-foreground">
                {quotation.quotationNumber} - Version {selectedVersion} - {account?.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Grand Total: {formatCurrency(version?.grandTotal ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Building2 className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Account</span>
            </div>
            <p className="text-sm font-medium">{account?.name ?? "N/A"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <User className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Contact</span>
            </div>
            <p className="text-sm font-medium">
              {contact ? `${contact.firstName} ${contact.lastName}` : "N/A"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Calendar className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Valid Until</span>
            </div>
            <p className="text-sm font-medium">{formatDate(quotation.validUntil)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Hash className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Current Version</span>
            </div>
            <p className="text-sm font-medium">v{quotation.currentVersion}</p>
          </CardContent>
        </Card>
      </div>

      {/* Version Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Version Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs
            value={String(selectedVersion)}
            onValueChange={(v) => setSelectedVersion(Number(v))}
          >
            <TabsList>
              {quotation.versions.map((v) => (
                <TabsTrigger key={v.version} value={String(v.version)}>
                  v{v.version}
                </TabsTrigger>
              ))}
            </TabsList>

            {quotation.versions.map((ver) => (
              <TabsContent key={ver.version} value={String(ver.version)}>
                {/* Line Items */}
                <div className="rounded-lg border overflow-hidden mt-4">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead>Product</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Discount %</TableHead>
                        <TableHead className="text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ver.items.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium text-sm">
                            {item.productName}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.sku}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {item.quantity}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {formatCurrency(item.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {item.discount}%
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatCurrency(item.lineTotal)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Totals */}
                <div className="mt-4 flex justify-end">
                  <div className="w-72 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCurrency(ver.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Discount</span>
                      <span className="text-red-600">
                        -{formatCurrency(ver.discountAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax (18% GST)</span>
                      <span>{formatCurrency(ver.taxAmount)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm font-bold">
                      <span>Grand Total</span>
                      <span>{formatCurrency(ver.grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Version History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Version History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {quotation.versions
              .slice()
              .reverse()
              .map((ver) => {
                const creator = getUserById(ver.createdBy);
                return (
                  <div
                    key={ver.version}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                  >
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary">
                        v{ver.version}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          Version {ver.version}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(ver.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Created by {creator?.name ?? "Unknown"} &middot; Total:{" "}
                        {formatCurrency(ver.grandTotal)}
                      </p>
                      {ver.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          {ver.notes}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
