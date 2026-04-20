"use client";

import React from "react";
import { AlertTriangle, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BlockedStateBannerProps = {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: "warning" | "error" | "info";
};

const variantConfig = {
  warning: {
    icon: AlertTriangle,
    container: "bg-amber-50 border border-amber-200 text-amber-800",
    iconClass: "text-amber-500",
    buttonVariant: "outline" as const,
    buttonClass: "border-amber-300 text-amber-800 hover:bg-amber-100",
  },
  error: {
    icon: XCircle,
    container: "bg-red-50 border border-red-200 text-red-800",
    iconClass: "text-red-500",
    buttonVariant: "outline" as const,
    buttonClass: "border-red-300 text-red-800 hover:bg-red-100",
  },
  info: {
    icon: Info,
    container: "bg-blue-50 border border-blue-200 text-blue-800",
    iconClass: "text-blue-500",
    buttonVariant: "outline" as const,
    buttonClass: "border-blue-300 text-blue-800 hover:bg-blue-100",
  },
};

export function BlockedStateBanner({
  title,
  description,
  action,
  variant = "warning",
}: BlockedStateBannerProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div className={cn("flex items-start gap-3 rounded-lg p-4", config.container)}>
      <Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", config.iconClass)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-snug">{title}</p>
        {description && (
          <p className="mt-0.5 text-sm opacity-80 leading-snug">{description}</p>
        )}
      </div>
      {action && (
        <Button
          variant={config.buttonVariant}
          size="sm"
          className={cn("flex-shrink-0", config.buttonClass)}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
