"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * Route-level error boundary for the (dashboard) group.
 * Catches all uncaught errors thrown during rendering.
 * Must be "use client" — Next.js requirement for error.tsx.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // TODO: replace with real error logger (Sentry, Datadog, etc.)
    console.error("[Dashboard Error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <AlertTriangle className="h-8 w-8 text-red-600" />
      </div>

      <h2 className="text-xl font-semibold text-foreground mb-1">
        Something went wrong
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        {error.message || "An unexpected error occurred while loading this page."}
        {error.digest && (
          <span className="block mt-1 font-mono text-xs text-muted-foreground/60">
            Error ID: {error.digest}
          </span>
        )}
      </p>

      <div className="flex items-center gap-3">
        <Button onClick={reset} variant="default" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Try Again
        </Button>
        <Button onClick={() => router.push("/")} variant="outline" size="sm">
          <Home className="h-4 w-4 mr-2" />
          Dashboard
        </Button>
      </div>
    </div>
  );
}
