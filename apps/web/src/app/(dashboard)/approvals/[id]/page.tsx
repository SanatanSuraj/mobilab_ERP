"use client";

/**
 * Approval request detail — full timeline of an approval workflow.
 *
 *   Header card  : entity (link out to /<module>/<id>), status, amount,
 *                  requester, currentStep / total, createdAt / completedAt.
 *   Steps card   : ordered list of approval_steps with role, status,
 *                  actor, decision time, e-sig hash (truncated), comment.
 *   Audit card   : workflow_transitions in chronological order — every
 *                  state change with actor, comment, e-sig hash. This is
 *                  the auditor view; the steps card is the reviewer view.
 *
 * Data source: GET /approvals/:id → ApprovalRequestDetail
 *  ({ request, steps, transitions }).
 *
 * Route lives under (dashboard) so the standard sidebar / chrome wraps it.
 * The inbox page already deep-links to `/approvals/[id]` — wiring that
 * link from the inbox row is left to a follow-up; this page works
 * standalone via the URL.
 */

import Link from "next/link";
import { useParams } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiApprovalRequest } from "@/hooks/useApprovalsApi";
import type {
  ApprovalEntityType,
  ApprovalRequestStatus,
  ApprovalStep,
  ApprovalStepStatus,
  WorkflowTransition,
} from "@instigenie/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldCheck,
  XCircle,
} from "lucide-react";

// ─── Display helpers (kept in sync with /approvals/page.tsx) ──────────

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

const REQ_STATUS_TONE: Record<ApprovalRequestStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-gray-50 text-gray-700 border-gray-200",
};

const STEP_STATUS_TONE: Record<ApprovalStepStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  SKIPPED: "bg-gray-50 text-gray-700 border-gray-200",
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

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.slice(0, 8);
}

function truncateHash(hash: string | null): string | null {
  if (!hash) return null;
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function ApprovalDetailPage(): React.ReactElement {
  const params = useParams();
  const requestId = typeof params?.id === "string" ? params.id : "";

  const detailQuery = useApiApprovalRequest(requestId);

  if (detailQuery.isLoading || !requestId) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Link
          href="/approvals"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Approvals
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-red-900">
              Approval request not found
            </p>
            <p className="text-red-700 mt-1">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "The request you're looking for doesn't exist or you don't have access to it."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { request, steps, transitions } = detailQuery.data;
  const detailHref = ENTITY_DETAIL_HREF[request.entityType](request.entityId);
  const orderedSteps = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  // Transitions arrive in insertion order from the API; sort defensively
  // by createdAt so any out-of-order delivery still renders chronologically.
  const orderedTransitions = [...transitions].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link
        href="/approvals"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Approvals
      </Link>

      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title={`${ENTITY_LABEL[request.entityType]} approval`}
          description={`Created ${formatDateTime(request.createdAt)}`}
        />
        <Badge
          variant="outline"
          className={`text-xs whitespace-nowrap ${REQ_STATUS_TONE[request.status]}`}
        >
          {request.status}
        </Badge>
      </div>

      {/* Header card — request facts at a glance. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Module</dt>
              <dd>{ENTITY_MODULE[request.entityType]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Entity</dt>
              <dd>
                <Link
                  href={detailHref}
                  className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-800 hover:underline"
                >
                  {ENTITY_LABEL[request.entityType]} ·{" "}
                  <span className="font-mono">{shortId(request.entityId)}</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amount</dt>
              <dd className="font-mono">
                {formatINR(request.amount, request.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Chain</dt>
              <dd className="font-mono text-xs">
                {shortId(request.chainDefId)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Step progress</dt>
              <dd>
                Step {request.currentStep} of {orderedSteps.length}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Requested by</dt>
              <dd className="font-mono text-xs">
                {shortId(request.requestedBy)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd>{formatDateTime(request.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Completed</dt>
              <dd>{formatDateTime(request.completedAt)}</dd>
            </div>
            {request.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">{request.notes}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {/* Steps card — reviewer view, ordered by step number. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {orderedSteps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Audit card — auditor view, every transition. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit trail</CardTitle>
        </CardHeader>
        <CardContent>
          {orderedTransitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No transitions recorded yet.
            </p>
          ) : (
            <ol className="space-y-3">
              {orderedTransitions.map((t) => (
                <TransitionRow key={t.id} transition={t} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sub-rows ─────────────────────────────────────────────────────────────

function StepRow({ step }: { step: ApprovalStep }): React.ReactElement {
  const Icon =
    step.status === "APPROVED"
      ? CheckCircle2
      : step.status === "REJECTED"
        ? XCircle
        : step.status === "SKIPPED"
          ? Ban
          : Clock;

  const iconColor =
    step.status === "APPROVED"
      ? "text-emerald-600"
      : step.status === "REJECTED"
        ? "text-red-600"
        : step.status === "SKIPPED"
          ? "text-gray-500"
          : "text-amber-600";

  const hashShort = truncateHash(step.eSignatureHash);

  return (
    <li className="border rounded-md p-3 flex items-start gap-3">
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            #{step.stepNumber}
          </Badge>
          <span className="text-sm font-medium">{step.roleId}</span>
          <Badge
            variant="outline"
            className={`text-xs ${STEP_STATUS_TONE[step.status]}`}
          >
            {step.status}
          </Badge>
          {step.requiresESignature ? (
            <Badge
              variant="outline"
              className="text-xs bg-purple-50 text-purple-700 border-purple-200 inline-flex items-center gap-1"
            >
              <ShieldCheck className="h-3 w-3" />
              e-sig
            </Badge>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          {step.actedBy ? (
            <p>
              Acted by{" "}
              <span className="font-mono text-foreground">
                {shortId(step.actedBy)}
              </span>{" "}
              · {formatDateTime(step.actedAt)}
            </p>
          ) : (
            <p>Awaiting action</p>
          )}
          {hashShort ? (
            <p className="font-mono">e-sig hash: {hashShort}</p>
          ) : null}
        </div>
        {step.comment ? (
          <p className="text-sm whitespace-pre-wrap">{step.comment}</p>
        ) : null}
      </div>
    </li>
  );
}

function TransitionRow({
  transition,
}: {
  transition: WorkflowTransition;
}): React.ReactElement {
  const hashShort = truncateHash(transition.eSignatureHash);
  return (
    <li className="border-l-2 border-gray-200 pl-3 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {transition.action}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {transition.fromStatus} → {transition.toStatus}
        </span>
        <span className="text-xs text-muted-foreground">
          · {formatDateTime(transition.createdAt)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
        {transition.actorId ? (
          <p>
            Actor{" "}
            <span className="font-mono text-foreground">
              {shortId(transition.actorId)}
            </span>
            {transition.actorRole ? ` · ${transition.actorRole}` : ""}
          </p>
        ) : (
          <p>System</p>
        )}
        {hashShort ? (
          <p className="font-mono">e-sig hash: {hashShort}</p>
        ) : null}
      </div>
      {transition.comment ? (
        <p className="text-sm mt-1 whitespace-pre-wrap">{transition.comment}</p>
      ) : null}
    </li>
  );
}
