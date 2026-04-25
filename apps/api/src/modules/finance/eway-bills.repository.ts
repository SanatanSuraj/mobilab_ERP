/**
 * E-way bills repository (eway_bills).
 *
 * Phase-5 read-only surface. Writes happen via SQL seed for now — the GSTN
 * integration that issues real EWB numbers is a Phase-6 task.
 */

import type { PoolClient } from "pg";
import type {
  EwayBill,
  EwbStatus,
  EwbTransportMode,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface EwayBillRow {
  id: string;
  org_id: string;
  ewb_number: string;
  invoice_number: string;
  invoice_date: Date;
  invoice_value: string;
  consignor_gstin: string;
  consignee_gstin: string | null;
  consignee_name: string | null;
  from_place: string;
  from_state_code: string;
  to_place: string;
  to_state_code: string;
  distance_km: number;
  transport_mode: EwbTransportMode;
  vehicle_number: string | null;
  transporter_name: string | null;
  transporter_id: string | null;
  status: EwbStatus;
  generated_at: Date;
  valid_until: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToEwayBill(r: EwayBillRow): EwayBill {
  return {
    id: r.id,
    orgId: r.org_id,
    ewbNumber: r.ewb_number,
    invoiceNumber: r.invoice_number,
    invoiceDate: r.invoice_date.toISOString().slice(0, 10),
    invoiceValue: r.invoice_value,
    consignorGstin: r.consignor_gstin,
    consigneeGstin: r.consignee_gstin,
    consigneeName: r.consignee_name,
    fromPlace: r.from_place,
    fromStateCode: r.from_state_code,
    toPlace: r.to_place,
    toStateCode: r.to_state_code,
    distanceKm: r.distance_km,
    transportMode: r.transport_mode,
    vehicleNumber: r.vehicle_number,
    transporterName: r.transporter_name,
    transporterId: r.transporter_id,
    status: r.status,
    generatedAt: r.generated_at.toISOString(),
    validUntil: r.valid_until ? r.valid_until.toISOString() : null,
    cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
    cancellationReason: r.cancellation_reason,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const COLS = `
  id, org_id, ewb_number, invoice_number, invoice_date, invoice_value,
  consignor_gstin, consignee_gstin, consignee_name,
  from_place, from_state_code, to_place, to_state_code,
  distance_km, transport_mode, vehicle_number, transporter_name, transporter_id,
  status, generated_at, valid_until, cancelled_at, cancellation_reason,
  created_at, updated_at
`;

export interface EwayBillListFilters {
  status?: EwbStatus;
  transportMode?: EwbTransportMode;
  from?: string;
  to?: string;
  search?: string;
}

export const ewayBillsRepo = {
  async list(
    client: PoolClient,
    filters: EwayBillListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: EwayBill[]; total: number }> {
    const where: string[] = ["1=1"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.status) {
      where.push(`status = $${i}`);
      params.push(filters.status);
      i++;
    }
    if (filters.transportMode) {
      where.push(`transport_mode = $${i}`);
      params.push(filters.transportMode);
      i++;
    }
    if (filters.from) {
      where.push(`generated_at >= $${i}`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`generated_at <= $${i}`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(ewb_number ILIKE $${i} OR invoice_number ILIKE $${i} OR consignee_name ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM eway_bills ${whereSql}`;
    const listSql = `
      SELECT ${COLS}
        FROM eway_bills
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<EwayBillRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToEwayBill),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<EwayBill | null> {
    const { rows } = await client.query<EwayBillRow>(
      `SELECT ${COLS} FROM eway_bills WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToEwayBill(rows[0]) : null;
  },
};
