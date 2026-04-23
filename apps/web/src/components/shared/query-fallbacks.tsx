/**
 * Shared loading + error fallbacks for React Query–backed pages.
 *
 * Minimal, accessible, and intentionally unstyled beyond the existing
 * surface tokens — these are reused across the migrated dashboard modules
 * (inventory, finance, mfg, procurement, qc, notifications) so all pages
 * present a consistent shape while we migrate the data layer.
 *
 * Use `role="status"` for loading so screen readers announce progress and
 * `role="alert"` for errors so they're announced immediately. Skeleton UI
 * can still be rendered by individual pages via <Skeleton/> — these two
 * components are the fallback for every other screen that does not need
 * a custom skeleton.
 */

interface LoadingFallbackProps {
  label?: string;
  className?: string;
}

export function LoadingFallback({
  label = "Loading…",
  className,
}: LoadingFallbackProps) {
  return (
    <div className={className ?? "p-6"}>
      <p role="status" className="text-sm text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

interface ErrorFallbackProps {
  error: unknown;
  label?: string;
  className?: string;
}

export function ErrorFallback({
  error,
  label = "Failed to load data",
  className,
}: ErrorFallbackProps) {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <div className={className ?? "p-6"}>
      <p role="alert" className="text-sm text-red-700">
        {label}: {message}
      </p>
    </div>
  );
}
