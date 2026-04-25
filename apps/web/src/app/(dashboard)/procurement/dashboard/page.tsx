"use client";

/**
 * Procurement dashboard.
 *
 * Cards reflect the live aggregate from `/procurement/overview`:
 *   - Total POs       all purchase orders (excluding soft-deleted)
 *   - Pending POs     status = PENDING_APPROVAL — awaiting approver action
 *   - Total GRNs      all goods receipts on file
 *   - Pending indents SUBMITTED + APPROVED but not yet CONVERTED to a PO
 *
 * No mock data. The page falls back to skeletons while the query loads
 * and an explicit error banner if the request fails.
 */

import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiProcurementOverview } from "@/hooks/useProcurementApi";
import {
  AlertCircle,
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  ShoppingCart,
} from "lucide-react";

export default function ProcurementDashboardPage() {
  const overviewQuery = useApiProcurementOverview();

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Procurement"
        description="End-to-end purchase lifecycle management"
      />

      {overviewQuery.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : overviewQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Failed to load procurement overview
            </p>
            <p className="text-red-700 mt-1">
              {overviewQuery.error instanceof Error
                ? overviewQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total POs"
            value={(overviewQuery.data?.totalPOs ?? 0).toLocaleString()}
            icon={ShoppingCart}
            iconColor="text-blue-600"
          />
          <KPICard
            title="Pending POs"
            value={(overviewQuery.data?.pendingPOs ?? 0).toLocaleString()}
            icon={ClipboardCheck}
            iconColor={
              (overviewQuery.data?.pendingPOs ?? 0) > 0
                ? "text-amber-600"
                : "text-gray-500"
            }
            change={
              (overviewQuery.data?.pendingPOs ?? 0) > 0
                ? "Awaiting approval"
                : "All approved"
            }
            trend={
              (overviewQuery.data?.pendingPOs ?? 0) > 0 ? "up" : "neutral"
            }
          />
          <KPICard
            title="Total GRNs"
            value={(overviewQuery.data?.totalGRNs ?? 0).toLocaleString()}
            icon={PackageCheck}
            iconColor="text-emerald-600"
          />
          <KPICard
            title="Pending indents"
            value={(overviewQuery.data?.pendingIndents ?? 0).toLocaleString()}
            icon={ClipboardList}
            iconColor={
              (overviewQuery.data?.pendingIndents ?? 0) > 0
                ? "text-amber-600"
                : "text-gray-500"
            }
            change={
              (overviewQuery.data?.pendingIndents ?? 0) > 0
                ? "Not yet on a PO"
                : "All converted"
            }
            trend={
              (overviewQuery.data?.pendingIndents ?? 0) > 0 ? "up" : "neutral"
            }
          />
        </div>
      )}

      {/* Quick links into the underlying lists. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group rounded-lg border bg-card hover:bg-muted/50 transition-colors p-4 flex items-start justify-between gap-3"
          >
            <div className="space-y-0.5 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {link.title}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {link.description}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 mt-0.5" />
          </Link>
        ))}
      </div>

      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        Looking for spend, on-time delivery, or vendor breakdowns?{" "}
        <Link
          href="/procurement/reports"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          Open the reports view
        </Link>
        .
      </div>
    </div>
  );
}

const QUICK_LINKS = [
  {
    title: "Indents",
    href: "/procurement/indents",
    description: "Material requirement requests from production / stores.",
  },
  {
    title: "Purchase Orders",
    href: "/procurement/purchase-orders",
    description: "Vendor commitments, approvals, and dispatch tracking.",
  },
  {
    title: "Inward & Gate Entry",
    href: "/procurement/inward",
    description: "Goods received notes and gate-pass capture.",
  },
  {
    title: "Approvals",
    href: "/approvals",
    description: "Cross-module pending approvals across all entities.",
  },
] as const;
