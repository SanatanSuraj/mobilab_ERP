"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";

export type BatchTrace = {
  componentType: string;
  componentId: string;
  batchNumber: string;
  grnNumber: string;
  vendorName: string;
  qcResult: "PASS" | "FAIL" | "PENDING";
  expiryDate?: string;
};

export type TraceabilityData = {
  deviceId: string;
  productCode: string;
  woId: string;
  pcbId: string | null;
  mechId: string | null;
  sensorId: string | null;
  ocId: string | null;
  batches: BatchTrace[];
  qcCertNumber?: string;
  dispatchDate?: string;
  customerName?: string;
};

export type TraceabilityPanelProps = {
  data: TraceabilityData | null;
  isLoading?: boolean;
};

type ComponentEntry = {
  label: string;
  componentId: string | null;
  batchTrace: BatchTrace | null;
};

function ComponentNode({
  entry,
  isLast,
}: {
  entry: ComponentEntry;
  isLast: boolean;
}) {
  return (
    <div className="flex">
      {/* Tree lines */}
      <div className="flex flex-col items-center mr-2">
        <div className="w-px h-3 bg-border" />
        <div className="flex items-center">
          <div className="w-4 h-px bg-border" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border" />}
      </div>

      {/* Content */}
      <div className="pb-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block h-3 w-3 rounded-sm bg-muted border border-border flex-shrink-0" />
          <span className="text-sm font-medium text-foreground">{entry.label}:</span>
          {entry.componentId ? (
            <span className="font-mono text-sm font-semibold">{entry.componentId}</span>
          ) : (
            <span className="text-xs text-red-500 font-mono">— unassigned —</span>
          )}
        </div>

        {/* Batch trace sub-row */}
        {entry.batchTrace && (
          <div className="ml-5 mt-1 pl-3 border-l border-dashed border-border">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Batch: <span className="font-mono text-foreground">{entry.batchTrace.batchNumber}</span></span>
              <span className="text-border">|</span>
              <span>GRN: <span className="font-mono text-foreground">{entry.batchTrace.grnNumber}</span></span>
              <span className="text-border">|</span>
              <span>Vendor: <span className="text-foreground">{entry.batchTrace.vendorName}</span></span>
              <span className="text-border">|</span>
              <StatusBadge status={entry.batchTrace.qcResult === "PASS" ? "PASSED" : entry.batchTrace.qcResult === "FAIL" ? "FAILED" : "PENDING"} />
              {entry.batchTrace.expiryDate && (
                <>
                  <span className="text-border">|</span>
                  <span>Exp: {entry.batchTrace.expiryDate}</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TraceabilityPanel({ data, isLoading = false }: TraceabilityPanelProps) {
  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-64" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5 pl-6">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-80 ml-5" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-sm text-muted-foreground italic">
        No traceability data available.
      </div>
    );
  }

  const batchByType = (type: string) =>
    data.batches.find(
      (b) => b.componentType.toLowerCase() === type.toLowerCase()
    ) ?? null;

  const entries: ComponentEntry[] = [
    { label: "PCB-ID", componentId: data.pcbId, batchTrace: batchByType("PCB") },
    { label: "Sensor-ID", componentId: data.sensorId, batchTrace: batchByType("SENSOR") },
    { label: "Mech-ID", componentId: data.mechId, batchTrace: batchByType("MECH_BODY") },
    { label: "OC-ID", componentId: data.ocId, batchTrace: batchByType("OPTICAL_COUPLER") },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4 font-sans">
      {/* Root node — Device */}
      <div className="flex items-center gap-2 mb-2">
        <div className="h-3 w-3 rounded-full bg-primary flex-shrink-0" />
        <span className="text-sm font-semibold">
          Device:{" "}
          <span className="font-mono">{data.deviceId}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          ({data.woId})
        </span>
        {data.productCode && (
          <span className="text-xs text-muted-foreground">
            &mdash; {data.productCode}
          </span>
        )}
      </div>

      {/* Supplementary info */}
      {(data.qcCertNumber || data.dispatchDate || data.customerName) && (
        <div className="flex flex-wrap gap-3 mb-3 ml-5 text-xs text-muted-foreground">
          {data.qcCertNumber && <span>QC Cert: <span className="font-mono text-foreground">{data.qcCertNumber}</span></span>}
          {data.dispatchDate && <span>Dispatched: {data.dispatchDate}</span>}
          {data.customerName && <span>Customer: {data.customerName}</span>}
        </div>
      )}

      {/* Component tree */}
      <div className="ml-4">
        {entries.map((entry, i) => (
          <ComponentNode key={entry.label} entry={entry} isLast={i === entries.length - 1} />
        ))}
      </div>
    </div>
  );
}
