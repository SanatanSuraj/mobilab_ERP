import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading UI for the entire (dashboard) group.
 * Shown automatically by Next.js during page navigation + Suspense streaming.
 * Individual routes can override with their own loading.tsx.
 */
export default function DashboardLoading() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 animate-pulse">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48 rounded-lg" />
        <Skeleton className="h-4 w-80 rounded-md" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>

      {/* Main content area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
