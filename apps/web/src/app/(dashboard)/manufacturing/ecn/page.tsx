"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  ecns,
  mfgProducts,
  ECN,
  ECNApprovalStep,
  formatDate,
} from "@/data/manufacturing-mock";
import {
  FileText,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  AlertTriangle,
  Plus,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REASON_CODE_LABELS: Record<string, string> = {
  QUALITY_IMPROVEMENT: "Quality Improvement",
  COST_REDUCTION: "Cost Reduction",
  SUPPLIER_CHANGE: "Supplier Change",
  REGULATORY: "Regulatory",
  SAFETY: "Safety",
  PERFORMANCE: "Performance",
};

function reasonCodeBadgeClass(code: string): string {
  switch (code) {
    case "SAFETY":
    case "QUALITY_IMPROVEMENT":
      return "bg-red-50 text-red-700 border-red-200";
    case "SUPPLIER_CHANGE":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "PERFORMANCE":
    case "COST_REDUCTION":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "REGULATORY":
      return "bg-purple-50 text-purple-700 border-purple-200";
    default:
      return "bg-gray-50 text-gray-600 border-gray-200";
  }
}

function getApprovalCount(steps: ECNApprovalStep[]): number {
  return steps.filter((s) => s.action === "APPROVED").length;
}

// ─── Initiate ECN Dialog ──────────────────────────────────────────────────────

interface InitiateECNDialogProps {
  open: boolean;
  onClose: () => void;
}

function InitiateECNDialog({ open, onClose }: InitiateECNDialogProps) {
  const [title, setTitle] = useState("");
  const [reasonCode, setReasonCode] = useState("QUALITY_IMPROVEMENT");
  const [affectedProducts, setAffectedProducts] = useState<string[]>([]);
  const [fromBomVersion, setFromBomVersion] = useState("");
  const [toBomVersion, setToBomVersion] = useState("");
  const [changeDescription, setChangeDescription] = useState("");
  const [impact, setImpact] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);

  function handleSubmit() {
    // In a real app: dispatch to state/API
    onClose();
  }

  function toggleProduct(id: string) {
    setAffectedProducts((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Initiate Engineering Change Notice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ecn-title">Title</Label>
            <Input
              id="ecn-title"
              placeholder="Brief description of the change"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ecn-reason-code">Reason Code</Label>
            <Select
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v ?? "QUALITY_IMPROVEMENT")}
            >
              <SelectTrigger id="ecn-reason-code">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_CODE_LABELS).map(([code, label]) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Affected Products</Label>
            <div className="flex flex-wrap gap-2 border rounded-md p-3">
              {mfgProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProduct(p.id)}
                  className={`text-xs px-2.5 py-1 rounded border font-medium transition-colors ${
                    affectedProducts.includes(p.id)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:border-primary"
                  }`}
                >
                  {p.productCode}
                </button>
              ))}
            </div>
            {affectedProducts.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Selected:{" "}
                {affectedProducts
                  .map((id) => mfgProducts.find((p) => p.id === id)?.name)
                  .join(", ")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ecn-from-bom">From BOM Version</Label>
              <Input
                id="ecn-from-bom"
                placeholder="e.g. v2"
                value={fromBomVersion}
                onChange={(e) => setFromBomVersion(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ecn-to-bom">To BOM Version</Label>
              <Input
                id="ecn-to-bom"
                placeholder="e.g. v3"
                value={toBomVersion}
                onChange={(e) => setToBomVersion(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ecn-change-desc">Change Description</Label>
            <Textarea
              id="ecn-change-desc"
              placeholder="Describe the exact changes to the BOM or process..."
              rows={3}
              value={changeDescription}
              onChange={(e) => setChangeDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ecn-impact">Impact</Label>
            <Textarea
              id="ecn-impact"
              placeholder="Cost impact, lead time impact, affected WOs..."
              rows={2}
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label>Mark as Urgent</Label>
            <button
              type="button"
              onClick={() => setIsUrgent((v) => !v)}
              className={`px-4 py-1.5 text-sm rounded-full border font-medium transition-colors ${
                isUrgent
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
              }`}
            >
              {isUrgent ? "URGENT — Click to remove" : "Not Urgent"}
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            Submit ECN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── View ECN Dialog ──────────────────────────────────────────────────────────

interface ViewECNDialogProps {
  ecn: ECN | null;
  open: boolean;
  onClose: () => void;
}

function ViewECNDialog({ ecn, open, onClose }: ViewECNDialogProps) {
  const [localSteps, setLocalSteps] = useState<ECNApprovalStep[]>(
    ecn?.approvalSteps ?? []
  );
  const [localStatus, setLocalStatus] = useState<ECN["status"]>(
    ecn?.status ?? "DRAFT"
  );
  const [implementedAt, setImplementedAt] = useState<string | undefined>(
    ecn?.implementedAt
  );

  // Sync when ECN changes
  if (ecn && ecn.approvalSteps !== localSteps && !open) {
    // reset when dialog reopened for new ecn
  }

  function handleOpen(isOpen: boolean) {
    if (isOpen && ecn) {
      setLocalSteps([...ecn.approvalSteps]);
      setLocalStatus(ecn.status);
      setImplementedAt(ecn.implementedAt);
    }
    if (!isOpen) onClose();
  }

  const firstPendingIdx = localSteps.findIndex((s) => s.action === "PENDING");

  function handleApprove() {
    if (firstPendingIdx === -1) return;
    const updated = localSteps.map((s, i) =>
      i === firstPendingIdx
        ? { ...s, action: "APPROVED" as const, actionedAt: new Date().toISOString() }
        : s
    );
    setLocalSteps(updated);
    const allApproved = updated.every((s) => s.action === "APPROVED");
    if (allApproved) setLocalStatus("APPROVED");
  }

  function handleReject() {
    if (firstPendingIdx === -1) return;
    const updated = localSteps.map((s, i) =>
      i === firstPendingIdx
        ? { ...s, action: "REJECTED" as const, actionedAt: new Date().toISOString() }
        : s
    );
    setLocalSteps(updated);
    setLocalStatus("REJECTED");
  }

  function handleMarkImplemented() {
    setLocalStatus("IMPLEMENTED");
    setImplementedAt(new Date().toISOString());
  }

  if (!ecn) return null;

  const approvedCount = localSteps.filter((s) => s.action === "APPROVED").length;
  const approvalPct = Math.round((approvedCount / localSteps.length) * 100);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-lg">{ecn.ecnNumber}</span>
            {ecn.isUrgent && (
              <Badge className="bg-red-600 text-white border-red-600 text-xs">
                URGENT
              </Badge>
            )}
            <StatusBadge status={localStatus} />
          </div>
          <DialogTitle className="text-base font-medium text-muted-foreground mt-1">
            {ecn.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Reason Code:</span>{" "}
              <Badge
                variant="outline"
                className={`text-xs ${reasonCodeBadgeClass(ecn.reasonCode)}`}
              >
                {REASON_CODE_LABELS[ecn.reasonCode]}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Initiated by:</span>{" "}
              <span className="font-medium">{ecn.initiatedBy}</span>
            </div>
            <div>
              <span className="text-muted-foreground">BOM Change:</span>{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                {ecn.fromBomVersion} → {ecn.toBomVersion}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">Effective Date:</span>{" "}
              <span className="font-medium">
                {ecn.effectiveDate ? formatDate(ecn.effectiveDate) : "TBD"}
              </span>
            </div>
            {implementedAt && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Implemented At:</span>{" "}
                <span className="font-medium">{formatDate(implementedAt)}</span>
              </div>
            )}
          </div>

          {/* Affected Products */}
          <div>
            <p className="text-sm font-medium mb-1.5">Affected Products</p>
            <div className="flex flex-wrap gap-1.5">
              {ecn.affectedProductNames.map((name) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Change Description */}
          <div>
            <p className="text-sm font-semibold mb-1">Change Description</p>
            <p className="text-sm text-muted-foreground leading-relaxed bg-muted/40 rounded-md p-3">
              {ecn.changeDescription}
            </p>
          </div>

          {/* Impact */}
          <div>
            <p className="text-sm font-semibold mb-1">Impact</p>
            <p className="text-sm text-muted-foreground leading-relaxed bg-amber-50 border border-amber-200 rounded-md p-3">
              {ecn.impact}
            </p>
          </div>

          {/* Approval Trail */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Approval Trail</p>
              <span className="text-xs text-muted-foreground">
                {approvedCount}/{localSteps.length} approved
              </span>
            </div>
            <Progress value={approvalPct} className="h-1.5 mb-4" />
            <div className="space-y-3">
              {localSteps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {step.action === "APPROVED" && (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    )}
                    {step.action === "REJECTED" && (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    {step.action === "PENDING" && (
                      <Clock className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{step.role}</span>
                      <span className="text-xs text-muted-foreground">
                        — {step.approver}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          step.action === "APPROVED"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : step.action === "REJECTED"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                      >
                        {step.action}
                      </Badge>
                    </div>
                    {step.note && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {step.note}
                      </p>
                    )}
                    {step.actionedAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(step.actionedAt).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {firstPendingIdx !== -1 && localStatus !== "REJECTED" && (
            <>
              <Button
                variant="outline"
                onClick={handleReject}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Reject
              </Button>
              <Button
                onClick={handleApprove}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Approve
              </Button>
            </>
          )}
          {localStatus === "APPROVED" && (
            <Button
              onClick={handleMarkImplemented}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <ClipboardCheck className="h-4 w-4 mr-1.5" />
              Mark Implemented
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ECNPage() {
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [viewECN, setViewECN] = useState<ECN | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [reasonFilter, setReasonFilter] = useState("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");

  // KPIs
  const total = ecns.length;
  const draft = ecns.filter((e) => e.status === "DRAFT").length;
  const inReview = ecns.filter((e) => e.status === "IN_REVIEW").length;
  const approvedOrImpl = ecns.filter(
    (e) => e.status === "APPROVED" || e.status === "IMPLEMENTED"
  ).length;
  const urgent = ecns.filter(
    (e) => e.isUrgent && e.status !== "IMPLEMENTED"
  ).length;

  // Urgent banner ECNs
  const urgentActive = ecns.filter(
    (e) => e.isUrgent && e.status !== "IMPLEMENTED"
  );

  // Filtered ECNs
  const filtered = ecns.filter((e) => {
    if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
    if (reasonFilter !== "ALL" && e.reasonCode !== reasonFilter) return false;
    if (urgencyFilter === "URGENT" && !e.isUrgent) return false;
    return true;
  });

  const columns: Column<ECN>[] = [
    {
      key: "ecnNumber",
      header: "ECN Number",
      sortable: true,
      render: (e) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-sm">{e.ecnNumber}</span>
          {e.isUrgent && (
            <Badge className="bg-red-600 text-white border-red-600 text-[10px] px-1.5 py-0">
              URGENT
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "title",
      header: "Title",
      render: (e) => (
        <span className="text-sm" title={e.title}>
          {e.title.length > 50 ? `${e.title.slice(0, 50)}…` : e.title}
        </span>
      ),
    },
    {
      key: "reasonCode",
      header: "Reason",
      render: (e) => (
        <Badge
          variant="outline"
          className={`text-xs ${reasonCodeBadgeClass(e.reasonCode)}`}
        >
          {REASON_CODE_LABELS[e.reasonCode]}
        </Badge>
      ),
    },
    {
      key: "affectedProductNames",
      header: "Affected Products",
      render: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.affectedProductNames.map((name) => (
            <Badge key={name} variant="secondary" className="text-[10px] px-1.5">
              {name.split(" ").slice(0, 2).join(" ")}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "fromBomVersion",
      header: "BOM Change",
      render: (e) => (
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
          {e.fromBomVersion} → {e.toBomVersion}
        </code>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (e) => <StatusBadge status={e.status} />,
    },
    {
      key: "initiatedBy",
      header: "Initiated By",
      render: (e) => (
        <span className="text-sm text-muted-foreground">{e.initiatedBy}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (e) => (
        <span className="text-sm tabular-nums">{formatDate(e.createdAt)}</span>
      ),
    },
    {
      key: "effectiveDate",
      header: "Effective Date",
      render: (e) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {e.effectiveDate ? formatDate(e.effectiveDate) : "TBD"}
        </span>
      ),
    },
    {
      key: "approvalSteps",
      header: "Approval",
      render: (e) => {
        const count = getApprovalCount(e.approvalSteps);
        const total = e.approvalSteps.length;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div className="space-y-1 min-w-[80px]">
            <span className="text-xs text-muted-foreground">
              {count}/{total} approved
            </span>
            <Progress value={pct} className="h-1.5" />
          </div>
        );
      },
    },
    {
      key: "id",
      header: "Actions",
      render: (e) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setViewECN(e);
            setViewOpen(true);
          }}
        >
          View ECN
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Engineering Change Notices (ECN)"
        description="Formal BOM change control with approval workflow"
      />

      {/* Urgent Banner */}
      {urgentActive.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 space-y-1">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Active Urgent ECNs Require Immediate Attention
          </div>
          {urgentActive.map((e) => (
            <p key={e.id} className="text-sm text-red-600 pl-6">
              🚨 {e.ecnNumber} — {e.title} —{" "}
              <span className="font-medium">{e.status}</span>
            </p>
          ))}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
        <KPICard
          title="Total ECNs"
          value={String(total)}
          icon={FileText}
          iconColor="text-primary"
        />
        <KPICard
          title="Draft"
          value={String(draft)}
          icon={FileText}
          iconColor="text-gray-500"
        />
        <KPICard
          title="In Review"
          value={String(inReview)}
          icon={Clock}
          iconColor="text-indigo-600"
        />
        <KPICard
          title="Approved / Implemented"
          value={String(approvedOrImpl)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Urgent Active"
          value={String(urgent)}
          icon={AlertCircle}
          iconColor="text-red-600"
        />
      </div>

      {/* Filters + Initiate Button */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "ALL")}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="IN_REVIEW">In Review</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="IMPLEMENTED">Implemented</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={reasonFilter}
          onValueChange={(v) => setReasonFilter(v ?? "ALL")}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Reason Codes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Reason Codes</SelectItem>
            {Object.entries(REASON_CODE_LABELS).map(([code, label]) => (
              <SelectItem key={code} value={code}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={urgencyFilter}
          onValueChange={(v) => setUrgencyFilter(v ?? "ALL")}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All ECNs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All ECNs</SelectItem>
            <SelectItem value="URGENT">Urgent Only</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <Button onClick={() => setInitiateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Initiate ECN
          </Button>
        </div>
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Engineering Change Notices ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            data={filtered}
            columns={columns}
            searchKey="ecnNumber"
            searchPlaceholder="Search by ECN number..."
            pageSize={10}
          />
        </CardContent>
      </Card>

      {/* Dialogs */}
      <InitiateECNDialog
        open={initiateOpen}
        onClose={() => setInitiateOpen(false)}
      />

      <ViewECNDialog
        ecn={viewECN}
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setViewECN(null);
        }}
      />
    </div>
  );
}
