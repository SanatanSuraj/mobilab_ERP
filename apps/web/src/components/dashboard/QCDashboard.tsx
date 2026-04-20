"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, ClipboardList, AlertTriangle, AlertCircle } from "lucide-react";
import {
  incomingInspections,
  wipInspections,
  getOverdueEquipment,
  getOpenCAPAs,
} from "@/data/qc-mock";

export function QCDashboard() {
  // Live today — never hardcoded
  const todayPrefix = useMemo(
    () => new Date().toISOString().slice(0, 10),
    []
  );

  const pendingInspections = useMemo(
    () =>
      incomingInspections.filter(
        (i) => i.status === "PENDING" || i.status === "IN_PROGRESS"
      ),
    []
  );

  // Completed today uses live date, not hardcoded "2026-04-18"
  const completedToday = useMemo(
    () =>
      incomingInspections.filter((i) =>
        i.completedAt?.startsWith(todayPrefix)
      ).length,
    [todayPrefix]
  );

  const overdueGates = useMemo(
    () =>
      wipInspections.filter(
        (w) => w.status === "PENDING" || w.status === "ON_HOLD"
      ).length,
    []
  );

  const openCAPAs = useMemo(() => getOpenCAPAs().length, []);
  const overdueEquipment = useMemo(() => getOverdueEquipment(), []);

  const allInspections = useMemo(
    () =>
      [
        ...incomingInspections.map((i) => ({
          id: i.id,
          ref: i.inspectionNumber,
          type: "Incoming",
          item: i.itemName,
          status: i.status,
          priority: i.status === "PENDING" ? 0 : 1,
        })),
        ...wipInspections.map((w) => ({
          id: w.id,
          ref: w.inspectionNumber,
          type: "WIP",
          item: w.productName,
          status: w.status,
          priority: w.status === "PENDING" ? 0 : 1,
        })),
      ].sort((a, b) => a.priority - b.priority),
    []
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Pending Inspections" value={String(pendingInspections.length)} icon={ShieldCheck} trend={pendingInspections.length > 0 ? "down" : "up"} iconColor="text-amber-600" />
        <KPICard title="Completed Today" value={String(completedToday)} icon={ClipboardList} trend="up" iconColor="text-green-600" />
        <KPICard title="Overdue Gates" value={String(overdueGates)} icon={AlertTriangle} trend={overdueGates > 0 ? "down" : "up"} iconColor={overdueGates > 0 ? "text-red-600" : "text-green-600"} />
        <KPICard title="CAPA Open" value={String(openCAPAs)} icon={AlertCircle} trend={openCAPAs > 0 ? "down" : "up"} iconColor={openCAPAs > 0 ? "text-red-600" : "text-green-600"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Inspection Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>Ref</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allInspections.slice(0, 8).map((ins) => (
                    <TableRow key={ins.id}>
                      <TableCell className="font-mono text-xs">{ins.ref}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{ins.type}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                        {ins.item}
                      </TableCell>
                      <TableCell><StatusBadge status={ins.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Overdue Equipment Calibration</CardTitle>
          </CardHeader>
          <CardContent>
            {overdueEquipment.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No overdue calibrations.</p>
            ) : (
              <div className="space-y-3">
                {overdueEquipment.map((eq) => (
                  <div key={eq.id} className="flex items-center justify-between p-3 rounded-lg border border-red-200 bg-red-50/40">
                    <div>
                      <p className="text-sm font-medium">{eq.equipmentName}</p>
                      <p className="text-xs text-muted-foreground">{eq.equipmentId}</p>
                    </div>
                    <StatusBadge status={eq.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
