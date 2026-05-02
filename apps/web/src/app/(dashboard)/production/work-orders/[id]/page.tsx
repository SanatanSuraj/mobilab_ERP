"use client";

/**
 * Work Order detail — reads /production/work-orders/:id (returns
 * WorkOrderWithStages) via useApiWorkOrder.
 *
 * Capabilities:
 *   - Update WO status (PLANNED → MATERIAL_CHECK → IN_PROGRESS, then
 *     COMPLETE / CANCEL) with optimistic concurrency.
 *   - Advance WIP stages through a 5-action mini-lifecycle:
 *       START → COMPLETE → QC_PASS / QC_FAIL → REWORK_DONE.
 *     Server enforces sequential ordering, QC gate, and auto-bubbles
 *     status into the parent WO.
 *   - Displays PID, product, BOM version label, device serials, and the
 *     full ordered stage list.
 *
 * Deltas vs manufacturing-mock prototype:
 *   - No MRP lines / no component assignments / no unit-level component
 *     traceability panel — those are Phase 3 concerns.
 *   - Activity feed is derived from WO/stage timestamps only.
 */

import { memo, use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiAdvanceWipStage,
  useApiProduct,
  useApiUpdateWorkOrder,
  useApiWorkOrder,
} from "@/hooks/useProductionApi";
import type {
  AdvanceWipStage,
  WipStage,
  WipStageStatus,
  WoPriority,
  WoStatus,
} from "@instigenie/contracts";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Hash,
  Link2,
  Loader2,
  Package,
  RotateCcw,
  Shield,
  User,
} from "lucide-react";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const WO_STATUS_TONE: Record<WoStatus, string> = {
  PLANNED: "bg-gray-50 text-gray-700 border-gray-200",
  MATERIAL_CHECK: "bg-amber-50 text-amber-700 border-amber-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  QC_HOLD: "bg-orange-50 text-orange-700 border-orange-200",
  REWORK: "bg-red-50 text-red-700 border-red-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
  CANCELLED: "bg-slate-50 text-slate-700 border-slate-200",
};

const WO_PRIORITY_TONE: Record<WoPriority, string> = {
  LOW: "bg-slate-50 text-slate-600 border-slate-200",
  NORMAL: "bg-gray-50 text-gray-700 border-gray-200",
  HIGH: "bg-amber-50 text-amber-700 border-amber-200",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
};

const STAGE_STATUS_TONE: Record<WipStageStatus, string> = {
  PENDING: "bg-gray-50 text-gray-600 border-gray-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  QC_HOLD: "bg-orange-50 text-orange-700 border-orange-200",
  REWORK: "bg-red-50 text-red-700 border-red-200",
  COMPLETED: "bg-green-50 text-green-700 border-green-200",
};

export default function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const woQuery = useApiWorkOrder(id);
  const wo = woQuery.data;
  const productQuery = useApiProduct(wo?.productId);

  const updateWo = useApiUpdateWorkOrder(id);
  const advanceStage = useApiAdvanceWipStage(id);

  // Dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (woQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (woQuery.isError || !wo) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              {woQuery.isError
                ? "Failed to load work order"
                : "Work order not found"}
            </p>
            {woQuery.isError && (
              <p className="text-red-700 mt-1">
                {woQuery.error instanceof Error
                  ? woQuery.error.message
                  : "Unknown error"}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/production/work-orders")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Work Orders
        </Button>
      </div>
    );
  }

  const product = productQuery.data;
  const stages = wo.stages;
  const completedStages = stages.filter((s) => s.status === "COMPLETED").length;
  const progress =
    stages.length === 0
      ? 0
      : Math.round((completedStages / stages.length) * 100);

  const overdue =
    wo.targetDate !== null &&
    wo.status !== "COMPLETED" &&
    wo.status !== "CANCELLED" &&
    new Date(wo.targetDate).getTime() < Date.now();

  const currentStage = stages[wo.currentStageIndex];
  const canCancel =
    wo.status !== "COMPLETED" && wo.status !== "CANCELLED";

  async function changeStatus(next: WoStatus): Promise<void> {
    if (!wo) return;
    setActionError(null);
    try {
      await updateWo.mutateAsync({
        status: next,
        expectedVersion: wo.version,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Status update failed"
      );
    }
  }

  async function cancelWo(): Promise<void> {
    if (!wo) return;
    setActionError(null);
    try {
      await updateWo.mutateAsync({
        status: "CANCELLED",
        notes: cancelReason.trim() || undefined,
        expectedVersion: wo.version,
      });
      setCancelDialogOpen(false);
      setCancelReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  // Signature lifted to take stageId directly (instead of the WipStage
  // object) so the parent can pass a stable handler reference to StageRow.
  // useCallback keeps the ref stable across re-renders so the row's
  // React.memo bail-out fires.
  const handleStageAction = useCallback(async (
    stageId: string,
    action: AdvanceWipStage["action"]
  ): Promise<void> => {
    setActionError(null);
    try {
      await advanceStage.mutateAsync({
        stageId,
        body: { action },
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Stage transition failed"
      );
    }
  }, [advanceStage]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Back button */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/production/work-orders")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Work Orders
        </Button>
      </div>

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Header */}
      <PageHeader
        title={wo.pid}
        description={
          product ? `${product.name} · ${product.productCode}` : "…"
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={`text-xs whitespace-nowrap ${WO_STATUS_TONE[wo.status]}`}
            >
              {wo.status.replace(/_/g, " ")}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs whitespace-nowrap ${WO_PRIORITY_TONE[wo.priority]}`}
            >
              {wo.priority}
            </Badge>
            {overdue && (
              <Badge
                variant="outline"
                className="bg-red-50 text-red-700 border-red-200"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Overdue
              </Badge>
            )}
            {wo.reworkCount > 0 && (
              <Badge
                variant="outline"
                className="bg-orange-50 text-orange-700 border-orange-200"
              >
                ↺ Rework {wo.reworkCount}
              </Badge>
            )}
          </div>
        }
      />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: 2/3 — WIP stages */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">WIP Stage Tracker</CardTitle>
                  <CardDescription className="mt-0.5">
                    {completedStages} of {stages.length} stages complete —{" "}
                    {progress}%
                  </CardDescription>
                </div>
                <Progress value={progress} className="h-2 w-32" />
              </div>
            </CardHeader>
            <CardContent>
              {stages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No WIP stages registered for this work order.
                </p>
              ) : (
                <div className="relative">
                  <div className="absolute left-[15px] top-4 bottom-4 w-px bg-border" />
                  <div className="space-y-3">
                    {stages.map((stage, idx) => (
                      <StageRow
                        key={stage.id}
                        stage={stage}
                        index={idx}
                        isCurrent={idx === wo.currentStageIndex}
                        woStatus={wo.status}
                        disabled={advanceStage.isPending}
                        onAction={handleStageAction}
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: 1/3 — header info + actions */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Work Order Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow
                icon={Package}
                label="Product"
                value={product?.name ?? "—"}
              />
              <InfoRow
                icon={Hash}
                label="Product Code"
                value={product?.productCode ?? "—"}
              />
              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">BOM Version</p>
                  <Badge
                    variant="outline"
                    className="font-mono text-xs mt-0.5"
                  >
                    {wo.bomVersionLabel}
                  </Badge>
                </div>
              </div>
              <InfoRow icon={Hash} label="Quantity" value={wo.quantity} />
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Target Date</p>
                  <p
                    className={`text-sm font-medium ${
                      overdue ? "text-red-600" : ""
                    }`}
                  >
                    {formatDate(wo.targetDate)}
                    {overdue && " (Overdue)"}
                  </p>
                </div>
              </div>
              {wo.startedAt && (
                <InfoRow
                  icon={Clock}
                  label="Started At"
                  value={formatDateTime(wo.startedAt)}
                />
              )}
              {wo.completedAt && (
                <InfoRow
                  icon={CheckCircle2}
                  label="Completed At"
                  value={formatDateTime(wo.completedAt)}
                />
              )}
              {wo.dealId && (
                <div className="flex items-start gap-3">
                  <Link2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Deal ID</p>
                    <Badge
                      variant="outline"
                      className="font-mono text-xs mt-0.5"
                    >
                      {wo.dealId.slice(0, 8)}…
                    </Badge>
                  </div>
                </div>
              )}
              {wo.lotNumber && (
                <InfoRow
                  icon={Hash}
                  label="Lot Number"
                  value={wo.lotNumber}
                />
              )}
              {wo.assignedTo && (
                <div className="flex items-start gap-3">
                  <User className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Assigned To
                    </p>
                    <Badge
                      variant="outline"
                      className="font-mono text-xs mt-0.5"
                    >
                      {wo.assignedTo.slice(0, 8)}…
                    </Badge>
                  </div>
                </div>
              )}
              {wo.notes && (
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
                    {wo.notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* WO status actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {wo.status === "PLANNED" && (
                <Button
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => changeStatus("MATERIAL_CHECK")}
                  disabled={updateWo.isPending}
                >
                  Release to Material Check
                </Button>
              )}
              {wo.status === "MATERIAL_CHECK" && (
                <Button
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => changeStatus("IN_PROGRESS")}
                  disabled={updateWo.isPending}
                >
                  Approve Materials & Start Production
                </Button>
              )}
              {canCancel && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start text-red-600 border-red-300 hover:bg-red-50 gap-1"
                  onClick={() => setCancelDialogOpen(true)}
                  disabled={updateWo.isPending}
                >
                  <Ban className="h-4 w-4" /> Cancel Work Order
                </Button>
              )}
              {wo.status === "COMPLETED" && (
                <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>All stages completed.</span>
                </div>
              )}
              {wo.status === "CANCELLED" && (
                <div className="flex items-center gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-2">
                  <Ban className="h-3.5 w-3.5 shrink-0" />
                  <span>Work order cancelled.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Device Serials */}
          {wo.deviceSerials.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Unit Serials
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    ({wo.deviceSerials.length})
                  </span>
                </CardTitle>
                <CardDescription>
                  Auto-generated per unit of quantity for serialized products.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {wo.deviceSerials.map((serial) => (
                    <Badge
                      key={serial}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {serial}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Current stage summary */}
          {currentStage && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Current Stage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">
                    {currentStage.sequenceNumber}. {currentStage.stageName}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-xs ${STAGE_STATUS_TONE[currentStage.status]}`}
                  >
                    {currentStage.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {currentStage.expectedDurationHours}h expected
                  {currentStage.requiresQcSignoff && " · QC sign-off required"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Cancel dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Work Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This will mark the WO as <span className="font-medium">CANCELLED</span>.
              Note: cancellation does not revert materials already issued.
            </p>
            <Textarea
              placeholder="Reason for cancellation (optional)..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={updateWo.isPending}
            >
              Keep Open
            </Button>
            <Button
              variant="destructive"
              onClick={cancelWo}
              disabled={updateWo.isPending}
            >
              {updateWo.isPending ? "Cancelling…" : "Cancel Work Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Stage row subcomponent ────────────────────────────────────────────────

// Wrapped in React.memo so a parent re-render (header status edit, dialog
// open, action error toast, etc.) doesn't redundantly re-render every
// stage card. With handleStageAction useCallback'd in the parent and the
// remaining props being primitives, the memo bail-out fires cleanly.
const StageRow = memo(function StageRow({
  stage,
  index,
  isCurrent,
  woStatus,
  disabled,
  onAction,
}: {
  stage: WipStage;
  index: number;
  isCurrent: boolean;
  woStatus: WoStatus;
  disabled: boolean;
  /** Receives stageId so the parent can pass a stable handler reference. */
  onAction: (stageId: string, action: AdvanceWipStage["action"]) => void;
}) {
  const isDone = stage.status === "COMPLETED";
  const isActive = stage.status === "IN_PROGRESS";
  const isHold = stage.status === "QC_HOLD";
  const isRework = stage.status === "REWORK";
  const isPending = stage.status === "PENDING";

  return (
    <div
      className={`relative flex items-start gap-4 p-3 rounded-lg border transition-colors ${
        isActive
          ? "border-amber-200 bg-amber-50/40"
          : isDone
            ? "border-green-200 bg-green-50/20"
            : isHold || isRework
              ? "border-orange-200 bg-orange-50/30"
              : "border-border bg-background"
      }`}
    >
      {/* Circle icon */}
      <div
        className={`relative z-10 flex items-center justify-center h-8 w-8 rounded-full shrink-0 text-xs font-bold ${
          isDone
            ? "bg-green-100 text-green-700"
            : isActive
              ? "bg-amber-100 text-amber-700 ring-2 ring-amber-300 ring-offset-1"
              : isHold || isRework
                ? "bg-orange-100 text-orange-700"
                : "bg-muted text-muted-foreground"
        }`}
      >
        {isDone ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : isActive ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isHold || isRework ? (
          <RotateCcw className="h-3.5 w-3.5" />
        ) : (
          index + 1
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {stage.sequenceNumber}. {stage.stageName}
          </span>
          {stage.requiresQcSignoff && (
            <Shield className="h-3.5 w-3.5 text-indigo-500" />
          )}
          <Badge
            variant="outline"
            className={`text-xs whitespace-nowrap ${STAGE_STATUS_TONE[stage.status]}`}
          >
            {stage.status.replace(/_/g, " ")}
          </Badge>
          {stage.qcResult && (
            <Badge
              variant="outline"
              className={
                stage.qcResult === "PASS"
                  ? "bg-green-50 text-green-700 border-green-200 text-xs"
                  : "bg-red-50 text-red-700 border-red-200 text-xs"
              }
            >
              QC: {stage.qcResult}
            </Badge>
          )}
          {stage.reworkCount > 0 && (
            <Badge
              variant="outline"
              className="bg-orange-50 text-orange-700 border-orange-200 text-xs"
            >
              ↺ Rework ×{stage.reworkCount}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          <span>{stage.expectedDurationHours}h expected</span>
          {stage.startedAt && (
            <span>Started {formatDateTime(stage.startedAt)}</span>
          )}
          {stage.completedAt && (
            <span>Completed {formatDateTime(stage.completedAt)}</span>
          )}
        </div>

        {stage.qcNotes && (
          <p className="text-xs text-muted-foreground italic mt-1.5 border-l-2 border-muted pl-2">
            QC notes: {stage.qcNotes}
          </p>
        )}

        {/* Controls — only on the current stage and while WO is in a
            live status. */}
        {isCurrent &&
          (woStatus === "IN_PROGRESS" ||
            woStatus === "QC_HOLD" ||
            woStatus === "REWORK") && (
            <div className="mt-3 flex gap-2 flex-wrap">
              {isPending && (
                <Button
                  size="sm"
                  onClick={() => onAction(stage.id, "START")}
                  disabled={disabled}
                >
                  <ChevronRight className="h-4 w-4 mr-1" />
                  Start Stage
                </Button>
              )}
              {isActive && (
                <Button
                  size="sm"
                  onClick={() => onAction(stage.id, "COMPLETE")}
                  disabled={disabled}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Complete Stage
                </Button>
              )}
              {isHold && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-300 text-green-700 hover:bg-green-50"
                    onClick={() => onAction(stage.id, "QC_PASS")}
                    disabled={disabled}
                  >
                    <Shield className="h-4 w-4 mr-1" />
                    QC Pass
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                    onClick={() => onAction(stage.id, "QC_FAIL")}
                    disabled={disabled}
                  >
                    <Shield className="h-4 w-4 mr-1" />
                    QC Fail (Rework)
                  </Button>
                </>
              )}
              {isRework && (
                <Button
                  size="sm"
                  onClick={() => onAction(stage.id, "REWORK_DONE")}
                  disabled={disabled}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Mark Rework Done
                </Button>
              )}
            </div>
          )}
      </div>
    </div>
  );
});

// ─── Helper component ──────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
