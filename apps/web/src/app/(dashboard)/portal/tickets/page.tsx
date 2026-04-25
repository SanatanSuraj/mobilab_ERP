"use client";

/**
 * Customer portal — support tickets. List + create. The create form
 * uses the narrower `CreatePortalTicketSchema` (no accountId,
 * assignedTo, slaDeadline, deviceSerial — those are owned by internal
 * staff). On success the dialog closes and both the tickets list and
 * the landing summary's openTickets count refresh.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import {
  useApiCreatePortalTicket,
  useApiPortalTickets,
} from "@/hooks/usePortalApi";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type CreatePortalTicket,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
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

export default function PortalTicketsPage() {
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);

  const query = useMemo(
    () => ({
      limit: 100,
      sortBy: "createdAt",
      sortDir: "desc" as const,
      status: status === "all" ? undefined : status,
    }),
    [status],
  );

  const ticketsQuery = useApiPortalTickets(query);

  const columns: Column<Ticket>[] = [
    {
      key: "ticketNumber",
      header: "Ticket",
      render: (t) => (
        <Link
          href={`/portal/tickets/${t.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {t.ticketNumber}
        </Link>
      ),
    },
    {
      key: "subject",
      header: "Subject",
      render: (t) => <span className="text-sm">{t.subject}</span>,
    },
    {
      key: "category",
      header: "Category",
      render: (t) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {t.category.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (t) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${PRIORITY_TONE[t.priority]}`}
        >
          {t.priority}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (t) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[t.status]}`}
        >
          {t.status.replace(/_/g, " ")}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Opened",
      render: (t) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(t.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Portal
      </Link>

      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Support Tickets"
          description="Open new tickets and track existing requests"
        />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New ticket
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={status}
            onValueChange={(v) =>
              setStatus(!v ? "all" : (v as TicketStatus | "all"))
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TICKET_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {ticketsQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : ticketsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">Failed to load tickets</p>
            <p className="text-red-700 mt-1">
              {ticketsQuery.error instanceof Error
                ? ticketsQuery.error.message
                : "Unknown error"}
            </p>
          </div>
        </div>
      ) : (
        <>
          <DataTable<Ticket>
            data={ticketsQuery.data?.data ?? []}
            columns={columns}
            pageSize={25}
          />
          <p className="text-xs text-muted-foreground">
            Showing {(ticketsQuery.data?.data.length ?? 0).toLocaleString()} of{" "}
            {(ticketsQuery.data?.total ?? 0).toLocaleString()} ticket
            {ticketsQuery.data?.total === 1 ? "" : "s"}.
          </p>
        </>
      )}

      {createOpen ? (
        <CreateTicketDialog onClose={() => setCreateOpen(false)} />
      ) : null}
    </div>
  );
}

function CreateTicketDialog({ onClose }: { onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("GENERAL_INQUIRY");
  const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
  const [productCode, setProductCode] = useState("");

  const createMutation = useApiCreatePortalTicket();

  const isValid =
    subject.trim().length >= 3 &&
    subject.trim().length <= 200 &&
    description.trim().length >= 3 &&
    description.trim().length <= 4000;

  async function onSubmit() {
    if (!isValid) return;
    const body: CreatePortalTicket = {
      subject: subject.trim(),
      description: description.trim(),
      category,
      priority,
      ...(productCode.trim() ? { productCode: productCode.trim() } : {}),
    };
    try {
      await createMutation.mutateAsync(body);
      toast.success("Ticket opened");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open ticket");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a new ticket</DialogTitle>
          <DialogDescription>
            We&apos;ll route your request to the right team and email you when
            it&apos;s picked up.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ticket-subject" className="text-xs">
              Subject <span className="text-red-600">*</span>
            </Label>
            <Input
              id="ticket-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary of the issue"
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Category <span className="text-red-600">*</span>
              </Label>
              <Select
                value={category}
                onValueChange={(v) =>
                  v && setCategory(v as TicketCategory)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) =>
                  v && setPriority(v as TicketPriority)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ticket-product" className="text-xs">
              Product code (optional)
            </Label>
            <Input
              id="ticket-product"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              placeholder="e.g. ANALYZER-200"
              maxLength={100}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="ticket-description" className="text-xs">
              Description <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what's happening — steps to reproduce, error messages, etc."
              rows={6}
              maxLength={4000}
            />
            <p className="text-[11px] text-muted-foreground">
              {description.length} / 4000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!isValid || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Open ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
