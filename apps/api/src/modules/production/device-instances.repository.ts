/**
 * Device instances repository (Phase 5 Mobicase slice).
 *
 * One row = one physical unit on the Mobicase production lines (L1-L5).
 * MCC rows carry roll-up IDs for the embedded analyser/mixer/incubator
 * assemblies; module rows (MBA/MBM/MBC) carry their own component IDs.
 * Read-only for now — inserts come from SQL seeds until the Mobicase WO
 * lifecycle lands (§13.2.9).
 */

import type { PoolClient } from "pg";
import type {
  AssemblyLine,
  DeviceInstance,
  DeviceInstanceStatus,
  MobicaseProductCode,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface DeviceInstanceRow {
  id: string;
  org_id: string;
  device_code: string;
  product_code: MobicaseProductCode;
  work_order_ref: string;
  status: DeviceInstanceStatus;
  rework_count: number;
  max_rework_limit: number;
  assigned_line: AssemblyLine | null;

  pcb_id: string | null;
  sensor_id: string | null;
  detector_id: string | null;
  machine_id: string | null;
  cfg_vendor_id: string | null;
  cfg_serial_no: string | null;

  analyzer_pcb_id: string | null;
  analyzer_sensor_id: string | null;
  analyzer_detector_id: string | null;
  mixer_machine_id: string | null;
  mixer_pcb_id: string | null;
  incubator_pcb_id: string | null;

  micropipette_id: string | null;
  centrifuge_id: string | null;

  finished_goods_ref: string | null;
  invoice_ref: string | null;
  delivery_challan_ref: string | null;
  sales_order_ref: string | null;
  dispatched_at: Date | null;

  scrapped_at: Date | null;
  scrapped_reason: string | null;

  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToInstance(r: DeviceInstanceRow): DeviceInstance {
  return {
    id: r.id,
    orgId: r.org_id,
    deviceCode: r.device_code,
    productCode: r.product_code,
    workOrderRef: r.work_order_ref,
    status: r.status,
    reworkCount: r.rework_count,
    maxReworkLimit: r.max_rework_limit,
    assignedLine: r.assigned_line,

    pcbId: r.pcb_id,
    sensorId: r.sensor_id,
    detectorId: r.detector_id,
    machineId: r.machine_id,
    cfgVendorId: r.cfg_vendor_id,
    cfgSerialNo: r.cfg_serial_no,

    analyzerPcbId: r.analyzer_pcb_id,
    analyzerSensorId: r.analyzer_sensor_id,
    analyzerDetectorId: r.analyzer_detector_id,
    mixerMachineId: r.mixer_machine_id,
    mixerPcbId: r.mixer_pcb_id,
    incubatorPcbId: r.incubator_pcb_id,

    micropipetteId: r.micropipette_id,
    centrifugeId: r.centrifuge_id,

    finishedGoodsRef: r.finished_goods_ref,
    invoiceRef: r.invoice_ref,
    deliveryChallanRef: r.delivery_challan_ref,
    salesOrderRef: r.sales_order_ref,
    dispatchedAt: r.dispatched_at ? r.dispatched_at.toISOString() : null,

    scrappedAt: r.scrapped_at ? r.scrapped_at.toISOString() : null,
    scrappedReason: r.scrapped_reason,

    notes: r.notes,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `
  id, org_id, device_code, product_code, work_order_ref, status,
  rework_count, max_rework_limit, assigned_line,
  pcb_id, sensor_id, detector_id, machine_id,
  cfg_vendor_id, cfg_serial_no,
  analyzer_pcb_id, analyzer_sensor_id, analyzer_detector_id,
  mixer_machine_id, mixer_pcb_id, incubator_pcb_id,
  micropipette_id, centrifuge_id,
  finished_goods_ref, invoice_ref, delivery_challan_ref, sales_order_ref,
  dispatched_at, scrapped_at, scrapped_reason,
  notes, version, created_at, updated_at, deleted_at
`;

export interface DeviceInstanceListFilters {
  productCode?: MobicaseProductCode;
  status?: DeviceInstanceStatus;
  workOrderRef?: string;
  assignedLine?: AssemblyLine;
  search?: string;
}

export const deviceInstancesRepo = {
  async list(
    client: PoolClient,
    filters: DeviceInstanceListFilters,
    plan: PaginationPlan
  ): Promise<{ data: DeviceInstance[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.productCode) {
      where.push(`product_code = $${i}`);
      params.push(filters.productCode);
      i++;
    }
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.workOrderRef) {
      where.push(`work_order_ref = $${i}`);
      params.push(filters.workOrderRef);
      i++;
    }
    if (filters.assignedLine) {
      where.push(`assigned_line = $${i}`);
      params.push(filters.assignedLine);
      i++;
    }
    if (filters.search) {
      where.push(`(device_code ILIKE $${i} OR work_order_ref ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM device_instances ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM device_instances
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<DeviceInstanceRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToInstance),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(
    client: PoolClient,
    id: string
  ): Promise<DeviceInstance | null> {
    const { rows } = await client.query<DeviceInstanceRow>(
      `SELECT ${SELECT_COLS} FROM device_instances
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToInstance(rows[0]) : null;
  },
};
