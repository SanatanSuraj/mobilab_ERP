"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KanbanBoard, KanbanColumn } from "@/components/shared/kanban-board";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  deals as initialDeals,
  getUserById,
  formatCurrency,
  formatDate,
  type Deal,
  type DealStage,
} from "@/data/mock";
import { toast } from "sonner";
import { CalendarDays, DollarSign, Percent } from "lucide-react";

const stageConfig: Record<DealStage, { title: string; color: string }> = {
  discovery: { title: "Discovery", color: "#06b6d4" },
  proposal: { title: "Proposal", color: "#f97316" },
  negotiation: { title: "Negotiation", color: "#eab308" },
  closed_won: { title: "Closed Won", color: "#22c55e" },
  closed_lost: { title: "Closed Lost", color: "#ef4444" },
};

const stages: DealStage[] = [
  "discovery",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

export default function PipelinePage() {
  const [dealList, setDealList] = useState<Deal[]>(initialDeals);
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [pendingLostDeal, setPendingLostDeal] = useState<{
    id: string;
    from: string;
  } | null>(null);

  const columns: KanbanColumn<Deal>[] = stages.map((stage) => ({
    id: stage,
    title: stageConfig[stage].title,
    color: stageConfig[stage].color,
    items: dealList.filter((d) => d.stage === stage),
  }));

  const totalValue = dealList
    .filter((d) => d.stage !== "closed_lost")
    .reduce((sum, d) => sum + d.value, 0);

  function handleMoveItem(
    itemId: string,
    fromColumn: string,
    toColumn: string
  ) {
    if (toColumn === "closed_lost") {
      setPendingLostDeal({ id: itemId, from: fromColumn });
      setLostReason("");
      setLostNotes("");
      setLostDialogOpen(true);
      return;
    }

    setDealList((prev) =>
      prev.map((deal) =>
        deal.id === itemId
          ? { ...deal, stage: toColumn as DealStage }
          : deal
      )
    );

    const deal = dealList.find((d) => d.id === itemId);

    if (toColumn === "closed_won") {
      toast.success(
        `Deal Won! Work Order Created + MRP Triggered`,
        { description: deal?.title }
      );
    } else {
      const fromLabel = stageConfig[fromColumn as DealStage]?.title;
      const toLabel = stageConfig[toColumn as DealStage]?.title;
      toast.success(`"${deal?.title}" moved from ${fromLabel} to ${toLabel}`);
    }
  }

  function handleConfirmLost() {
    if (!pendingLostDeal) return;

    setDealList((prev) =>
      prev.map((deal) =>
        deal.id === pendingLostDeal.id
          ? { ...deal, stage: "closed_lost" as DealStage }
          : deal
      )
    );

    const deal = dealList.find((d) => d.id === pendingLostDeal.id);
    toast.error("Deal marked as Lost", { description: deal?.title });
    setLostDialogOpen(false);
    setPendingLostDeal(null);
  }

  function handleCancelLost() {
    setLostDialogOpen(false);
    setPendingLostDeal(null);
  }

  function renderDealCard(deal: Deal) {
    const user = getUserById(deal.assignedTo);
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-3 space-y-2.5">
          <div>
            <p className="text-sm font-semibold leading-tight">{deal.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {deal.company}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-sm font-medium">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              {formatCurrency(deal.value)}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Percent className="h-3 w-3" />
              {deal.probability}%
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {formatDate(deal.expectedClose)}
            </div>
            {user && (
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                  {user.avatar}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="p-6 max-w-[1600px] mx-auto">
        <PageHeader
          title="Pipeline"
          description={`${dealList.length} deals -- Pipeline value: ${formatCurrency(totalValue)}`}
        />
        <KanbanBoard<Deal>
          columns={columns}
          renderCard={renderDealCard}
          onMoveItem={handleMoveItem}
          getItemId={(deal) => deal.id}
        />
      </div>

      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Deal as Lost</DialogTitle>
            <DialogDescription>
              Please provide a reason for losing this deal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="lost-reason">Lost Reason</Label>
              <Textarea
                id="lost-reason"
                placeholder="Why was this deal lost?"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                className="min-h-[60px] resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lost-notes">Additional Notes</Label>
              <Textarea
                id="lost-notes"
                placeholder="Any additional context..."
                value={lostNotes}
                onChange={(e) => setLostNotes(e.target.value)}
                className="min-h-[60px] resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelLost}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmLost}
              disabled={!lostReason.trim()}
            >
              Mark as Lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
