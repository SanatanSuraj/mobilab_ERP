"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, Column } from "@/components/shared/data-table";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  qcInspections,
  procurementGRNs,
  QCInspection,
  QCCheckItem,
  GRN,
  formatCurrency,
  formatDate,
} from "@/data/procurement-mock";
import {
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Package,
  BadgeCheck,
  BarChart3,
} from "lucide-react";

type CheckResult = "PASS" | "FAIL" | "NA";

function QCInspectDialog({
  inspection,
  open,
  onOpenChange,
  onSubmit,
}: {
  inspection: QCInspection;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (id: string, passed: boolean, qtyAccepted: number) => void;
}) {
  const [checkResults, setCheckResults] = useState<Record<string, CheckResult>>(
    () =>
      Object.fromEntries(
        inspection.checklist.map((c) => [c.id, c.result])
      )
  );
  const [defectReason, setDefectReason] = useState(
    inspection.defectReason ?? ""
  );
  const [qtyAccepted, setQtyAccepted] = useState(
    inspection.qtyAccepted > 0 ? inspection.qtyAccepted : inspection.qtyInspected
  );
  const [submitted, setSubmitted] = useState(false);
  const [submitPassed, setSubmitPassed] = useState(true);

  const hasFail = Object.values(checkResults).some((r) => r === "FAIL");
  const qtyRejected = inspection.qtyInspected - qtyAccepted;

  function setCheck(id: string, result: CheckResult) {
    setCheckResults((prev) => ({ ...prev, [id]: result }));
  }

  function handleSubmit(pass: boolean) {
    setSubmitPassed(pass);
    setSubmitted(true);
    onSubmit(inspection.id, pass, qtyAccepted);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>QC Inspection — {inspection.itemName}</DialogTitle>
        </DialogHeader>

        {/* Header info */}
        <div className="grid grid-cols-2 gap-3 text-sm bg-muted/40 rounded-lg p-3">
          <div>
            <span className="text-muted-foreground">Vendor: </span>
            <span className="font-medium">{inspection.vendorName}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Inward Ref: </span>
            <span className="font-mono font-medium">{inspection.inwardNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Item Code: </span>
            <span className="font-mono">{inspection.itemCode}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Qty to Inspect: </span>
            <span className="font-bold">{inspection.qtyInspected}</span>
          </div>
        </div>

        {submitted ? (
          <div
            className={`rounded-md border p-4 text-sm font-medium ${
              submitPassed
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-red-50 border-red-200 text-red-800"
            }`}
          >
            {submitPassed
              ? "✓ GRN auto-generated. Stock updated in Inventory."
              : "✗ QC Failed. Items sent to Quarantine. Create RTV to return to vendor."}
          </div>
        ) : (
          <div className="space-y-5">
            {/* Checklist */}
            <div>
              <h4 className="text-sm font-semibold mb-3">QC Checklist</h4>
              <div className="space-y-2">
                {inspection.checklist.map((check) => (
                  <div
                    key={check.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg border bg-background"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {check.checkName}
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs mt-0.5 bg-blue-50 text-blue-700 border-blue-200"
                      >
                        {check.category}
                      </Badge>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setCheck(check.id, "PASS")}
                        className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                          checkResults[check.id] === "PASS"
                            ? "bg-green-600 text-white border-green-600"
                            : "bg-white text-green-700 border-green-300 hover:bg-green-50"
                        }`}
                      >
                        PASS
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheck(check.id, "FAIL")}
                        className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                          checkResults[check.id] === "FAIL"
                            ? "bg-red-600 text-white border-red-600"
                            : "bg-white text-red-700 border-red-300 hover:bg-red-50"
                        }`}
                      >
                        FAIL
                      </button>
                      <button
                        type="button"
                        onClick={() => setCheck(check.id, "NA")}
                        className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                          checkResults[check.id] === "NA"
                            ? "bg-gray-500 text-white border-gray-500"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        N/A
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Defect Reason */}
            {hasFail && (
              <div className="space-y-1.5">
                <Label>Defect Reason</Label>
                <Textarea
                  placeholder="Describe the defect(s) found…"
                  value={defectReason}
                  onChange={(e) => setDefectReason(e.target.value)}
                  rows={3}
                />
              </div>
            )}

            {/* Qty Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  Qty Accepted (max {inspection.qtyInspected})
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={inspection.qtyInspected}
                  value={qtyAccepted}
                  onChange={(e) =>
                    setQtyAccepted(
                      Math.min(
                        inspection.qtyInspected,
                        Math.max(0, Number(e.target.value))
                      )
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Qty Rejected (auto)</Label>
                <Input
                  value={qtyRejected}
                  readOnly
                  className="bg-muted/40"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!submitted && (
            <>
              <Button
                onClick={() => handleSubmit(true)}
                disabled={hasFail}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                Submit — QC PASS
              </Button>
              <Button
                onClick={() => handleSubmit(false)}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Submit — QC FAIL
              </Button>
            </>
          )}
          {submitted && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GRNDetailDialog({
  grn,
  open,
  onOpenChange,
}: {
  grn: GRN;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>GRN Details — {grn.grnNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Header Info */}
          <div className="grid grid-cols-3 gap-3 text-sm bg-muted/40 rounded-lg p-3">
            <div>
              <span className="text-muted-foreground">GRN: </span>
              <span className="font-mono font-bold">{grn.grnNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Inward: </span>
              <span className="font-mono">{grn.inwardNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">PO: </span>
              <span className="font-mono">{grn.poNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Vendor: </span>
              <span className="font-medium">{grn.vendorName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Warehouse: </span>
              <span>{grn.warehouseName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Status: </span>
              <StatusBadge status={grn.status} />
            </div>
            <div>
              <span className="text-muted-foreground">Created: </span>
              <span>{formatDate(grn.createdAt)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Value: </span>
              <span className="font-bold text-green-700">
                {formatCurrency(grn.totalAcceptedValue)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Confirmed By: </span>
              <span>{grn.confirmedBy ?? "—"}</span>
            </div>
          </div>

          {/* Lines Table */}
          <div>
            <h4 className="text-sm font-semibold mb-2">GRN Lines</h4>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Item Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Accepted</TableHead>
                    <TableHead className="text-right">Rejected</TableHead>
                    <TableHead>Batch #</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Line Value</TableHead>
                    <TableHead>QC Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grn.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-xs">
                        {line.itemCode}
                      </TableCell>
                      <TableCell className="text-sm">{line.itemName}</TableCell>
                      <TableCell className="text-right text-green-700 font-medium">
                        {line.qtyAccepted} {line.unit}
                      </TableCell>
                      <TableCell className="text-right">
                        {line.qtyRejected > 0 ? (
                          <span className="text-red-600 font-medium">
                            {line.qtyRejected} {line.unit}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {line.batchNumber}
                      </TableCell>
                      <TableCell className="text-xs">
                        {line.expiryDate ? formatDate(line.expiryDate) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {formatCurrency(line.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {formatCurrency(line.lineValue)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={line.qcResult} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Integration Callout */}
          {grn.purchaseInvoiceDraft && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <span className="font-medium">→ Purchase Invoice </span>
              <span className="font-mono font-bold">
                {grn.purchaseInvoiceDraft}
              </span>
              <span> created in Finance &amp; Accounting</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GRNQCPage() {
  const [inspections, setInspections] = useState<QCInspection[]>(qcInspections);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [selectedInspection, setSelectedInspection] =
    useState<QCInspection | null>(null);

  const [grnDetailOpen, setGRNDetailOpen] = useState(false);
  const [selectedGRN, setSelectedGRN] = useState<GRN | null>(null);

  function handleInspectSubmit(
    id: string,
    passed: boolean,
    qtyAccepted: number
  ) {
    setInspections((prev) =>
      prev.map((insp) =>
        insp.id === id
          ? {
              ...insp,
              status: passed
                ? insp.qtyAccepted === insp.qtyInspected
                  ? "PASSED"
                  : "PARTIALLY_PASSED"
                : "FAILED",
              qtyAccepted: passed ? qtyAccepted : 0,
              qtyRejected: passed
                ? insp.qtyInspected - qtyAccepted
                : insp.qtyInspected,
            }
          : insp
      )
    );
  }

  // QC KPIs
  const qcTotal = inspections.length;
  const qcPending = inspections.filter((i) => i.status === "PENDING").length;
  const qcInProgress = inspections.filter(
    (i) => i.status === "IN_PROGRESS"
  ).length;
  const qcPassed = inspections.filter((i) => i.status === "PASSED").length;
  const qcPartial = inspections.filter(
    (i) => i.status === "PARTIALLY_PASSED"
  ).length;
  const qcFailed = inspections.filter((i) => i.status === "FAILED").length;

  // GRN KPIs
  const grnTotal = procurementGRNs.length;
  const grnConfirmed = procurementGRNs.filter(
    (g) => g.status === "CONFIRMED"
  ).length;
  const grnStockUpdated = procurementGRNs.filter((g) => g.stockUpdated).length;
  const grnTotalValue = procurementGRNs.reduce(
    (sum, g) => sum + g.totalAcceptedValue,
    0
  );

  const qcColumns: Column<QCInspection>[] = [
    {
      key: "id",
      header: "Inspection ID",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.id}</span>
      ),
    },
    {
      key: "inwardNumber",
      header: "Inward Ref",
      render: (row) => (
        <span className="font-mono text-sm font-medium">{row.inwardNumber}</span>
      ),
    },
    {
      key: "poNumber",
      header: "PO Number",
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.poNumber}
        </span>
      ),
    },
    { key: "vendorName", header: "Vendor" },
    {
      key: "itemCode",
      header: "Item",
      render: (row) => (
        <div>
          <div className="font-mono text-xs text-muted-foreground">
            {row.itemCode}
          </div>
          <div className="text-sm">{row.itemName}</div>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      render: (row) => (
        <div className="text-sm space-y-0.5">
          <div className="text-muted-foreground">
            Inspected: {row.qtyInspected}
          </div>
          <div className="text-green-700 font-medium">
            Accepted: {row.qtyAccepted}
          </div>
          {row.qtyRejected > 0 && (
            <div className="text-red-600 font-medium">
              Rejected: {row.qtyRejected}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "inspectedBy",
      header: "Inspector",
      render: (row) => (
        <div className="text-sm">
          <div>{row.inspectedBy ?? "—"}</div>
          {row.inspectedAt && (
            <div className="text-xs text-muted-foreground">
              {formatDate(row.inspectedAt)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => {
        const canInspect =
          row.status === "PENDING" || row.status === "IN_PROGRESS";
        return (
          <Button
            variant={canInspect ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setSelectedInspection(row);
              setInspectOpen(true);
            }}
          >
            {canInspect ? "Inspect" : "View Result"}
          </Button>
        );
      },
    },
  ];

  const grnColumns: Column<GRN>[] = [
    {
      key: "grnNumber",
      header: "GRN Number",
      render: (row) => (
        <span className="font-mono font-bold text-sm">{row.grnNumber}</span>
      ),
    },
    {
      key: "refs",
      header: "Inward / PO",
      render: (row) => (
        <div>
          <div className="font-mono text-xs">{row.inwardNumber}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {row.poNumber}
          </div>
        </div>
      ),
    },
    { key: "vendorName", header: "Vendor" },
    { key: "warehouseName", header: "Warehouse" },
    {
      key: "createdAt",
      header: "Created At",
      render: (row) => (
        <span className="text-sm">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "lines",
      header: "Lines",
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.lines.length} item{row.lines.length !== 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "totalAcceptedValue",
      header: "Total Value",
      className: "text-right",
      render: (row) => (
        <span className="font-medium text-sm text-right block">
          {formatCurrency(row.totalAcceptedValue)}
        </span>
      ),
    },
    {
      key: "purchaseInvoiceDraft",
      header: "Purchase Invoice",
      render: (row) =>
        row.purchaseInvoiceDraft ? (
          <Badge
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 text-xs font-mono"
          >
            {row.purchaseInvoiceDraft}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
          >
            Draft Pending
          </Badge>
        ),
    },
    {
      key: "stockUpdated",
      header: "Stock",
      render: (row) =>
        row.stockUpdated ? (
          <span className="text-green-700 text-xs font-medium">
            ✓ Stock Updated
          </span>
        ) : (
          <span className="text-amber-600 text-xs font-medium">Pending</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setSelectedGRN(row);
            setGRNDetailOpen(true);
          }}
        >
          View Details
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="GRN & QC"
        description="Quality inspection → Goods Receipt → Stock induction"
      />

      <Tabs defaultValue="qc">
        <TabsList>
          <TabsTrigger value="qc">QC Inspections</TabsTrigger>
          <TabsTrigger value="grn">GRN Register</TabsTrigger>
        </TabsList>

        {/* QC TAB */}
        <TabsContent value="qc" className="space-y-5 mt-5">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <KPICard
              title="Total"
              value={String(qcTotal)}
              icon={ClipboardCheck}
              iconColor="text-blue-600"
            />
            <KPICard
              title="Pending"
              value={String(qcPending)}
              icon={Clock}
              iconColor="text-amber-600"
            />
            <KPICard
              title="In Progress"
              value={String(qcInProgress)}
              icon={AlertTriangle}
              iconColor="text-orange-600"
            />
            <KPICard
              title="Passed"
              value={String(qcPassed)}
              icon={CheckCircle2}
              iconColor="text-green-600"
            />
            <KPICard
              title="Partially Passed"
              value={String(qcPartial)}
              icon={BadgeCheck}
              iconColor="text-cyan-600"
            />
            <KPICard
              title="Failed"
              value={String(qcFailed)}
              icon={XCircle}
              iconColor="text-red-600"
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <DataTable
                data={inspections}
                columns={qcColumns}
                searchKey="vendorName"
                searchPlaceholder="Search by vendor…"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* GRN TAB */}
        <TabsContent value="grn" className="space-y-5 mt-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              title="Total GRNs"
              value={String(grnTotal)}
              icon={FileText}
              iconColor="text-blue-600"
            />
            <KPICard
              title="Confirmed"
              value={String(grnConfirmed)}
              icon={CheckCircle2}
              iconColor="text-green-600"
            />
            <KPICard
              title="Stock Updated"
              value={String(grnStockUpdated)}
              icon={Package}
              iconColor="text-indigo-600"
            />
            <KPICard
              title="Total Value Accepted"
              value={formatCurrency(grnTotalValue)}
              icon={BarChart3}
              iconColor="text-emerald-600"
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <DataTable
                data={procurementGRNs}
                columns={grnColumns}
                searchKey="vendorName"
                searchPlaceholder="Search by vendor…"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* QC Inspect Dialog */}
      {selectedInspection && (
        <QCInspectDialog
          inspection={selectedInspection}
          open={inspectOpen}
          onOpenChange={setInspectOpen}
          onSubmit={handleInspectSubmit}
        />
      )}

      {/* GRN Detail Dialog */}
      {selectedGRN && (
        <GRNDetailDialog
          grn={selectedGRN}
          open={grnDetailOpen}
          onOpenChange={setGRNDetailOpen}
        />
      )}
    </div>
  );
}
