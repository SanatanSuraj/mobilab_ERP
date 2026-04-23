"use client";

// TODO(phase-5): Incoming (IQC) inspections have no dedicated backend route
// yet — they need the AQL-sampling workflow on top of generic QC. Expected:
//   GET  /qc/incoming-inspections?status=
//   POST /qc/incoming-inspections/:id/aql-measurements
//   POST /qc/incoming-inspections/:id/pass   (auto-issue GRN QC done)
//   POST /qc/incoming-inspections/:id/fail   (auto-open NCR)
//   POST /qc/incoming-inspections/:id/countersign
// Mock imports left in place until the IQC slice ships in
// apps/api/src/modules/qc.

import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  incomingInspections,
  ncrRecords,
  formatDate,
  formatDateTime,
  IncomingQCInspection,
  AQLMeasurement,
} from "@/data/qc-mock";
import { Search, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

type StatusFilter =
  | "ALL"
  | "PENDING"
  | "IN_PROGRESS"
  | "PASSED"
  | "FAILED"
  | "PENDING_COUNTERSIGN";

function CheckResultBadge({ result }: { result: string }) {
  if (result === "PASS")
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 border border-green-200">
        PASS
      </span>
    );
  if (result === "FAIL")
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 border border-red-200">
        FAIL
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
      NA
    </span>
  );
}

function AQLDecisionBanner({ result }: { result: "ACCEPT" | "REJECT" | "MARGINAL" }) {
  if (result === "ACCEPT") {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 font-semibold">
        AQL ACCEPTED — Batch cleared for production
      </div>
    );
  }
  if (result === "REJECT") {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 font-semibold">
        AQL REJECTED — Batch quarantined. NCR required.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-semibold">
      AQL MARGINAL — Within accept number. Chetan countersign required.
    </div>
  );
}

function InspectionDetailDialog({
  inspection,
  open,
  onOpenChange,
}: {
  inspection: IncomingQCInspection | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!inspection) return null;

  const linkedNCR = inspection.linkedNCRId
    ? ncrRecords.find((n) => n.id === inspection.linkedNCRId)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            {inspection.inspectionNumber} — AQL Incoming Inspection
          </DialogTitle>
        </DialogHeader>

        {/* AQL Decision Banner */}
        <AQLDecisionBanner result={inspection.aqlResult} />

        {/* Header Info Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm border rounded-lg p-4 bg-muted/30">
          <div>
            <span className="text-muted-foreground">Inspection #:</span>{" "}
            <span className="font-mono text-xs font-bold">{inspection.inspectionNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">GRN:</span>{" "}
            <span className="font-mono text-xs">{inspection.grnNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">PO:</span>{" "}
            <span className="font-mono text-xs">{inspection.poNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Vendor:</span>{" "}
            <span>{inspection.vendorName}</span>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Item:</span>{" "}
            <span className="font-medium">{inspection.itemName}</span>{" "}
            <span className="font-mono text-xs text-muted-foreground">({inspection.itemCode})</span>
          </div>
          <div>
            <span className="text-muted-foreground">Batch / Lot:</span>{" "}
            <span className="font-mono text-xs">{inspection.batchLotNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Qty Received:</span>{" "}
            <span className="font-medium">{inspection.qtyReceived}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Qty Sampled:</span>{" "}
            <span className="font-medium">{inspection.qtySampled}</span>
          </div>
          <div>
            <span className="text-muted-foreground">AQL Level:</span>{" "}
            <span className="text-xs">{inspection.aqlLevel}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Accept #:</span>{" "}
            <span className="font-medium">{inspection.acceptNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Reject #:</span>{" "}
            <span className="font-medium">{inspection.rejectNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Defects Found:</span>{" "}
            <span className={`font-medium ${inspection.defectsFound > 0 ? "text-red-700" : "text-green-700"}`}>
              {inspection.defectsFound}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Inspector:</span>{" "}
            <span>{inspection.inspectedBy}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            <StatusBadge status={inspection.status} />
          </div>
        </div>

        {/* Measurement Results */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Measurement Results</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-700 font-medium">
                {inspection.measurements.filter((m) => m.result === "PASS").length} passed
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="text-red-700 font-medium">
                {inspection.measurements.filter((m) => m.result === "FAIL").length} failed
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">
                {inspection.measurements.filter((m) => m.result === "NA").length} N/A
              </span>
            </div>
          </div>
          {inspection.measurements.length === 0 ? (
            <div className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
              No measurement results recorded yet
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Check Name</th>
                    <th className="text-left px-3 py-2 font-medium">Specification</th>
                    <th className="text-left px-3 py-2 font-medium">Unit</th>
                    <th className="text-left px-3 py-2 font-medium">Measured Values</th>
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-left px-3 py-2 font-medium">Severity</th>
                    <th className="text-left px-3 py-2 font-medium">Result</th>
                    <th className="text-left px-3 py-2 font-medium">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {inspection.measurements.map((m) => (
                    <tr
                      key={m.checkId}
                      className={m.result === "FAIL" ? "bg-red-50" : ""}
                    >
                      <td className="px-3 py-2 font-medium max-w-[140px]">
                        {m.checkName}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[160px]">
                        {m.specification}
                      </td>
                      <td className="px-3 py-2 font-mono">{m.unit}</td>
                      <td className="px-3 py-2 font-mono max-w-[160px]">
                        {m.measuredValues.length === 0
                          ? "Visual"
                          : m.measuredValues.join(", ")}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={m.category} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={m.severity} />
                      </td>
                      <td className="px-3 py-2">
                        <CheckResultBadge result={m.result} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[160px]">
                        <span className="line-clamp-2">{m.remarks ?? "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* NCR Link Panel */}
        {linkedNCR && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="font-semibold text-amber-800">NCR Raised:</span>
              <span className="font-mono font-bold text-amber-900">{linkedNCR.ncrNumber}</span>
              <StatusBadge status={linkedNCR.status} />
            </div>
            <p className="text-xs text-amber-700 pl-6">{linkedNCR.title}</p>
          </div>
        )}

        {/* Action Buttons */}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-green-700 border-green-300 hover:bg-green-50"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            Mark Passed
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-700 border-red-300 hover:bg-red-50"
          >
            <XCircle className="h-4 w-4 mr-1.5" />
            Mark Failed
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-orange-700 border-orange-300 hover:bg-orange-50"
          >
            <AlertTriangle className="h-4 w-4 mr-1.5" />
            Raise NCR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InwardInspectionPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedInspection, setSelectedInspection] =
    useState<IncomingQCInspection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    return incomingInspections.filter((i) => {
      const matchesStatus =
        statusFilter === "ALL" || i.status === statusFilter;

      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        i.inspectionNumber.toLowerCase().includes(searchLower) ||
        i.vendorName.toLowerCase().includes(searchLower) ||
        i.itemName.toLowerCase().includes(searchLower);

      return matchesStatus && matchesSearch;
    });
  }, [statusFilter, search]);

  function handleRowClick(insp: IncomingQCInspection) {
    setSelectedInspection(insp);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Incoming RM QC — AQL Inspections"
        description="AQL-based incoming raw material inspection — Instigenie Guwahati Plant | ISO 13485"
      />

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by inspection #, vendor, item…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter((v ?? "ALL") as StatusFilter)}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="PASSED">Passed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="PENDING_COUNTERSIGN">Pending Countersign</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {incomingInspections.length} inspections
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              No inspections match your filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inspection #</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">GRN #</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">PO #</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vendor</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Batch / Lot</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty Rcvd</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Sampled</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Defects</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">AQL Result</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inspector</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((insp) => (
                    <tr
                      key={insp.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => handleRowClick(insp)}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                        {insp.inspectionNumber}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {insp.grnNumber}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {insp.poNumber}
                      </td>
                      <td className="px-4 py-3 text-sm max-w-[140px]">
                        <span className="truncate block" title={insp.vendorName}>
                          {insp.vendorName}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        <div className="text-sm font-medium truncate" title={insp.itemName}>
                          {insp.itemName}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{insp.itemCode}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{insp.batchLotNumber}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{insp.qtyReceived}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{insp.qtySampled}</td>
                      <td className={`px-4 py-3 text-right font-mono text-sm font-bold ${insp.defectsFound > 0 ? "text-red-700" : "text-green-700"}`}>
                        {insp.defectsFound}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={insp.aqlResult} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={insp.status} />
                      </td>
                      <td className="px-4 py-3 text-sm">{insp.inspectedBy}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(insp.inspectionDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <InspectionDetailDialog
        inspection={selectedInspection}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
