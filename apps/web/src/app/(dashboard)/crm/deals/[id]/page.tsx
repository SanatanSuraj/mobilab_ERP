"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getUserById,
  getProductById,
  getActivitiesForEntity,
  formatCurrency,
  formatDate,
  DealStage,
} from "@/data/mock";
import { useDeal } from "@/hooks/useCrm";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  User,
  DollarSign,
  CalendarDays,
  Percent,
  Package,
  Link2,
  CheckCircle2,
  AlertTriangle,
  Factory,
  FileText,
  ExternalLink,
} from "lucide-react";

const stageLabels: Record<DealStage, string> = {
  discovery: "Discovery",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

const stageOrder: DealStage[] = ["discovery", "proposal", "negotiation", "closed_won"];

type WOState = null | "CREATING" | "CREATED";

type LostReasonCategory =
  | "PRICE"
  | "COMPETITOR"
  | "TIMELINE"
  | "BUDGET"
  | "NO_RESPONSE"
  | "OTHER";

const LOST_REASON_CATEGORIES: Record<LostReasonCategory, string> = {
  PRICE: "Price too high",
  COMPETITOR: "Chose competitor",
  TIMELINE: "Timeline mismatch",
  BUDGET: "Budget constraints",
  NO_RESPONSE: "No response / gone cold",
  OTHER: "Other",
};

export default function DealDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.id as string;

  const { data: deal, isLoading: dealLoading } = useDeal(dealId);
  const [currentStage, setCurrentStage] = useState<DealStage>("discovery");

  // Sync local stage state when deal data arrives
  const [stageSynced, setStageSynced] = useState(false);
  if (deal && !stageSynced) {
    setCurrentStage(deal.stage);
    setStageSynced(true);
  }
  const [woState, setWoState] = useState<WOState>(null);
  const [woResult, setWoResult] = useState<{
    pid: string;
    reservedItems: number;
    shortfallItems: number;
  } | null>(null);

  // Lost reason dialog state
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostCategory, setLostCategory] = useState<LostReasonCategory | "">("");
  const [pendingLostStage, setPendingLostStage] = useState(false);

  if (dealLoading) {
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

  if (!deal) {
    return (
      <div className="p-6">
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold mb-2">Deal not found</h2>
          <p className="text-muted-foreground mb-4">The deal you are looking for does not exist.</p>
          <Button variant="outline" onClick={() => router.push("/crm/deals")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Deals
          </Button>
        </div>
      </div>
    );
  }

  const user = getUserById(deal.assignedTo);
  const dealActivities = getActivitiesForEntity("deal", deal.id);
  const isTerminal = currentStage === "closed_won" || currentStage === "closed_lost";

  const timelineEvents = [
    { label: "Deal created", date: deal.createdAt, stage: "discovery" as DealStage },
    ...(currentStage === "proposal" || currentStage === "negotiation" || currentStage === "closed_won"
      ? [{ label: "Moved to Proposal", date: deal.createdAt, stage: "proposal" as DealStage }]
      : []),
    ...(currentStage === "negotiation" || currentStage === "closed_won"
      ? [{ label: "Moved to Negotiation", date: deal.createdAt, stage: "negotiation" as DealStage }]
      : []),
    ...(currentStage === "closed_won"
      ? [{ label: "Deal closed (Won)", date: deal.expectedClose, stage: "closed_won" as DealStage }]
      : []),
    ...(currentStage === "closed_lost"
      ? [{ label: "Deal closed (Lost)", date: deal.expectedClose, stage: "closed_lost" as DealStage }]
      : []),
  ];

  function triggerWOCreation() {
    setWoState("CREATING");
    setTimeout(() => {
      setWoState("CREATED");
      setWoResult({ pid: "WO-2026-006", reservedItems: 4, shortfallItems: 1 });
      toast.success("Work Order WO-2026-006 created automatically from this deal.");
    }, 800);
  }

  function handleStageChange(newStage: string | null) {
    if (!newStage) return;
    if (isTerminal) return;

    const ns = newStage as DealStage;
    const prevLabel = stageLabels[currentStage];
    const newLabel = stageLabels[ns];

    if (ns === "closed_lost") {
      setPendingLostStage(true);
      setLostDialogOpen(true);
      return;
    }

    setCurrentStage(ns);
    toast.success(`Stage changed from ${prevLabel} to ${newLabel}`);

    if (ns === "closed_won") {
      triggerWOCreation();
    }
  }

  function handleConfirmLost() {
    if (!lostReason.trim() || !lostCategory) {
      toast.error("Please fill in both lost reason and category.");
      return;
    }
    setCurrentStage("closed_lost");
    setLostDialogOpen(false);
    setPendingLostStage(false);
    toast.info(`Deal marked as Lost. Reason: ${lostReason.slice(0, 60)}`);
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Lost Reason Dialog */}
      <Dialog open={lostDialogOpen} onOpenChange={(open) => {
        if (!open) { setLostDialogOpen(false); setPendingLostStage(false); }
      }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Mark Deal as Lost</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Lost Reason Category *</Label>
              <Select
                value={lostCategory}
                onValueChange={(v) => setLostCategory((v ?? "") as LostReasonCategory)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason category…" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(LOST_REASON_CATEGORIES) as [LostReasonCategory, string][]).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
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
            <Button variant="outline" onClick={() => { setLostDialogOpen(false); setPendingLostStage(false); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmLost} disabled={!lostReason.trim() || !lostCategory}>
              Confirm Lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/crm/deals")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Deals
        </Button>
      </div>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{deal.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{deal.company}</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={currentStage}
            onValueChange={handleStageChange}
            disabled={isTerminal}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(stageLabels) as DealStage[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {stageLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <StatusBadge status={currentStage} />
        </div>
      </div>

      {/* Stage flow */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
        {stageOrder.map((s, idx) => {
          const isActive = currentStage === s;
          const isPast =
            currentStage === "closed_won"
              ? true
              : stageOrder.indexOf(currentStage) > idx;
          return (
            <div key={s} className="flex items-center gap-1 shrink-0">
              <button
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isPast
                    ? "bg-green-100 text-green-700 border border-green-200"
                    : "bg-muted text-muted-foreground border border-border"
                } ${isTerminal ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}
                onClick={() => !isTerminal && handleStageChange(s)}
                disabled={isTerminal}
              >
                {stageLabels[s]}
              </button>
              {idx < stageOrder.length - 1 && (
                <span className="text-muted-foreground text-xs">→</span>
              )}
            </div>
          );
        })}
        <span className="text-muted-foreground text-xs mx-1">↘</span>
        <button
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            currentStage === "closed_lost"
              ? "bg-red-100 text-red-700 border border-red-200"
              : "bg-muted text-muted-foreground border border-border"
          } ${isTerminal ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}
          onClick={() => !isTerminal && handleStageChange("closed_lost")}
          disabled={isTerminal}
        >
          Lost
        </button>
      </div>

      {/* WO Creation Banner */}
      {woState === "CREATING" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center gap-3 mb-4 animate-pulse">
          <Factory className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm font-medium text-amber-800">Creating Work Order automatically…</p>
        </div>
      )}
      {woState === "CREATED" && woResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex items-start gap-3 mb-4">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-800">
              Work Order {woResult.pid} created automatically
            </p>
            <p className="text-xs text-green-700 mt-1">
              MRP complete: {woResult.reservedItems} components reserved
              {woResult.shortfallItems > 0 && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                  <span className="text-amber-700">{woResult.shortfallItems} item needs procurement</span>
                </span>
              )}
            </p>
          </div>
          <Link href="/manufacturing/work-orders">
            <Button size="sm" variant="outline" className="shrink-0">
              View Work Order
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="products">Products &amp; GST</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
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
                  <div>
                    <p className="text-xs text-muted-foreground">Company</p>
                    <p className="text-sm font-medium">{deal.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
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
                    <p className="text-sm font-medium">{formatCurrency(deal.value)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Percent className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Probability</p>
                    <div className="flex items-center gap-2">
                      <Progress value={deal.probability} className="h-2 w-24" />
                      <span className="text-sm font-medium">{deal.probability}%</span>
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
                    <p className="text-xs text-muted-foreground">Expected Close</p>
                    <p className="text-sm font-medium">{formatDate(deal.expectedClose)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p className="text-sm font-medium">{formatDate(deal.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Assigned To</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {user && (
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                            {user.avatar}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="text-sm font-medium">{user?.name ?? "Unassigned"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <Package className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Products</p>
                    <p className="text-sm font-medium">{deal.products.length} item(s)</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Linked Records card */}
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Linked Records</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Work Order */}
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Factory className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Work Order</p>
                        <p className="text-sm font-medium">
                          {woResult?.pid ?? "Not yet created"}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={woState === "CREATED" ? "IN_PROGRESS" : "PENDING"} />
                  </div>

                  {/* Quotation */}
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Quotation</p>
                        <p className="text-sm font-medium">v1 — SENT</p>
                      </div>
                    </div>
                    <Link href="/crm/quotations">
                      <Button size="sm" variant="ghost" className="h-7 text-xs">
                        View <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  </div>

                  {/* Order Confirmation */}
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Order Confirmation</p>
                        <p className="text-sm font-medium">
                          {currentStage !== "closed_won" ? "Pending" : "Ready to raise"}
                        </p>
                      </div>
                    </div>
                    {currentStage === "closed_won" && woState === "CREATED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => toast.info("Order Confirmation flow: navigate to Sales Orders to raise OC.")}
                      >
                        Raise OC
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Products &amp; GST</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>HSN Code</TableHead>
                      <TableHead>GST Rate</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Line Total</TableHead>
                      <TableHead className="text-right">GST Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deal.products.map((item, idx) => {
                      const product = getProductById(item.productId);
                      const unitPrice = product?.price ?? 0;
                      const lineTotal = unitPrice * item.quantity;
                      const gstRate = 0.18;
                      const gstAmount = lineTotal * gstRate;
                      const isDevice = product?.category === "Devices";
                      const hsnCode = isDevice ? "8471" : "3822";

                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium text-sm">
                            {product?.name ?? item.productId}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {product?.sku ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {hsnCode}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-xs">18%</Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                          <TableCell className="text-right text-sm">
                            {formatCurrency(unitPrice)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatCurrency(lineTotal)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {formatCurrency(gstAmount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {/* Summary rows */}
                    {(() => {
                      const subtotal = deal.products.reduce((sum, item) => {
                        const product = getProductById(item.productId);
                        return sum + (product?.price ?? 0) * item.quantity;
                      }, 0);
                      const cgst = subtotal * 0.09;
                      const sgst = subtotal * 0.09;
                      const total = subtotal + cgst + sgst;
                      return (
                        <>
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={6} className="text-right text-sm text-muted-foreground">
                              Subtotal
                            </TableCell>
                            <TableCell colSpan={2} className="text-right text-sm font-medium">
                              {formatCurrency(subtotal)}
                            </TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={6} className="text-right text-xs text-muted-foreground">
                              CGST 9% (Intra-state)
                            </TableCell>
                            <TableCell colSpan={2} className="text-right text-xs text-muted-foreground">
                              {formatCurrency(cgst)}
                            </TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={6} className="text-right text-xs text-muted-foreground">
                              SGST 9% (Intra-state)
                            </TableCell>
                            <TableCell colSpan={2} className="text-right text-xs text-muted-foreground">
                              {formatCurrency(sgst)}
                            </TableCell>
                          </TableRow>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={6} className="text-right font-semibold text-sm">
                              Grand Total (incl. GST)
                            </TableCell>
                            <TableCell colSpan={2} className="text-right font-semibold text-sm">
                              {formatCurrency(total)}
                            </TableCell>
                          </TableRow>
                        </>
                      );
                    })()}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed activities={dealActivities} maxHeight="600px" />
            </CardContent>
          </Card>
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
                  <div key={idx} className="relative flex items-start gap-4">
                    <div className="absolute left-[-18px] top-1.5 w-3 h-3 rounded-full border-2 border-primary bg-background" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{event.label}</p>
                        <StatusBadge status={event.stage} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(event.date)}
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
