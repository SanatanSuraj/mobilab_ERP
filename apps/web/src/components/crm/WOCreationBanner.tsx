"use client";

import React from "react";
import { CheckCircle2, AlertTriangle, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WOCreationState = "CREATING" | "CREATED" | "ERROR";

export type WOCreationBannerProps = {
  state: WOCreationState;
  workOrderPid?: string;
  workOrderId?: string;
  mrpStatus?: "RUNNING" | "COMPLETE";
  reservedItems?: number;
  shortfallItems?: number;
  onViewWO?: () => void;
};

export function WOCreationBanner({
  state,
  workOrderPid,
  workOrderId,
  mrpStatus,
  reservedItems,
  shortfallItems,
  onViewWO,
}: WOCreationBannerProps) {
  if (state === "CREATING") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-500 flex-shrink-0" />
        <p className="text-sm font-medium text-blue-800">
          Work Order being created automatically&hellip;
        </p>
      </div>
    );
  }

  if (state === "ERROR") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
        <p className="text-sm font-medium text-red-800">
          Work Order creation failed. Please create it manually.
        </p>
      </div>
    );
  }

  // CREATED state
  return (
    <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
        <p className="text-sm font-semibold text-green-800">
          Deal Won — Work Order Created Automatically
        </p>
      </div>

      {/* Details */}
      <div className="space-y-1.5 pl-7">
        {/* WO ID + View button */}
        {workOrderPid && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold text-green-900">
              {workOrderPid}
            </span>
            {onViewWO && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-green-700 font-medium text-sm"
                onClick={onViewWO}
              >
                View Work Order &rarr;
              </Button>
            )}
          </div>
        )}

        {/* WO Created row */}
        <div className="flex items-center gap-1.5 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span>Work Order Created</span>
        </div>

        {/* MRP status row */}
        <div className={cn("flex items-center gap-1.5 text-sm", mrpStatus === "COMPLETE" ? "text-green-800" : "text-amber-800")}>
          {mrpStatus === "COMPLETE" ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          )}
          <span>
            {mrpStatus === "COMPLETE"
              ? "MRP Complete"
              : "MRP Running \u2014 components being checked"}
          </span>
        </div>

        {/* Inventory summary */}
        {(reservedItems !== undefined || shortfallItems !== undefined) && (
          <div className="flex items-center gap-2 text-sm flex-wrap">
            {reservedItems !== undefined && (
              <span className="flex items-center gap-1 text-green-800">
                <Package className="h-4 w-4" />
                {reservedItems} item{reservedItems !== 1 ? "s" : ""} reserved
              </span>
            )}
            {shortfallItems !== undefined && shortfallItems > 0 && (
              <span className="flex items-center gap-1 text-amber-700 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {shortfallItems} item{shortfallItems !== 1 ? "s" : ""} need{shortfallItems === 1 ? "s" : ""} procurement
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
