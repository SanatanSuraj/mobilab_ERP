"use client";

/**
 * Vendor detail — reads /procurement/vendors/:id via useApiVendor.
 * The "Purchase Orders" tab is driven by useApiPurchaseOrders({ vendorId }).
 *
 * Contract deltas vs the older mock:
 *   - Rating / performance breakdown dropped — not in the Phase 2 schema.
 *     (The ratingPeriods array, qcPassRate, onTimeRate, rejectionRate are
 *     Phase 3 vendor-performance work; the column + UI will return then.)
 *   - `totalPOValue` / `totalGRNs` summary aggregates are derived on-the-fly
 *     from useApiPurchaseOrders rather than denormalised on the header.
 *   - `legalName` + `tradeName` collapse to `name` — see list page comment.
 *   - Activity feed is gone (was static strings); real wiring lands with
 *     Phase 3 audit-log surfacing.
 */

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useApiPurchaseOrders,
  useApiVendor,
} from "@/hooks/useProcurementApi";
import type { PoStatus, VendorType } from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Clock,
  CreditCard,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";

function formatMoney(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw ?? "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const VENDOR_TYPE_LABEL: Record<VendorType, string> = {
  SUPPLIER: "Supplier",
  SERVICE: "Service",
  LOGISTICS: "Logistics",
  BOTH: "Supplier + Service",
};

const PO_STATUS_TONE: Record<PoStatus, string> = {
  DRAFT: "bg-gray-50 text-gray-700 border-gray-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200",
  SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
  PARTIALLY_RECEIVED: "bg-purple-50 text-purple-700 border-purple-200",
  RECEIVED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export default function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16 passes params as a Promise; unwrap with React.use().
  const { id } = use(params);
  const router = useRouter();

  const vendorQuery = useApiVendor(id);
  const posQuery = useApiPurchaseOrders(
    useMemo(() => ({ vendorId: id, limit: 100 }), [id])
  );

  if (vendorQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-3 gap-6">
          <Skeleton className="col-span-2 h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (vendorQuery.isError || !vendorQuery.data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              {vendorQuery.isError ? "Failed to load vendor" : "Vendor not found"}
            </p>
            {vendorQuery.isError && (
              <p className="text-red-700 mt-1">
                {vendorQuery.error instanceof Error
                  ? vendorQuery.error.message
                  : "Unknown error"}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.back()}
          className="mt-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Vendors
        </Button>
      </div>
    );
  }

  const vendor = vendorQuery.data;
  const pos = posQuery.data?.data ?? [];
  const totalPoValue = pos.reduce(
    (sum, po) => sum + (Number.parseFloat(po.grandTotal) || 0),
    0
  );

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
            <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
            <Badge variant="outline" className="font-mono text-xs">
              {vendor.code}
            </Badge>
            <Badge
              variant="outline"
              className={
                vendor.isActive
                  ? "text-xs bg-green-50 text-green-700 border-green-200"
                  : "text-xs bg-gray-50 text-gray-600 border-gray-200"
              }
            >
              {vendor.isActive ? "Active" : "Inactive"}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {VENDOR_TYPE_LABEL[vendor.vendorType]}
            </Badge>
            {vendor.isMsme && (
              <Badge className="bg-green-50 text-green-700 border border-green-200 text-xs font-medium">
                MSME
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Onboarded {formatDate(vendor.createdAt)} · version {vendor.version}
          </p>
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
                      Tax Information
                    </p>
                    <p className="text-sm font-mono font-medium">
                      {vendor.gstin ?? "—"}
                    </p>
                    {vendor.pan && (
                      <p className="text-xs text-muted-foreground">
                        PAN: {vendor.pan}
                      </p>
                    )}
                    {vendor.state && (
                      <p className="text-xs text-muted-foreground">
                        State: {vendor.state}
                      </p>
                    )}
                    {vendor.isMsme && vendor.msmeNumber && (
                      <p className="text-xs text-muted-foreground">
                        MSME: {vendor.msmeNumber}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Terms
                    </p>
                    <div className="flex items-center gap-1.5 text-sm">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                      Net {vendor.paymentTermsDays} days
                    </div>
                    <div className="flex items-center gap-1.5 text-sm mt-0.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      Credit limit: {formatMoney(vendor.creditLimit)}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                      Contact
                    </p>
                    <p className="text-sm font-medium">
                      {vendor.contactName ?? "—"}
                    </p>
                    {vendor.phone && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                        <Phone className="h-3.5 w-3.5" />
                        {vendor.phone}
                      </div>
                    )}
                    {vendor.email && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                        <Mail className="h-3.5 w-3.5" />
                        {vendor.email}
                      </div>
                    )}
                  </div>
                  {(vendor.address || vendor.city) && (
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                        Address
                      </p>
                      <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          {[vendor.address, vendor.city, vendor.state, vendor.postalCode]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {vendor.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Notes
                  </p>
                  <p className="text-sm">{vendor.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bank Details */}
          {(vendor.bankName || vendor.bankAccount || vendor.bankIfsc) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bank Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Bank Name
                  </p>
                  <p className="text-sm font-medium">
                    {vendor.bankName ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Account
                  </p>
                  <p className="text-sm font-mono">
                    {vendor.bankAccount ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    IFSC
                  </p>
                  <p className="text-sm font-mono">{vendor.bankIfsc ?? "—"}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: col-span-1 */}
        <div className="col-span-1 space-y-4">
          {/* Summary Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Purchase Orders</span>
                <span className="text-sm font-bold">
                  {posQuery.isLoading ? "…" : pos.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">PO Value (shown)</span>
                <span className="text-sm font-bold">
                  {posQuery.isLoading
                    ? "…"
                    : formatMoney(totalPoValue.toFixed(2))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Since</span>
                <span className="text-sm font-medium">
                  {formatDate(vendor.createdAt)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Updated</span>
                <span className="text-sm font-medium">
                  {formatDate(vendor.updatedAt)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs: POs */}
      <Tabs defaultValue="purchase-orders">
        <TabsList>
          <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="purchase-orders" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {posQuery.isLoading ? (
                <div className="p-8">
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : pos.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
                  <Building2 className="h-8 w-8 text-muted-foreground/40" />
                  No purchase orders found for this vendor.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>PO Number</TableHead>
                      <TableHead>Order Date</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pos.map((po) => (
                      <TableRow
                        key={po.id}
                        className="cursor-pointer"
                        onClick={() =>
                          router.push(`/procurement/purchase-orders/${po.id}`)
                        }
                      >
                        <TableCell className="font-mono text-xs text-blue-700">
                          {po.poNumber}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(po.orderDate)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(po.expectedDate)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatMoney(po.grandTotal)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs whitespace-nowrap ${PO_STATUS_TONE[po.status]}`}
                          >
                            {po.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
