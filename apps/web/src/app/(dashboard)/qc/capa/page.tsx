"use client";

// TODO(phase-5): Corrective / Preventive Action (CAPA) records have no backend
// routes yet. Expected routes:
//   GET  /qc/capas?status=&type=
//   POST /qc/capas - open CAPA (often linked from an NCR)
//   POST /qc/capas/:id/plan - record action plan + owner + due date
//   POST /qc/capas/:id/verify - effectiveness verification
//   POST /qc/capas/:id/close
// Mock imports left in place until the CAPA slice ships in
// apps/api/src/modules/qc.

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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  capaRecords,
  getOpenCAPAs,
  getCAPAOverdueCount,
  formatDate,
  formatDateTime,
  CAPARecord,
  CAPAStatus,
  CAPAType,
} from "@/data/qc-mock";
import {
  AlertTriangle,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldCheck,
  ClipboardList,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "ACTION_PLAN_APPROVED" | "CLOSED";
type TypeFilter = "ALL" | "CORRECTIVE" | "PREVENTIVE";

const TODAY = new Date("2026-04-17");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOverdue(capa: CAPARecord): boolean {
  return capa.status !== "CLOSED" && new Date(capa.targetClosureDate) < TODAY;
}

function typeBadgeClass(type: CAPAType): string {
  return type === "CORRECTIVE"
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-blue-50 text-blue-700 border-blue-200";
}

function rootCauseMethodLabel(method: string): string {
  switch (method) {
    case "5_WHY": return "5-Why";
    case "ISHIKAWA": return "Ishikawa";
    case "8D": return "8D";
    case "FAULT_TREE": return "Fault Tree";
    default: return method;
  }
}

function effectivenessBadgeClass(status: string): string {
  switch (status) {
    case "EFFECTIVE": return "bg-green-50 text-green-700 border-green-200";
    case "INEFFECTIVE": return "bg-red-50 text-red-700 border-red-200";
    case "MONITORING": return "bg-amber-50 text-amber-700 border-amber-200";
    default: return "bg-gray-50 text-gray-500 border-gray-200";
  }
}

function ApprovalBubble({ action, role }: { action: string; role: string }) {
  const base = "flex flex-col items-center gap-0.5";
  let icon: React.ReactNode;
  let labelColor: string;

  if (action === "APPROVED") {
    icon = <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center"><CheckCircle2 className="h-3.5 w-3.5 text-white" /></div>;
    labelColor = "text-green-700";
  } else if (action === "REJECTED") {
    icon = <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center"><XCircle className="h-3.5 w-3.5 text-white" /></div>;
    labelColor = "text-red-700";
  } else {
    icon = <div className="w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center"><Clock className="h-3.5 w-3.5 text-white" /></div>;
    labelColor = "text-amber-700";
  }

  return (
    <div className={base}>
      {icon}
      <span className={`text-[9px] font-medium ${labelColor} text-center leading-tight max-w-[52px]`}>{role}</span>
    </div>
  );
}

// ─── CAPA Detail Dialog ───────────────────────────────────────────────────────

function CAPADetailDialog({
  capa,
  open,
  onOpenChange,
}: {
  capa: CAPARecord | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!capa) return null;

  const completedActions = capa.actionItems.filter((a) => a.status === "COMPLETED").length;
  const totalActions = capa.actionItems.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-lg text-blue-700">{capa.capaNumber}</span>
            <Badge variant="outline" className={`text-xs ${typeBadgeClass(capa.type)}`}>{capa.type}</Badge>
            <StatusBadge status={capa.status} />
            {isOverdue(capa) && (
              <Badge className="bg-red-600 text-white text-xs">OVERDUE</Badge>
            )}
          </div>
          <DialogTitle className="text-sm font-normal text-muted-foreground mt-1">
            {capa.productCode && <span className="font-mono mr-2">{capa.productCode}</span>}
            {capa.linkedNCRNumber && <span>Linked NCR: <span className="font-mono">{capa.linkedNCRNumber}</span></span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Problem Statement */}
          <section>
            <h3 className="text-sm font-semibold mb-1">Problem Statement</h3>
            <p className="text-sm text-muted-foreground bg-muted/40 rounded-md p-3 leading-relaxed">{capa.problemStatement}</p>
          </section>

          {/* Immediate Containment */}
          <section>
            <h3 className="text-sm font-semibold mb-1">Immediate Containment</h3>
            <p className="text-sm text-muted-foreground bg-amber-50 border border-amber-200 rounded-md p-3 leading-relaxed">{capa.immediateContainment}</p>
          </section>

          {/* Root Cause Analysis */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Root Cause Analysis</h3>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                {rootCauseMethodLabel(capa.rootCauseMethod)}
              </Badge>
              <Badge variant="outline" className="text-xs bg-slate-50 text-slate-700 border-slate-200">
                {capa.rootCauseCategory.replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground bg-muted/40 rounded-md p-3 leading-relaxed">{capa.rootCauseFinding}</p>
          </section>

          {/* Corrective Action */}
          <section>
            <h3 className="text-sm font-semibold mb-1">Corrective Action</h3>
            <p className="text-sm text-muted-foreground bg-muted/40 rounded-md p-3 leading-relaxed">{capa.correctiveAction}</p>
          </section>

          {/* Preventive Action */}
          <section>
            <h3 className="text-sm font-semibold mb-1">Preventive Action</h3>
            <p className="text-sm text-muted-foreground bg-blue-50 border border-blue-200 rounded-md p-3 leading-relaxed">{capa.preventiveAction}</p>
          </section>

          {/* Action Items Table */}
          <section>
            <h3 className="text-sm font-semibold mb-2">
              Action Items ({completedActions}/{totalActions} completed)
            </h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Description</th>
                    <th className="text-left px-3 py-2 font-medium">Assigned To</th>
                    <th className="text-left px-3 py-2 font-medium">Due Date</th>
                    <th className="text-left px-3 py-2 font-medium">Completed At</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {capa.actionItems.map((item) => {
                    const dueOverdue = new Date(item.dueDate) < TODAY && item.status !== "COMPLETED";
                    return (
                      <tr key={item.id} className={item.status === "COMPLETED" ? "bg-green-50/30" : ""}>
                        <td className="px-3 py-2 max-w-[180px]">{item.description}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.assignedTo}</td>
                        <td className={`px-3 py-2 font-mono ${dueOverdue ? "text-red-600 font-semibold" : ""}`}>
                          {item.dueDate}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {item.completedAt ? formatDateTime(item.completedAt) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[140px]">
                          {item.evidence ? <span className="line-clamp-2">{item.evidence}</span> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Approval Steps */}
          <section>
            <h3 className="text-sm font-semibold mb-3">Approval Steps</h3>
            <div className="space-y-3">
              {capa.approvalSteps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {step.action === "APPROVED" && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                    {step.action === "REJECTED" && <XCircle className="h-5 w-5 text-red-600" />}
                    {step.action === "PENDING" && <Clock className="h-5 w-5 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{step.role}</span>
                      <span className="text-xs text-muted-foreground">— {step.approver}</span>
                      <Badge variant="outline" className={`text-xs ${
                        step.action === "APPROVED" ? "bg-green-50 text-green-700 border-green-200"
                        : step.action === "REJECTED" ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        {step.action}
                      </Badge>
                    </div>
                    {step.note && <p className="text-xs text-muted-foreground mt-0.5">{step.note}</p>}
                    {step.actionedAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(step.actionedAt)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Effectiveness */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Effectiveness Monitoring</h3>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline" className={`text-xs ${effectivenessBadgeClass(capa.effectivenessStatus)}`}>
                  {capa.effectivenessStatus.replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {capa.batchesMonitored} batch{capa.batchesMonitored !== 1 ? "es" : ""} monitored
                </span>
                <span className={`text-xs font-medium ${capa.recurrenceFound ? "text-red-600" : "text-green-600"}`}>
                  {capa.recurrenceFound ? "Recurrence found" : "No recurrence found"}
                </span>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            className="border-green-300 text-green-700 hover:bg-green-50"
          >
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            Approve CAPA
          </Button>
          <Button
            variant="outline"
            disabled={capa.status === "CLOSED"}
            className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Close CAPA
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CAPA Card ────────────────────────────────────────────────────────────────

function CAPACard({
  capa,
  onView,
}: {
  capa: CAPARecord;
  onView: (c: CAPARecord) => void;
}) {
  const overdue = isOverdue(capa);
  const completedActions = capa.actionItems.filter((a) => a.status === "COMPLETED").length;
  const totalActions = capa.actionItems.length;
  const progressPct = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0;
  const targetRed = new Date(capa.targetClosureDate) < TODAY && capa.status !== "CLOSED";

  return (
    <Card className={`transition-shadow hover:shadow-md ${overdue ? "border-red-200" : ""}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-sm text-blue-700">{capa.capaNumber}</span>
            <Badge variant="outline" className={`text-xs ${typeBadgeClass(capa.type)}`}>{capa.type}</Badge>
            <StatusBadge status={capa.status} />
            {overdue && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold bg-red-100 text-red-700 border border-red-300">
                OVERDUE
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => onView(capa)}>
            View Details
          </Button>
        </div>

        {/* Product / NCR line */}
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          {capa.productCode && (
            <span className="font-mono">{capa.productCode}</span>
          )}
          {capa.linkedNCRNumber && (
            <span>NCR: <span className="font-mono font-medium">{capa.linkedNCRNumber}</span></span>
          )}
        </div>

        {/* Problem Statement (truncated) */}
        <p className="text-sm leading-relaxed text-muted-foreground line-clamp-2">
          {capa.problemStatement.length > 100
            ? `${capa.problemStatement.slice(0, 100)}…`
            : capa.problemStatement}
        </p>

        {/* Root cause + method badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs bg-slate-50 text-slate-600 border-slate-200">
            {capa.rootCauseCategory.replace(/_/g, " ")}
          </Badge>
          <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
            {rootCauseMethodLabel(capa.rootCauseMethod)}
          </Badge>
        </div>

        {/* Responsible + Dates */}
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="block font-medium text-foreground">{capa.responsiblePerson}</span>
            <span>Responsible</span>
          </div>
          <div>
            <span className="block font-mono">{capa.openedAt.slice(0, 10)}</span>
            <span>Opened</span>
          </div>
          <div>
            <span className={`block font-mono ${targetRed ? "text-red-600 font-semibold" : ""}`}>
              {capa.targetClosureDate}
            </span>
            <span>Target Closure</span>
          </div>
        </div>

        {/* Action items progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{completedActions}/{totalActions} actions completed</span>
            <span className="font-medium">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>

        {/* Approval bubbles */}
        <div className="flex items-center gap-4 pt-1">
          {capa.approvalSteps.map((step, idx) => (
            <ApprovalBubble key={idx} action={step.action} role={step.role} />
          ))}
          {/* Effectiveness badge */}
          <div className="ml-auto">
            <Badge variant="outline" className={`text-xs ${effectivenessBadgeClass(capa.effectivenessStatus)}`}>
              {capa.effectivenessStatus.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CAPAPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedCAPA, setSelectedCAPA] = useState<CAPARecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // KPIs
  const totalCAPAs = capaRecords.length;
  const openCAPAs = getOpenCAPAs().length;
  const closedCAPAs = capaRecords.filter((c) => c.status === "CLOSED").length;
  const overdueCAPAs = getCAPAOverdueCount();
  const closedRecords = capaRecords.filter((c) => c.status === "CLOSED");
  const effectivePct =
    closedRecords.length > 0
      ? Math.round(
          (closedRecords.filter((c) => c.effectivenessStatus === "EFFECTIVE").length /
            closedRecords.length) *
            100
        )
      : 0;

  const filtered = useMemo(() => {
    return capaRecords.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && c.type !== typeFilter) return false;
      const s = search.toLowerCase();
      if (
        s &&
        !c.capaNumber.toLowerCase().includes(s) &&
        !c.problemStatement.toLowerCase().includes(s) &&
        !(c.productCode ?? "").toLowerCase().includes(s) &&
        !(c.linkedNCRNumber ?? "").toLowerCase().includes(s) &&
        !c.responsiblePerson.toLowerCase().includes(s)
      ) {
        return false;
      }
      return true;
    });
  }, [statusFilter, typeFilter, search]);

  function handleView(capa: CAPARecord) {
    setSelectedCAPA(capa);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="CAPA — Corrective & Preventive Actions"
        description="ISO 13485 §8.5.2 | Open CAPAs must be closed within 30 days"
      />

      {/* Overdue Alert */}
      {overdueCAPAs > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
          <span className="text-sm font-semibold text-red-700">
            {overdueCAPAs} CAPA{overdueCAPAs !== 1 ? "s" : ""} overdue — Management escalation required
          </span>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KPICard title="Total CAPAs" value={String(totalCAPAs)} icon={ClipboardList} iconColor="text-primary" />
        <KPICard title="Open" value={String(openCAPAs)} icon={Clock} iconColor="text-amber-600" />
        <KPICard title="Closed" value={String(closedCAPAs)} icon={CheckCircle2} iconColor="text-green-600" />
        <KPICard title="Overdue" value={String(overdueCAPAs)} icon={AlertTriangle} iconColor="text-red-600" />
        <KPICard title="Avg Effectiveness" value={`${effectivePct}%`} icon={ShieldCheck} iconColor="text-indigo-600" />
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search CAPA number, product, NCR…"
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
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="ACTION_PLAN_APPROVED">Action Plan Approved</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter((v ?? "ALL") as TypeFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="CORRECTIVE">Corrective</SelectItem>
            <SelectItem value="PREVENTIVE">Preventive</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {capaRecords.length} CAPAs
        </span>
      </div>

      {/* CAPA Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
          No CAPAs match your filters
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((capa) => (
            <CAPACard key={capa.id} capa={capa} onView={handleView} />
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      <CAPADetailDialog
        capa={selectedCAPA}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
