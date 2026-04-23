"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  enhancedWorkOrders,
  mfgProducts,
  EnhancedWorkOrder,
  getCompletedStages,
  getWOProgress,
  isWOOverdue,
  formatDate,
} from "@/data/manufacturing-mock";
import {
  ClipboardList,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
} from "lucide-react";

export default function WorkOrdersPage() {
  const router = useRouter();

  const [newWOOpen, setNewWOOpen] = useState(false);
  const [newWOProduct, setNewWOProduct] = useState("");
  const [newWOQty, setNewWOQty] = useState("");
  const [newWOPriority, setNewWOPriority] = useState("NORMAL");
  const [newWODate, setNewWODate] = useState("");
  const [newWOAssignedTo, setNewWOAssignedTo] = useState("");
  const [newWONotes, setNewWONotes] = useState("");

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [familyFilter, setFamilyFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");

  const allWOs = enhancedWorkOrders;

  const total = allWOs.length;
  const inProgress = allWOs.filter((w) => w.status === "IN_PROGRESS").length;
  const qcHoldRework = allWOs.filter((w) => w.status === "QC_HOLD" || w.status === "REWORK").length;
  const completed = allWOs.filter((w) => w.status === "COMPLETED").length;
  const overdue = allWOs.filter((w) => isWOOverdue(w)).length;

  const filtered = allWOs.filter((wo) => {
    if (statusFilter !== "ALL" && wo.status !== statusFilter) return false;
    if (familyFilter !== "ALL" && wo.productFamily !== familyFilter) return false;
    if (priorityFilter !== "ALL" && wo.priority !== priorityFilter) return false;
    return true;
  });

  const columns: Column<EnhancedWorkOrder>[] = [
    {
      key: "pid",
      header: "PID",
      sortable: true,
      render: (wo) => (
        <span
          className="font-mono font-bold text-blue-600 cursor-pointer hover:underline"
          onClick={(e) => { e.stopPropagation(); router.push(`/manufacturing/work-orders/${wo.id}`); }}
        >
          {wo.pid}
        </span>
      ),
    },
    {
      key: "productName",
      header: "Product",
      render: (wo) => (
        <div className="space-y-0.5">
          <div className="font-medium text-sm">{wo.productName}</div>
          <Badge
            variant="outline"
            className={
              wo.productFamily === "INSTIGENIE_INSTRUMENT"
                ? "bg-blue-50 text-blue-700 border-blue-200 text-xs"
                : wo.productFamily === "CBL_DEVICE"
                ? "bg-purple-50 text-purple-700 border-purple-200 text-xs"
                : "bg-teal-50 text-teal-700 border-teal-200 text-xs"
            }
          >
            {wo.productFamily.replace(/_/g, " ")}
          </Badge>
        </div>
      ),
    },
    {
      key: "bomVersion",
      header: "BOM",
      render: (wo) => (
        <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
          {wo.bomVersion}
        </Badge>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      sortable: true,
      className: "text-right",
      render: (wo) => <span className="tabular-nums">{wo.quantity}</span>,
    },
    {
      key: "priority",
      header: "Priority",
      render: (wo) => <StatusBadge status={wo.priority} />,
    },
    {
      key: "status",
      header: "Status",
      render: (wo) => <StatusBadge status={wo.status} />,
    },
    {
      key: "progress",
      header: "Progress",
      render: (wo) => {
        const pct = getWOProgress(wo);
        const done = getCompletedStages(wo);
        return (
          <div className="w-28 space-y-1">
            <Progress value={pct} className="h-1.5" />
            <div className="text-xs text-muted-foreground">{done}/{wo.wipStages.length} stages</div>
          </div>
        );
      },
    },
    {
      key: "currentStage",
      header: "Current Stage",
      render: (wo) => {
        const stage = wo.wipStages[wo.currentStageIndex];
        if (!stage) return <span className="text-xs text-muted-foreground">Not started</span>;
        return (
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                stage.status === "IN_PROGRESS"
                  ? "bg-amber-500"
                  : stage.status === "QC_HOLD"
                  ? "bg-red-500"
                  : "bg-gray-300"
              }`}
            />
            <span className="text-xs">{stage.stageName}</span>
          </div>
        );
      },
    },
    {
      key: "targetDate",
      header: "Target Date",
      sortable: true,
      render: (wo) => (
        <span className={`text-xs ${isWOOverdue(wo) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
          {formatDate(wo.targetDate)}
        </span>
      ),
    },
    {
      key: "assignedTo",
      header: "Assigned To",
      render: (wo) => <span className="text-xs text-muted-foreground">{wo.assignedTo}</span>,
    },
    {
      key: "reworkCount",
      header: "Rework",
      render: (wo) =>
        wo.reworkCount > 0 ? (
          <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
            ↺ {wo.reworkCount}
          </Badge>
        ) : null,
    },
    {
      key: "dealId",
      header: "Deal",
      render: (wo) =>
        wo.dealId ? (
          <Badge variant="outline" className="font-mono text-xs">
            {wo.dealId}
          </Badge>
        ) : null,
    },
    {
      key: "actions",
      header: "",
      render: (wo) => (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => { e.stopPropagation(); router.push(`/manufacturing/work-orders/${wo.id}`); }}
        >
          Open
        </Button>
      ),
    },
  ];

  function handleCreate() {
    setNewWOOpen(false);
    setNewWOProduct("");
    setNewWOQty("");
    setNewWOPriority("NORMAL");
    setNewWODate("");
    setNewWOAssignedTo("");
    setNewWONotes("");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Work Orders (PID)"
        description="Production orders across all product families"
        actions={
          <Button onClick={() => setNewWOOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Work Order
          </Button>
        }
      />

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard title="Total" value={String(total)} icon={ClipboardList} iconColor="text-blue-600" />
        <KPICard
          title="In Progress"
          value={String(inProgress)}
          icon={Loader2}
          iconColor="text-blue-600"
          change="Active production"
          trend="neutral"
        />
        <KPICard
          title="QC Hold / Rework"
          value={String(qcHoldRework)}
          icon={AlertTriangle}
          iconColor="text-orange-600"
          change={qcHoldRework > 0 ? "Needs attention" : "All clear"}
          trend={qcHoldRework > 0 ? "down" : "up"}
        />
        <KPICard
          title="Completed"
          value={String(completed)}
          icon={CheckCircle2}
          iconColor="text-green-600"
          change={`${Math.round((completed / total) * 100)}% completion rate`}
          trend="up"
        />
        <KPICard
          title="Overdue"
          value={String(overdue)}
          icon={Clock}
          iconColor="text-red-600"
          change={overdue > 0 ? "Past target date" : "On schedule"}
          trend={overdue > 0 ? "down" : "up"}
        />
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">Filters:</span>
            <Select onValueChange={(v: string | null) => setStatusFilter(v ?? "ALL")}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PLANNED">Planned</SelectItem>
                <SelectItem value="MATERIAL_CHECK">Material Check</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="QC_HOLD">QC Hold</SelectItem>
                <SelectItem value="REWORK">Rework</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select onValueChange={(v: string | null) => setFamilyFilter(v ?? "ALL")}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Families" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Families</SelectItem>
                <SelectItem value="INSTIGENIE_INSTRUMENT">Instigenie Instrument</SelectItem>
                <SelectItem value="CBL_DEVICE">CBL Device</SelectItem>
                <SelectItem value="REAGENT">Reagent</SelectItem>
              </SelectContent>
            </Select>
            <Select onValueChange={(v: string | null) => setPriorityFilter(v ?? "ALL")}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Priorities</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
            {(statusFilter !== "ALL" || familyFilter !== "ALL" || priorityFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setStatusFilter("ALL"); setFamilyFilter("ALL"); setPriorityFilter("ALL"); }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <DataTable<EnhancedWorkOrder>
        data={filtered}
        columns={columns}
        searchKey="pid"
        searchPlaceholder="Search by PID..."
        onRowClick={(wo) => router.push(`/manufacturing/work-orders/${wo.id}`)}
      />

      {/* New Work Order Dialog */}
      <Dialog open={newWOOpen} onOpenChange={setNewWOOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Work Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select onValueChange={(v: string | null) => setNewWOProduct(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product..." />
                </SelectTrigger>
                <SelectContent>
                  {mfgProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.productCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  placeholder="e.g. 5"
                  value={newWOQty}
                  onChange={(e) => setNewWOQty(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select onValueChange={(v: string | null) => setNewWOPriority(v ?? "NORMAL")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Normal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Target Date</Label>
              <Input
                type="date"
                value={newWODate}
                onChange={(e) => setNewWODate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assigned To</Label>
              <Input
                placeholder="e.g. Bikash Deka"
                value={newWOAssignedTo}
                onChange={(e) => setNewWOAssignedTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional notes..."
                value={newWONotes}
                onChange={(e) => setNewWONotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewWOOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newWOProduct || !newWOQty || !newWODate}>
              Create Work Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
