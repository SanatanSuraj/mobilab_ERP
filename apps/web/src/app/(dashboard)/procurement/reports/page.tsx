"use client";

// TODO(phase-5): Procurement analytics has no dedicated backend aggregation
// yet. useApiPurchaseOrders / useApiGrns / useApiVendors already exist but
// vendor scorecards, spend-by-category, on-time-delivery rollups need
// server-side aggregation. Expected routes:
//   GET /procurement/reports/vendor-scorecards
//   GET /procurement/reports/spend-summary?from=&to=&groupBy=category
//   GET /procurement/reports/on-time-delivery
// Mock imports left in place until the reporting slice ships in
// apps/api/src/modules/procurement.

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  purchaseOrders,
  procurementGRNs,
  vendors,
  PurchaseOrder,
  GRN,
  Vendor,
  formatCurrency,
  formatDate,
  getRatingColor,
} from "@/data/procurement-mock";
import {
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Ban,
  FileText,
  CheckCircle2,
  Package,
} from "lucide-react";

// ── Helpers ─────────────────────────────────────────────────────────────────

function trendArrow(prev: number, curr: number) {
  if (curr > prev)
    return <span className="text-green-600 font-bold text-base">↑</span>;
  if (curr < prev)
    return <span className="text-red-600 font-bold text-base">↓</span>;
  return <span className="text-gray-400">→</span>;
}

function getRatingBarColor(score: number): string {
  if (score >= 85) return "bg-green-500";
  if (score >= 70) return "bg-amber-500";
  if (score >= 60) return "bg-orange-500";
  return "bg-red-500";
}

// ── Purchase Register Tab ────────────────────────────────────────────────────

const poColumns: Column<PurchaseOrder>[] = [
  {
    key: "poNumber",
    header: "PO Number",
    sortable: true,
    render: (row) => (
      <span className="font-mono font-bold text-sm">{row.poNumber}</span>
    ),
  },
  { key: "vendorName", header: "Vendor", sortable: true },
  {
    key: "createdAt",
    header: "Date",
    sortable: true,
    render: (row) => <span className="text-sm">{formatDate(row.createdAt)}</span>,
  },
  {
    key: "requiredDeliveryDate",
    header: "Required Delivery",
    render: (row) => (
      <span className="text-sm">{formatDate(row.requiredDeliveryDate)}</span>
    ),
  },
  {
    key: "lines",
    header: "Lines",
    render: (row) => (
      <span className="text-sm text-muted-foreground">{row.lines.length}</span>
    ),
  },
  {
    key: "totalValue",
    header: "Total Value",
    className: "text-right",
    render: (row) => (
      <span className="font-medium text-sm">{formatCurrency(row.totalValue)}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusBadge status={row.status} />,
  },
];

function PurchaseRegisterTab() {
  const totalPOValue = purchaseOrders.reduce((s, p) => s + p.totalValue, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Filters:</span>
        <span className="px-2.5 py-1 rounded-md border bg-muted/40">
          Date Range: All Time
        </span>
        <span className="px-2.5 py-1 rounded-md border bg-muted/40">
          Status: All
        </span>
        <span className="px-2.5 py-1 rounded-md border bg-muted/40">
          Vendor: All
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            data={purchaseOrders}
            columns={poColumns}
            searchKey="vendorName"
            searchPlaceholder="Search by vendor…"
          />
        </CardContent>
      </Card>

      {/* Summary Row */}
      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              Total PO Value ({purchaseOrders.length} POs)
            </span>
            <span className="text-lg font-bold">
              {formatCurrency(totalPOValue)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Vendor Performance Tab ───────────────────────────────────────────────────

function VendorPerformanceTab() {
  const sorted = [...vendors].sort((a, b) => b.ratingScore - a.ratingScore);
  const onProbation = vendors.filter((v) => v.status === "ON_PROBATION");
  const blacklisted = vendors.filter((v) => v.status === "BLACKLISTED");

  return (
    <div className="space-y-5">
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Vendor Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">QC Pass Rate</TableHead>
              <TableHead className="text-right">On-Time Rate</TableHead>
              <TableHead className="text-right">Rejection Rate</TableHead>
              <TableHead className="w-40">Score</TableHead>
              <TableHead className="text-center">Trend</TableHead>
              <TableHead className="text-right">Total PO Value</TableHead>
              <TableHead className="text-right">GRNs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((vendor, idx) => {
              const periods = vendor.ratingPeriods;
              const prev =
                periods.length >= 2
                  ? periods[periods.length - 2].score
                  : vendor.ratingScore;
              const curr =
                periods.length >= 1
                  ? periods[periods.length - 1].score
                  : vendor.ratingScore;
              const lastPeriod =
                periods.length >= 1
                  ? periods[periods.length - 1]
                  : null;

              return (
                <TableRow key={vendor.id}>
                  <TableCell className="font-mono text-muted-foreground text-sm">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{vendor.tradeName}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {vendor.code}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{vendor.category}</TableCell>
                  <TableCell>
                    <StatusBadge status={vendor.status} />
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium text-green-700">
                    {lastPeriod?.qcPassRate ?? "—"}%
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {lastPeriod?.onTimeRate ?? "—"}%
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium text-red-600">
                    {lastPeriod?.rejectionRate ?? "—"}%
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all ${getRatingBarColor(vendor.ratingScore)}`}
                          style={{ width: `${vendor.ratingScore}%` }}
                        />
                      </div>
                      <span
                        className={`text-xs font-bold ${getRatingColor(vendor.ratingScore)}`}
                      >
                        {vendor.ratingScore}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {trendArrow(prev, curr)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {formatCurrency(vendor.totalPOValue)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {vendor.totalGRNs}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Probation Alert */}
      {onProbation.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">
              Vendors on Probation
            </span>
          </div>
          {onProbation.map((v) => (
            <div key={v.id} className="text-sm text-amber-700 ml-6">
              <span className="font-medium">{v.tradeName}</span> —{" "}
              Score: {v.ratingScore} | QC Pass:{" "}
              {v.ratingPeriods.at(-1)?.qcPassRate}%
            </div>
          ))}
        </div>
      )}

      {/* Blacklisted Alert */}
      {blacklisted.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Ban className="h-4 w-4 text-red-600" />
            <span className="text-sm font-semibold text-red-800">
              Blacklisted Vendors — No orders allowed
            </span>
          </div>
          {blacklisted.map((v) => (
            <div key={v.id} className="text-sm text-red-700 ml-6">
              <span className="font-medium">{v.tradeName}</span> —{" "}
              Score: {v.ratingScore} | Rejection Rate:{" "}
              {v.ratingPeriods.at(-1)?.rejectionRate}%
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── GRN Register Tab ─────────────────────────────────────────────────────────

function GRNRegisterTab() {
  const totalGRNValue = procurementGRNs.reduce(
    (s, g) => s + g.totalAcceptedValue,
    0
  );

  const avgAcceptanceRate =
    procurementGRNs.length > 0
      ? Math.round(
          procurementGRNs.reduce((sum, g) => {
            const totalQty = g.lines.reduce(
              (s, l) => s + l.qtyAccepted + l.qtyRejected,
              0
            );
            const accepted = g.lines.reduce((s, l) => s + l.qtyAccepted, 0);
            return sum + (totalQty > 0 ? (accepted / totalQty) * 100 : 100);
          }, 0) / procurementGRNs.length
        )
      : 0;

  const grnColumns: Column<GRN>[] = [
    {
      key: "grnNumber",
      header: "GRN Number",
      sortable: true,
      render: (row) => (
        <span className="font-mono font-bold text-sm">{row.grnNumber}</span>
      ),
    },
    {
      key: "poNumber",
      header: "PO Number",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.poNumber}
        </span>
      ),
    },
    { key: "vendorName", header: "Vendor", sortable: true },
    { key: "warehouseName", header: "Warehouse" },
    {
      key: "createdAt",
      header: "Date",
      render: (row) => (
        <span className="text-sm">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "totalAcceptedValue",
      header: "Total Value",
      className: "text-right",
      render: (row) => (
        <span className="font-medium text-sm">
          {formatCurrency(row.totalAcceptedValue)}
        </span>
      ),
    },
    {
      key: "qcResult",
      header: "QC Result",
      render: (row) => {
        const results = [...new Set(row.lines.map((l) => l.qcResult))];
        return (
          <div className="flex flex-wrap gap-1">
            {results.map((r) => (
              <StatusBadge key={r} status={r} />
            ))}
          </div>
        );
      },
    },
    {
      key: "purchaseInvoiceDraft",
      header: "Purchase Invoice",
      render: (row) =>
        row.purchaseInvoiceDraft ? (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 text-xs font-mono"
          >
            {row.purchaseInvoiceDraft}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
          >
            Draft Pending
          </Badge>
        ),
    },
    {
      key: "stockUpdated",
      header: "Stock",
      render: (row) =>
        row.stockUpdated ? (
          <span className="text-green-700 text-xs font-medium">
            ✓ Updated
          </span>
        ) : (
          <span className="text-amber-600 text-xs font-medium">Pending</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <KPICard
          title="Total GRN Value"
          value={formatCurrency(totalGRNValue)}
          icon={FileText}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Avg. Acceptance Rate"
          value={`${avgAcceptanceRate}%`}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
      </div>
      <Card>
        <CardContent className="p-0">
          <DataTable
            data={procurementGRNs}
            columns={grnColumns}
            searchKey="vendorName"
            searchPlaceholder="Search by vendor…"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Spend Analysis Tab ───────────────────────────────────────────────────────

function SpendAnalysisTab() {
  // Spend by vendor
  const vendorSpend = vendors
    .map((v) => ({
      name: v.tradeName,
      value: v.totalPOValue,
      category: v.category,
    }))
    .filter((v) => v.value > 0)
    .sort((a, b) => b.value - a.value);

  const maxVendorSpend = vendorSpend[0]?.value ?? 1;

  // Spend by category
  const categoryMap: Record<string, number> = {};
  vendors.forEach((v) => {
    if (v.totalPOValue > 0) {
      categoryMap[v.category] = (categoryMap[v.category] ?? 0) + v.totalPOValue;
    }
  });
  const categorySpend = Object.entries(categoryMap)
    .map(([cat, value]) => ({ cat, value }))
    .sort((a, b) => b.value - a.value);
  const maxCatSpend = categorySpend[0]?.value ?? 1;

  // Open vs Closed POs
  const openStatuses = [
    "DRAFT",
    "PENDING_FINANCE",
    "PENDING_MGMT",
    "APPROVED",
    "PO_SENT",
    "PARTIALLY_RECEIVED",
  ];
  const closedStatuses = ["FULFILLED", "CANCELLED", "AMENDED"];

  const openValue = purchaseOrders
    .filter((p) => openStatuses.includes(p.status))
    .reduce((s, p) => s + p.totalValue, 0);
  const closedValue = purchaseOrders
    .filter((p) => closedStatuses.includes(p.status))
    .reduce((s, p) => s + p.totalValue, 0);

  const BAR_COLORS = [
    "bg-blue-500",
    "bg-indigo-500",
    "bg-violet-500",
    "bg-cyan-500",
    "bg-teal-500",
    "bg-emerald-500",
  ];

  return (
    <div className="space-y-6">
      {/* Open vs Closed */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-700">
              Open PO Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-800">
              {formatCurrency(openValue)}
            </div>
            <div className="text-xs text-amber-600 mt-1">
              {purchaseOrders.filter((p) => openStatuses.includes(p.status)).length}{" "}
              open purchase orders
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-green-700">
              Closed PO Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-800">
              {formatCurrency(closedValue)}
            </div>
            <div className="text-xs text-green-600 mt-1">
              {purchaseOrders.filter((p) => closedStatuses.includes(p.status)).length}{" "}
              closed purchase orders
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Spend by Vendor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend by Vendor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {vendorSpend.map((item, idx) => (
            <div key={item.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground font-mono">
                  {formatCurrency(item.value)}
                </span>
              </div>
              <div className="h-6 bg-gray-100 rounded-md overflow-hidden">
                <div
                  className={`h-full rounded-md transition-all ${
                    BAR_COLORS[idx % BAR_COLORS.length]
                  }`}
                  style={{
                    width: `${Math.max(2, (item.value / maxVendorSpend) * 100)}%`,
                  }}
                />
              </div>
              <div className="text-xs text-muted-foreground">{item.category}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Spend by Category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend by Category</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {categorySpend.map((item, idx) => (
            <div key={item.cat} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{item.cat}</span>
                <span className="text-muted-foreground font-mono">
                  {formatCurrency(item.value)}
                </span>
              </div>
              <div className="h-6 bg-gray-100 rounded-md overflow-hidden">
                <div
                  className={`h-full rounded-md transition-all ${
                    BAR_COLORS[idx % BAR_COLORS.length]
                  }`}
                  style={{
                    width: `${Math.max(2, (item.value / maxCatSpend) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProcurementReportsPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Procurement Reports"
        description="Spend analysis, vendor performance, and fulfilment tracking"
      />

      <Tabs defaultValue="purchase-register">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="purchase-register">Purchase Register</TabsTrigger>
          <TabsTrigger value="vendor-performance">Vendor Performance</TabsTrigger>
          <TabsTrigger value="grn-register">GRN Register</TabsTrigger>
          <TabsTrigger value="spend-analysis">Spend Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="purchase-register" className="mt-5">
          <PurchaseRegisterTab />
        </TabsContent>

        <TabsContent value="vendor-performance" className="mt-5">
          <VendorPerformanceTab />
        </TabsContent>

        <TabsContent value="grn-register" className="mt-5">
          <GRNRegisterTab />
        </TabsContent>

        <TabsContent value="spend-analysis" className="mt-5">
          <SpendAnalysisTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
