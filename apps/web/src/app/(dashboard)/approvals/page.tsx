"use client";

/**
 * Approvals Inbox — cross-module pending approvals + the user's own
 * action queue.
 *
 * Two views:
 *   • "Inbox"        — pending steps for roles held by the current
 *                      user (`/approvals/inbox`). Rows know their
 *                      `requiresESignature` so the Approve/Reject
 *                      dialog can demand the e-sig payload.
 *   • "All requests" — every approval request the user can read
 *                      (`/approvals`). Filterable by status, module,
 *                      and date range.
 *
 * Row-level actions:
 *   • Approve  → POST /approvals/:id/act  { action: "APPROVE", … }
 *   • Reject   → POST /approvals/:id/act  { action: "REJECT", … }
 *   • Cancel   → POST /approvals/:id/cancel { reason }
 *
 * Detail page (timeline of steps + transitions) lives at
 * /approvals/[id] and is consumed via `useApiApprovalRequest`.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  useApiActOnApproval,
  useApiApprovalInbox,
  useApiApprovalRequests,
  useApiCancelApproval,
} from "@/hooks/useApprovalsApi";

import {
  APPROVAL_ENTITY_TYPES,
  APPROVAL_REQUEST_STATUSES,
  type ApprovalEntityType,
  type ApprovalInboxItem,
  type ApprovalRequest,
  type ApprovalRequestStatus,
} from "@instigenie/contracts";

import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Inbox,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

// ─── Display helpers ─────────────────────────────────────────────────────────

const ENTITY_LABEL: Record<ApprovalEntityType, string> = {
  work_order: "Work Order",
  purchase_order: "Purchase Order",
  deal_discount: "Deal Discount",
  raw_material_issue: "RM Issue",
  device_qc_final: "Device QC",
  invoice: "Invoice",
  quotation: "Quotation",
};

const ENTITY_MODULE: Record<ApprovalEntityType, string> = {
  work_order: "Production",
  purchase_order: "Procurement",
  deal_discount: "Sales",
  raw_material_issue: "Inventory",
  device_qc_final: "QC",
  invoice: "Finance",
  quotation: "Sales",
};

const ENTITY_DETAIL_HREF: Record<ApprovalEntityType, (id: string) => string> = {
  work_order: (id) => `/production/work-orders/${id}`,
  purchase_order: (id) => `/procurement/purchase-orders/${id}`,
  deal_discount: (id) => `/crm/deals/${id}`,
  raw_material_issue: (id) => `/inventory/issues/${id}`,
  device_qc_final: (id) => `/qc/inspections/${id}`,
  invoice: (id) => `/finance/sales-invoices/${id}`,
  quotation: (id) => `/crm/quotations/${id}`,
};

const STATUS_TONE: Record<ApprovalRequestStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-gray-50 text-gray-700 border-gray-200",
};

function formatINR(amount: string | null, currency: string): string {
  if (!amount) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (currency === "INR") {
    return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.slice(0, 8);
}

// ─── Row-action dialog state ─────────────────────────────────────────────────

type ActDialogState =
  | { kind: "approve"; request: ApprovalRequest; requiresESignature: boolean }
  | { kind: "reject"; request: ApprovalRequest; requiresESignature: boolean }
  | { kind: "cancel"; request: ApprovalRequest }
  | null;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  // Tab + filters
  const [tab, setTab] = useState<"inbox" | "all">("inbox");
  const [entityType, setEntityType] = useState<ApprovalEntityType | "all">(
    "all",
  );
  const [status, setStatus] = useState<ApprovalRequestStatus | "all">(
    "PENDING",
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Inbox: server-scoped to current user's roles. Module filter is the
  // only narrowing the API supports; status is implicit ("PENDING").
  const inboxQuery = useApiApprovalInbox({
    limit: 100,
    entityType: entityType === "all" ? undefined : entityType,
  });

  // All-requests: cross-module, filterable.
  const allQuery = useApiApprovalRequests({
    limit: 100,
    sortBy: "createdAt",
    sortDir: "desc",
    entityType: entityType === "all" ? undefined : entityType,
    status: status === "all" ? undefined : status,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  // KPIs — light-weight count probes (limit=1) so we read meta.total only.
  const kpiPending = useApiApprovalRequests({ limit: 1, status: "PENDING" });
  const kpiApproved = useApiApprovalRequests({ limit: 1, status: "APPROVED" });
  const kpiRejected = useApiApprovalRequests({ limit: 1, status: "REJECTED" });

  // Mutations
  const actMutation = useApiActOnApproval();
  const cancelMutation = useApiCancelApproval();

  // Dialog
  const [dialog, setDialog] = useState<ActDialogState>(null);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Approvals"
        description="Cross-module approval inbox and request log"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="My inbox"
          value={(inboxQuery.data?.meta.total ?? 0).toLocaleString()}
          icon={Inbox}
          iconColor={
            (inboxQuery.data?.meta.total ?? 0) > 0
              ? "text-blue-600"
              : "text-gray-500"
          }
          change={
            (inboxQuery.data?.meta.total ?? 0) > 0
              ? "Awaiting your action"
              : "All clear"
          }
          trend={(inboxQuery.data?.meta.total ?? 0) > 0 ? "up" : "neutral"}
        />
        <KPICard
          title="Pending (org-wide)"
          value={(kpiPending.data?.meta.total ?? 0).toLocaleString()}
          icon={ClipboardCheck}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Approved"
          value={(kpiApproved.data?.meta.total ?? 0).toLocaleString()}
          icon={CheckCircle2}
          iconColor="text-emerald-600"
        />
        <KPICard
          title="Rejected"
          value={(kpiRejected.data?.meta.total ?? 0).toLocaleString()}
          icon={XCircle}
          iconColor="text-red-600"
        />
      </div>

      {/* Filters — module is shared; status / dates only apply to "All". */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Module</Label>
          <Select
            value={entityType}
            onValueChange={(v) =>
              setEntityType(!v ? "all" : (v as ApprovalEntityType | "all"))
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {APPROVAL_ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ENTITY_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {tab === "all" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select
                value={status}
                onValueChange={(v) =>
                  setStatus(!v ? "all" : (v as ApprovalRequestStatus | "all"))
                }
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {APPROVAL_REQUEST_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-[160px]"
              />
            </div>
          </>
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v === "all" ? "all" : "inbox")}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="inbox">
            <Inbox className="h-3.5 w-3.5 mr-1.5" />
            My inbox
          </TabsTrigger>
          <TabsTrigger value="all">
            <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
            All requests
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="space-y-3">
          <InboxTable
            isLoading={inboxQuery.isLoading}
            isError={inboxQuery.isError}
            error={inboxQuery.error}
            items={inboxQuery.data?.data ?? []}
            onAct={(item, kind) =>
              setDialog({
                kind,
                request: item.request,
                requiresESignature: item.requiresESignature,
              })
            }
            onCancel={(item) =>
              setDialog({ kind: "cancel", request: item.request })
            }
          />
          <p className="text-xs text-muted-foreground">
            Showing {(inboxQuery.data?.data.length ?? 0).toLocaleString()} of{" "}
            {(inboxQuery.data?.meta.total ?? 0).toLocaleString()} pending step
            {inboxQuery.data?.meta.total === 1 ? "" : "s"} for your roles.
          </p>
        </TabsContent>

        <TabsContent value="all" className="space-y-3">
          <AllRequestsTable
            isLoading={allQuery.isLoading}
            isError={allQuery.isError}
            error={allQuery.error}
            items={allQuery.data?.data ?? []}
            onAct={(req, kind) =>
              setDialog({ kind, request: req, requiresESignature: false })
            }
            onCancel={(req) => setDialog({ kind: "cancel", request: req })}
          />
          <p className="text-xs text-muted-foreground">
            Showing {(allQuery.data?.data.length ?? 0).toLocaleString()} of{" "}
            {(allQuery.data?.meta.total ?? 0).toLocaleString()} request
            {allQuery.data?.meta.total === 1 ? "" : "s"}.
          </p>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {dialog?.kind === "approve" || dialog?.kind === "reject" ? (
        <ActDialog
          state={dialog}
          isPending={actMutation.isPending}
          error={actMutation.error}
          onClose={() => {
            actMutation.reset();
            setDialog(null);
          }}
          onConfirm={async (payload) => {
            await actMutation.mutateAsync({
              id: dialog.request.id,
              payload,
            });
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === "cancel" ? (
        <CancelDialog
          request={dialog.request}
          isPending={cancelMutation.isPending}
          error={cancelMutation.error}
          onClose={() => {
            cancelMutation.reset();
            setDialog(null);
          }}
          onConfirm={async (reason) => {
            await cancelMutation.mutateAsync({
              id: dialog.request.id,
              reason,
            });
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────

function ErrorBanner({ error }: { error: unknown }): React.ReactElement {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
      <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
      <div className="text-sm">
        <p className="font-medium text-red-900">Failed to load approvals</p>
        <p className="text-red-700 mt-1">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    </div>
  );
}

function LoadingShell(): React.ReactElement {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function RequestRowCells({ req }: { req: ApprovalRequest }): React.ReactElement {
  const detailHref = ENTITY_DETAIL_HREF[req.entityType](req.entityId);
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <Link
        href={detailHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800 hover:underline"
      >
        {ENTITY_LABEL[req.entityType]} · {shortId(req.entityId)}
        <ExternalLink className="h-3 w-3" />
      </Link>
      <span className="text-xs text-muted-foreground">
        {ENTITY_MODULE[req.entityType]}
      </span>
    </div>
  );
}

interface InboxTableProps {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  items: ApprovalInboxItem[];
  onAct: (item: ApprovalInboxItem, kind: "approve" | "reject") => void;
  onCancel: (item: ApprovalInboxItem) => void;
}

function InboxTable({
  isLoading,
  isError,
  error,
  items,
  onAct,
  onCancel,
}: InboxTableProps): React.ReactElement {
  if (isLoading) return <LoadingShell />;
  if (isError) return <ErrorBanner error={error} />;

  const columns: Column<ApprovalInboxItem>[] = [
    {
      key: "entity",
      header: "Entity",
      render: (item) => <RequestRowCells req={item.request} />,
    },
    {
      key: "step",
      header: "Step",
      render: (item) => (
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            #{item.stepNumber}
          </Badge>
          <span className="text-xs text-muted-foreground">{item.roleId}</span>
          {item.requiresESignature && (
            <Badge
              variant="outline"
              className="text-xs bg-purple-50 text-purple-700 border-purple-200 inline-flex items-center gap-1"
            >
              <ShieldCheck className="h-3 w-3" />
              e-sig
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (item) => (
        <span className="font-mono text-sm whitespace-nowrap">
          {formatINR(item.request.amount, item.request.currency)}
        </span>
      ),
    },
    {
      key: "requestedBy",
      header: "Requested by",
      render: (item) => (
        <span className="font-mono text-xs text-muted-foreground">
          {shortId(item.request.requestedBy)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      render: (item) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelative(item.request.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (item) => (
        <div className="flex justify-end items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            onClick={() => onAct(item, "approve")}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            onClick={() => onAct(item, "reject")}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            Reject
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            onClick={() => onCancel(item)}
            title="Cancel request"
          >
            <Ban className="h-3.5 w-3.5" />
            <span className="sr-only">Cancel</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable<ApprovalInboxItem>
      data={items}
      columns={columns}
      pageSize={25}
    />
  );
}

interface AllRequestsTableProps {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  items: ApprovalRequest[];
  onAct: (req: ApprovalRequest, kind: "approve" | "reject") => void;
  onCancel: (req: ApprovalRequest) => void;
}

function AllRequestsTable({
  isLoading,
  isError,
  error,
  items,
  onAct,
  onCancel,
}: AllRequestsTableProps): React.ReactElement {
  if (isLoading) return <LoadingShell />;
  if (isError) return <ErrorBanner error={error} />;

  const columns: Column<ApprovalRequest>[] = [
    {
      key: "entity",
      header: "Entity",
      render: (req) => <RequestRowCells req={req} />,
    },
    {
      key: "amount",
      header: "Amount",
      render: (req) => (
        <span className="font-mono text-sm whitespace-nowrap">
          {formatINR(req.amount, req.currency)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (req) => (
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${STATUS_TONE[req.status]}`}
        >
          {req.status}
        </Badge>
      ),
    },
    {
      key: "requestedBy",
      header: "Requested by",
      render: (req) => (
        <span className="font-mono text-xs text-muted-foreground">
          {shortId(req.requestedBy)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      render: (req) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelative(req.createdAt)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (req) => {
        if (req.status !== "PENDING") {
          return (
            <span className="text-xs text-muted-foreground">
              {req.status === "APPROVED" && req.completedAt
                ? `Approved ${formatRelative(req.completedAt)}`
                : req.status === "REJECTED" && req.completedAt
                  ? `Rejected ${formatRelative(req.completedAt)}`
                  : req.status === "CANCELLED" && req.completedAt
                    ? `Cancelled ${formatRelative(req.completedAt)}`
                    : "Closed"}
            </span>
          );
        }
        return (
          <div className="flex justify-end items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              onClick={() => onAct(req, "approve")}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              onClick={() => onAct(req, "reject")}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground"
              onClick={() => onCancel(req)}
              title="Cancel request"
            >
              <Ban className="h-3.5 w-3.5" />
              <span className="sr-only">Cancel</span>
            </Button>
          </div>
        );
      },
    },
  ];

  return <DataTable<ApprovalRequest> data={items} columns={columns} pageSize={25} />;
}

// ─── Approve / Reject dialog ────────────────────────────────────────────────

interface ActDialogProps {
  state: Extract<ActDialogState, { kind: "approve" | "reject" }>;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (payload: {
    action: "APPROVE" | "REJECT";
    comment?: string;
    eSignaturePayload?: string;
    eSignaturePassword?: string;
  }) => Promise<void>;
}

function ActDialog({
  state,
  isPending,
  error,
  onClose,
  onConfirm,
}: ActDialogProps): React.ReactElement {
  const [comment, setComment] = useState("");
  const [eSigPayload, setESigPayload] = useState("");
  const [eSigPassword, setESigPassword] = useState("");

  const isApprove = state.kind === "approve";
  const action: "APPROVE" | "REJECT" = isApprove ? "APPROVE" : "REJECT";
  const requiresESig = state.requiresESignature;

  // Reject requires a non-empty comment per workflow conventions.
  const canSubmit = useMemo(() => {
    if (!isApprove && !comment.trim()) return false;
    if (requiresESig) {
      if (!eSigPayload.trim()) return false;
      if (!eSigPassword) return false;
    }
    return true;
  }, [isApprove, comment, requiresESig, eSigPayload, eSigPassword]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isApprove ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            {isApprove ? "Approve" : "Reject"}{" "}
            {ENTITY_LABEL[state.request.entityType]}
          </DialogTitle>
          <DialogDescription>
            {ENTITY_MODULE[state.request.entityType]} ·{" "}
            {formatINR(state.request.amount, state.request.currency)} · entity{" "}
            <span className="font-mono">{shortId(state.request.entityId)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="act-comment">
              Comment{!isApprove ? " (required)" : ""}
            </Label>
            <Textarea
              id="act-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                isApprove
                  ? "Optional note for the audit trail"
                  : "Explain why you're rejecting this request"
              }
              rows={3}
              maxLength={2000}
            />
          </div>

          {requiresESig && (
            <div className="rounded-md border border-purple-200 bg-purple-50 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-purple-700 mt-0.5" />
                <div className="text-xs text-purple-800">
                  <p className="font-medium">Electronic signature required</p>
                  <p className="mt-0.5">
                    This step is locked behind an e-signature. The statement
                    below is hashed (HMAC) with your identity and stored on
                    the audit trail; your password is verified server-side
                    and never persisted.
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="esig-payload" className="text-xs">
                  Statement
                </Label>
                <Textarea
                  id="esig-payload"
                  value={eSigPayload}
                  onChange={(e) => setESigPayload(e.target.value)}
                  placeholder='e.g. "Final QC pass — serial ABC123"'
                  rows={2}
                  maxLength={4000}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="esig-password" className="text-xs">
                  Your password
                </Label>
                <Input
                  id="esig-password"
                  type="password"
                  autoComplete="current-password"
                  value={eSigPassword}
                  onChange={(e) => setESigPassword(e.target.value)}
                  maxLength={256}
                />
              </div>
            </div>
          )}

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {error instanceof Error ? error.message : "Action failed"}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={isPending} />}>
            Cancel
          </DialogClose>
          <Button
            disabled={!canSubmit || isPending}
            onClick={() =>
              onConfirm({
                action,
                comment: comment.trim() || undefined,
                eSignaturePayload: requiresESig
                  ? eSigPayload.trim()
                  : undefined,
                eSignaturePassword: requiresESig ? eSigPassword : undefined,
              })
            }
            className={
              isApprove
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-red-600 hover:bg-red-700"
            }
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {isApprove ? "Approving…" : "Rejecting…"}
              </>
            ) : isApprove ? (
              "Approve"
            ) : (
              "Reject"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cancel dialog ──────────────────────────────────────────────────────────

interface CancelDialogProps {
  request: ApprovalRequest;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

function CancelDialog({
  request,
  isPending,
  error,
  onClose,
  onConfirm,
}: CancelDialogProps): React.ReactElement {
  const [reason, setReason] = useState("");
  const canSubmit = reason.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-gray-600" />
            Cancel approval request
          </DialogTitle>
          <DialogDescription>
            {ENTITY_LABEL[request.entityType]} · entity{" "}
            <span className="font-mono">{shortId(request.entityId)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cancel-reason">Reason (required)</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this request being cancelled?"
              rows={3}
              maxLength={2000}
            />
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {error instanceof Error ? error.message : "Cancel failed"}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={isPending} />}>
            Keep open
          </DialogClose>
          <Button
            variant="outline"
            className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            disabled={!canSubmit || isPending}
            onClick={() => onConfirm(reason.trim())}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Cancelling…
              </>
            ) : (
              "Cancel request"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
