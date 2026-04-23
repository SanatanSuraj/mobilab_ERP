"use client";

// TODO(phase-5): Final-batch QC (FQC) has no dedicated backend route yet.
// Specialized from generic QC because it locks a batch for dispatch and
// issues the Certificate of Analysis (CoA). Expected routes:
//   GET  /qc/final-batch-qcs?status=
//   POST /qc/final-batch-qcs/:id/complete - triggers CoA generation
//   POST /qc/final-batch-qcs/:id/release  - frees the batch for dispatch
// Mock imports left in place until the FQC slice ships in
// apps/api/src/modules/qc.

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { KPICard } from "@/components/shared/kpi-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  finalBatchQCs,
  FinalBatchQC,
  formatDate,
} from "@/data/qc-mock";
import {
  CheckCircle2,
  Clock,
  Package,
  Search,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "ALL" | "PENDING" | "PASSED" | "FAILED" | "ON_HOLD";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAvgTAT(): string {
  const withTAT = finalBatchQCs.filter((b) => b.tatHours !== undefined);
  if (withTAT.length === 0) return "—";
  const sum = withTAT.reduce((acc, b) => acc + (b.tatHours ?? 0), 0);
  return (sum / withTAT.length).toFixed(1) + " hrs";
}

function batchDecisionBg(decision: FinalBatchQC["batchDecision"]): string {
  switch (decision) {
    case "ACCEPT":
      return "bg-green-50 border border-green-200 text-green-800";
    case "REJECT":
      return "bg-red-50 border border-red-200 text-red-800";
    case "QC_HOLD":
      return "bg-orange-50 border border-orange-200 text-orange-800";
    default:
      return "bg-gray-50 border border-gray-200 text-gray-600";
  }
}

function batchDecisionLabel(decision: FinalBatchQC["batchDecision"]): string {
  switch (decision) {
    case "ACCEPT":
      return "BATCH ACCEPTED — Released to dispatch";
    case "REJECT":
      return "BATCH REJECTED — Return to production / Rework Sub-WO required";
    case "QC_HOLD":
      return "ON QC HOLD — 100% inspection initiated";
    default:
      return "Awaiting QC inspection";
  }
}

// ─── Batch Detail Dialog ──────────────────────────────────────────────────────

function BatchQCDetailDialog({
  batch,
  open,
  onOpenChange,
}: {
  batch: FinalBatchQC | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!batch) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono text-base">{batch.batchQCNumber}</span>
            <span className="ml-2 text-sm text-muted-foreground font-normal">
              — {batch.productName}
            </span>
          </DialogTitle>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
            <span>
              <span className="font-medium text-foreground">WO PID:</span>{" "}
              <code className="font-mono">{batch.workOrderPid}</code>
            </span>
            <span>
              <span className="font-medium text-foreground">BMR Ref:</span>{" "}
              <code className="font-mono">{batch.bmrReference}</code>
            </span>
            <span>
              <span className="font-medium text-foreground">Product Code:</span>{" "}
              {batch.productCode}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Sampling Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Sampling Plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="font-medium text-xs">{batch.samplingPlan}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Batch Qty</p>
                  <p className="font-semibold tabular-nums">{batch.batchQty}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sample Size</p>
                  <p className="font-semibold tabular-nums">{batch.sampleSize}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Accept / Reject #</p>
                  <p className="font-semibold tabular-nums">
                    {batch.acceptNumber} / {batch.rejectNumber}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Batch Decision Banner */}
          <div
            className={cn(
              "w-full rounded-lg px-4 py-3 text-sm font-semibold text-center",
              batchDecisionBg(batch.batchDecision)
            )}
          >
            {batchDecisionLabel(batch.batchDecision)}
          </div>

          {/* Unit Results (Devices + Modules) */}
          {batch.deviceResults.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Unit Results</h3>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit ID</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Revision</TableHead>
                      <TableHead>Defects</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.deviceResults.map((dev) => (
                      <TableRow key={dev.deviceId}>
                        <TableCell className="font-mono text-xs font-semibold">
                          {dev.deviceId}
                        </TableCell>
                        <TableCell>
                          {dev.result === "PASS" ? (
                            <Badge className="bg-green-50 text-green-700 border border-green-200 text-xs font-medium">
                              PASS
                            </Badge>
                          ) : (
                            <Badge className="bg-red-50 text-red-700 border border-red-200 text-xs font-medium">
                              FAIL
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {dev.reworkRevision === 0
                            ? "Original"
                            : `Rework Rev ${dev.reworkRevision}`}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {dev.defects ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* QC Checks */}
          {batch.checks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">QC Checks</h3>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Check Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Specification</TableHead>
                      <TableHead className="text-center">Pass</TableHead>
                      <TableHead className="text-center">Fail</TableHead>
                      <TableHead className="text-center">NA</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.checks.map((chk) => (
                      <TableRow key={chk.checkId}>
                        <TableCell className="font-medium text-sm whitespace-nowrap">
                          {chk.checkName}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={chk.category} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={chk.severity} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                          {chk.specification}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-green-700 font-semibold">
                          {chk.passCount}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-red-600 font-semibold">
                          {chk.failCount}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-muted-foreground">
                          {chk.naCount}
                        </TableCell>
                        <TableCell>
                          {chk.result === "PASS" ? (
                            <Badge className="bg-green-50 text-green-700 border border-green-200 text-xs font-medium">
                              PASS
                            </Badge>
                          ) : chk.result === "FAIL" ? (
                            <Badge className="bg-red-50 text-red-700 border border-red-200 text-xs font-medium">
                              FAIL
                            </Badge>
                          ) : (
                            <Badge className="bg-gray-50 text-gray-600 border border-gray-200 text-xs font-medium">
                              NA
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                          {chk.remarks ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Signature Section */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Signatures &amp; Handover
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/40 border px-4 py-3">
                  <p className="text-xs text-muted-foreground mb-1">Inspected By</p>
                  <p className="font-semibold text-sm">{batch.inspectedBy}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Handover: {formatDate(batch.handoverDate)}
                  </p>
                  {batch.completedAt && (
                    <p className="text-xs text-muted-foreground">
                      Completed:{" "}
                      {new Date(batch.completedAt).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </div>
                {batch.countersignedBy ? (
                  <div className="rounded-lg bg-muted/40 border px-4 py-3">
                    <p className="text-xs text-muted-foreground mb-1">Countersigned By</p>
                    <p className="font-semibold text-sm">{batch.countersignedBy}</p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                    <p className="text-xs text-amber-700 font-medium">Countersign Pending</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {batch.notes && (
            <div className="rounded-lg bg-muted/40 border px-4 py-3">
              <p className="text-xs text-muted-foreground mb-1 font-medium">Notes</p>
              <p className="text-sm">{batch.notes}</p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          {batch.batchDecision === "PENDING" && (
            <>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                Accept Batch
              </Button>
              <Button size="sm" variant="destructive">
                Reject Batch
              </Button>
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
                Place on Hold
              </Button>
            </>
          )}
          {batch.batchDecision === "QC_HOLD" && (
            <>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                Accept Batch
              </Button>
              <Button size="sm" variant="destructive">
                Reject Batch
              </Button>
            </>
          )}
          {(batch.batchDecision === "ACCEPT" || batch.batchDecision === "REJECT") &&
            !batch.countersignedBy && (
              <Button size="sm" variant="outline">
                Countersign
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FinalQCPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<FinalBatchQC | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // KPI calculations
  const totalBatches = finalBatchQCs.length;
  const acceptedCount = finalBatchQCs.filter(
    (b) => b.batchDecision === "ACCEPT"
  ).length;
  const pendingCount = finalBatchQCs.filter(
    (b) => b.batchDecision === "PENDING"
  ).length;
  const avgTAT = calcAvgTAT();

  // Filtered data
  const filtered = useMemo(() => {
    return finalBatchQCs.filter((b) => {
      const matchStatus = statusFilter === "ALL" || b.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        b.workOrderPid.toLowerCase().includes(q) ||
        b.batchQCNumber.toLowerCase().includes(q) ||
        b.productName.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [statusFilter, search]);

  function handleRowClick(batch: FinalBatchQC) {
    setSelectedBatch(batch);
    setDialogOpen(true);
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Final Device QC"
        description="Batch-level QC handover — BMR §5.8 | TAT tracked per batch"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard
          title="Total Batches"
          value={String(totalBatches)}
          icon={Package}
          iconColor="text-primary"
        />
        <KPICard
          title="Accepted"
          value={String(acceptedCount)}
          icon={CheckCircle2}
          iconColor="text-green-600"
        />
        <KPICard
          title="Pending"
          value={String(pendingCount)}
          icon={Clock}
          iconColor="text-amber-600"
        />
        <KPICard
          title="Avg TAT"
          value={avgTAT}
          icon={ClipboardCheck}
          iconColor="text-blue-600"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by WO PID or Batch QC number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter((v ?? "ALL") as StatusFilter)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="PASSED">Passed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="ON_HOLD">On Hold</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch QC #</TableHead>
                  <TableHead>WO PID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Batch Qty</TableHead>
                  <TableHead className="text-right">Sample</TableHead>
                  <TableHead>Sampling Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Batch Decision</TableHead>
                  <TableHead className="text-right">Pass</TableHead>
                  <TableHead className="text-right">Fail</TableHead>
                  <TableHead>Inspected By</TableHead>
                  <TableHead>Countersigned By</TableHead>
                  <TableHead>Handover Date</TableHead>
                  <TableHead className="text-right">TAT (hrs)</TableHead>
                  <TableHead>BMR Ref</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={15}
                      className="text-center text-muted-foreground py-10"
                    >
                      No batch QC records match the current filter.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((batch) => (
                  <TableRow
                    key={batch.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(batch)}
                  >
                    <TableCell className="font-mono text-xs font-semibold text-primary">
                      {batch.batchQCNumber}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {batch.workOrderPid}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm leading-tight">
                          {batch.productName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {batch.productCode}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {batch.batchQty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {batch.sampleSize}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                      {batch.samplingPlan}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={batch.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={batch.batchDecision} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-green-700 font-semibold">
                      {batch.passQty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600 font-semibold">
                      {batch.failQty}
                    </TableCell>
                    <TableCell className="text-sm">{batch.inspectedBy}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {batch.countersignedBy ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatDate(batch.handoverDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {batch.tatHours !== undefined ? batch.tatHours : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {batch.bmrReference}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <BatchQCDetailDialog
        batch={selectedBatch}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
