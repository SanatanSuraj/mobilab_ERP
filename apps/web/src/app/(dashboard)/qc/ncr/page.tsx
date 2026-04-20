"use client";

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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ncrRecords,
  getOpenNCRs,
  getCAPAById,
  formatDate,
  formatDateTime,
  NCRRecord,
  NCRSeverity,
  NCRSource,
  NCRStatus,
} from "@/data/qc-mock";
import {
  AlertTriangle,
  Search,
  FileText,
  CheckCircle2,
  Link2,
  ClipboardList,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SeverityFilter = "ALL" | "CRITICAL" | "MAJOR" | "MINOR";
type SourceFilter = "ALL" | "INCOMING_QC" | "WIP_INSPECTION" | "FINAL_QC";
type StatusFilter = "ALL" | "OPEN" | "INVESTIGATING" | "PENDING_CAPA" | "CAPA_RAISED" | "CLOSED" | "REJECTED";

const TODAY = new Date("2026-04-17");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOverdueNCR(ncr: NCRRecord): boolean {
  return ncr.status !== "CLOSED" && ncr.status !== "REJECTED" && new Date(ncr.targetClosureDate) < TODAY;
}

function severityBadgeClass(severity: NCRSeverity): string {
  switch (severity) {
    case "CRITICAL": return "bg-red-50 text-red-700 border-red-200";
    case "MAJOR": return "bg-orange-50 text-orange-700 border-orange-200";
    case "MINOR": return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function sourceBadgeClass(source: NCRSource): string {
  switch (source) {
    case "INCOMING_QC": return "bg-blue-50 text-blue-700 border-blue-200";
    case "WIP_INSPECTION": return "bg-purple-50 text-purple-700 border-purple-200";
    case "FINAL_QC": return "bg-indigo-50 text-indigo-700 border-indigo-200";
    default: return "bg-gray-50 text-gray-600 border-gray-200";
  }
}

function dispositionBadgeClass(disposition: string): string {
  switch (disposition) {
    case "USE_AS_IS": return "bg-green-50 text-green-700 border-green-200";
    case "REWORK": return "bg-amber-50 text-amber-700 border-amber-200";
    case "SCRAP": return "bg-red-50 text-red-700 border-red-200";
    case "RETURN_TO_VENDOR": return "bg-orange-50 text-orange-700 border-orange-200";
    case "PENDING": return "bg-gray-50 text-gray-500 border-gray-200";
    default: return "bg-gray-50 text-gray-500 border-gray-200";
  }
}

// ─── NCR Detail Dialog ────────────────────────────────────────────────────────

function NCRDetailDialog({
  ncr,
  open,
  onOpenChange,
}: {
  ncr: NCRRecord | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!ncr) return null;

  const linkedCAPA = ncr.linkedCAPAId ? getCAPAById(ncr.linkedCAPAId) : undefined;
  const overdue = isOverdueNCR(ncr);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-xl text-blue-700">{ncr.ncrNumber}</span>
            <Badge variant="outline" className={`text-xs ${severityBadgeClass(ncr.severity)}`}>{ncr.severity}</Badge>
            <Badge variant="outline" className={`text-xs ${sourceBadgeClass(ncr.source)}`}>{ncr.source.replace(/_/g, " ")}</Badge>
            <StatusBadge status={ncr.status} />
            {overdue && (
              <Badge className="bg-red-600 text-white text-xs">OVERDUE</Badge>
            )}
          </div>
          <DialogTitle className="text-base font-medium mt-1">{ncr.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm border rounded-lg p-4 bg-muted/30">
            <div>
              <span className="text-muted-foreground">Source:</span>{" "}
              <Badge variant="outline" className={`text-xs ${sourceBadgeClass(ncr.source)}`}>
                {ncr.source.replace(/_/g, " ")}
              </Badge>
            </div>
            {ncr.workOrderPid && (
              <div>
                <span className="text-muted-foreground">WO / PID:</span>{" "}
                <span className="font-mono text-xs">{ncr.workOrderPid}</span>
              </div>
            )}
            {ncr.productCode && (
              <div>
                <span className="text-muted-foreground">Product:</span>{" "}
                <span className="font-mono text-xs">{ncr.productCode}</span>
                {ncr.productName && <span className="text-xs ml-1 text-muted-foreground">({ncr.productName})</span>}
              </div>
            )}
            {ncr.itemCode && (
              <div>
                <span className="text-muted-foreground">Item:</span>{" "}
                <span className="font-mono text-xs">{ncr.itemCode}</span>
                {ncr.itemName && <span className="text-xs ml-1 text-muted-foreground">— {ncr.itemName}</span>}
              </div>
            )}
            {ncr.batchLotNumber && (
              <div>
                <span className="text-muted-foreground">Batch / Lot:</span>{" "}
                <span className="font-mono text-xs">{ncr.batchLotNumber}</span>
              </div>
            )}
            {ncr.vendorName && (
              <div>
                <span className="text-muted-foreground">Vendor:</span>{" "}
                <span>{ncr.vendorName}</span>
              </div>
            )}
            {ncr.qtyAffected !== undefined && (
              <div>
                <span className="text-muted-foreground">Qty Affected:</span>{" "}
                <span className="font-semibold">{ncr.qtyAffected}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Raised By:</span>{" "}
              <span>{ncr.raisedBy}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Raised At:</span>{" "}
              <span className="font-mono text-xs">{formatDateTime(ncr.raisedAt)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Assigned To:</span>{" "}
              <span>{ncr.assignedTo}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Target Closure:</span>{" "}
              <span className={`font-mono text-xs ${overdue ? "text-red-600 font-bold" : ""}`}>
                {ncr.targetClosureDate}
              </span>
            </div>
          </div>

          {/* Description */}
          <section>
            <h3 className="text-sm font-semibold mb-1">Description</h3>
            <blockquote className="text-sm text-muted-foreground bg-muted/40 border-l-4 border-muted-foreground/30 rounded-r-md px-4 py-3 leading-relaxed">
              {ncr.description}
            </blockquote>
          </section>

          {/* Containment Action */}
          <section>
            <h3 className="text-sm font-semibold mb-1">Containment Action</h3>
            <p className="text-sm text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3 leading-relaxed">
              {ncr.containmentAction}
            </p>
          </section>

          {/* Linked Inspection */}
          {ncr.linkedInspectionNumber && (
            <section>
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
                <Link2 className="h-4 w-4 shrink-0" />
                <span>Linked Inspection: <span className="font-mono font-semibold">{ncr.linkedInspectionNumber}</span></span>
              </div>
            </section>
          )}

          {/* Disposition Decision */}
          {ncr.dispositionDecision && (
            <section>
              <h3 className="text-sm font-semibold mb-1">Disposition Decision</h3>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={`text-sm px-3 py-1 ${dispositionBadgeClass(ncr.dispositionDecision)}`}>
                  {ncr.dispositionDecision.replace(/_/g, " ")}
                </Badge>
              </div>
            </section>
          )}

          {/* CAPA Panel */}
          <section>
            <h3 className="text-sm font-semibold mb-1">CAPA Linkage</h3>
            {linkedCAPA ? (
              <div className="rounded-md border border-green-300 bg-green-50 px-4 py-2.5 flex items-center gap-2 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>CAPA Raised: <span className="font-mono font-semibold">{linkedCAPA.capaNumber}</span></span>
                <span className="text-xs text-green-700 ml-1">— {linkedCAPA.status.replace(/_/g, " ")}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">No CAPA linked</span>
                <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50">
                  <FileText className="h-4 w-4 mr-1.5" />
                  Raise CAPA
                </Button>
              </div>
            )}
          </section>

          {/* Closure Section */}
          {ncr.closedAt && (
            <section>
              <h3 className="text-sm font-semibold mb-2">Closure Details</h3>
              <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Closed At:</span>{" "}
                  <span className="font-mono text-xs">{formatDateTime(ncr.closedAt)}</span>
                </div>
                {ncr.closedBy && (
                  <div>
                    <span className="text-muted-foreground">Closed By:</span>{" "}
                    <span>{ncr.closedBy}</span>
                  </div>
                )}
                {ncr.notes && (
                  <div>
                    <span className="text-muted-foreground">Notes:</span>{" "}
                    <span>{ncr.notes}</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {ncr.status !== "CLOSED" && ncr.status !== "REJECTED" && (
            <Button
              variant="outline"
              className="border-green-300 text-green-700 hover:bg-green-50"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Close NCR
            </Button>
          )}
          {!ncr.linkedCAPAId && (
            <Button
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              <FileText className="h-4 w-4 mr-1.5" />
              Raise CAPA
            </Button>
          )}
          <Button
            variant="outline"
            className="border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            Update Disposition
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NCRPage() {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedNCR, setSelectedNCR] = useState<NCRRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // KPIs
  const totalNCRs = ncrRecords.length;
  const openNCRs = getOpenNCRs().length;
  const capaLinked = ncrRecords.filter((n) => n.linkedCAPAId).length;
  const closedNCRs = ncrRecords.filter((n) => n.status === "CLOSED").length;

  const filtered = useMemo(() => {
    return ncrRecords.filter((n) => {
      if (severityFilter !== "ALL" && n.severity !== severityFilter) return false;
      if (sourceFilter !== "ALL" && n.source !== sourceFilter) return false;
      if (statusFilter !== "ALL" && n.status !== statusFilter) return false;
      const s = search.toLowerCase();
      if (
        s &&
        !n.ncrNumber.toLowerCase().includes(s) &&
        !n.title.toLowerCase().includes(s) &&
        !(n.itemName ?? "").toLowerCase().includes(s) &&
        !(n.productCode ?? "").toLowerCase().includes(s) &&
        !(n.vendorName ?? "").toLowerCase().includes(s)
      ) {
        return false;
      }
      return true;
    });
  }, [severityFilter, sourceFilter, statusFilter, search]);

  function handleRowClick(ncr: NCRRecord) {
    setSelectedNCR(ncr);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="NCR — Non-Conformance Reports"
        description="Linked to incoming QC failures, WIP gate failures, and final QC rejections"
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPICard title="Total NCRs" value={String(totalNCRs)} icon={ClipboardList} iconColor="text-primary" />
        <KPICard title="Open" value={String(openNCRs)} icon={AlertTriangle} iconColor="text-amber-600" />
        <KPICard title="CAPA Linked" value={String(capaLinked)} icon={Link2} iconColor="text-indigo-600" />
        <KPICard title="Closed" value={String(closedNCRs)} icon={CheckCircle2} iconColor="text-green-600" />
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search NCR number, title, item, vendor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={severityFilter}
          onValueChange={(v) => setSeverityFilter((v ?? "ALL") as SeverityFilter)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Severities</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
            <SelectItem value="MAJOR">Major</SelectItem>
            <SelectItem value="MINOR">Minor</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter((v ?? "ALL") as SourceFilter)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Sources</SelectItem>
            <SelectItem value="INCOMING_QC">Incoming QC</SelectItem>
            <SelectItem value="WIP_INSPECTION">WIP Inspection</SelectItem>
            <SelectItem value="FINAL_QC">Final QC</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter((v ?? "ALL") as StatusFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="INVESTIGATING">Investigating</SelectItem>
            <SelectItem value="PENDING_CAPA">Pending CAPA</SelectItem>
            <SelectItem value="CAPA_RAISED">CAPA Raised</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {ncrRecords.length} NCRs
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No NCRs match your filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">NCR #</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Severity</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item / Product</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vendor / WO</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Disposition</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">CAPA</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Raised By</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target Closure</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((ncr) => {
                    const overdue = isOverdueNCR(ncr);
                    const linkedCAPA = ncr.linkedCAPAId ? getCAPAById(ncr.linkedCAPAId) : undefined;
                    return (
                      <tr
                        key={ncr.id}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => handleRowClick(ncr)}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700 whitespace-nowrap">
                          {ncr.ncrNumber}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${severityBadgeClass(ncr.severity)}`}>
                            {ncr.severity}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${sourceBadgeClass(ncr.source)}`}>
                            {ncr.source.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 max-w-[240px]">
                          <span className="text-sm" title={ncr.title}>
                            {ncr.title.length > 65 ? `${ncr.title.slice(0, 65)}…` : ncr.title}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {ncr.itemCode && <div className="font-mono">{ncr.itemCode}</div>}
                          {ncr.productCode && <div className="font-mono">{ncr.productCode}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {ncr.vendorName && <div>{ncr.vendorName}</div>}
                          {ncr.workOrderPid && <div className="font-mono">{ncr.workOrderPid}</div>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {ncr.qtyAffected ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={ncr.status} />
                        </td>
                        <td className="px-4 py-3">
                          {ncr.dispositionDecision ? (
                            <Badge variant="outline" className={`text-xs ${dispositionBadgeClass(ncr.dispositionDecision)}`}>
                              {ncr.dispositionDecision.replace(/_/g, " ")}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {linkedCAPA ? (
                            <span className="font-mono text-xs text-green-700 font-semibold">
                              {linkedCAPA.capaNumber}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{ncr.raisedBy}</td>
                        <td className={`px-4 py-3 font-mono text-xs whitespace-nowrap ${overdue ? "text-red-600 font-bold" : "text-muted-foreground"}`}>
                          {ncr.targetClosureDate}
                          {overdue && <span className="ml-1 text-red-500">!</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <NCRDetailDialog
        ncr={selectedNCR}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
