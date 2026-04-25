"use client";

/**
 * GST Reports — derives GSTR-1 / GSTR-3B summary from sales_invoices and
 * purchase_invoices.
 *
 * The GSTN return engine (filing JSON, error codes, ITC reconciliation)
 * is a Phase-5 task. Until then this page rolls up the same numbers an
 * accountant would punch into the offline tool: taxable value, tax
 * collected, tax paid, net liability, period-over-period.
 *
 * Reuses useApiSalesInvoices + useApiPurchaseInvoices — no new endpoints.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useApiSalesInvoices,
  useApiPurchaseInvoices,
} from "@/hooks/useFinanceApi";
import type { SalesInvoice, PurchaseInvoice } from "@instigenie/contracts";
import {
  IndianRupee,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calculator,
} from "lucide-react";

function n(v: string | null | undefined): number {
  if (v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function inr(v: number): string {
  if (v >= 1_00_00_000)
    return `₹${(v / 1_00_00_000).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}Cr`;
  if (v >= 1_00_000)
    return `₹${(v / 1_00_000).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}L`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

type Period = "thisMonth" | "lastMonth" | "fy";

function periodRange(p: Period): { from: string; to: string; label: string } {
  const now = new Date();
  if (p === "thisMonth") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      label: from.toLocaleString("en-IN", { month: "long", year: "numeric" }),
    };
  }
  if (p === "lastMonth") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      label: from.toLocaleString("en-IN", { month: "long", year: "numeric" }),
    };
  }
  // Indian FY: April–March.
  const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const from = new Date(fyStartYear, 3, 1);
  const to = new Date(fyStartYear + 1, 2, 31);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)}`,
  };
}

function inDateRange(iso: string | null, from: string, to: string): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= from && d <= to;
}

export default function GSTReportsPage() {
  const [period, setPeriod] = useState<Period>("thisMonth");
  const range = periodRange(period);

  const salesQuery = useApiSalesInvoices(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "invoiceDate" as const,
        sortDir: "desc" as const,
      }),
      []
    )
  );
  const purchasesQuery = useApiPurchaseInvoices(
    useMemo(
      () => ({
        limit: 200,
        sortBy: "invoiceDate" as const,
        sortDir: "desc" as const,
      }),
      []
    )
  );

  if (salesQuery.isLoading || purchasesQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        <PageHeader
          title="GST Reports"
          description="GSTR-1 outward supplies, GSTR-3B summary, ITC register"
        />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const sales = (salesQuery.data?.data ?? []).filter((s) =>
    inDateRange(s.invoiceDate, range.from, range.to)
  );
  const purchases = (purchasesQuery.data?.data ?? []).filter((p) =>
    inDateRange(p.invoiceDate, range.from, range.to)
  );

  const outwardTaxable = sales.reduce(
    (acc, s) => acc + n(s.subtotal) - n(s.discountTotal),
    0
  );
  const outwardTax = sales.reduce((acc, s) => acc + n(s.taxTotal), 0);
  const inwardTax = purchases.reduce((acc, p) => acc + n(p.taxTotal), 0);
  const netLiability = Math.max(0, outwardTax - inwardTax);

  const salesColumns: Column<SalesInvoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.invoiceNumber}</span>
      ),
    },
    {
      key: "invoiceDate",
      header: "Date",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.invoiceDate}</span>
      ),
    },
    {
      key: "customerName",
      header: "Customer",
      render: (r) => (
        <div>
          <p className="text-sm leading-tight">{r.customerName ?? "—"}</p>
          {r.customerGstin && (
            <p className="font-mono text-[10px] text-muted-foreground">
              {r.customerGstin}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "placeOfSupply",
      header: "POS",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.placeOfSupply ?? "—"}
        </span>
      ),
    },
    {
      key: "subtotal",
      header: "Taxable",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono">
          {inr(n(r.subtotal) - n(r.discountTotal))}
        </span>
      ),
    },
    {
      key: "taxTotal",
      header: "GST",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono text-amber-700">
          {inr(n(r.taxTotal))}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono font-semibold">
          {inr(n(r.grandTotal))}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  const purchaseColumns: Column<PurchaseInvoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      render: (r) => (
        <span className="font-mono text-xs font-bold">{r.invoiceNumber}</span>
      ),
    },
    {
      key: "invoiceDate",
      header: "Date",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.invoiceDate}</span>
      ),
    },
    {
      key: "vendorName",
      header: "Vendor",
      render: (r) => (
        <div>
          <p className="text-sm leading-tight">{r.vendorName ?? "—"}</p>
          {r.vendorGstin && (
            <p className="font-mono text-[10px] text-muted-foreground">
              {r.vendorGstin}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "subtotal",
      header: "Taxable",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono">
          {inr(n(r.subtotal) - n(r.discountTotal))}
        </span>
      ),
    },
    {
      key: "taxTotal",
      header: "ITC",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono text-green-700">
          {inr(n(r.taxTotal))}
        </span>
      ),
    },
    {
      key: "grandTotal",
      header: "Total",
      className: "text-right",
      render: (r) => (
        <span className="text-sm font-mono font-semibold">
          {inr(n(r.grandTotal))}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="GST Reports"
        description={`GSTR-1 outward supplies, GSTR-3B summary, ITC — ${range.label}`}
      />

      <div className="flex items-center justify-end">
        <Select
          value={period}
          onValueChange={(v) => setPeriod((v ?? "thisMonth") as Period)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="thisMonth">This Month</SelectItem>
            <SelectItem value="lastMonth">Last Month</SelectItem>
            <SelectItem value="fy">Current FY</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Outward Taxable"
          value={inr(outwardTaxable)}
          icon={ArrowUpFromLine}
          iconColor="text-blue-600"
        />
        <KPICard
          title="GST Collected"
          value={inr(outwardTax)}
          icon={IndianRupee}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Inward / ITC"
          value={inr(inwardTax)}
          icon={ArrowDownToLine}
          iconColor="text-green-600"
        />
        <KPICard
          title="Net GST Liability"
          value={inr(netLiability)}
          icon={Calculator}
          iconColor="text-red-600"
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">
          GSTR-1 — Outward Supplies ({sales.length})
        </h2>
        <DataTable<SalesInvoice>
          data={sales}
          columns={salesColumns}
          searchKey="invoiceNumber"
          searchPlaceholder="Search invoice #..."
          pageSize={10}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">
          ITC — Inward Supplies ({purchases.length})
        </h2>
        <DataTable<PurchaseInvoice>
          data={purchases}
          columns={purchaseColumns}
          searchKey="invoiceNumber"
          searchPlaceholder="Search invoice #..."
          pageSize={10}
        />
      </div>
    </div>
  );
}
