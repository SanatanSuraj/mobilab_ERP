/**
 * Vendors repository. SQL-only, org-scoped via withRequest()/withOrg().
 *
 * Same shape as warehouses.repository.ts — master record with optimistic
 * concurrency via `version` + soft-delete via `deleted_at`.
 */

import type { PoolClient } from "pg";
import type {
  CreateVendor,
  UpdateVendor,
  Vendor,
  VendorType,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface VendorRow {
  id: string;
  org_id: string;
  code: string;
  name: string;
  vendor_type: VendorType;
  gstin: string | null;
  pan: string | null;
  msme_number: string | null;
  is_msme: boolean;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postal_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  payment_terms_days: number;
  credit_limit: string;
  bank_account: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  notes: string | null;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToVendor(r: VendorRow): Vendor {
  return {
    id: r.id,
    orgId: r.org_id,
    code: r.code,
    name: r.name,
    vendorType: r.vendor_type,
    gstin: r.gstin,
    pan: r.pan,
    msmeNumber: r.msme_number,
    isMsme: r.is_msme,
    address: r.address,
    city: r.city,
    state: r.state,
    country: r.country,
    postalCode: r.postal_code,
    contactName: r.contact_name,
    email: r.email,
    phone: r.phone,
    website: r.website,
    paymentTermsDays: r.payment_terms_days,
    creditLimit: r.credit_limit,
    bankAccount: r.bank_account,
    bankIfsc: r.bank_ifsc,
    bankName: r.bank_name,
    notes: r.notes,
    isActive: r.is_active,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, code, name, vendor_type, gstin, pan,
                     msme_number, is_msme, address, city, state, country,
                     postal_code, contact_name, email, phone, website,
                     payment_terms_days, credit_limit, bank_account,
                     bank_ifsc, bank_name, notes, is_active, version,
                     created_at, updated_at, deleted_at`;

export interface VendorListFilters {
  vendorType?: VendorType;
  isActive?: boolean;
  isMsme?: boolean;
  search?: string;
}

export const vendorsRepo = {
  async list(
    client: PoolClient,
    filters: VendorListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Vendor[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.vendorType) {
      where.push(`vendor_type = $${i}`);
      params.push(filters.vendorType);
      i++;
    }
    if (filters.isActive !== undefined) {
      where.push(`is_active = $${i}`);
      params.push(filters.isActive);
      i++;
    }
    if (filters.isMsme !== undefined) {
      where.push(`is_msme = $${i}`);
      params.push(filters.isMsme);
      i++;
    }
    if (filters.search) {
      where.push(
        `(name ILIKE $${i} OR code ILIKE $${i} OR gstin ILIKE $${i} OR email ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM vendors ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM vendors
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<VendorRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToVendor),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Vendor | null> {
    const { rows } = await client.query<VendorRow>(
      `SELECT ${SELECT_COLS} FROM vendors
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToVendor(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateVendor
  ): Promise<Vendor> {
    const { rows } = await client.query<VendorRow>(
      `INSERT INTO vendors (
         org_id, code, name, vendor_type, gstin, pan, msme_number, is_msme,
         address, city, state, country, postal_code, contact_name, email,
         phone, website, payment_terms_days, credit_limit, bank_account,
         bank_ifsc, bank_name, notes, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.code,
        input.name,
        input.vendorType ?? "SUPPLIER",
        input.gstin ?? null,
        input.pan ?? null,
        input.msmeNumber ?? null,
        input.isMsme ?? false,
        input.address ?? null,
        input.city ?? null,
        input.state ?? null,
        input.country ?? "IN",
        input.postalCode ?? null,
        input.contactName ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.website ?? null,
        input.paymentTermsDays ?? 30,
        input.creditLimit ?? "0",
        input.bankAccount ?? null,
        input.bankIfsc ?? null,
        input.bankName ?? null,
        input.notes ?? null,
        input.isActive ?? true,
      ]
    );
    return rowToVendor(rows[0]!);
  },

  /**
   * Optimistic-locked update.
   */
  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateVendor
  ): Promise<Vendor | "version_conflict" | null> {
    const cur = await vendorsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.code !== undefined) col("code", input.code);
    if (input.name !== undefined) col("name", input.name);
    if (input.vendorType !== undefined) col("vendor_type", input.vendorType);
    if (input.gstin !== undefined) col("gstin", input.gstin);
    if (input.pan !== undefined) col("pan", input.pan);
    if (input.msmeNumber !== undefined) col("msme_number", input.msmeNumber);
    if (input.isMsme !== undefined) col("is_msme", input.isMsme);
    if (input.address !== undefined) col("address", input.address);
    if (input.city !== undefined) col("city", input.city);
    if (input.state !== undefined) col("state", input.state);
    if (input.country !== undefined) col("country", input.country);
    if (input.postalCode !== undefined) col("postal_code", input.postalCode);
    if (input.contactName !== undefined) col("contact_name", input.contactName);
    if (input.email !== undefined) col("email", input.email);
    if (input.phone !== undefined) col("phone", input.phone);
    if (input.website !== undefined) col("website", input.website);
    if (input.paymentTermsDays !== undefined)
      col("payment_terms_days", input.paymentTermsDays);
    if (input.creditLimit !== undefined) col("credit_limit", input.creditLimit);
    if (input.bankAccount !== undefined) col("bank_account", input.bankAccount);
    if (input.bankIfsc !== undefined) col("bank_ifsc", input.bankIfsc);
    if (input.bankName !== undefined) col("bank_name", input.bankName);
    if (input.notes !== undefined) col("notes", input.notes);
    if (input.isActive !== undefined) col("is_active", input.isActive);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<VendorRow>(
      `UPDATE vendors SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToVendor(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE vendors SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },
};
