"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import {
  KanbanBoard,
  KanbanColumn,
} from "@/components/shared/kanban-board";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useApiDeals, useApiMoveDealStage } from "@/hooks/useCrmApi";
import { formatCurrency, formatDate } from "@/data/mock";
import type { Deal, DealStage } from "@mobilab/contracts";
import {
  AlertCircle,
  CalendarDays,
  DollarSign,
  Percent,
} from "lucide-react";

/**
 * Pipeline kanban — /crm/pipeline, backed by useApiDeals + useApiMoveDealStage.
 *
 * The full pipeline is paginated at 500 to keep the board one-shot. Heavier
 * tenants will eventually need a saved-filter / lane-pagination story, but
 * at prototype scale dropping 500 cards on the client is fine.
 *
 * Drag-and-drop semantics:
 *   - Dropping on any non-LOST column transitions immediately (optimistic
 *     update via the mutation hook; 409 rolls back).
 *   - Dropping on CLOSED_LOST opens a dialog; the actual transition only
 *     fires on "Confirm Lost" with a reason, because the backend rejects
 *     the transition without one.
 *   - Terminal deals (CLOSED_WON, CLOSED_LOST) are draggable but the
 *     backend will 409 any re-transition. We don't pre-emptively disable —
 *     the mutation error surface is enough.
 *
 * Deltas from the mock version:
 *   - Stages are UPPER_CASE (DealStage).
 *   - `deal.value` is a decimal string; KPI reduction goes through Number()
 *     per card (acceptable at O(n=500)).
 *   - `deal.expectedClose` + `assignedTo` are nullable — render paths fall
 *     back to "—" / avatar omission.
 *   - Assignee avatars dropped — no user catalog; we show a uuid prefix
 *     badge in its place. When /org/users lands, swap for initials.
 *   - "Deal Won! Work Order Created + MRP Triggered" toast from the mock
 *     is dropped; WO orchestration isn't real yet.
 */

const STAGE_CONFIG: Record<DealStage, { title: string; color: string }> = {
  DISCOVERY: { title: "Discovery", color: "#06b6d4" },
  PROPOSAL: { title: "Proposal", color: "#f97316" },
  NEGOTIATION: { title: "Negotiation", color: "#eab308" },
  CLOSED_WON: { title: "Closed Won", color: "#22c55e" },
  CLOSED_LOST: { title: "Closed Lost", color: "#ef4444" },
};

const STAGE_ORDER: DealStage[] = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "CLOSED_WON",
  "CLOSED_LOST",
];

type LostCategory =
  | "PRICE"
  | "COMPETITOR"
  | "TIMELINE"
  | "BUDGET"
  | "NO_RESPONSE"
  | "OTHER";

const LOST_CATEGORY_LABELS: Record<LostCategory, string> = {
  PRICE: "Price too high",
  COMPETITOR: "Chose competitor",
  TIMELINE: "Timeline mismatch",
  BUDGET: "Budget constraints",
  NO_RESPONSE: "No response / gone cold",
  OTHER: "Other",
};

function toNumber(v: string | null): number {
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function PipelinePage() {
  const router = useRouter();
  const dealsQuery = useApiDeals({ limit: 500 });
  const moveMut = useApiMoveDealStage();

  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostCategory, setLostCategory] = useState<LostCategory | "">("");
  const [pendingLostDeal, setPendingLostDeal] = useState<{
    id: string;
    version: number;
    title: string;
  } | null>(null);

  // Stable reference so the two downstream useMemos don't churn on
  // every render from the `?? []` fallback on the unrelated re-renders.
  const deals = useMemo<Deal[]>(
    () => dealsQuery.data?.data ?? [],
    [dealsQuery.data]
  );

  // Group deals by stage — cheap at O(n), recomputes when data moves.
  const columns: KanbanColumn<Deal>[] = useMemo(
    () =>
      STAGE_ORDER.map((stage) => ({
        id: stage,
        title: STAGE_CONFIG[stage].title,
        color: STAGE_CONFIG[stage].color,
        items: deals.filter((d) => d.stage === stage),
      })),
    [deals]
  );

  const activePipelineValue = useMemo(
    () =>
      deals
        .filter((d) => d.stage !== "CLOSED_LOST")
        .reduce((sum, d) => sum + toNumber(d.value), 0),
    [deals]
  );

  function handleMoveItem(
    itemId: string,
    _fromColumn: string,
    toColumn: string
  ) {
    const deal = deals.find((d) => d.id === itemId);
    if (!deal) return;
    const toStage = toColumn as DealStage;

    if (toStage === "CLOSED_LOST") {
      // Defer: backend requires a reason. Open the modal, collect it,
      // then fire the mutation.
      setPendingLostDeal({
        id: deal.id,
        version: deal.version,
        title: deal.title,
      });
      setLostReason("");
      setLostCategory("");
      setLostDialogOpen(true);
      return;
    }

    moveMut.mutate(
      {
        id: itemId,
        body: {
          stage: toStage,
          expectedVersion: deal.version,
        },
      },
      {
        onSuccess: () => {
          toast.success(
            `"${deal.title}" moved to ${STAGE_CONFIG[toStage].title}`
          );
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to move deal"
          );
        },
      }
    );
  }

  function handleConfirmLost() {
    if (!pendingLostDeal) return;
    if (!lostReason.trim() || !lostCategory) {
      toast.error("Please fill in both lost reason and category.");
      return;
    }
    // Fold category in as a prefix — contract stores one free-form string.
    const composed = `[${lostCategory}] ${lostReason.trim()}`;
    moveMut.mutate(
      {
        id: pendingLostDeal.id,
        body: {
          stage: "CLOSED_LOST",
          expectedVersion: pendingLostDeal.version,
          lostReason: composed,
        },
      },
      {
        onSuccess: () => {
          toast.error("Deal marked as Lost", {
            description: pendingLostDeal.title,
          });
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to mark deal as lost"
          );
        },
      }
    );
    setLostDialogOpen(false);
    setPendingLostDeal(null);
  }

  function handleCancelLost() {
    setLostDialogOpen(false);
    setPendingLostDeal(null);
  }

  function renderDealCard(deal: Deal) {
    return (
      <Card
        className="hover:shadow-md transition-shadow"
        onClick={(e) => {
          // Guard against the click firing after a drop gesture; the
          // kanban container drives dragend separately.
          if ((e.target as HTMLElement).closest("[data-no-open]")) return;
          router.push(`/crm/deals/${deal.id}`);
        }}
      >
        <CardContent className="p-3 space-y-2.5">
          <div>
            <p className="text-sm font-semibold leading-tight truncate">
              {deal.title}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {deal.company}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-sm font-medium">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              {formatCurrency(toNumber(deal.value))}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Percent className="h-3 w-3" />
              {deal.probability}%
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {deal.expectedClose ? formatDate(deal.expectedClose) : "—"}
            </div>
            {deal.assignedTo && (
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {deal.assignedTo.slice(0, 6)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (dealsQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_ORDER.map((s) => (
            <Skeleton
              key={s}
              className="h-[calc(100vh-240px)] w-[300px] shrink-0"
            />
          ))}
        </div>
      </div>
    );
  }

  if (dealsQuery.isError) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load pipeline</p>
            <p className="text-red-700 mt-1">
              {dealsQuery.error instanceof Error
                ? dealsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-6 max-w-[1600px] mx-auto">
        <PageHeader
          title="Pipeline"
          description={`${deals.length} deals -- Active pipeline value: ${formatCurrency(activePipelineValue)}`}
        />
        <KanbanBoard<Deal>
          columns={columns}
          renderCard={renderDealCard}
          onMoveItem={handleMoveItem}
          getItemId={(deal) => deal.id}
        />
      </div>

      <Dialog
        open={lostDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelLost();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Deal as Lost</DialogTitle>
            <DialogDescription>
              {pendingLostDeal
                ? `"${pendingLostDeal.title}" will be moved to Closed Lost.`
                : "Please provide a reason for losing this deal."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Lost Reason Category *</Label>
              <Select
                value={lostCategory}
                onValueChange={(v) =>
                  setLostCategory((v ?? "") as LostCategory)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason category…" />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(LOST_CATEGORY_LABELS) as [
                      LostCategory,
                      string,
                    ][]
                  ).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lost-reason">Lost Reason *</Label>
              <Textarea
                id="lost-reason"
                placeholder="Why was this deal lost?"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="min-h-[60px] resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelLost}
              disabled={moveMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmLost}
              disabled={
                !lostReason.trim() || !lostCategory || moveMut.isPending
              }
            >
              {moveMut.isPending ? "Saving…" : "Mark as Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
