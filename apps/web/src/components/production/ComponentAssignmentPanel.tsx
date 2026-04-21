"use client";

import React from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ComponentType =
  | "PCB"
  | "MECH_BODY"
  | "SENSOR"
  | "OPTICAL_COUPLER"
  | "REAGENT_BATCH";

export type ComponentAssignment = {
  deviceSerialId: string;
  pcbId: string | null;
  mechId: string | null;
  sensorId: string | null;
  ocId: string | null;
  pcbBatchId?: string;
  sensorBatchId?: string;
  assignedBy?: string;
  assignedAt?: string;
};

export type ComponentAssignmentPanelProps = {
  woId: string;
  assignments: ComponentAssignment[];
  canAssign?: boolean;
  onAssign?: (deviceSerialId: string, componentType: ComponentType) => void;
};

function UnassignedCell() {
  return (
    <span className="text-red-500 text-xs font-mono">— unassigned —</span>
  );
}

function isComplete(a: ComponentAssignment) {
  return a.pcbId !== null && a.mechId !== null && a.sensorId !== null && a.ocId !== null;
}

export function ComponentAssignmentPanel({
  assignments,
  canAssign = false,
  onAssign,
}: ComponentAssignmentPanelProps) {
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Unit ID</TableHead>
            <TableHead>PCB-ID</TableHead>
            <TableHead>Mech-ID</TableHead>
            <TableHead>Sensor-ID</TableHead>
            <TableHead>OC-ID</TableHead>
            <TableHead>Status</TableHead>
            {canAssign && <TableHead>Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignments.map((a) => {
            const complete = isComplete(a);
            return (
              <TableRow key={a.deviceSerialId}>
                {/* Unit ID (Device = MCC · Module = MBA/MBM/MBC/CFG) */}
                <TableCell>
                  <span className="font-mono text-xs font-semibold">
                    {a.deviceSerialId}
                  </span>
                </TableCell>

                {/* PCB */}
                <TableCell>
                  {a.pcbId ? (
                    <span className="font-mono text-xs">{a.pcbId}</span>
                  ) : (
                    <UnassignedCell />
                  )}
                </TableCell>

                {/* Mech */}
                <TableCell>
                  {a.mechId ? (
                    <span className="font-mono text-xs">{a.mechId}</span>
                  ) : (
                    <UnassignedCell />
                  )}
                </TableCell>

                {/* Sensor */}
                <TableCell>
                  {a.sensorId ? (
                    <span className="font-mono text-xs">{a.sensorId}</span>
                  ) : (
                    <UnassignedCell />
                  )}
                </TableCell>

                {/* OC */}
                <TableCell>
                  {a.ocId ? (
                    <span className="font-mono text-xs">{a.ocId}</span>
                  ) : (
                    <UnassignedCell />
                  )}
                </TableCell>

                {/* Status badge */}
                <TableCell>
                  <StatusBadge status={complete ? "COMPLETE" : "INCOMPLETE"} />
                </TableCell>

                {/* Assign actions */}
                {canAssign && (
                  <TableCell>
                    {!complete && (
                      <div className="flex flex-wrap gap-1">
                        {!a.pcbId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2"
                            onClick={() => onAssign?.(a.deviceSerialId, "PCB")}
                          >
                            PCB
                          </Button>
                        )}
                        {!a.mechId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2"
                            onClick={() => onAssign?.(a.deviceSerialId, "MECH_BODY")}
                          >
                            Mech
                          </Button>
                        )}
                        {!a.sensorId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2"
                            onClick={() => onAssign?.(a.deviceSerialId, "SENSOR")}
                          >
                            Sensor
                          </Button>
                        )}
                        {!a.ocId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2"
                            onClick={() => onAssign?.(a.deviceSerialId, "OPTICAL_COUPLER")}
                          >
                            OC
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground italic px-1">
        All components must be assigned before Final QC can proceed.
      </p>
    </div>
  );
}
