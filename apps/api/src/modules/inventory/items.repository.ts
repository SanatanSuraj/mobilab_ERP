/**
 * Items repository. Mirrors warehouses.repository.ts; adds nothing special.
 */

import type { PoolClient } from "pg";
import type {
  CreateItem,
  Item,
  ItemCategory,
  ItemUom,
  UpdateItem,
} from "@mobilab/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface ItemRow {
  id: string;
  org_id: string;
  sku: string;
  name: string;
  description: string | null;
  category: ItemCategory;
  uom: ItemUom;
  hsn_code: string | null;
  unit_cost: string;
  default_warehouse_id: string | null;
  is_serialised: boolean;
  is_batched: boolean;
  shelf_life_days: number | null;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    orgId: r.org_id,
    sku: r.sku,
    name: r.name,
    description: r.description,
    category: r.category,
    uom: r.uom,
    hsnCode: r.hsn_code,
    unitCost: r.unit_cost,
    defaultWarehouseId: r.default_warehouse_id,
    isSerialised: r.is_serialised,
    isBatched: r.is_batched,
    shelfLifeDays: r.shelf_life_days,
    isActive: r.is_active,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, sku, name, description, category, uom,
                     hsn_code, unit_cost, default_warehouse_id, is_serialised,
                     is_batched, shelf_life_days, is_active, version,
                     created_at, updated_at, deleted_at`;

export interface ItemListFilters {
  category?: ItemCategory;
  uom?: ItemUom;
  isActive?: boolean;
  search?: string;
}

export const itemsRepo = {
  async list(
    client: PoolClient,
    filters: ItemListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Item[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.category) {
      where.push(`category = $${i}`);
      params.push(filters.category);
      i++;
    }
    if (filters.uom) {
      where.push(`uom = $${i}`);
      params.push(filters.uom);
      i++;
    }
    if (filters.isActive !== undefined) {
      where.push(`is_active = $${i}`);
      params.push(filters.isActive);
      i++;
    }
    if (filters.search) {
      where.push(`(name ILIKE $${i} OR sku ILIKE $${i} OR description ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM items ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM items
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<ItemRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToItem),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Item | null> {
    const { rows } = await client.query<ItemRow>(
      `SELECT ${SELECT_COLS} FROM items
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToItem(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateItem
  ): Promise<Item> {
    const { rows } = await client.query<ItemRow>(
      `INSERT INTO items (
         org_id, sku, name, description, category, uom, hsn_code, unit_cost,
         default_warehouse_id, is_serialised, is_batched, shelf_life_days,
         is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.sku,
        input.name,
        input.description ?? null,
        input.category ?? "RAW_MATERIAL",
        input.uom ?? "EA",
        input.hsnCode ?? null,
        input.unitCost ?? "0",
        input.defaultWarehouseId ?? null,
        input.isSerialised ?? false,
        input.isBatched ?? false,
        input.shelfLifeDays ?? null,
        input.isActive ?? true,
      ]
    );
    return rowToItem(rows[0]!);
  },

  async updateWithVersion(
    client: PoolClient,
    id: string,
    input: UpdateItem
  ): Promise<Item | "version_conflict" | null> {
    const cur = await itemsRepo.getById(client, id);
    if (!cur) return null;
    if (cur.version !== input.expectedVersion) return "version_conflict";

    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.sku !== undefined) col("sku", input.sku);
    if (input.name !== undefined) col("name", input.name);
    if (input.description !== undefined) col("description", input.description);
    if (input.category !== undefined) col("category", input.category);
    if (input.uom !== undefined) col("uom", input.uom);
    if (input.hsnCode !== undefined) col("hsn_code", input.hsnCode);
    if (input.unitCost !== undefined) col("unit_cost", input.unitCost);
    if (input.defaultWarehouseId !== undefined)
      col("default_warehouse_id", input.defaultWarehouseId);
    if (input.isSerialised !== undefined)
      col("is_serialised", input.isSerialised);
    if (input.isBatched !== undefined) col("is_batched", input.isBatched);
    if (input.shelfLifeDays !== undefined)
      col("shelf_life_days", input.shelfLifeDays);
    if (input.isActive !== undefined) col("is_active", input.isActive);
    if (sets.length === 0) return cur;

    params.push(id);
    const idIdx = i++;
    params.push(input.expectedVersion);
    const verIdx = i;
    const { rows } = await client.query<ItemRow>(
      `UPDATE items SET ${sets.join(", ")}
        WHERE id = $${idIdx} AND version = $${verIdx} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    if (!rows[0]) return "version_conflict";
    return rowToItem(rows[0]);
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE items SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },
};
