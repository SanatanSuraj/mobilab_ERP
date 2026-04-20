import Link from "next/link";
import { FileQuestion } from "lucide-react";

/**
 * Global 404 page — shown for all unmatched routes.
 * Keeps branded UI instead of a blank browser page.
 * Must be a server component — no "use client".
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/20 p-6 text-center">
      <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
        <FileQuestion className="h-10 w-10 text-primary" />
      </div>

      <p className="text-7xl font-bold text-muted-foreground/20 mb-2 tabular-nums">404</p>
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-sm text-muted-foreground max-w-sm mb-8">
        The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have
        permission to view it.
      </p>

      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
