"use client";

/**
 * Work-in-Progress kanban.
 *
 * One column per WO header status (PLANNED, MATERIAL_CHECK, IN_PROGRESS,
 * QC_HOLD, REWORK, COMPLETED). Cards show progress (n/m stages completed),
 * the active stage name, priority, and target date. Read-only Phase-5
 * surface — stage advances happen on the work-order detail screen.
 */

import { useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useApiWipBoard } from "@/hooks/useProductionApi";
import type { WipBoardCard, WoStatus } from "@instigenie/contracts";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
} from "lucide-react";

const LANES: { status: WoStatus; label: string }[] = [
  { status: "PLANNED", label: "Planned" },
  { status: "MATERIAL_CHECK", label: "Material Check" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "QC_HOLD", label: "QC Hold" },
  { status: "REWORK", label: "Rework" },
  { status: "COMPLETED", label: "Completed" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - Date.now()) / 86400000);
}

function priorityClass(p: WipBoardCard["priority"]): string {
  switch (p) {
    case "CRITICAL":
      return "bg-red-50 text-red-700 border-red-200";
    case "HIGH":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "NORMAL":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "LOW":
      return "bg-gray-50 text-gray-600 border-gray-200";
  }
}

function activeStageName(card: WipBoardCard): string {
  const idx = card.currentStageIndex;
  const stage =
    card.stages.find((s) => s.sequenceNumber === idx + 1) ??
    card.stages[card.stages.length - 1];
  return stage?.stageName ?? "—";
}

function completedStageCount(card: WipBoardCard): number {
  return card.stages.filter((s) => s.status === "COMPLETED").length;
}

export default function WipPage() {
  const query = useApiWipBoard();

  const lanes = useMemo(() => {
    const cards = query.data ?? [];
    const grouped: Record<WoStatus, WipBoardCard[]> = {
      PLANNED: [],
      MATERIAL_CHECK: [],
      IN_PROGRESS: [],
      QC_HOLD: [],
      REWORK: [],
      COMPLETED: [],
      CANCELLED: [],
    };
    for (const c of cards) grouped[c.status].push(c);
    return grouped;
  }, [query.data]);

  if (query.isLoading) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto space-y-6">
        <PageHeader
          title="Work-in-Progress"
          description="Kanban of work orders across WIP stages"
        />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {LANES.map((l) => (
            <Skeleton key={l.status} className="h-96" />
          ))}
        </div>
      </div>
    );
  }

  const all = query.data ?? [];
  const total = all.length;
  const inProgress = lanes.IN_PROGRESS.length;
  const onHold = lanes.QC_HOLD.length + lanes.REWORK.length;
  const overdue = all.filter((c) => {
    if (c.status === "COMPLETED") return false;
    const d = daysUntil(c.targetDate);
    return d !== null && d < 0;
  }).length;

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Work-in-Progress"
        description="Kanban of work orders across WIP stages"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active WOs"
          value={String(total)}
          icon={ClipboardList}
          iconColor="text-blue-600"
        />
        <KPICard
          title="In Progress"
          value={String(inProgress)}
          icon={Activity}
          iconColor="text-amber-600"
        />
        <KPICard
          title="On Hold / Rework"
          value={String(onHold)}
          icon={AlertTriangle}
          iconColor="text-orange-600"
        />
        <KPICard
          title="Overdue"
          value={String(overdue)}
          icon={CheckCircle2}
          iconColor="text-red-600"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {LANES.map(({ status, label }) => {
          const cards = lanes[status];
          return (
            <div
              key={status}
              className="bg-muted/40 rounded-lg p-3 min-h-[400px] flex flex-col"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold">{label}</div>
                <Badge variant="secondary" className="text-xs">
                  {cards.length}
                </Badge>
              </div>
              <div className="space-y-2 flex-1">
                {cards.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-8">
                    No work orders
                  </div>
                ) : (
                  cards.map((card) => {
                    const completed = completedStageCount(card);
                    const totalStages = card.stages.length;
                    const pct =
                      totalStages > 0
                        ? Math.round((completed / totalStages) * 100)
                        : 0;
                    const due = daysUntil(card.targetDate);
                    const overdueRow =
                      card.status !== "COMPLETED" &&
                      due !== null &&
                      due < 0;
                    return (
                      <div
                        key={card.id}
                        className="bg-background border rounded-md p-3 space-y-2 hover:shadow-sm transition-shadow"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-blue-600">
                            {card.pid}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${priorityClass(card.priority)}`}
                          >
                            {card.priority}
                          </Badge>
                        </div>
                        <div className="text-sm font-medium line-clamp-1">
                          {card.productName}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {card.productCode} · {card.bomVersionLabel} ·{" "}
                          {card.quantity}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          Stage: {activeStageName(card)}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">
                              {completed}/{totalStages} stages
                            </span>
                            <span className="font-mono">{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <StatusBadge status={card.status} />
                          <div
                            className={`text-[11px] font-mono ${
                              overdueRow
                                ? "text-red-600 font-semibold"
                                : "text-muted-foreground"
                            }`}
                          >
                            {card.targetDate ? formatDate(card.targetDate) : "—"}
                            {overdueRow && due !== null && (
                              <span className="ml-1">({Math.abs(due)}d)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
