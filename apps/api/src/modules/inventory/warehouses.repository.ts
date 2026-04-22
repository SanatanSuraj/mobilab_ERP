/**
 * Warehouses repository. SQL-only, org-scoped via withRequest()/withOrg().
 *
 * Same shape as accounts.repository.ts:
 *   - snake_case DB rows → camelCase domain objects
 *   - numeric columns arrive as strings (installNumericTypeParser)
 *   - timestamptz columns arrive as Date; we serialize with toISOString()
 *
 * Optimistic concurrency on UPDATE via `version` (trigger-maintained).
 */

import type { PoolClient } from "pg";
import type {
  CreateWarehouse,
  UpdateWarehouse,
  Warehouse,
  WarehouseKind,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface WarehouseRow {
  id: string;
  org_id: string;
  code: string;
  name: string;
  kind: WarehouseKind;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postal_code: string | null;
  is_default: boolean;
  is_active: boolean;
  manager_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToWarehouse(r: WarehouseRow): Warehouse {
  return {
    id: r.id,
    orgId: r.org_id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    address: r.address,
    city: r.city,
    state: r.state,
    country: r.country,
    postalCode: r.postal_code,
    isDefault: r.is_default,
    isActive: r.is_active,
    managerId: r.manager_id,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, code, name, kind, address, city, state,
                     country, postal_code, is_default, is_active, manager_id,
                     version, created_at, updated_at, deleted_at`;

export interface WarehouseListFilters {
  kind?: WarehouseKind;
  isActive?: boolean;
  search?: string;
}

export const warehousesRepo = {
  async list(
    client: PoolClient,
    filters: WarehouseListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Warehouse[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.kind) {
      where.push(`kind = $${i}`);
      params.push(filters.kind);
      i++;
    }
    if (filters.isActive !== undefined) {
      where.push(`is_active = $${i}`);
      params.push(filters.isActive);
      i++;
    }
    if (filters.search) {
      where.push(
        `(name ILIKE $${i} OR code ILIKE $${i} OR city ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM warehouses ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM warehouses
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<WarehouseRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToWarehouse),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Warehouse | null> {
    const { rows } = await client.query<WarehouseRow>(
      `SELECT ${SELECT_COLS} FROM warehouses
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToWarehouse(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateWarehouse
  ): Promise<Warehouse> {
    const { rows } = await client.query<WarehouseRow>(
      `INSERT INTO warehouses (
         org_id, code, name, kind, address, city, state, country,
         postal_code, is_default, is_active, manager_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.code,
        input.name,
        input.kind ?? "PRIMARY",
        input.address ?? null,
        input.city ?? null,
        input.state ?? null,
        input.country ?? "IN",
        input.postalCode ?? null,
        input.isDefault ?? false,
        input.isActive ?? true,
        input.managerId ?? null,
      ]
    );
    return rowToWarehouse(rows[0]!);
  },

  /**
   * Optimistic-locked update. Returns:
   *   - Warehouse on success
   *   - null if row doesn't exist / is soft-deleted
   *   - "version_conflict" on version mismatch
   */
  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateWarehouse
  ): Promise<Warehouse | "version_conflict" | null> {
    const cur = await warehousesRepo.getById(client, id);
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
    if (input.kind !== undefined) col("kind", input.kind);
    if (input.address !== undefined) col("address", input.address);
    if (input.city !== undefined) col("city", input.city);
    if (input.state !== undefined) col("state", input.state);
    if (input.country !== undefined) col("country", input.country);
    if (input.postalCode !== undefined) col("postal_code", input.postalCode);
    if (input.isDefault !== undefined) col("is_default", input.isDefault);
    if (input.isActive !== undefined) col("is_active", input.isActive);
    if (input.managerId !== undefined) col("manager_id", input.managerId);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<WarehouseRow>(
      `UPDATE warehouses SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToWarehouse(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE warehouses SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },
};
