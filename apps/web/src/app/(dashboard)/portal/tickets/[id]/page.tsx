"use client";

/**
 * Customer portal — ticket detail. Reads /portal/tickets/:id which
 * returns `{ ticket, comments }`. Customer can add comments (always
 * visibility=CUSTOMER server-side). Internal-visibility comments are
 * filtered server-side, so anything here is safe to render.
 *
 * No status transitions on the portal — only internal staff can move
 * tickets between OPEN / IN_PROGRESS / RESOLVED / CLOSED.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useApiAddPortalTicketComment,
  useApiPortalTicket,
} from "@/hooks/usePortalApi";
import type {
  TicketComment,
  TicketPriority,
  TicketStatus,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Hash,
  Loader2,
  Send,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_TONE: Record<TicketStatus, string> = {
  OPEN: "bg-blue-50 text-blue-700 border-blue-200",
  IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
  WAITING_CUSTOMER: "bg-purple-50 text-purple-700 border-purple-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-gray-50 text-gray-700 border-gray-200",
};

const PRIORITY_TONE: Record<TicketPriority, string> = {
  LOW: "bg-gray-50 text-gray-700 border-gray-200",
  MEDIUM: "bg-blue-50 text-blue-700 border-blue-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
};

export default function PortalTicketDetailPage() {
  const params = useParams();
  const ticketId = params.id as string;

  const ticketQuery = useApiPortalTicket(ticketId);

  if (ticketQuery.isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (ticketQuery.isError || !ticketQuery.data) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Link
          href="/portal/tickets"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tickets
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Ticket not found</p>
            <p className="text-red-700 mt-1">
              {ticketQuery.error instanceof Error
                ? ticketQuery.error.message
                : "The ticket you're looking for doesn't exist or you don't have access to it."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { ticket, comments } = ticketQuery.data;
  const isClosed = ticket.status === "CLOSED" || ticket.status === "RESOLVED";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Link
        href="/portal/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tickets
      </Link>

      <div className="flex items-start justify-between gap-4">
        <PageHeader title={ticket.subject} description={ticket.ticketNumber} />
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-xs whitespace-nowrap ${PRIORITY_TONE[ticket.priority]}`}
          >
            {ticket.priority}
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs whitespace-nowrap ${STATUS_TONE[ticket.status]}`}
          >
            {ticket.status.replace(/_/g, " ")}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticket details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Hash className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Ticket number</p>
                <p className="font-mono">{ticket.ticketNumber}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Tag className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Category</p>
                <p>{ticket.category.replace(/_/g, " ")}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground">Opened</p>
                <p>{formatDateTime(ticket.createdAt)}</p>
              </div>
            </div>
            {ticket.resolvedAt ? (
              <div className="flex items-start gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Resolved</p>
                  <p>{formatDateTime(ticket.resolvedAt)}</p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground mb-1">Description</p>
            <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Conversation
            {comments.length > 0 ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({comments.length})
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No replies yet. Add the first message below.
            </p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <CommentRow key={c.id} comment={c} />
              ))}
            </ul>
          )}

          {isClosed ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-muted-foreground">
              This ticket is {ticket.status.toLowerCase()}. Open a new ticket if
              you need more help.
            </div>
          ) : (
            <AddCommentForm ticketId={ticket.id} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CommentRow({ comment }: { comment: TicketComment }) {
  const initials = comment.actorId
    ? comment.actorId.slice(0, 2).toUpperCase()
    : "—";

  return (
    <li className="flex gap-3">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {comment.actorId
              ? `User ${comment.actorId.slice(0, 8)}`
              : "System"}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(comment.createdAt)}
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
        </div>
      </div>
    </li>
  );
}

function AddCommentForm({ ticketId }: { ticketId: string }) {
  const [content, setContent] = useState("");
  const addCommentMutation = useApiAddPortalTicketComment();

  const isValid = content.trim().length >= 1 && content.trim().length <= 4000;

  async function onSubmit() {
    if (!isValid) return;
    try {
      await addCommentMutation.mutateAsync({
        id: ticketId,
        body: { content: content.trim() },
      });
      setContent("");
      toast.success("Reply posted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post reply");
    }
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <label
        htmlFor="ticket-reply"
        className="text-xs font-medium text-muted-foreground"
      >
        Add a reply
      </label>
      <Textarea
        id="ticket-reply"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Type your message…"
        rows={4}
        maxLength={4000}
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {content.length} / 4000
        </p>
        <Button
          onClick={onSubmit}
          disabled={!isValid || addCommentMutation.isPending}
          size="sm"
        >
          {addCommentMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Post reply
        </Button>
      </div>
    </div>
  );
}
