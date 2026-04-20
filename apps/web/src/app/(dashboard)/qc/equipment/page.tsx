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
  equipmentRecords,
  getCalibrationDueEquipment,
  getOverdueEquipment,
  getDaysUntilCalibration,
  formatDate,
  EquipmentRecord,
  EquipmentStatus,
  EquipmentCategory,
  CalibrationHistory,
} from "@/data/qc-mock";
import {
  AlertTriangle,
  Search,
  CheckCircle2,
  Clock,
  Wrench,
  Activity,
  CalendarClock,
  AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "ALL" | "CALIBRATED" | "CALIBRATION_DUE" | "CALIBRATION_OVERDUE" | "OUT_OF_SERVICE";
type CategoryFilter = "ALL" | "TEST_EQUIPMENT" | "MEASURING_INSTRUMENT" | "FIXTURE" | "PRODUCTION_TOOL";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadgeClass(status: EquipmentStatus): string {
  switch (status) {
    case "CALIBRATED": return "bg-green-50 text-green-700 border-green-200";
    case "CALIBRATION_DUE": return "bg-amber-50 text-amber-700 border-amber-200";
    case "CALIBRATION_OVERDUE": return "bg-red-50 text-red-700 border-red-200";
    case "OUT_OF_SERVICE": return "bg-gray-50 text-gray-500 border-gray-200";
    case "UNDER_REPAIR": return "bg-orange-50 text-orange-700 border-orange-200";
  }
}

function categoryBadgeClass(cat: EquipmentCategory): string {
  switch (cat) {
    case "TEST_EQUIPMENT": return "bg-blue-50 text-blue-700 border-blue-200";
    case "MEASURING_INSTRUMENT": return "bg-purple-50 text-purple-700 border-purple-200";
    case "FIXTURE": return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "PRODUCTION_TOOL": return "bg-teal-50 text-teal-700 border-teal-200";
  }
}

function calHistoryResultClass(result: "PASS" | "FAIL" | "ADJUSTED"): string {
  switch (result) {
    case "PASS": return "bg-green-50 text-green-700 border-green-200";
    case "FAIL": return "bg-red-50 text-red-700 border-red-200";
    case "ADJUSTED": return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function DaysUntilBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        {Math.abs(days)}d overdue
      </span>
    );
  }
  if (days < 30) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
        <Clock className="h-3.5 w-3.5" />
        {days}d
      </span>
    );
  }
  return (
    <span className="text-xs text-green-700 font-medium">{days}d</span>
  );
}

// ─── Equipment Detail Dialog ──────────────────────────────────────────────────

function EquipmentDetailDialog({
  equipment,
  open,
  onOpenChange,
}: {
  equipment: EquipmentRecord | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!equipment) return null;

  const days = getDaysUntilCalibration(equipment.nextCalibrationDue);
  const isOverdue = equipment.status === "CALIBRATION_OVERDUE";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-xl text-blue-700">{equipment.equipmentId}</span>
            <Badge variant="outline" className={`text-sm ${statusBadgeClass(equipment.status)}`}>
              {isOverdue && <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
              {equipment.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <DialogTitle className="text-base font-medium mt-1">{equipment.equipmentName}</DialogTitle>
        </DialogHeader>

        {/* Overdue Alert */}
        {isOverdue && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 font-medium">
              This equipment is OVERDUE for calibration. Results from stages using this equipment may be unreliable and must be flagged.
            </p>
          </div>
        )}

        <div className="space-y-5 py-2">
          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm border rounded-lg p-4 bg-muted/30">
            <div>
              <span className="text-muted-foreground">Category:</span>{" "}
              <Badge variant="outline" className={`text-xs ${categoryBadgeClass(equipment.category)}`}>
                {equipment.category.replace(/_/g, " ")}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Make:</span>{" "}
              <span className="font-medium">{equipment.make}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Model:</span>{" "}
              <span className="font-mono text-xs">{equipment.model}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Serial Number:</span>{" "}
              <span className="font-mono text-xs">{equipment.serialNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Location:</span>{" "}
              <span>{equipment.location}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Cal Frequency:</span>{" "}
              <span>{equipment.calibrationFrequencyDays} days</span>
            </div>
            <div>
              <span className="text-muted-foreground">Last Cal Date:</span>{" "}
              <span className="font-mono text-xs">{equipment.lastCalibrationDate}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Next Due Date:</span>{" "}
              <span className={`font-mono text-xs ${isOverdue ? "text-red-600 font-bold" : days < 30 ? "text-amber-600 font-semibold" : ""}`}>
                {equipment.nextCalibrationDue}
              </span>
            </div>
            {equipment.calibrationCertNumber && (
              <div>
                <span className="text-muted-foreground">Cert Number:</span>{" "}
                <span className="font-mono text-xs">{equipment.calibrationCertNumber}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Calibrated By:</span>{" "}
              <span>{equipment.calibratedBy}</span>
            </div>
          </div>

          {/* Used In Stages */}
          <section>
            <h3 className="text-sm font-semibold mb-2">Used In Stages</h3>
            <div className="flex flex-wrap gap-2">
              {equipment.usedInStages.map((stage) => (
                <Badge key={stage} variant="secondary" className="text-xs">
                  {stage}
                </Badge>
              ))}
            </div>
          </section>

          {/* Calibration History */}
          <section>
            <h3 className="text-sm font-semibold mb-3">Calibration History</h3>
            <div className="space-y-3">
              {equipment.calibrationHistory.map((entry, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="mt-1 shrink-0">
                    <div className={`w-2 h-2 rounded-full ${
                      entry.result === "PASS" ? "bg-green-500"
                      : entry.result === "FAIL" ? "bg-red-500"
                      : "bg-amber-500"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0 border rounded-md p-3 space-y-1.5 bg-muted/20">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold">{entry.date}</span>
                      <Badge variant="outline" className={`text-xs ${calHistoryResultClass(entry.result)}`}>
                        {entry.result}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">{entry.certNumber}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Performed by: <span className="text-foreground">{entry.performedBy}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Next due: <span className="font-mono text-foreground">{entry.nextDueDate}</span>
                    </div>
                    {entry.notes && (
                      <p className="text-xs text-muted-foreground italic">{entry.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {equipment.notes && (
            <section>
              <h3 className="text-sm font-semibold mb-1">Notes</h3>
              <p className="text-sm text-muted-foreground bg-muted/40 rounded-md p-3">{equipment.notes}</p>
            </section>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            className="border-indigo-300 text-indigo-700 hover:bg-indigo-50"
          >
            <CalendarClock className="h-4 w-4 mr-1.5" />
            Schedule Calibration
          </Button>
          <Button
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50"
          >
            <AlertCircle className="h-4 w-4 mr-1.5" />
            Mark Out of Service
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

export default function EquipmentCalibrationPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Data
  const overdueEquipment = getOverdueEquipment();
  const calibrationDue = equipmentRecords.filter((e) => e.status === "CALIBRATION_DUE");

  // KPIs
  const totalEquipment = equipmentRecords.length;
  const calibrated = equipmentRecords.filter((e) => e.status === "CALIBRATED").length;
  const due = equipmentRecords.filter((e) => e.status === "CALIBRATION_DUE").length;
  const overdue = overdueEquipment.length;
  const outOfService = equipmentRecords.filter(
    (e) => e.status === "OUT_OF_SERVICE" || e.status === "UNDER_REPAIR"
  ).length;

  const filtered = useMemo(() => {
    return equipmentRecords.filter((e) => {
      if (statusFilter === "OUT_OF_SERVICE") {
        if (e.status !== "OUT_OF_SERVICE" && e.status !== "UNDER_REPAIR") return false;
      } else if (statusFilter !== "ALL" && e.status !== statusFilter) {
        return false;
      }
      if (categoryFilter !== "ALL" && e.category !== categoryFilter) return false;
      const s = search.toLowerCase();
      if (
        s &&
        !e.equipmentId.toLowerCase().includes(s) &&
        !e.equipmentName.toLowerCase().includes(s) &&
        !e.location.toLowerCase().includes(s) &&
        !e.make.toLowerCase().includes(s) &&
        !e.model.toLowerCase().includes(s)
      ) {
        return false;
      }
      return true;
    });
  }, [statusFilter, categoryFilter, search]);

  function handleRowClick(eq: EquipmentRecord) {
    setSelectedEquipment(eq);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Equipment Calibration Registry"
        description="ISO 13485 §7.6 | All test equipment must be calibrated to traceable standards"
      />

      {/* Alert Banners */}
      <div className="space-y-2">
        {overdueEquipment.length > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">
              <span className="font-bold">CALIBRATION OVERDUE: </span>
              <span className="font-semibold">{overdueEquipment.map((e) => e.equipmentName).join(", ")}</span>
              <span>. Results from affected stages are FLAGGED and may be invalid.</span>
            </div>
          </div>
        )}
        {calibrationDue.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-700">
              <span className="font-semibold">Calibration Due: </span>
              <span>{calibrationDue.map((e) => e.equipmentName).join(", ")}</span>
              <span className="font-medium">. Schedule calibration immediately.</span>
            </div>
          </div>
        )}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KPICard title="Total Equipment" value={String(totalEquipment)} icon={Wrench} iconColor="text-primary" />
        <KPICard title="Calibrated" value={String(calibrated)} icon={CheckCircle2} iconColor="text-green-600" />
        <KPICard title="Calibration Due" value={String(due)} icon={Clock} iconColor="text-amber-600" />
        <KPICard title="Overdue" value={String(overdue)} icon={AlertTriangle} iconColor="text-red-600" />
        <KPICard title="Out of Service" value={String(outOfService)} icon={AlertCircle} iconColor="text-gray-500" />
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search equipment ID, name, location…"
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
            <SelectItem value="CALIBRATED">Calibrated</SelectItem>
            <SelectItem value="CALIBRATION_DUE">Calibration Due</SelectItem>
            <SelectItem value="CALIBRATION_OVERDUE">Calibration Overdue</SelectItem>
            <SelectItem value="OUT_OF_SERVICE">Out of Service / Under Repair</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={categoryFilter}
          onValueChange={(v) => setCategoryFilter((v ?? "ALL") as CategoryFilter)}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            <SelectItem value="TEST_EQUIPMENT">Test Equipment</SelectItem>
            <SelectItem value="MEASURING_INSTRUMENT">Measuring Instrument</SelectItem>
            <SelectItem value="FIXTURE">Fixture</SelectItem>
            <SelectItem value="PRODUCTION_TOOL">Production Tool</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {filtered.length} of {equipmentRecords.length} equipment
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No equipment records match your filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Equipment ID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Make / Model</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Last Cal</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Next Due</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Days Until</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Frequency</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Calibrated By</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((eq) => {
                    const days = getDaysUntilCalibration(eq.nextCalibrationDue);
                    const rowBg =
                      eq.status === "CALIBRATION_OVERDUE"
                        ? "bg-red-50/40"
                        : eq.status === "CALIBRATION_DUE"
                        ? "bg-amber-50/30"
                        : "";

                    return (
                      <tr
                        key={eq.id}
                        className={`hover:bg-muted/30 transition-colors cursor-pointer ${rowBg}`}
                        onClick={() => handleRowClick(eq)}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700 whitespace-nowrap">
                          {eq.equipmentId}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium max-w-[200px] line-clamp-2">{eq.equipmentName}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${categoryBadgeClass(eq.category)}`}>
                            {eq.category.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div>{eq.make}</div>
                          <div className="font-mono">{eq.model}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[140px]">
                          {eq.location}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${statusBadgeClass(eq.status)}`}>
                            {eq.status === "CALIBRATION_OVERDUE" && (
                              <AlertTriangle className="h-3 w-3 mr-1" />
                            )}
                            {eq.status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {eq.lastCalibrationDate}
                        </td>
                        <td className={`px-4 py-3 font-mono text-xs whitespace-nowrap ${
                          eq.status === "CALIBRATION_OVERDUE" ? "text-red-600 font-bold"
                          : eq.status === "CALIBRATION_DUE" ? "text-amber-600 font-semibold"
                          : "text-muted-foreground"
                        }`}>
                          {eq.nextCalibrationDue}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <DaysUntilBadge days={days} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {eq.calibrationFrequencyDays}d
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[140px]">
                          {eq.calibratedBy}
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
      <EquipmentDetailDialog
        equipment={selectedEquipment}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
