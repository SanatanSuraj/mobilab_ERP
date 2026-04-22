"use client";

/**
 * /crm/leads/[id] — real-API-backed lead detail page.
 *
 * The state machine exposed by the backend (see apps/api leads.service.ts):
 *
 *   NEW ──(first CALL/EMAIL/WHATSAPP/MEETING activity)──► CONTACTED
 *   (CONTACTED or NEW) ──POST /convert──► CONVERTED  (+ mints account + deal)
 *   (CONTACTED or NEW) ──POST /lose──► LOST           (requires reason)
 *
 * There is no explicit "Mark Qualified" transition in the API, so we do
 * not surface one in the UI — Qualified only exists as a target status in
 * the enum; the server never sets it automatically and there is no
 * endpoint for it. If product decides to add one we'll drop a button in.
 *
 * CONVERTED / LOST are terminal and every write-endpoint rejects writes
 * in those states with 409. We reflect that by hiding the action panel.
 */

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Handshake,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  PhoneCall,
  PlusCircle,
  ShieldAlert,
  User,
  XCircle,
  Zap,
} from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import {
  useApiAddLeadActivity,
  useApiConvertLead,
  useApiLead,
  useApiLeadActivities,
  useApiMarkLeadLost,
} from "@/hooks/useCrmApi";
import { useTenantAuthGuard } from "@/hooks/useTenantAuthGuard";
import { formatCurrencyStr, formatDateTime, formatRelativeDate } from "@/lib/format";
import { ApiProblem } from "@/lib/api/tenant-fetch";
import type {
  Lead,
  LeadActivity,
  LeadActivityType,
  LeadStatus,
} from "@instigenie/contracts";

// ─── Activity type presentation ────────────────────────────────────────────

const ACTIVITY_ICON: Record<LeadActivityType, typeof Phone> = {
  CALL: Phone,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  NOTE: FileText,
  MEETING: Calendar,
  STATUS_CHANGE: CheckCircle2,
};

const ACTIVITY_COLOR: Record<LeadActivityType, string> = {
  CALL: "bg-blue-100 text-blue-600",
  EMAIL: "bg-purple-100 text-purple-600",
  WHATSAPP: "bg-green-100 text-green-600",
  NOTE: "bg-gray-100 text-gray-600",
  MEETING: "bg-amber-100 text-amber-600",
  STATUS_CHANGE: "bg-indigo-100 text-indigo-600",
};

// The activity types a user can manually log. STATUS_CHANGE is emitted
// only by the backend as a side-effect of mark-lost / convert / auto-
// transitions — letting a user submit one directly would muddy the audit
// trail, so we gate it out of the picker.
const LOGGABLE_ACTIVITY_TYPES: LeadActivityType[] = [
  "CALL",
  "EMAIL",
  "WHATSAPP",
  "NOTE",
  "MEETING",
];

// Status progression — keeps in sync with LeadStatusSchema. "LOST" is off
// this lane (shown separately when reached).
const STATUS_PROGRESSION: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "CONVERTED",
];

function statusBadgeKey(s: LeadStatus): string {
  // StatusBadge palette for lead statuses keys on lowercase.
  return s.toLowerCase();
}

function statusIndex(s: LeadStatus): number {
  if (s === "LOST") return -1;
  return STATUS_PROGRESSION.indexOf(s);
}

function shortId(id: string | null | undefined): string {
  if (!id) return "Unassigned";
  return id.slice(0, 8);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const leadId = params?.id;
  const guard = useTenantAuthGuard();

  const authed = guard === "authenticated";
  const leadQuery = useApiLead(authed ? leadId : undefined);
  const activitiesQuery = useApiLeadActivities(authed ? leadId : undefined);

  const [logOpen, setLogOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">
            {guard === "redirecting" ? "Redirecting to login…" : "Checking session…"}
          </span>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (leadQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ── 401 ───────────────────────────────────────────────────────────────────
  const err = leadQuery.error;
  const is401 = err instanceof ApiProblem && err.problem.status === 401;
  if (is401) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <ShieldAlert className="h-8 w-8 text-amber-500" />
          <h2 className="text-lg font-semibold">Session expired</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your login has expired. Please sign in again.
          </p>
          <Button
            onClick={() => router.replace(`/auth/login?from=/crm/leads/${leadId ?? ""}`)}
          >
            Go to login
          </Button>
        </div>
      </div>
    );
  }

  const lead = leadQuery.data;
  if (!lead) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold mb-2">Lead not found</h2>
          <p className="text-muted-foreground mb-4">
            The lead you are looking for does not exist or you do not have access.
          </p>
          <Button variant="outline" onClick={() => router.push("/crm/leads")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Leads
          </Button>
        </div>
      </div>
    );
  }

  const activities = activitiesQuery.data ?? [];
  const terminal = lead.status === "CONVERTED" || lead.status === "LOST";
  const canConvert = !terminal;
  const canMarkLost = !terminal;
  const curIdx = statusIndex(lead.status);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4"
        onClick={() => router.push("/crm/leads")}
      >
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Leads
      </Button>

      {lead.isDuplicate && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="text-sm font-medium">
            Possible duplicate of lead{" "}
            {lead.duplicateOfLeadId ? (
              <Link
                href={`/crm/leads/${lead.duplicateOfLeadId}`}
                className="font-semibold underline"
              >
                {shortId(lead.duplicateOfLeadId)}
              </Link>
            ) : (
              <span className="font-mono">(unknown)</span>
            )}
          </p>
        </div>
      )}

      {/* ── Header with name, status, and action panel ────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
              <StatusBadge status={statusBadgeKey(lead.status)} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span>{lead.company}</span>
              <span className="font-medium text-foreground">
                {formatCurrencyStr(lead.estimatedValue)}
              </span>
              {lead.source && (
                <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                  {lead.source}
                </span>
              )}
            </div>
          </div>
        </div>

        {!terminal && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogOpen(true)}
            >
              <PlusCircle className="h-4 w-4 mr-1.5" />
              Log Activity
            </Button>

            {lead.status === "NEW" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogOpen(true)}
                title="Log a call/email/meeting to auto-advance to Contacted"
              >
                <PhoneCall className="h-4 w-4 mr-1.5 text-blue-600" />
                First Outreach
              </Button>
            )}

            {canConvert && (
              <Button size="sm" onClick={() => setConvertOpen(true)}>
                <Handshake className="h-4 w-4 mr-1.5" />
                Convert to Deal
              </Button>
            )}

            {canMarkLost && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLostOpen(true)}
                className="text-destructive border-destructive/30 hover:bg-destructive/5"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Mark Lost
              </Button>
            )}
          </div>
        )}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activities">
            Activities
            {activities.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-1.5 text-[10px] h-4 px-1"
              >
                {activities.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* ── Overview ───────────────────────────────────────────────────── */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contact Information</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { icon: Mail, label: "Email", value: lead.email },
                    { icon: Phone, label: "Phone", value: lead.phone },
                    { icon: Zap, label: "Source", value: lead.source ?? "—" },
                    {
                      icon: User,
                      label: "Assigned",
                      value: shortId(lead.assignedTo),
                    },
                    {
                      icon: Calendar,
                      label: "Created",
                      value: formatDateTime(lead.createdAt),
                    },
                    {
                      icon: Clock,
                      label: "Last Activity",
                      value: lead.lastActivityAt
                        ? formatRelativeDate(lead.lastActivityAt)
                        : "—",
                    },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-start gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="text-sm font-medium break-words">
                          {value}
                        </dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {lead.status === "CONVERTED" && (
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

              {lead.status === "LOST" && lead.lostReason && (
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Estimated Value</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums">
                    {formatCurrencyStr(lead.estimatedValue)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Estimated deal value
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Activities ───────────────────────────────────────────────────── */}
        <TabsContent value="activities">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Activity Log ({activities.length})
              </CardTitle>
              {!terminal && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLogOpen(true)}
                >
                  <PlusCircle className="h-3.5 w-3.5 mr-1.5" />
                  Log Activity
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {activitiesQuery.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : activities.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground mb-3">
                    No activities yet
                  </p>
                  {!terminal && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLogOpen(true)}
                    >
                      Log first activity
                    </Button>
                  )}
                </div>
              ) : (
                <ActivityList activities={activities} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Timeline (stepper + event feed) ────────────────────────────── */}
        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status Progression</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-0 mb-8">
                {STATUS_PROGRESSION.map((status, idx) => {
                  const isActive = lead.status !== "LOST" && idx <= curIdx;
                  const isCurrent = lead.status === status;
                  return (
                    <div key={status} className="flex items-center flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                            isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted text-muted-foreground border-muted"
                          } ${isCurrent ? "ring-2 ring-primary/30 ring-offset-2" : ""}`}
                        >
                          {idx + 1}
                        </div>
                        <span
                          className={`text-xs mt-2 capitalize ${
                            isActive
                              ? "font-medium text-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          {status.toLowerCase()}
                        </span>
                      </div>
                      {idx < STATUS_PROGRESSION.length - 1 && (
                        <div
                          className={`h-0.5 flex-1 -mt-5 ${
                            lead.status !== "LOST" && idx < curIdx
                              ? "bg-primary"
                              : "bg-muted"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {lead.status === "LOST" && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50/50 mb-6">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-semibold text-red-800">
                      Lead Lost
                    </span>
                  </div>
                  {lead.lostReason && (
                    <p className="text-sm text-red-700 ml-6">
                      {lead.lostReason}
                    </p>
                  )}
                </div>
              )}

              <div className="border-t pt-5">
                <h3 className="text-sm font-semibold mb-4">Event Timeline</h3>
                {activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No events yet.
                  </p>
                ) : (
                  <div className="space-y-0">
                    {activities.map((activity, idx, arr) => {
                      const Icon = ACTIVITY_ICON[activity.type];
                      const colorClass = ACTIVITY_COLOR[activity.type];
                      return (
                        <div
                          key={activity.id}
                          className="flex gap-3 relative"
                        >
                          {idx < arr.length - 1 && (
                            <div className="absolute left-[14px] top-8 bottom-0 w-px bg-border" />
                          )}
                          <div
                            className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 pb-4">
                            <p className="text-sm">{activity.content}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDateTime(activity.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Floating action dialogs ────────────────────────────────────────── */}
      <LogActivityDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        leadId={lead.id}
        leadName={lead.name}
      />
      <ConvertLeadDialogInline
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={lead}
        onConverted={() => router.refresh()}
      />
      <MarkLostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        leadId={lead.id}
        leadName={lead.name}
      />
    </div>
  );
}

// ─── Activity list (shared by Activities tab, reverse-chron) ───────────────

function ActivityList({ activities }: { activities: LeadActivity[] }) {
  return (
    <div className="space-y-0">
      {activities.map((activity, idx, arr) => {
        const Icon = ACTIVITY_ICON[activity.type];
        const colorClass = ACTIVITY_COLOR[activity.type];
        return (
          <div key={activity.id} className="flex gap-3 relative">
            {idx < arr.length - 1 && (
              <div className="absolute left-[18px] top-10 bottom-0 w-px bg-border" />
            )}
            <div
              className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 pb-5">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="text-sm font-medium">
                  {shortId(activity.actorId)}
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-4"
                >
                  {activity.type.toLowerCase().replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDateTime(activity.createdAt)}
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
  );
}

// ─── Log Activity Dialog ───────────────────────────────────────────────────

function LogActivityDialog({
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
  const addActivity = useApiAddLeadActivity(leadId);
  const [type, setType] = useState<LeadActivityType>("CALL");
  const [content, setContent] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      await addActivity.mutateAsync({ type, content: content.trim() });
      toast.success(`Activity logged on ${leadName}`);
      setContent("");
      setType("CALL");
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiProblem
          ? err.problem.detail ?? err.problem.title ?? "Failed to log activity"
          : "Failed to log activity.";
      toast.error(msg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            Log Activity
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(v) => v && setType(v as LeadActivityType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOGGABLE_ACTIVITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Logging a Call / Email / WhatsApp / Meeting on a NEW lead
              automatically advances it to CONTACTED.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="la-content">
              Note <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="la-content"
              placeholder="Spoke with Dr. Gupta — interested in a demo next week."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={addActivity.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!content.trim() || addActivity.isPending}
            >
              {addActivity.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Log Activity"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Convert Lead Dialog ───────────────────────────────────────────────────

function ConvertLeadDialogInline({
  open,
  onOpenChange,
  lead,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: Lead;
  onConverted: () => void;
}) {
  const convert = useApiConvertLead(lead.id);
  const [dealTitle, setDealTitle] = useState(
    `${lead.company} — ${lead.name}`
  );
  const [dealValue, setDealValue] = useState(lead.estimatedValue);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dealTitle.trim() || !dealValue.trim()) return;
    try {
      await convert.mutateAsync({
        dealTitle: dealTitle.trim(),
        dealValue: dealValue.trim(),
        dealStage: "DISCOVERY",
      });
      toast.success(`Lead converted — deal created`, {
        description: `${dealTitle.trim()} is now in the Discovery stage.`,
      });
      onOpenChange(false);
      onConverted();
    } catch (err) {
      const msg =
        err instanceof ApiProblem
          ? err.problem.detail ?? err.problem.title ?? "Failed to convert lead"
          : "Failed to convert lead.";
      toast.error(msg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-4 w-4" />
            Convert to Deal
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">
            Creates an <strong>Account</strong> for {lead.company} and a new{" "}
            <strong>Deal</strong> in the Discovery stage. The lead moves to
            CONVERTED and is locked.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="cl-title">
              Deal Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cl-title"
              value={dealTitle}
              onChange={(e) => setDealTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cl-value">
              Deal Value (₹) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cl-value"
              inputMode="decimal"
              placeholder="500000"
              value={dealValue}
              onChange={(e) => setDealValue(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={convert.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !dealTitle.trim() || !dealValue.trim() || convert.isPending
              }
            >
              {convert.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Convert"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Mark Lost Dialog ──────────────────────────────────────────────────────

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
  const markLost = useApiMarkLeadLost(leadId);
  const [reason, setReason] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    try {
      await markLost.mutateAsync({ reason: reason.trim() });
      toast.success(`${leadName} marked as lost.`);
      setReason("");
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof ApiProblem
          ? err.problem.detail ?? err.problem.title ?? "Failed to mark lost"
          : "Failed to mark lead as lost.";
      toast.error(msg);
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
            <Label htmlFor="ml-reason">
              Loss Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ml-reason"
              placeholder="Chose competitor — lower price from MedEquip Corp"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={markLost.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!reason.trim() || markLost.isPending}
            >
              {markLost.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Mark Lost"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
