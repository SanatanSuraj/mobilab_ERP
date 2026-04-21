"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useApiAccount,
  useApiDeal,
  useApiTransitionDealStage,
} from "@/hooks/useCrmApi";
import { formatCurrency, formatDate } from "@/data/mock";
import type { DealStage } from "@mobilab/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarDays,
  DollarSign,
  ExternalLink,
  Percent,
  User,
} from "lucide-react";

/**
 * Deal detail — /crm/deals/:id, backed by useApiDeal + useApiTransitionDealStage.
 *
 * Migration deltas from the earlier mock page:
 *   - Stage is UPPER_CASE (DealStage enum). All label/order maps switched.
 *   - Stage changes go through POST /crm/deals/:id/transition with the
 *     deal's `expectedVersion`. On 409 (stale version), the user sees a
 *     toast and the detail is re-fetched so they can retry.
 *   - `deal.value` is a decimal string (NUMERIC(18,2)), not a number.
 *   - `deal.expectedClose` / `closedAt` / `lostReason` / `assignedTo` are
 *     all nullable; render paths fall back to "—" / "Unassigned".
 *   - Dropped tabs: Products & GST (not in contract — deal line items are
 *     a quotation concern, not a deal concern) and Activity (no per-deal
 *     activity endpoint yet).
 *   - Dropped the fake Work Order banner — that was pure prototype UX. The
 *     real cross-module link lives under Manufacturing once the pipeline
 *     is wired.
 *
 * The Lost flow still uses a modal: CLOSED_LOST requires lostReason, so we
 * can't just fire the transition off a Select change. Category is kept as
 * UI-only metadata (appended to the reason text) because the backend only
 * stores a free-form reason string.
 */

const STAGE_LABELS: Record<DealStage, string> = {
  DISCOVERY: "Discovery",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  CLOSED_WON: "Closed Won",
  CLOSED_LOST: "Closed Lost",
};

// Pipeline order — CLOSED_LOST is the side branch, rendered separately in
// the stage flow strip.
const STAGE_ORDER: DealStage[] = [
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "CLOSED_WON",
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

export default function DealDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.id as string;

  const dealQuery = useApiDeal(dealId);
  const transitionMut = useApiTransitionDealStage(dealId);

  // Side-fetch the linked account so we can show its name rather than a
  // bare uuid. Only enabled when the deal has an accountId.
  const accountQuery = useApiAccount(dealQuery.data?.accountId ?? undefined);

  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostCategory, setLostCategory] = useState<LostCategory | "">("");

  // Pre-compute the stage strip every render — cheap, and keeps the flow
  // logic colocated with the data it depends on.
  const isTerminal = useMemo(() => {
    const s = dealQuery.data?.stage;
    return s === "CLOSED_WON" || s === "CLOSED_LOST";
  }, [dealQuery.data?.stage]);

  if (dealQuery.isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-[1200px] mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (dealQuery.isError || !dealQuery.data) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3 mb-4">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Deal not found</p>
            <p className="text-red-700 mt-1">
              {dealQuery.error instanceof Error
                ? dealQuery.error.message
                : "The deal you are looking for does not exist or you do not have access."}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push("/crm/deals")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Deals
        </Button>
      </div>
    );
  }

  const deal = dealQuery.data;
  const accountName =
    deal.accountId && accountQuery.data ? accountQuery.data.name : deal.company;

  function commitStage(nextStage: DealStage, reason?: string) {
    transitionMut.mutate(
      {
        stage: nextStage,
        expectedVersion: deal.version,
        ...(reason ? { lostReason: reason } : {}),
      },
      {
        onSuccess: () => {
          toast.success(
            `Stage changed to ${STAGE_LABELS[nextStage]}`
          );
        },
        onError: (err) => {
          // Backend returns 409 with a specific code on stale version —
          // surface it so the user knows a re-fetch is happening.
          const message =
            err instanceof Error ? err.message : "Failed to change stage";
          toast.error(message);
          // Force a fresh read so the next attempt picks up the new version.
          dealQuery.refetch();
        },
      }
    );
  }

  function handleStageChange(nextStageRaw: string | null) {
    if (!nextStageRaw) return;
    if (isTerminal || transitionMut.isPending) return;

    const nextStage = nextStageRaw as DealStage;
    if (nextStage === deal.stage) return;

    if (nextStage === "CLOSED_LOST") {
      // Open modal; confirmation path calls commitStage with reason.
      setLostDialogOpen(true);
      return;
    }
    commitStage(nextStage);
  }

  function handleConfirmLost() {
    if (!lostReason.trim() || !lostCategory) {
      toast.error("Please fill in both lost reason and category.");
      return;
    }
    // Backend only stores one reason string — fold category in as a prefix
    // so the categorisation is preserved without schema changes.
    const composed = `[${lostCategory}] ${lostReason.trim()}`;
    commitStage("CLOSED_LOST", composed);
    setLostDialogOpen(false);
    setLostReason("");
    setLostCategory("");
  }

  // Timeline events derive from the current stage + timestamps on the row.
  // We don't have per-stage audit yet, so intermediate events reuse
  // createdAt as a placeholder anchor.
  const timelineEvents: Array<{
    label: string;
    date: string | null;
    stage: DealStage;
  }> = [
    { label: "Deal created", date: deal.createdAt, stage: "DISCOVERY" },
    ...(deal.stage === "PROPOSAL" ||
    deal.stage === "NEGOTIATION" ||
    deal.stage === "CLOSED_WON"
      ? [
          {
            label: "Moved to Proposal",
            date: deal.updatedAt,
            stage: "PROPOSAL" as DealStage,
          },
        ]
      : []),
    ...(deal.stage === "NEGOTIATION" || deal.stage === "CLOSED_WON"
      ? [
          {
            label: "Moved to Negotiation",
            date: deal.updatedAt,
            stage: "NEGOTIATION" as DealStage,
          },
        ]
      : []),
    ...(deal.stage === "CLOSED_WON"
      ? [
          {
            label: "Deal closed (Won)",
            date: deal.closedAt ?? deal.updatedAt,
            stage: "CLOSED_WON" as DealStage,
          },
        ]
      : []),
    ...(deal.stage === "CLOSED_LOST"
      ? [
          {
            label: "Deal closed (Lost)",
            date: deal.closedAt ?? deal.updatedAt,
            stage: "CLOSED_LOST" as DealStage,
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <Dialog
        open={lostDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setLostDialogOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Mark Deal as Lost</DialogTitle>
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
              <Label>Lost Reason *</Label>
              <Textarea
                placeholder="Describe why this deal was lost…"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLostDialogOpen(false)}
              disabled={transitionMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmLost}
              disabled={
                !lostReason.trim() ||
                !lostCategory ||
                transitionMut.isPending
              }
            >
              {transitionMut.isPending ? "Saving…" : "Confirm Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/crm/deals")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Deals
        </Button>
      </div>

      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight truncate">
              {deal.title}
            </h1>
            <span className="text-xs text-muted-foreground font-mono">
              {deal.dealNumber}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{accountName}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Select
            value={deal.stage}
            onValueChange={handleStageChange}
            disabled={isTerminal || transitionMut.isPending}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STAGE_LABELS) as DealStage[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <StatusBadge status={deal.stage} />
        </div>
      </div>

      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {STAGE_ORDER.map((s, idx) => {
          const isActive = deal.stage === s;
          const isPast =
            deal.stage === "CLOSED_WON"
              ? true
              : STAGE_ORDER.indexOf(deal.stage as DealStage) > idx;
          return (
            <div key={s} className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isPast
                      ? "bg-green-100 text-green-700 border border-green-200"
                      : "bg-muted text-muted-foreground border border-border"
                } ${
                  isTerminal || transitionMut.isPending
                    ? "cursor-not-allowed opacity-70"
                    : "cursor-pointer hover:opacity-80"
                }`}
                onClick={() =>
                  !isTerminal && !transitionMut.isPending && handleStageChange(s)
                }
                disabled={isTerminal || transitionMut.isPending}
              >
                {STAGE_LABELS[s]}
              </button>
              {idx < STAGE_ORDER.length - 1 && (
                <span className="text-muted-foreground text-xs">→</span>
              )}
            </div>
          );
        })}
        <span className="text-muted-foreground text-xs mx-1">↘</span>
        <button
          type="button"
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            deal.stage === "CLOSED_LOST"
              ? "bg-red-100 text-red-700 border border-red-200"
              : "bg-muted text-muted-foreground border border-border"
          } ${
            isTerminal || transitionMut.isPending
              ? "cursor-not-allowed opacity-70"
              : "cursor-pointer hover:opacity-80"
          }`}
          onClick={() =>
            !isTerminal &&
            !transitionMut.isPending &&
            handleStageChange("CLOSED_LOST")
          }
          disabled={isTerminal || transitionMut.isPending}
        >
          Lost
        </button>
      </div>

      {deal.stage === "CLOSED_LOST" && deal.lostReason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4">
          <p className="text-xs font-medium text-red-900 mb-1">Lost Reason</p>
          <p className="text-sm text-red-800 whitespace-pre-wrap">
            {deal.lostReason}
          </p>
        </div>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Deal Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Account</p>
                    {deal.accountId ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                        onClick={() =>
                          router.push(`/crm/accounts/${deal.accountId}`)
                        }
                      >
                        {accountName}
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    ) : (
                      <p className="text-sm font-medium">{deal.company}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Contact</p>
                    <p className="text-sm font-medium">{deal.contactName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Value</p>
                    <p className="text-sm font-medium">
                      {formatCurrency(toNumber(deal.value))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Percent className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Probability</p>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={deal.probability}
                        className="h-2 w-24"
                      />
                      <span className="text-sm font-medium">
                        {deal.probability}%
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Expected Close
                    </p>
                    <p className="text-sm font-medium">
                      {deal.expectedClose
                        ? formatDate(deal.expectedClose)
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p className="text-sm font-medium">
                      {formatDate(deal.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Closed</p>
                    <p className="text-sm font-medium">
                      {deal.closedAt ? formatDate(deal.closedAt) : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Owner</p>
                    <p className="text-sm font-medium text-muted-foreground">
                      {deal.assignedTo
                        ? deal.assignedTo.slice(0, 8)
                        : "Unassigned"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Deal Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative pl-6 space-y-6">
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
                {timelineEvents.map((event, idx) => (
                  <div
                    key={idx}
                    className="relative flex items-start gap-4"
                  >
                    <div className="absolute left-[-18px] top-1.5 w-3 h-3 rounded-full border-2 border-primary bg-background" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{event.label}</p>
                        <StatusBadge status={event.stage} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {event.date ? formatDate(event.date) : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
