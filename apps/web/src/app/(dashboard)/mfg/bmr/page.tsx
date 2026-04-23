"use client";

// TODO(phase-5): Batch Manufacturing Record (BMR) - the GMP compliance record
// for each batch - has no backend routes yet. Expected routes:
//   GET  /mfg/bmr?workOrderId=&status=
//   GET  /mfg/bmr/:id - full BMR with sections + approvals
//   POST /mfg/bmr/:id/sections/:sectionId - record section data
//   POST /mfg/bmr/:id/lock - immutable once locked
//   POST /mfg/bmr/:id/approve - multi-role sign-off
// Mock imports left in place until the BMR slice ships in
// apps/api/src/modules/mfg.

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  bmrRecords,
  mobiWorkOrders,
  formatDate,
  formatDateTime,
  BMR,
  BMRStatus,
  BMRSection,
} from "@/data/instigenie-mock";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  ShieldCheck,
  Lock,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "ALL" | BMRStatus;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSectionsComplete(sections: BMRSection[]): number {
  return sections.filter((s) => s.status === "COMPLETE").length;
}

function getWONumber(bmr: BMR): string {
  const wo = mobiWorkOrders.find((w) => w.id === bmr.workOrderId);
  return wo?.woNumber ?? bmr.workOrderNumber;
}

// ─── Section Checklist Grid ───────────────────────────────────────────────────

function SectionGrid({ sections }: { sections: BMRSection[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {sections.map((sec, idx) => (
        <div
          key={idx}
          className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
            sec.status === "COMPLETE"
              ? "border-green-200 bg-green-50"
              : sec.status === "INCOMPLETE"
              ? "border-amber-200 bg-amber-50"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <div className="mt-0.5 shrink-0">
            {sec.status === "COMPLETE" ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : sec.status === "INCOMPLETE" ? (
              <Clock className="h-4 w-4 text-amber-500" />
            ) : (
              <XCircle className="h-4 w-4 text-gray-400" />
            )}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground leading-snug">
              {idx + 1}. {sec.sectionName}
            </p>
            {sec.completedBy && (
              <p className="text-muted-foreground mt-0.5">
                {sec.completedBy}
                {sec.completedAt ? ` · ${formatDateTime(sec.completedAt)}` : ""}
              </p>
            )}
            {!sec.completedBy && (
              <p className="text-muted-foreground mt-0.5 capitalize">
                {sec.status.toLowerCase()}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Sign-off Panel ───────────────────────────────────────────────────────────

function SignOffPanel({ bmr }: { bmr: BMR }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* Production Sign-off */}
      <div
        className={`rounded-lg border p-4 space-y-1 ${
          bmr.productionHODSign
            ? "border-blue-200 bg-blue-50"
            : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="flex items-center gap-2">
          {bmr.productionHODSign ? (
            <CheckCircle2 className="h-5 w-5 text-blue-600 shrink-0" />
          ) : (
            <Clock className="h-5 w-5 text-gray-400 shrink-0" />
          )}
          <span className="text-sm font-semibold">Production Sign-off</span>
        </div>
        {bmr.productionHODSign ? (
          <>
            <p className="text-sm font-medium text-blue-800">
              {bmr.productionHODSign}
            </p>
            <p className="text-xs text-muted-foreground">Production HOD</p>
            {bmr.productionHODSignAt && (
              <p className="text-xs text-muted-foreground font-mono">
                {formatDateTime(bmr.productionHODSignAt)}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Pending</p>
        )}
      </div>

      {/* QC Sign-off */}
      <div
        className={`rounded-lg border p-4 space-y-1 ${
          bmr.qcHODSign
            ? "border-green-200 bg-green-50"
            : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="flex items-center gap-2">
          {bmr.qcHODSign ? (
            <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
          ) : (
            <Clock className="h-5 w-5 text-gray-400 shrink-0" />
          )}
          <span className="text-sm font-semibold">QC Sign-off</span>
        </div>
        {bmr.qcHODSign ? (
          <>
            <p className="text-sm font-medium text-green-800">
              {bmr.qcHODSign}
            </p>
            <p className="text-xs text-muted-foreground">QC HOD</p>
            {bmr.qcHODSignAt && (
              <p className="text-xs text-muted-foreground font-mono">
                {formatDateTime(bmr.qcHODSignAt)}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Pending</p>
        )}
      </div>
    </div>
  );
}

// ─── BMR Detail Dialog ────────────────────────────────────────────────────────

function BMRDetailDialog({
  bmr,
  open,
  onOpenChange,
}: {
  bmr: BMR | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!bmr) return null;

  const complete = getSectionsComplete(bmr.sections);
  const total = bmr.sections.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-lg text-blue-700">
              {bmr.bmrNumber}
            </span>
            <StatusBadge status={bmr.status} />
          </div>
          <DialogTitle className="text-sm font-normal text-muted-foreground mt-1">
            <span className="font-mono mr-2">{bmr.workOrderNumber}</span>
            {bmr.productName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Immutability banner */}
          {bmr.status === "CLOSED" && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
              <Lock className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <span className="text-sm font-semibold text-red-700">
                This BMR is closed and immutable. 7-year retention policy
                applies.
              </span>
            </div>
          )}

          {/* Header meta */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
            <div>
              <span className="block text-muted-foreground">Batch Qty</span>
              <span className="font-semibold text-sm">{bmr.batchQty}</span>
            </div>
            <div>
              <span className="block text-muted-foreground">DMR Version</span>
              <span className="font-mono font-semibold text-sm">
                {bmr.dmrVersion}
              </span>
            </div>
            <div>
              <span className="block text-muted-foreground">Start Date</span>
              <span className="font-mono text-sm">{formatDate(bmr.startDate)}</span>
            </div>
            {bmr.endDate && (
              <div>
                <span className="block text-muted-foreground">End Date</span>
                <span className="font-mono text-sm">
                  {formatDate(bmr.endDate)}
                </span>
              </div>
            )}
          </section>

          {/* Yield summary */}
          <section className="grid grid-cols-3 gap-3 text-xs sm:grid-cols-4">
            <div className="rounded-lg border bg-green-50 border-green-200 p-3 text-center">
              <span className="block text-2xl font-bold text-green-700">
                {bmr.passQty}
              </span>
              <span className="text-muted-foreground">Passed</span>
            </div>
            <div className="rounded-lg border bg-red-50 border-red-200 p-3 text-center">
              <span className="block text-2xl font-bold text-red-700">
                {bmr.failQty}
              </span>
              <span className="text-muted-foreground">Failed</span>
            </div>
            <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-center">
              <span className="block text-2xl font-bold text-amber-700">
                {bmr.scrapQty}
              </span>
              <span className="text-muted-foreground">Scrapped</span>
            </div>
            {bmr.firstPassYield !== undefined && (
              <div className="rounded-lg border bg-blue-50 border-blue-200 p-3 text-center">
                <span className="block text-2xl font-bold text-blue-700">
                  {bmr.firstPassYield}%
                </span>
                <span className="text-muted-foreground">FPY</span>
              </div>
            )}
          </section>

          {/* 12-Section checklist */}
          <section>
            <h3 className="text-sm font-semibold mb-2">
              Section Checklist ({complete}/{total} complete)
            </h3>
            <SectionGrid sections={bmr.sections} />
          </section>

          {/* Sign-off */}
          <section>
            <h3 className="text-sm font-semibold mb-2">
              Dual Approver Sign-off
            </h3>
            <SignOffPanel bmr={bmr} />
          </section>

          {/* Deviation notes */}
          {bmr.notes && (
            <section>
              <h3 className="text-sm font-semibold mb-1">
                Deviation / Notes
              </h3>
              <p className="text-sm text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3 leading-relaxed">
                {bmr.notes}
              </p>
            </section>
          )}

          {/* Audit trail count */}
          <section>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>
                Audit trail: {bmr.auditTrailEntries} entries recorded
              </span>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BMRPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selectedBMR, setSelectedBMR] = useState<BMR | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // KPIs
  const totalBMRs = bmrRecords.length;
  const draftCount = bmrRecords.filter((b) => b.status === "DRAFT").length;
  const prodSignedCount = bmrRecords.filter(
    (b) => b.status === "PRODUCTION_SIGNED"
  ).length;
  const closedCount = bmrRecords.filter((b) => b.status === "CLOSED").length;
  const avgFPY = (() => {
    const withFPY = bmrRecords.filter((b) => b.firstPassYield !== undefined);
    if (withFPY.length === 0) return null;
    const sum = withFPY.reduce((s, b) => s + (b.firstPassYield ?? 0), 0);
    return Math.round(sum / withFPY.length);
  })();

  const filtered = useMemo(() => {
    if (statusFilter === "ALL") return bmrRecords;
    return bmrRecords.filter((b) => b.status === statusFilter);
  }, [statusFilter]);

  function handleRowClick(bmr: BMR) {
    setSelectedBMR(bmr);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Batch Manufacturing Records (BMR)"
        description="ISO 13485 §4.2.4 | 21 CFR Part 11 | Immutable after QC sign-off | 7-year retention"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KPICard
          title="Total BMRs"
          value={String(totalBMRs)}
          icon={ClipboardList}
          iconColor="text-primary"
        />
        <KPICard
          title="Draft"
          value={String(draftCount)}
          icon={FileText}
          iconColor="text-gray-500"
        />
        <KPICard
          title="Production Signed"
          value={String(prodSignedCount)}
          icon={CheckCircle2}
          iconColor="text-blue-600"
        />
        <KPICard
          title="Closed"
          value={String(closedCount)}
          icon={Lock}
          iconColor="text-green-600"
        />
        <KPICard
          title="Avg FPY"
          value={avgFPY !== null ? `${avgFPY}%` : "—"}
          icon={ShieldCheck}
          iconColor="text-indigo-600"
        />
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={statusFilter}
          onValueChange={(v) =>
            setStatusFilter((v ?? "ALL") as StatusFilter)
          }
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="PRODUCTION_SIGNED">Production Signed</SelectItem>
            <SelectItem value="QC_SIGNED">QC Signed</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {bmrRecords.length} BMR
          {bmrRecords.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* BMR Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    BMR ID
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    WO#
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    Product
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    Batch
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    Sections
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    Production Sign-off
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    QC Sign-off
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-xs text-muted-foreground">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-12 text-center text-sm text-muted-foreground"
                    >
                      No BMRs match your filters
                    </td>
                  </tr>
                ) : (
                  filtered.map((bmr) => {
                    const complete = getSectionsComplete(bmr.sections);
                    const total = bmr.sections.length;
                    return (
                      <tr
                        key={bmr.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => handleRowClick(bmr)}
                      >
                        <td className="px-4 py-3 font-mono font-semibold text-blue-700 text-xs">
                          {bmr.bmrNumber}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {getWONumber(bmr)}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[160px]">
                          <span className="line-clamp-2 leading-snug">
                            {bmr.productName}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-center font-medium">
                          {bmr.batchQty}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={bmr.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-semibold ${
                                complete === total
                                  ? "text-green-700"
                                  : complete > 0
                                  ? "text-amber-700"
                                  : "text-gray-500"
                              }`}
                            >
                              {complete}/{total}
                            </span>
                            <div className="h-1.5 w-16 rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  complete === total
                                    ? "bg-green-500"
                                    : "bg-amber-400"
                                }`}
                                style={{
                                  width: `${Math.round(
                                    (complete / total) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {bmr.productionHODSign ? (
                            <div>
                              <span className="font-medium text-blue-700">
                                {bmr.productionHODSign}
                              </span>
                              {bmr.productionHODSignAt && (
                                <p className="text-muted-foreground font-mono">
                                  {formatDate(bmr.productionHODSignAt)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs bg-gray-50 text-gray-500 border-gray-200"
                            >
                              Pending
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {bmr.qcHODSign ? (
                            <div>
                              <span className="font-medium text-green-700">
                                {bmr.qcHODSign}
                              </span>
                              {bmr.qcHODSignAt && (
                                <p className="text-muted-foreground font-mono">
                                  {formatDate(bmr.qcHODSignAt)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs bg-gray-50 text-gray-500 border-gray-200"
                            >
                              Pending
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {formatDate(bmr.startDate)}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRowClick(bmr);
                            }}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <BMRDetailDialog
        bmr={selectedBMR}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
