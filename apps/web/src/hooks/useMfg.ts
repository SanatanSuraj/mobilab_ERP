/**
 * Manufacturing React Query hooks.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  mfgService,
  type WOFilters,
  type DeviceIDFilters,
  type LogStageInput,
  type ComponentIdInput,
  type GenerateDevicesInput,
} from "@/services/mfg.service";
import { currentMonthPrefix } from "@/lib/format";
import type { AssemblyLine } from "@/data/instigenie-mock";

export const mfgKeys = {
  all: ["mfg"] as const,
  mobiWOs: (filters?: WOFilters) => ["mfg", "mobi-work-orders", filters] as const,
  mobiWO: (id: string) => ["mfg", "mobi-work-orders", id] as const,
  deviceIDs: (filters?: DeviceIDFilters) => ["mfg", "device-ids", filters] as const,
  deviceID: (id: string) => ["mfg", "device-ids", id] as const,
  scrap: (month?: string) => ["mfg", "scrap", month] as const,
  stageLogs: (woId?: string) => ["mfg", "stage-logs", woId] as const,
  stageLogsLine: (line: AssemblyLine) => ["mfg", "stage-logs", "line", line] as const,
  oeeAvg: () => ["mfg", "oee", "average"] as const,
  oeeRecords: () => ["mfg", "oee", "records"] as const,
  workOrders: (filters?: WOFilters) => ["mfg", "work-orders", filters] as const,
  workOrder: (id: string) => ["mfg", "work-orders", id] as const,
  boms: () => ["mfg", "bom"] as const,
  bom: (id: string) => ["mfg", "bom", id] as const,
  ecns: () => ["mfg", "ecn"] as const,
};

export function useMobiWorkOrders(filters?: WOFilters) {
  return useQuery({
    queryKey: mfgKeys.mobiWOs(filters),
    queryFn: () => mfgService.getMobiWorkOrders(filters),
    staleTime: 15_000,
  });
}

export function useMobiWorkOrder(id: string) {
  return useQuery({
    queryKey: mfgKeys.mobiWO(id),
    queryFn: () => mfgService.getMobiWorkOrder(id),
    enabled: Boolean(id),
  });
}

export function useOnHoldWorkOrders() {
  return useQuery({
    queryKey: ["mfg", "on-hold-wos"],
    queryFn: () => mfgService.getOnHoldWorkOrders(),
    staleTime: 15_000,
    refetchInterval: 60_000, // poll every minute — alerts are time-sensitive
  });
}

export function useDeviceIDs(filters?: DeviceIDFilters) {
  return useQuery({
    queryKey: mfgKeys.deviceIDs(filters),
    queryFn: () => mfgService.getDeviceIDs(filters),
    staleTime: 0, // always fresh — mutations must be visible immediately
  });
}

export function useDeviceID(deviceId: string) {
  return useQuery({
    queryKey: mfgKeys.deviceID(deviceId),
    queryFn: () => mfgService.getDeviceID(deviceId),
    enabled: Boolean(deviceId),
    staleTime: 0,
  });
}

export function useStageLogsForLine(line: AssemblyLine) {
  return useQuery({
    queryKey: mfgKeys.stageLogsLine(line),
    queryFn: () => mfgService.getStageLogsForLine(line),
    staleTime: 0,
  });
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

/** Log completion of a manufacturing stage for a device. */
export function useLogStageCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogStageInput) => mfgService.logStageCompletion(input),
    onSuccess: (_result, input) => {
      // Invalidate everything that might show this device or its stage logs
      qc.invalidateQueries({ queryKey: ["mfg", "device-ids"] });
      qc.invalidateQueries({ queryKey: ["mfg", "stage-logs"] });
      qc.invalidateQueries({ queryKey: mfgKeys.stageLogsLine(input.line) });
    },
  });
}

/** Update component serial numbers (PCB ID, sensor ID, etc.) on a device. */
export function useUpdateComponentIds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, data }: { deviceId: string; data: ComponentIdInput }) =>
      mfgService.updateComponentIds(deviceId, data),
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: ["mfg", "device-ids"] });
      qc.invalidateQueries({ queryKey: mfgKeys.deviceID(vars.deviceId) });
    },
  });
}

/** Send a QC-failed device into rework (or auto-scrap if limit exceeded). */
export function useSendToRework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deviceId, reason }: { deviceId: string; reason: string }) =>
      mfgService.sendToRework(deviceId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mfg", "device-ids"] });
    },
  });
}

/** QC Inspector releases a FINAL_QC_PASS device → RELEASED. */
export function useReleaseDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => mfgService.releaseDevice(deviceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mfg", "device-ids"] });
    },
  });
}

export function useDispatchDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => mfgService.dispatchDevice(deviceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mfg", "device-ids"] });
    },
  });
}

/** Returns WOs that are eligible for production start (approved, RM issued). */
export function useProductionReadyWOs() {
  return useQuery({
    queryKey: ["mfg", "production-ready-wos"],
    queryFn: () => mfgService.getProductionReadyWOs(),
    staleTime: 0,
  });
}

/** Generate Device IDs for a Work Order — called when production starts. */
export function useGenerateDeviceIds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateDevicesInput) => mfgService.generateDeviceIds(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mfg", "device-ids"] });
      qc.invalidateQueries({ queryKey: ["mfg", "mobi-work-orders"] });
      qc.invalidateQueries({ queryKey: ["mfg", "production-ready-wos"] });
    },
  });
}

export function useScrapEntries(monthPrefix?: string) {
  const month = monthPrefix ?? currentMonthPrefix();
  return useQuery({
    queryKey: mfgKeys.scrap(month),
    queryFn: () => mfgService.getScrapEntries(month),
    staleTime: 60_000,
  });
}

export function useOEEAverage() {
  return useQuery({
    queryKey: mfgKeys.oeeAvg(),
    queryFn: () => mfgService.getOEEAverage(),
    staleTime: 5 * 60_000,
  });
}

export function useWorkOrders(filters?: WOFilters) {
  return useQuery({
    queryKey: mfgKeys.workOrders(filters),
    queryFn: () => mfgService.getWorkOrders(filters),
    staleTime: 30_000,
  });
}

export function useWorkOrder(id: string) {
  return useQuery({
    queryKey: mfgKeys.workOrder(id),
    queryFn: () => mfgService.getWorkOrder(id),
    enabled: Boolean(id),
  });
}

export function useBOMs() {
  return useQuery({
    queryKey: mfgKeys.boms(),
    queryFn: () => mfgService.getBOMs(),
    staleTime: 5 * 60_000,
  });
}

export function useECNs() {
  return useQuery({
    queryKey: mfgKeys.ecns(),
    queryFn: () => mfgService.getECNs(),
    staleTime: 60_000,
  });
}
