"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  boms,
  enhancedWorkOrders,
  getBOMsForProduct,
  formatCurrency,
  formatDate,
  BOM,
  BOMLine,
} from "@/data/manufacturing-mock";
import { ArrowLeft, AlertTriangle, Info, FileWarning } from "lucide-react";

// Rough std cost estimates per component type
function estimateLineCost(line: BOMLine): number {
  const name = line.componentName.toLowerCase();
  if (name.includes("pcb")) return 8500;
  if (name.includes("sensor") || name.includes("flow cell")) return 12000;
  if (name.includes("frame") || name.includes("mechanical")) return 6200;
  if (name.includes("reagent") || name.includes("kit")) return 4200;
  if (name.includes("cleaning") || name.includes("solution")) return 450;
  if (name.includes("packaging") || name.includes("carton")) return 350;
  if (name.includes("manual")) return 80;
  return 500;
}

export default function BOMDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const bom = boms.find((b) => b.id === params.id);

  const [localStatus, setLocalStatus] = useState<BOM["status"] | null>(null);

  if (!bom) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <FileWarning className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">BOM not found.</p>
        <Button variant="outline" onClick={() => router.push("/manufacturing/bom")}>
          Back to BOM List
        </Button>
      </div>
    );
  }

  const displayStatus = localStatus ?? bom.status;
  const otherVersions = getBOMsForProduct(bom.productId).filter((b) => b.id !== bom.id);
  const relatedWOs = enhancedWorkOrders.filter((wo) => wo.bomId === bom.id);
  const totalBOMCost = bom.lines.reduce((sum, line) => sum + line.qtyPerUnit * estimateLineCost(line), 0);

  function handleSubmitApproval() {
    setLocalStatus("ACTIVE");
  }
  function handleActivate() {
    setLocalStatus("ACTIVE");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => router.push("/manufacturing/bom")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight">
            BOM: {bom.productName} {bom.version}
          </h1>
          <StatusBadge status={displayStatus} />
          {bom.ecnRef && (
            <Badge variant="outline" className="font-mono text-xs">
              {bom.ecnRef}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(displayStatus === "DRAFT") && (
            <>
              <Button variant="outline" size="sm" onClick={handleSubmitApproval}>
                Submit for Approval
              </Button>
              <Button size="sm" onClick={handleActivate}>
                Activate BOM
              </Button>
            </>
          )}
          {displayStatus === "ACTIVE" && (
            <Button variant="outline" size="sm">
              Initiate ECN
            </Button>
          )}
        </div>
      </div>

      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">BOM Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Product Code</p>
              <p className="font-mono font-medium">{bom.productCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Version</p>
              <Badge variant="outline" className="font-mono font-bold">{bom.version}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Status</p>
              <StatusBadge status={displayStatus} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Standard Cost</p>
              <p className="font-semibold">{formatCurrency(bom.totalStdCost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Effective From</p>
              <p>{formatDate(bom.effectiveFrom)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Effective To</p>
              <p>{bom.effectiveTo ? formatDate(bom.effectiveTo) : <span className="text-green-600 font-medium">Active</span>}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">ECN Reference</p>
              <p className="font-mono text-muted-foreground">{bom.ecnRef ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Created By</p>
              <p>{bom.createdBy}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Approved By</p>
              <p>
                {bom.approvedBy ?? (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                    Pending Approval
                  </Badge>
                )}
              </p>
            </div>
            {bom.notes && (
              <div className="col-span-2 md:col-span-4">
                <p className="text-xs text-muted-foreground mb-0.5">Notes</p>
                <p className="text-sm text-muted-foreground bg-muted/40 px-3 py-2 rounded-md">{bom.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ECN Callout */}
      {bom.ecnRef && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 bg-blue-50">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-700">
            This BOM was created/modified by <span className="font-mono font-semibold">{bom.ecnRef}</span>.
            View ECN for full change details, approval history, and impact assessment.
          </p>
        </div>
      )}

      {/* BOM Lines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">BOM Lines</CardTitle>
          <CardDescription>{bom.lines.length} components — {bom.lines.filter((l) => l.isCritical).length} critical</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Ref. Designator</TableHead>
                  <TableHead>Component Code</TableHead>
                  <TableHead>Component Name</TableHead>
                  <TableHead className="text-right">Qty/Unit</TableHead>
                  <TableHead>UoM</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Critical</TableHead>
                  <TableHead>Lead Time</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Line Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bom.lines.map((line, idx) => {
                  const unitCost = estimateLineCost(line);
                  const lineCost = unitCost * line.qtyPerUnit;
                  return (
                    <TableRow
                      key={line.id}
                      className={line.isCritical ? "border-l-4 border-l-red-400" : ""}
                    >
                      <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {line.referenceDesignator ?? "—"}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{line.componentCode}</span>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{line.componentName}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.qtyPerUnit}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{line.uom}</TableCell>
                      <TableCell>
                        <StatusBadge status={line.trackingType} />
                      </TableCell>
                      <TableCell>
                        {line.isCritical ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs flex items-center gap-1 w-fit">
                            <AlertTriangle className="h-3 w-3" />
                            Critical
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{line.leadTimeDays} days</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCurrency(unitCost)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">{formatCurrency(lineCost)}</TableCell>
                    </TableRow>
                  );
                })}
                {/* Summary Row */}
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell colSpan={9} className="text-right text-sm">
                    Total BOM Cost
                  </TableCell>
                  <TableCell colSpan={2} className="text-right tabular-nums text-sm">
                    {formatCurrency(totalBOMCost)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Other Versions */}
      {otherVersions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Other Versions</CardTitle>
            <CardDescription>All BOM versions for {bom.productName}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Effective To</TableHead>
                  <TableHead>ECN Ref</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otherVersions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono font-bold">{v.version}</Badge>
                    </TableCell>
                    <TableCell><StatusBadge status={v.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(v.effectiveFrom)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {v.effectiveTo ? formatDate(v.effectiveTo) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {v.ecnRef ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/manufacturing/bom/${v.id}`)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Where Used */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where Used</CardTitle>
          <CardDescription>Work orders currently using BOM {bom.productCode} {bom.version}</CardDescription>
        </CardHeader>
        <CardContent>
          {relatedWOs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No active work orders using this BOM version.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>PID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Target Date</TableHead>
                    <TableHead>Assigned To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatedWOs.map((wo) => (
                    <TableRow key={wo.id}>
                      <TableCell>
                        <span className="font-mono font-semibold text-sm">{wo.pid}</span>
                      </TableCell>
                      <TableCell><StatusBadge status={wo.status} /></TableCell>
                      <TableCell><StatusBadge status={wo.priority} /></TableCell>
                      <TableCell className="text-right tabular-nums">{wo.quantity}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(wo.targetDate)}</TableCell>
                      <TableCell className="text-sm">{wo.assignedTo}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
