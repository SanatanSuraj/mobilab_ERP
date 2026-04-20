import React from "react";
import { cn } from "@/lib/utils";

export type DetailPageLayoutProps = {
  breadcrumb?: React.ReactNode;
  header: React.ReactNode;
  alerts?: React.ReactNode;
  mainContent: React.ReactNode;
  sidePanel?: React.ReactNode;
  maxWidth?: string;
};

export function DetailPageLayout({
  breadcrumb,
  header,
  alerts,
  mainContent,
  sidePanel,
  maxWidth = "max-w-screen-2xl",
}: DetailPageLayoutProps) {
  return (
    <div className={cn("mx-auto w-full px-4 py-6 space-y-4", maxWidth)}>
      {/* Breadcrumb */}
      {breadcrumb && <div>{breadcrumb}</div>}

      {/* Page header */}
      <div>{header}</div>

      {/* Full-width alerts */}
      {alerts && <div>{alerts}</div>}

      {/* Main grid */}
      <div
        className={cn(
          "grid gap-6",
          sidePanel ? "lg:grid-cols-[1fr_320px]" : "lg:grid-cols-1"
        )}
      >
        {/* Left — main content */}
        <div className="min-w-0">{mainContent}</div>

        {/* Right — side panel */}
        {sidePanel && (
          <aside className="lg:sticky lg:top-4 space-y-4 self-start">
            {sidePanel}
          </aside>
        )}
      </div>
    </div>
  );
}
