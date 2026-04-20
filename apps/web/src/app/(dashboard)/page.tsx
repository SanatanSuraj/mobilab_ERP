"use client";

import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore, UserRole } from "@/store/auth.store";

// Lazy load each dashboard — they are only parsed/executed when shown
const ManagementDashboard = lazy(() =>
  import("@/components/dashboard/ManagementDashboard").then((m) => ({
    default: m.ManagementDashboard,
  }))
);
const ProductionDashboard = lazy(() =>
  import("@/components/dashboard/ProductionDashboard").then((m) => ({
    default: m.ProductionDashboard,
  }))
);
const FinanceDashboard = lazy(() =>
  import("@/components/dashboard/FinanceDashboard").then((m) => ({
    default: m.FinanceDashboard,
  }))
);
const SalesDashboard = lazy(() =>
  import("@/components/dashboard/SalesDashboard").then((m) => ({
    default: m.SalesDashboard,
  }))
);
const QCDashboard = lazy(() =>
  import("@/components/dashboard/QCDashboard").then((m) => ({
    default: m.QCDashboard,
  }))
);
const StoresDashboard = lazy(() =>
  import("@/components/dashboard/StoresDashboard").then((m) => ({
    default: m.StoresDashboard,
  }))
);

type DashView = "MANAGEMENT" | "SALES_REP" | "PRODUCTION_MANAGER" | "FINANCE" | "QC_INSPECTOR" | "STORES";

// Map every UserRole to the closest dashboard view
const ROLE_TO_DASH: Record<UserRole, DashView> = {
  SUPER_ADMIN:        "MANAGEMENT",
  MANAGEMENT:         "MANAGEMENT",
  SALES_REP:          "SALES_REP",
  SALES_MANAGER:      "SALES_REP",
  FINANCE:            "FINANCE",
  PRODUCTION:         "PRODUCTION_MANAGER",
  PRODUCTION_MANAGER: "PRODUCTION_MANAGER",
  RD:                 "PRODUCTION_MANAGER",
  QC_INSPECTOR:       "QC_INSPECTOR",
  QC_MANAGER:         "QC_INSPECTOR",
  STORES:             "STORES",
  CUSTOMER:           "MANAGEMENT",
};

function DashboardFallback() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const storeRole = useAuthStore((s) => s.role);
  const dashView: DashView = storeRole ? ROLE_TO_DASH[storeRole] : "PRODUCTION_MANAGER";

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Viewing as: {storeRole?.replace(/_/g, " ") ?? "—"}
        </p>
      </div>
      <Suspense fallback={<DashboardFallback />}>
        {dashView === "MANAGEMENT" && <ManagementDashboard />}
        {dashView === "PRODUCTION_MANAGER" && <ProductionDashboard />}
        {dashView === "FINANCE" && <FinanceDashboard />}
        {dashView === "SALES_REP" && <SalesDashboard />}
        {dashView === "QC_INSPECTOR" && <QCDashboard />}
        {dashView === "STORES" && <StoresDashboard />}
      </Suspense>
    </div>
  );
}
