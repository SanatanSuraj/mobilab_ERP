/**
 * QC certificates repository (qc_certs).
 *
 * Certs are append-only from the service layer. Issued once per PASSED
 * FINAL_QC inspection. No version column — once issued, a cert is
 * considered immutable (the service layer enforces no-update; we still
 * keep `updated_at` + `deleted_at` for soft-delete / admin recall).
 */

import type { PoolClient } from "pg";
import type { QcCert } from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface CertRow {
  id: string;
  org_id: string;
  cert_number: string;
  inspection_id: string;
  work_order_id: string | null;
  product_id: string | null;
  product_name: string | null;
  wo_pid: string | null;
  device_serials: string[];
  issued_at: Date;
  signed_by: string | null;
  signed_by_name: string | null;
  signature_hash: string | null;
  pdf_minio_key: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToCert(r: CertRow): QcCert {
  return {
    id: r.id,
    orgId: r.org_id,
    certNumber: r.cert_number,
    inspectionId: r.inspection_id,
    workOrderId: r.work_order_id,
    productId: r.product_id,
    productName: r.product_name,
    woPid: r.wo_pid,
    deviceSerials: r.device_serials ?? [],
    issuedAt: r.issued_at.toISOString(),
    signedBy: r.signed_by,
    signedByName: r.signed_by_name,
    signatureHash: r.signature_hash,
    pdfMinioKey: r.pdf_minio_key,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, cert_number, inspection_id, work_order_id,
                     product_id, product_name, wo_pid, device_serials,
                     issued_at, signed_by, signed_by_name, signature_hash,
                     pdf_minio_key, notes, created_at, updated_at, deleted_at`;

export interface CertListFilters {
  workOrderId?: string;
  productId?: string;
  inspectionId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export const certsRepo = {
  async list(
    client: PoolClient,
    filters: CertListFilters,
    plan: PaginationPlan,
  ): Promise<{ data: QcCert[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.workOrderId) {
      where.push(`work_order_id = $${i}`);
      params.push(filters.workOrderId);
      i++;
    }
    if (filters.productId) {
      where.push(`product_id = $${i}`);
      params.push(filters.productId);
      i++;
    }
    if (filters.inspectionId) {
      where.push(`inspection_id = $${i}`);
      params.push(filters.inspectionId);
      i++;
    }
    if (filters.from) {
      where.push(`issued_at >= $${i}::date`);
      params.push(filters.from);
      i++;
    }
    if (filters.to) {
      where.push(`issued_at < ($${i}::date + interval '1 day')`);
      params.push(filters.to);
      i++;
    }
    if (filters.search) {
      where.push(
        `(cert_number ILIKE $${i} OR wo_pid ILIKE $${i} OR product_name ILIKE $${i})`,
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM qc_certs ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM qc_certs
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<CertRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToCert),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<QcCert | null> {
    const { rows } = await client.query<CertRow>(
      `SELECT ${SELECT_COLS} FROM qc_certs
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? rowToCert(rows[0]) : null;
  },

  async getByInspectionId(
    client: PoolClient,
    inspectionId: string,
  ): Promise<QcCert | null> {
    const { rows } = await client.query<CertRow>(
      `SELECT ${SELECT_COLS} FROM qc_certs
        WHERE inspection_id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [inspectionId],
    );
    return rows[0] ? rowToCert(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: {
      certNumber: string;
      inspectionId: string;
      workOrderId: string | null;
      productId: string | null;
      productName: string | null;
      woPid: string | null;
      deviceSerials: string[];
      signedBy: string | null;
      signedByName: string | null;
      /**
       * Phase 4 §4.2 — SHA-256 forward-linked chain hash. Required (the
       * service layer computes it under a per-org advisory lock so the
       * chain head read and this INSERT are serialised). Legacy callers
       * passed null; those paths have been migrated to the new signature.
       */
      signatureHash: string;
      /**
       * Explicit issuance timestamp in canonical form (JS Date; caller
       * also passes the matching ISO-8601 string into computeCertHash).
       * We pass it to the INSERT rather than relying on the `now()`
       * default so the hash input and the persisted column cannot drift
       * by microseconds.
       */
      issuedAt: Date;
      notes: string | null;
    },
  ): Promise<QcCert> {
    const { rows } = await client.query<CertRow>(
      `INSERT INTO qc_certs (
         org_id, cert_number, inspection_id, work_order_id, product_id,
         product_name, wo_pid, device_serials, issued_at, signed_by,
         signed_by_name, signature_hash, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.certNumber,
        input.inspectionId,
        input.workOrderId,
        input.productId,
        input.productName,
        input.woPid,
        input.deviceSerials,
        input.issuedAt,
        input.signedBy,
        input.signedByName,
        input.signatureHash,
        input.notes,
      ],
    );
    return rowToCert(rows[0]!);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE qc_certs SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  },
};
