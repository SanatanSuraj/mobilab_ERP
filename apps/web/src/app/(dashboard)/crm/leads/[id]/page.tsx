"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { LogActivitySheet } from "@/components/crm/leads/LogActivitySheet";
import { ConvertLeadDialog } from "@/components/crm/leads/ConvertLeadDialog";
import { useLead, useUpdateLeadStatus, useMarkLeadLost } from "@/hooks/useCrm";
import { getUserById, formatCurrency, formatDate } from "@/data/mock";
import type { LeadActivity, EnhancedLeadStatus } from "@/data/crm-mock";
import { toast } from "sonner";
import {
  Phone,
  Mail,
  MessageCircle,
  FileText,
  Calendar,
  ArrowRightLeft,
  AlertTriangle,
  ExternalLink,
  ArrowLeft,
  Building2,
  DollarSign,
  User,
  Clock,
  Zap,
  PhoneCall,
  CheckCircle2,
  XCircle,
  Handshake,
  PlusCircle,
  Loader2,
} from "lucide-react";

const activityIcons: Record<LeadActivity["type"], typeof Phone> = {
  call: Phone, email: Mail, whatsapp: MessageCircle,
  note: FileText, meeting: Calendar, status_change: ArrowRightLeft,
};

const activityColors: Record<LeadActivity["type"], string> = {
  call: "bg-blue-100 text-blue-600",
  email: "bg-purple-100 text-purple-600",
  whatsapp: "bg-green-100 text-green-600",
  note: "bg-gray-100 text-gray-600",
  meeting: "bg-amber-100 text-amber-600",
  status_change: "bg-indigo-100 text-indigo-600",
};

const statusProgression: EnhancedLeadStatus[] = ["new", "contacted", "qualified", "converted"];

function getStatusIndex(status: EnhancedLeadStatus): number {
  if (status === "lost") return -1;
  return statusProgression.indexOf(status);
}

// ─── Mark Lost Dialog ────────────────────────────────────────────────────────

function MarkLostDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadId: string;
  leadName: string;
}) {
  const router = useRouter();
  const markLost = useMarkLeadLost();
  const [reason, setReason] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    try {
      await markLost.mutateAsync({ leadId, input: { reason } });
      toast.success(`${leadName} marked as lost.`);
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Failed to mark lead as lost.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            Mark Lead as Lost
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="lost-reason">
              Loss Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="lost-reason"
              placeholder="Chose competitor — lower price from MedEquip Corp"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!reason.trim() || markLost.isPending}>
              {markLost.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark Lost"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;

  const { data: lead, isLoading } = useLead(leadId);
  const updateStatus = useUpdateLeadStatus();

  const [logOpen, setLogOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!lead) {
    return (
      <div className="p-6">
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold mb-2">Lead not found</h2>
          <p className="text-muted-foreground mb-4">The lead you are looking for does not exist.</p>
          <Button variant="outline" onClick={() => router.push("/crm/leads")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Leads
          </Button>
        </div>
      </div>
    );
  }

  const assignedUser = getUserById(lead.assignedTo);
  const currentIdx = getStatusIndex(lead.status);

  async function handleAdvanceStatus(status: EnhancedLeadStatus) {
    try {
      await updateStatus.mutateAsync({ id: leadId, status });
      toast.success(`Lead moved to ${status}`);
    } catch {
      toast.error("Failed to update status.");
    }
  }

  // ── Action Panel ───────────────────────────────────────────────────────────
  const showActions = lead.status !== "converted" && lead.status !== "lost";

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => router.push("/crm/leads")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Leads
      </Button>

      {/* Duplicate Banner */}
      {lead.isDuplicate && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="text-sm font-medium">
            Possible duplicate of lead{" "}
            <Link href={`/crm/leads/${lead.duplicateOf}`} className="font-semibold underline">
              {lead.duplicateOf}
            </Link>
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
              <StatusBadge status={lead.status} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span>{lead.company}</span>
              <span className="font-medium text-foreground">{formatCurrency(lead.estimatedValue)}</span>
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{lead.source}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        {showActions && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogOpen(true)}
            >
              <PlusCircle className="h-4 w-4 mr-1.5" />
              Log Activity
            </Button>

            {lead.status === "new" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAdvanceStatus("contacted")}
                disabled={updateStatus.isPending}
              >
                <PhoneCall className="h-4 w-4 mr-1.5 text-blue-600" />
                Mark Contacted
              </Button>
            )}

            {lead.status === "contacted" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAdvanceStatus("qualified")}
                disabled={updateStatus.isPending}
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5 text-purple-600" />
                Mark Qualified
              </Button>
            )}

            {(lead.status === "qualified" || lead.status === "contacted") && (
              <Button
                size="sm"
                onClick={() => setConvertOpen(true)}
              >
                <Handshake className="h-4 w-4 mr-1.5" />
                Convert to Deal
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setLostOpen(true)}
              className="text-destructive border-destructive/30 hover:bg-destructive/5"
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              Mark Lost
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activities">
            Activities
            {lead.activities.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] h-4 px-1">
                {lead.activities.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Information</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { icon: Mail,     label: "Email",       value: lead.email },
                    { icon: Phone,    label: "Phone",       value: lead.phone },
                    { icon: Zap,      label: "Source",      value: lead.source },
                    { icon: User,     label: "Assigned To", value: assignedUser?.name ?? "Unassigned" },
                    { icon: Calendar, label: "Created",     value: formatDate(lead.createdAt) },
                    { icon: Clock,    label: "Last Activity", value: formatDate(lead.lastActivity) },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-start gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="text-sm font-medium">{value}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {/* Converted card */}
              {lead.status === "converted" && (
                <Card className="border-green-200 bg-green-50/50">
                  <CardHeader>
                    <CardTitle className="text-base text-green-800 flex items-center gap-2">
                      <Zap className="h-4 w-4" /> Successfully Converted
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {lead.convertedToAccountId && (
                      <Link
                        href={`/crm/accounts/${lead.convertedToAccountId}`}
                        className="flex items-center gap-2 text-sm text-green-700 hover:underline"
                      >
                        <Building2 className="h-4 w-4" /> View Account
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                    {lead.convertedToDealId && (
                      <Link
                        href={`/crm/deals/${lead.convertedToDealId}`}
                        className="flex items-center gap-2 text-sm text-green-700 hover:underline"
                      >
                        <DollarSign className="h-4 w-4" /> View Deal
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Lost card */}
              {lead.status === "lost" && lead.lostReason && (
                <Card className="border-red-200 bg-red-50/50">
                  <CardHeader>
                    <CardTitle className="text-base text-red-800 flex items-center gap-2">
                      <XCircle className="h-4 w-4" /> Lead Lost
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-red-700">{lead.lostReason}</p>
                  </CardContent>
                </Card>
              )}

              {/* Value card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Estimated Value</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums">{formatCurrency(lead.estimatedValue)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Estimated deal value</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Activities Tab ────────────────────────────────────────────────── */}
        <TabsContent value="activities">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Activity Log ({lead.activities.length})
              </CardTitle>
              {showActions && (
                <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
                  <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
                  Log Activity
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {lead.activities.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground mb-3">No activities yet</p>
                  {showActions && (
                    <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
                      Log first activity
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-0">
                  {[...lead.activities].reverse().map((activity, idx, arr) => {
                    const Icon = activityIcons[activity.type];
                    const colorClass = activityColors[activity.type];
                    const actUser = getUserById(activity.user);

                    return (
                      <div key={activity.id} className="flex gap-3 relative">
                        {idx < arr.length - 1 && (
                          <div className="absolute left-[18px] top-10 bottom-0 w-px bg-border" />
                        )}
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 pb-5">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="text-sm font-medium">{actUser?.name ?? "System"}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                              {activity.type.replace("_", " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {formatDate(activity.timestamp)}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {activity.content}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Timeline Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status Progression</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Progress stepper */}
              <div className="flex items-center gap-0 mb-8">
                {statusProgression.map((status, idx) => {
                  const isActive = lead.status !== "lost" && idx <= currentIdx;
                  const isCurrent = lead.status === status;
                  return (
                    <div key={status} className="flex items-center flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                          isActive
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted text-muted-foreground border-muted"
                        } ${isCurrent ? "ring-2 ring-primary/30 ring-offset-2" : ""}`}>
                          {idx + 1}
                        </div>
                        <span className={`text-xs mt-2 capitalize ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                          {status}
                        </span>
                      </div>
                      {idx < statusProgression.length - 1 && (
                        <div className={`h-0.5 flex-1 -mt-5 ${lead.status !== "lost" && idx < currentIdx ? "bg-primary" : "bg-muted"}`} />
                      )}
                    </div>
                  );
                })}
              </div>

              {lead.status === "lost" && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50/50 mb-6">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-semibold text-red-800">Lead Lost</span>
                  </div>
                  {lead.lostReason && (
                    <p className="text-sm text-red-700 ml-6">{lead.lostReason}</p>
                  )}
                </div>
              )}

              {/* Event timeline */}
              <div className="border-t pt-5">
                <h3 className="text-sm font-semibold mb-4">Event Timeline</h3>
                <div className="space-y-0">
                  {[...lead.activities].reverse().map((activity, idx, arr) => {
                    const Icon = activityIcons[activity.type];
                    const colorClass = activityColors[activity.type];
                    return (
                      <div key={activity.id} className="flex gap-3 relative">
                        {idx < arr.length - 1 && (
                          <div className="absolute left-[14px] top-8 bottom-0 w-px bg-border" />
                        )}
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 pb-4">
                          <p className="text-sm">{activity.content}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(activity.timestamp)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Floating Action Sheets / Dialogs ─────────────────────────────────── */}
      <LogActivitySheet
        open={logOpen}
        onOpenChange={setLogOpen}
        leadId={leadId}
        leadName={lead.name}
      />

      <ConvertLeadDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={lead}
      />

      <MarkLostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        leadId={leadId}
        leadName={lead.name}
      />
    </div>
  );
}
