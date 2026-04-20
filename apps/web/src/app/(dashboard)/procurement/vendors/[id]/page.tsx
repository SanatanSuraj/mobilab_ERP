"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  vendors,
  purchaseOrders,
  getVendorById,
  formatCurrency,
  formatDate,
  getRatingColor,
  getRatingLabel,
} from "@/data/procurement-mock";
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Clock,
  Package,
  ClipboardList,
  MessageSquare,
} from "lucide-react";

export default function VendorDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const vendor = getVendorById(params.id);

  if (!vendor) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Building2 className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium text-muted-foreground">Vendor not found</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Vendors
        </Button>
      </div>
    );
  }

  const vendorPOs = purchaseOrders.filter((po) => po.vendorId === vendor.id);

  // Rating component scores
  const latestPeriod = vendor.ratingPeriods[vendor.ratingPeriods.length - 1];
  const qcContribution = latestPeriod ? latestPeriod.qcPassRate * 0.4 : 0;
  const onTimeContribution = latestPeriod ? latestPeriod.onTimeRate * 0.4 : 0;
  const rejectionContribution = latestPeriod ? (100 - latestPeriod.rejectionRate) * 0.2 : 0;

  // Static activity feed
  const activityFeed = [
    { date: "2026-04-16", event: "Vendor rating updated for Q4-FY2025", type: "rating" },
    { date: "2026-04-12", event: `PO ${vendorPOs[vendorPOs.length - 1]?.poNumber ?? "N/A"} created`, type: "po" },
    { date: "2026-03-28", event: "GRN confirmed for last inward", type: "grn" },
    { date: "2026-03-15", event: "Contact details updated", type: "update" },
    { date: "2026-02-20", event: "Payment terms renegotiated", type: "update" },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Back button */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Vendors
        </Button>
      </div>

      {/* Header section */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{vendor.legalName}</h1>
            <Badge variant="outline" className="font-mono text-xs">
              {vendor.code}
            </Badge>
            <StatusBadge status={vendor.status} />
            {vendor.msmeRegistered && (
              <Badge className="bg-green-50 text-green-700 border border-green-200 text-xs font-medium">
                MSME
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">{vendor.tradeName}</p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left: col-span-2 */}
        <div className="col-span-2 space-y-6">
          {/* Vendor Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vendor Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      GST Information
                    </p>
                    <p className="text-sm font-mono font-medium">{vendor.gstin}</p>
                    <p className="text-xs text-muted-foreground">PAN: {vendor.pan}</p>
                    <p className="text-xs text-muted-foreground">State: {vendor.state}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Category
                    </p>
                    <Badge variant="outline">{vendor.category}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Terms
                    </p>
                    <div className="flex items-center gap-1.5 text-sm">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      {vendor.paymentTerms}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm mt-0.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      Lead Time: {vendor.leadTimeDays} days
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Contact
                    </p>
                    <p className="text-sm font-medium">{vendor.contactName}</p>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                      <Phone className="h-3.5 w-3.5" />
                      {vendor.phone}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                      <Mail className="h-3.5 w-3.5" />
                      {vendor.email}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Address
                    </p>
                    <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{vendor.address}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rating Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rating Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Big score */}
              <div className="flex items-center gap-4">
                <span className={`text-5xl font-bold ${getRatingColor(vendor.ratingScore)}`}>
                  {vendor.ratingScore}
                </span>
                <div>
                  <p className={`text-lg font-semibold ${getRatingColor(vendor.ratingScore)}`}>
                    {getRatingLabel(vendor.ratingScore)}
                  </p>
                  <p className="text-xs text-muted-foreground">Composite vendor score</p>
                </div>
              </div>

              {/* Component scores */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">QC Pass Rate (×40%)</span>
                    <span className="font-medium">
                      {latestPeriod ? `${latestPeriod.qcPassRate}%` : "—"}{" "}
                      <span className="text-xs text-muted-foreground">
                        → {qcContribution.toFixed(1)} pts
                      </span>
                    </span>
                  </div>
                  <Progress value={latestPeriod?.qcPassRate ?? 0} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">On-time Delivery (×40%)</span>
                    <span className="font-medium">
                      {latestPeriod ? `${latestPeriod.onTimeRate}%` : "—"}{" "}
                      <span className="text-xs text-muted-foreground">
                        → {onTimeContribution.toFixed(1)} pts
                      </span>
                    </span>
                  </div>
                  <Progress value={latestPeriod?.onTimeRate ?? 0} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">100 – Rejection Rate (×20%)</span>
                    <span className="font-medium">
                      {latestPeriod ? `${100 - latestPeriod.rejectionRate}%` : "—"}{" "}
                      <span className="text-xs text-muted-foreground">
                        → {rejectionContribution.toFixed(1)} pts
                      </span>
                    </span>
                  </div>
                  <Progress value={latestPeriod ? 100 - latestPeriod.rejectionRate : 0} className="h-2" />
                </div>
              </div>

              {/* Period history table */}
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
                  Last 3 Quarters
                </p>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs">Period</TableHead>
                      <TableHead className="text-xs text-right">QC Pass%</TableHead>
                      <TableHead className="text-xs text-right">On-time%</TableHead>
                      <TableHead className="text-xs text-right">Rejection%</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendor.ratingPeriods.slice(-3).map((rp) => (
                      <TableRow key={rp.period}>
                        <TableCell className="text-xs font-medium">{rp.period}</TableCell>
                        <TableCell className="text-xs text-right">{rp.qcPassRate}%</TableCell>
                        <TableCell className="text-xs text-right">{rp.onTimeRate}%</TableCell>
                        <TableCell className="text-xs text-right text-red-600">{rp.rejectionRate}%</TableCell>
                        <TableCell className={`text-xs text-right font-bold ${getRatingColor(rp.score)}`}>
                          {rp.score}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Bank Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bank Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Bank Name
                </p>
                <p className="text-sm font-medium">{vendor.bankName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  Account
                </p>
                <p className="text-sm font-mono">{vendor.bankAccount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                  IFSC
                </p>
                <p className="text-sm font-mono">{vendor.ifsc}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: col-span-1 */}
        <div className="col-span-1 space-y-4">
          {/* Summary Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total PO Value</span>
                <span className="text-sm font-bold">{formatCurrency(vendor.totalPOValue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total GRNs</span>
                <span className="text-sm font-bold">{vendor.totalGRNs}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Since</span>
                <span className="text-sm font-medium">{formatDate(vendor.createdAt)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2" size="sm">
                <ClipboardList className="h-4 w-4" />
                Create Indent
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" size="sm">
                <Package className="h-4 w-4" />
                View POs
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" size="sm">
                <MessageSquare className="h-4 w-4" />
                Contact Vendor
              </Button>
            </CardContent>
          </Card>

          {/* Performance Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Performance Trend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {vendor.ratingPeriods.map((rp) => (
                <div key={rp.period} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{rp.period}</span>
                  <Badge
                    variant="outline"
                    className={`font-bold text-xs border-current ${getRatingColor(rp.score)}`}
                  >
                    {rp.score}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs: POs + Activity */}
      <Tabs defaultValue="purchase-orders">
        <TabsList>
          <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="purchase-orders" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {vendorPOs.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No purchase orders found for this vendor.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>PO Number</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Required By</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendorPOs.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono text-xs text-blue-700">
                          {po.poNumber}
                        </TableCell>
                        <TableCell className="text-sm">{po.warehouseName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(po.requiredDeliveryDate)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatCurrency(po.totalValue)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={po.status} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(po.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="space-y-0">
                {activityFeed.map((item, idx) => (
                  <div key={idx} className="flex gap-4 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      {idx < activityFeed.length - 1 && (
                        <div className="w-px flex-1 bg-border mt-1" />
                      )}
                    </div>
                    <div className="pb-4 last:pb-0 flex-1">
                      <p className="text-sm">{item.event}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDate(item.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
