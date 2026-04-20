"use client";

import React from "react";
import { Lock, Shield, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";

export type WIPStageRowStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "QC_HOLD"
  | "REWORK"
  | "COMPLETED"
  | "SKIPPED";

export type WIPStageRowProps = {
  stageName: string;
  stageOrder: number;
  status: WIPStageRowStatus;
  requiresQCSignOff: boolean;
  qcInspectionId?: string;
  qcResult?: "PASS" | "FAIL";
  operatorName?: string;
  plannedDurationMin?: number;
  actualDurationMin?: number;
  reworkCount?: number;
  startedAt?: string;
  completedAt?: string;
  onAdvance?: () => void;
  onRequestQC?: () => void;
  canAdvance?: boolean;
};

export function WIPStageRow({
  stageName,
  stageOrder,
  status,
  requiresQCSignOff,
  qcInspectionId,
  qcResult,
  operatorName,
  plannedDurationMin,
  actualDurationMin,
  reworkCount = 0,
  startedAt,
  completedAt,
  onAdvance,
  onRequestQC,
  canAdvance = false,
}: WIPStageRowProps) {
  const isBlocked = requiresQCSignOff && !qcInspectionId && status !== "COMPLETED" && status !== "SKIPPED";
  const isGated = requiresQCSignOff;
  const hasQCPass = qcResult === "PASS";
  const reworkLimitExceeded = reworkCount >= 3;

  const isDurationOverrun =
    actualDurationMin !== undefined &&
    plannedDurationMin !== undefined &&
    actualDurationMin > plannedDurationMin * 1.2;

  return (
    <tr
      className={cn(
        "border-b transition-colors",
        isBlocked && "bg-amber-50",
        !isBlocked && status === "COMPLETED" && "bg-green-50/30",
        !isBlocked && status === "QC_HOLD" && "bg-orange-50"
      )}
    >
      {/* Stage # */}
      <td className="p-2 text-sm font-medium text-muted-foreground w-12">
        {stageOrder}
      </td>

      {/* Stage name */}
      <td className="p-2">
        <div className="flex items-center gap-2">
          {isBlocked && <Lock className="h-4 w-4 text-amber-500 flex-shrink-0" />}
          <span className="text-sm font-medium">{stageName}</span>
          {reworkLimitExceeded && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 uppercase tracking-wide">
              Rework Limit
            </span>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="p-2">
        <StatusBadge status={status} />
      </td>

      {/* QC Gate */}
      <td className="p-2">
        {isGated && (
          <div className="flex items-center gap-1">
            <Shield className="h-4 w-4 text-purple-600" />
            {hasQCPass && (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
          </div>
        )}
      </td>

      {/* Operator */}
      <td className="p-2 text-sm text-muted-foreground">
        {operatorName ?? "—"}
      </td>

      {/* Duration */}
      <td className="p-2">
        {actualDurationMin !== undefined || plannedDurationMin !== undefined ? (
          <span
            className={cn(
              "text-sm font-mono",
              isDurationOverrun ? "text-amber-700 font-semibold" : "text-foreground"
            )}
          >
            {actualDurationMin !== undefined ? `${actualDurationMin}m` : "—"}
            {plannedDurationMin !== undefined && (
              <span className="text-muted-foreground font-normal">
                {" "}/ {plannedDurationMin}m
              </span>
            )}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </td>

      {/* Rework count */}
      <td className="p-2 text-sm text-center">
        {reworkCount > 0 ? (
          <span className={cn("font-semibold", reworkCount >= 3 ? "text-red-600" : "text-amber-600")}>
            {reworkCount}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>

      {/* Dates */}
      <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
        {startedAt && <div>Start: {startedAt}</div>}
        {completedAt && <div>End: {completedAt}</div>}
      </td>

      {/* Action */}
      <td className="p-2">
        {isBlocked ? (
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-800 hover:bg-amber-100 text-xs"
            onClick={onRequestQC}
          >
            Request QC Inspection
          </Button>
        ) : canAdvance && status !== "COMPLETED" && status !== "SKIPPED" ? (
          <Button size="sm" variant="default" className="text-xs" onClick={onAdvance}>
            Advance
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
