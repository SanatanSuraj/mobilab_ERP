/**
 * QC Service — Data Access Layer
 *
 * org_id injected via apiFetch() on every real API call.
 * Import { apiFetch, getOrgId } from "@/lib/api-client" when swapping mock.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getOrgId } from "@/lib/api-client";
import {
  incomingInspections,
  wipInspections,
  equipmentRecords,
  capaRecords,
  ncrRecords,
  getOverdueEquipment,
  getOpenCAPAs,
  type IncomingQCInspection,
  type WIPInspection,
  type EquipmentRecord,
  type CAPARecord,
  type NCRRecord,
} from "@/data/qc-mock";

export const qcService = {
  // ── Incoming Inspections ──────────────────────────────────────────────────

  async getIncomingInspections(status?: string): Promise<IncomingQCInspection[]> {
    // API: return fetch(`/api/qc/incoming?status=${status}`).then(r => r.json())
    let result = [...incomingInspections];
    if (status && status !== "ALL") {
      result = result.filter((i) => i.status === status);
    }
    return Promise.resolve(result);
  },

  /** Inspections completed on a specific date (defaults to today). */
  async getCompletedToday(dateStr?: string): Promise<IncomingQCInspection[]> {
    // API: return fetch(`/api/qc/incoming?completedDate=${date}`).then(r => r.json())
    const date = dateStr ?? new Date().toISOString().slice(0, 10);
    return Promise.resolve(
      incomingInspections.filter((i) => i.completedAt?.startsWith(date))
    );
  },

  async getPendingInspections(): Promise<IncomingQCInspection[]> {
    // API: return fetch('/api/qc/incoming?status=PENDING,IN_PROGRESS').then(r => r.json())
    return Promise.resolve(
      incomingInspections.filter(
        (i) => i.status === "PENDING" || i.status === "IN_PROGRESS"
      )
    );
  },

  // ── WIP Inspections ───────────────────────────────────────────────────────

  async getWIPInspections(status?: string): Promise<WIPInspection[]> {
    // API: return fetch(`/api/qc/wip?status=${status}`).then(r => r.json())
    let result = [...wipInspections];
    if (status && status !== "ALL") {
      result = result.filter((w) => w.status === status);
    }
    return Promise.resolve(result);
  },

  async getOverdueWIPGates(): Promise<WIPInspection[]> {
    // API: return fetch('/api/qc/wip?status=PENDING,ON_HOLD').then(r => r.json())
    return Promise.resolve(
      wipInspections.filter(
        (w) => w.status === "PENDING" || w.status === "ON_HOLD"
      )
    );
  },

  // ── Equipment ────────────────────────────────────────────────────────────

  async getEquipment(): Promise<EquipmentRecord[]> {
    // API: return fetch('/api/qc/equipment').then(r => r.json())
    return Promise.resolve(equipmentRecords);
  },

  async getOverdueEquipment(): Promise<EquipmentRecord[]> {
    // API: return fetch('/api/qc/equipment?status=CALIBRATION_OVERDUE,CALIBRATION_DUE').then(r => r.json())
    return Promise.resolve(getOverdueEquipment());
  },

  // ── CAPAs ────────────────────────────────────────────────────────────────

  async getCAPAs(): Promise<CAPARecord[]> {
    // API: return fetch('/api/qc/capa').then(r => r.json())
    return Promise.resolve(capaRecords);
  },

  async getOpenCAPAs(): Promise<CAPARecord[]> {
    // API: return fetch('/api/qc/capa?status=OPEN,IN_PROGRESS,...').then(r => r.json())
    return Promise.resolve(getOpenCAPAs());
  },

  // ── NCRs ─────────────────────────────────────────────────────────────────

  async getNCRs(): Promise<NCRRecord[]> {
    // API: return fetch('/api/qc/ncr').then(r => r.json())
    return Promise.resolve(ncrRecords);
  },

  async getOpenNCRs(): Promise<NCRRecord[]> {
    // API: return fetch('/api/qc/ncr?status=OPEN').then(r => r.json())
    return Promise.resolve(ncrRecords.filter((n) => n.status === "OPEN"));
  },
};
