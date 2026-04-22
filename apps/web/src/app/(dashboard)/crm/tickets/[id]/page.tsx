"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useApiAccount,
  useApiAddTicketComment,
  useApiContact,
  useApiTicket,
  useApiTicketComments,
  useApiTransitionTicketStatus,
  useApiUpdateTicket,
} from "@/hooks/useCrmApi";
import { formatDate } from "@/data/mock";
import type {
  TicketCategory,
  TicketPriority,
  TicketStatus,
  UpdateTicket,
} from "@instigenie/contracts";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Cpu,
  Package,
  Pencil,
  Save,
  Send,
  Tag,
  User,
  X,
} from "lucide-react";

/**
 * Ticket detail — /crm/tickets/:id via useApiTicket + comments + status.
 *
 * Migration deltas from the mock page:
 *   - Status / priority / category are UPPER_CASE (TicketStatus enum). The
 *     linear status flow uses the contract enum order.
 *   - Status changes go through POST /crm/tickets/:id/transition with
 *     expectedVersion. 409 → toast + refetch.
 *   - Comments are fetched lazily (useApiTicketComments) and added via the
 *     POST /crm/tickets/:id/comments mutation. The mock's UI-only state is
 *     gone; React Query owns the list.
 *   - Comment visibility uses INTERNAL / CUSTOMER enum, not "type".
 *   - `actorId` is a bare uuid now — the backend doesn't return user
 *     metadata inline, so we show a uuid prefix until a users API lands.
 *   - Dropped tabs / cards: Device Traceability (no real endpoint), product
 *     lookup (contract has `productCode: string | null` but no products
 *     catalog on the CRM side).
 *   - Account/contact names are side-fetched via useApiAccount/useApiContact
 *     for humane labels. Avoid joining server-side on the ticket read path.
 */

const STATUS_FLOW: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
];

function statusLabel(s: TicketStatus): string {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  HARDWARE_DEFECT: "Hardware Defect",
  CALIBRATION: "Calibration",
  SOFTWARE_BUG: "Software Bug",
  TRAINING: "Training",
  WARRANTY_CLAIM: "Warranty Claim",
  GENERAL_INQUIRY: "General Inquiry",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

// Inline-edit draft. Empty strings for nullable fields → caller omits them
// from the PATCH body (backend treats them as "don't touch").
type EditDraft = {
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  deviceSerial: string;
  productCode: string;
};

/**
 * Human-readable SLA countdown. Returns "Resolved" for terminal statuses
 * and "No SLA" when the backend hasn't set a deadline yet.
 */
function getSlaDisplay(
  slaDeadline: string | null,
  status: TicketStatus
): { text: string; isBreached: boolean } {
  if (status === "RESOLVED" || status === "CLOSED") {
    return { text: "Resolved", isBreached: false };
  }
  if (!slaDeadline) {
    return { text: "No SLA", isBreached: false };
  }
  const now = new Date();
  const deadline = new Date(slaDeadline);
  const diff = deadline.getTime() - now.getTime();
  if (diff <= 0) {
    return { text: "SLA Breached", isBreached: true };
  }
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return { text: `${days}d ${hours % 24}h remaining`, isBreached: false };
  }
  return { text: `${hours}h ${mins}m remaining`, isBreached: false };
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ticketId = params.id as string;

  const ticketQuery = useApiTicket(ticketId);
  const commentsQuery = useApiTicketComments(ticketId);
  const transitionMut = useApiTransitionTicketStatus(ticketId);
  const addCommentMut = useApiAddTicketComment(ticketId);
  const updateMut = useApiUpdateTicket(ticketId);

  // Side-fetches for humane labels.
  const accountQuery = useApiAccount(
    ticketQuery.data?.accountId ?? undefined
  );
  const contactQuery = useApiContact(
    ticketQuery.data?.contactId ?? undefined
  );

  // INTERNAL by default — matches mock "internal note first" behaviour.
  const [isInternal, setIsInternal] = useState(true);
  const [newComment, setNewComment] = useState("");

  // Inline-edit state. Seeded from the server row on every Edit click so
  // the form always reflects the latest known version+values.
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<EditDraft>({
    subject: "",
    description: "",
    category: "HARDWARE_DEFECT",
    priority: "MEDIUM",
    deviceSerial: "",
    productCode: "",
  });

  if (ticketQuery.isLoading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (ticketQuery.isError || !ticketQuery.data) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3 mb-4">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Ticket not found</p>
            <p className="text-red-700 mt-1">
              {ticketQuery.error instanceof Error
                ? ticketQuery.error.message
                : "The ticket you are looking for does not exist or you do not have access."}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push("/crm/tickets")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Tickets
        </Button>
      </div>
    );
  }

  const ticket = ticketQuery.data;
  const comments = commentsQuery.data ?? [];
  const sla = getSlaDisplay(ticket.slaDeadline, ticket.status);

  const currentIdx = STATUS_FLOW.indexOf(ticket.status);
  const nextStatus =
    currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1
      ? STATUS_FLOW[currentIdx + 1]
      : null;

  const accountName = ticket.accountId
    ? accountQuery.data?.name ?? "Loading…"
    : "—";
  const contactName = ticket.contactId
    ? contactQuery.data
      ? `${contactQuery.data.firstName} ${contactQuery.data.lastName}`
      : "Loading…"
    : "—";

  const advanceStatus = () => {
    if (!nextStatus) return;
    transitionMut.mutate(
      {
        status: nextStatus,
        expectedVersion: ticket.version,
      },
      {
        onSuccess: () => {
          toast.success(`Status updated to ${statusLabel(nextStatus)}`);
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to update status"
          );
          ticketQuery.refetch();
        },
      }
    );
  };

  const addComment = () => {
    const content = newComment.trim();
    if (!content) return;
    addCommentMut.mutate(
      {
        content,
        visibility: isInternal ? "INTERNAL" : "CUSTOMER",
      },
      {
        onSuccess: () => {
          setNewComment("");
          toast.success("Comment added");
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to add comment"
          );
        },
      }
    );
  };

  const isTerminal =
    ticket.status === "RESOLVED" || ticket.status === "CLOSED";

  function startEdit() {
    setDraft({
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      priority: ticket.priority,
      deviceSerial: ticket.deviceSerial ?? "",
      productCode: ticket.productCode ?? "",
    });
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  function handleSave() {
    const subject = draft.subject.trim();
    const description = draft.description.trim();
    if (!subject || !description) {
      toast.error("Subject and description are required.");
      return;
    }
    if (subject.length > 200) {
      toast.error("Subject must be 200 characters or fewer.");
      return;
    }
    if (description.length > 4000) {
      toast.error("Description must be 4000 characters or fewer.");
      return;
    }

    const body: UpdateTicket = {
      subject,
      description,
      category: draft.category,
      priority: draft.priority,
      expectedVersion: ticket.version,
    };
    // Empty-string nullable fields → omit from PATCH; the backend keeps the
    // existing value rather than nulling it out.
    const deviceSerial = draft.deviceSerial.trim();
    if (deviceSerial) body.deviceSerial = deviceSerial;
    const productCode = draft.productCode.trim();
    if (productCode) body.productCode = productCode;

    updateMut.mutate(body, {
      onSuccess: () => {
        toast.success("Ticket updated");
        setEditMode(false);
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to update ticket"
        );
        // 409 → fresh read so the next attempt has the new version.
        ticketQuery.refetch();
      },
    });
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/crm/tickets"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          aria-disabled={editMode}
          onClick={(e) => {
            if (editMode) e.preventDefault();
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tickets
        </Link>
        {editMode ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelEdit}
              disabled={updateMut.isPending}
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateMut.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {updateMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={startEdit}
            disabled={isTerminal}
            title={
              isTerminal
                ? "Closed tickets cannot be edited"
                : "Edit ticket details"
            }
          >
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
        )}
      </div>

      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {ticket.ticketNumber}
            </h1>
            <StatusBadge status={ticket.priority} />
            <StatusBadge status={ticket.status} />
          </div>
          {editMode ? (
            <Input
              value={draft.subject}
              onChange={(e) =>
                setDraft((d) => ({ ...d, subject: e.target.value }))
              }
              placeholder="Ticket subject"
              maxLength={200}
              className="mt-1"
            />
          ) : (
            <p className="text-sm text-muted-foreground">{ticket.subject}</p>
          )}
        </div>
        <div
          className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${
            sla.isBreached
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-green-50 text-green-700 border border-green-200"
          }`}
        >
          {sla.isBreached ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
          {sla.text}
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="comments">
            Comments{commentsQuery.data ? ` (${comments.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Account</span>
                </div>
                {ticket.accountId ? (
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline text-left"
                    onClick={() =>
                      router.push(`/crm/accounts/${ticket.accountId}`)
                    }
                  >
                    {accountName}
                  </button>
                ) : (
                  <p className="text-sm font-medium">—</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <User className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Contact</span>
                </div>
                <p className="text-sm font-medium">{contactName}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Tag className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Category</span>
                </div>
                {editMode ? (
                  <Select
                    value={draft.category}
                    onValueChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        category: v as TicketCategory,
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(CATEGORY_LABELS) as [
                          TicketCategory,
                          string,
                        ][]
                      ).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <StatusBadge status={ticket.category} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Priority</span>
                </div>
                {editMode ? (
                  <Select
                    value={draft.priority}
                    onValueChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        priority: v as TicketPriority,
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(PRIORITY_LABELS) as [
                          TicketPriority,
                          string,
                        ][]
                      ).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <StatusBadge status={ticket.priority} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <User className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Assigned To</span>
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  {ticket.assignedTo
                    ? ticket.assignedTo.slice(0, 8)
                    : "Unassigned"}
                </p>
              </CardContent>
            </Card>
            {(editMode || ticket.deviceSerial) && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Cpu className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Unit Serial (Device / Module)</span>
                  </div>
                  {editMode ? (
                    <Input
                      value={draft.deviceSerial}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          deviceSerial: e.target.value,
                        }))
                      }
                      placeholder="e.g. SN-12345"
                      maxLength={120}
                      className="h-8 font-mono text-sm"
                    />
                  ) : (
                    <p className="text-sm font-mono font-medium">
                      {ticket.deviceSerial}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
            {(editMode || ticket.productCode) && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Package className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Product Code</span>
                  </div>
                  {editMode ? (
                    <Input
                      value={draft.productCode}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          productCode: e.target.value,
                        }))
                      }
                      placeholder="e.g. PRD-001"
                      maxLength={80}
                      className="h-8 font-mono text-sm"
                    />
                  ) : (
                    <p className="text-sm font-mono font-medium">
                      {ticket.productCode}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Status Flow</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {STATUS_FLOW.map((stage, idx) => {
                  const isActive = currentIdx >= idx;
                  const isCurrent = currentIdx === idx;
                  return (
                    <div key={stage} className="flex items-center gap-1">
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                          isCurrent
                            ? "bg-primary text-primary-foreground"
                            : isActive
                              ? "bg-green-100 text-green-700"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isActive && <CheckCircle2 className="h-3 w-3" />}
                        {statusLabel(stage)}
                      </div>
                      {idx < STATUS_FLOW.length - 1 && (
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
              {nextStatus && (
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={advanceStatus}
                    disabled={transitionMut.isPending || editMode}
                    title={
                      editMode
                        ? "Finish editing before changing status"
                        : undefined
                    }
                  >
                    {transitionMut.isPending
                      ? "Saving…"
                      : `Update to ${statusLabel(nextStatus)}`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              {editMode ? (
                <Textarea
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                  rows={6}
                  maxLength={4000}
                  placeholder="Describe the issue…"
                  className="text-sm leading-relaxed"
                />
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {ticket.description}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="comments" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Label
                  htmlFor="internal-toggle"
                  className="text-xs text-muted-foreground"
                >
                  {isInternal ? "Internal Note" : "Customer Reply"}
                </Label>
                <Switch
                  id="internal-toggle"
                  checked={isInternal}
                  onCheckedChange={setIsInternal}
                />
              </div>
              <div className="flex gap-2">
                <Textarea
                  placeholder={
                    isInternal
                      ? "Add an internal note..."
                      : "Reply to customer..."
                  }
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[60px] text-sm resize-none"
                  disabled={addCommentMut.isPending}
                />
                <Button
                  size="icon"
                  className="shrink-0 self-end"
                  onClick={addComment}
                  disabled={!newComment.trim() || addCommentMut.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {commentsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : commentsQuery.isError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">
                {commentsQuery.error instanceof Error
                  ? commentsQuery.error.message
                  : "Failed to load comments"}
              </p>
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No comments yet. Add the first one above.
            </p>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => {
                const isInternalComment = comment.visibility === "INTERNAL";
                // No user catalog yet — show uuid prefix as a placeholder
                // so entries are still distinguishable across authors.
                const name = comment.actorId
                  ? comment.actorId.slice(0, 8)
                  : "System";
                const initials = name.slice(0, 2).toUpperCase();

                return (
                  <div
                    key={comment.id}
                    className={`flex gap-3 p-3 rounded-lg border ${
                      isInternalComment
                        ? "border-blue-200 bg-blue-50/30"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback
                        className={`text-[10px] font-mono ${
                          isInternalComment
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium font-mono">
                            {name}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              isInternalComment
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {isInternalComment ? "Internal" : "Customer"}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(comment.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
                        {comment.content}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
