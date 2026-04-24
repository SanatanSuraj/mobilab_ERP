/**
 * Products repository. Manufactured-output master — distinct from
 * inventory.items, which covers raw materials / finished goods bought
 * for resale.
 *
 * Same shape as vendors.repository.ts: a single master record with
 * optimistic concurrency via `version` + soft-delete via `deleted_at`.
 *
 * `active_bom_id` is maintained by the BOM service when a BOM version
 * is promoted to ACTIVE — we never flip it directly from this repo.
 */

import type { PoolClient } from "pg";
import type {
  CreateProduct,
  Product,
  ProductFamily,
  UpdateProduct,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface ProductRow {
  id: string;
  org_id: string;
  product_code: string;
  name: string;
  family: ProductFamily;
  description: string | null;
  uom: string;
  standard_cycle_days: number;
  has_serial_tracking: boolean;
  rework_limit: number;
  active_bom_id: string | null;
  notes: string | null;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id,
    orgId: r.org_id,
    productCode: r.product_code,
    name: r.name,
    family: r.family,
    description: r.description,
    uom: r.uom,
    standardCycleDays: r.standard_cycle_days,
    hasSerialTracking: r.has_serial_tracking,
    reworkLimit: r.rework_limit,
    activeBomId: r.active_bom_id,
    notes: r.notes,
    isActive: r.is_active,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, product_code, name, family, description, uom,
                     standard_cycle_days, has_serial_tracking, rework_limit,
                     active_bom_id, notes, is_active, version,
                     created_at, updated_at, deleted_at`;

export interface ProductListFilters {
  family?: ProductFamily;
  isActive?: boolean;
  search?: string;
}

export const productsRepo = {
  async list(
    client: PoolClient,
    filters: ProductListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Product[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.family) {
      where.push(`family = $${i}`);
      params.push(filters.family);
      i++;
    }
    if (filters.isActive !== undefined) {
      where.push(`is_active = $${i}`);
      params.push(filters.isActive);
      i++;
    }
    if (filters.search) {
      where.push(
        `(name ILIKE $${i} OR product_code ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM products ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM products
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<ProductRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToProduct),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Product | null> {
    const { rows } = await client.query<ProductRow>(
      `SELECT ${SELECT_COLS} FROM products
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToProduct(rows[0]) : null;
  },

  async getByCode(
    client: PoolClient,
    productCode: string
  ): Promise<Product | null> {
    const { rows } = await client.query<ProductRow>(
      `SELECT ${SELECT_COLS} FROM products
        WHERE lower(product_code) = lower($1) AND deleted_at IS NULL`,
      [productCode]
    );
    return rows[0] ? rowToProduct(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateProduct
  ): Promise<Product> {
    const { rows } = await client.query<ProductRow>(
      `INSERT INTO products (
         org_id, product_code, name, family, description, uom,
         standard_cycle_days, has_serial_tracking, rework_limit,
         notes, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.productCode,
        input.name,
        input.family ?? "MODULE",
        input.description ?? null,
        input.uom ?? "PCS",
        input.standardCycleDays ?? 0,
        input.hasSerialTracking ?? true,
        input.reworkLimit ?? 2,
        input.notes ?? null,
        input.isActive ?? true,
      ]
    );
    return rowToProduct(rows[0]!);
  },

  /**
   * Optimistic-locked update. Does NOT touch active_bom_id — that's
   * maintained by the BOM service when a version is promoted.
   */
  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateProduct
  ): Promise<Product | "version_conflict" | null> {
    const cur = await productsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.productCode !== undefined) col("product_code", input.productCode);
    if (input.name !== undefined) col("name", input.name);
    if (input.family !== undefined) col("family", input.family);
    if (input.description !== undefined) col("description", input.description);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.standardCycleDays !== undefined)
      col("standard_cycle_days", input.standardCycleDays);
    if (input.hasSerialTracking !== undefined)
      col("has_serial_tracking", input.hasSerialTracking);
    if (input.reworkLimit !== undefined) col("rework_limit", input.reworkLimit);
    if (input.notes !== undefined) col("notes", input.notes);
    if (input.isActive !== undefined) col("is_active", input.isActive);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<ProductRow>(
      `UPDATE products SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToProduct(rows[0]);
  },

  /**
   * Internal — called from the BOM service when a BOM is promoted to
   * ACTIVE (or from the rollback path if activation fails after the
   * flip). Bumps updated_at but does NOT bump version (version tracks
   * user-visible changes, not denormalisation housekeeping).
   */
  async setActiveBomId(
    client: PoolClient,
    productId: string,
    bomId: string | null
  ): Promise<void> {
    await client.query(
      `UPDATE products
          SET active_bom_id = $2,
              updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [productId, bomId]
    );
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE products SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },
};
