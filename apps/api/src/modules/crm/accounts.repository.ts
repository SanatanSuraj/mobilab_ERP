/**
 * Accounts repository. SQL-only, org-scoped via withRequest()/withOrg().
 *
 * The shape returned to callers matches the zod Account schema: snake_case
 * DB columns are remapped to camelCase JS, numeric columns arrive as
 * strings (installNumericTypeParser), and timestamptz columns arrive as
 * Date objects which we serialize via toISOString().
 */

import type { PoolClient } from "pg";
import type {
  Account,
  CreateAccount,
  UpdateAccount,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface AccountRow {
  id: string;
  org_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postal_code: string | null;
  gstin: string | null;
  health_score: number;
  is_key_account: boolean;
  annual_revenue: string | null;
  employee_count: number | null;
  owner_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    industry: r.industry,
    website: r.website,
    phone: r.phone,
    email: r.email,
    address: r.address,
    city: r.city,
    state: r.state,
    country: r.country,
    postalCode: r.postal_code,
    gstin: r.gstin,
    healthScore: r.health_score,
    isKeyAccount: r.is_key_account,
    annualRevenue: r.annual_revenue,
    employeeCount: r.employee_count,
    ownerId: r.owner_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

export interface AccountListFilters {
  search?: string;
  industry?: string;
  ownerId?: string;
  isKeyAccount?: boolean;
}

export const accountsRepo = {
  async list(
    client: PoolClient,
    filters: AccountListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Account[]; total: number }> {
    // Dynamic WHERE assembly. Every branch parameterizes — never concat.
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.search) {
      where.push(`(name ILIKE $${i} OR city ILIKE $${i} OR industry ILIKE $${i})`);
      params.push(`%${filters.search}%`);
      i++;
    }
    if (filters.industry) {
      where.push(`industry = $${i}`);
      params.push(filters.industry);
      i++;
    }
    if (filters.ownerId) {
      where.push(`owner_id = $${i}`);
      params.push(filters.ownerId);
      i++;
    }
    if (filters.isKeyAccount !== undefined) {
      where.push(`is_key_account = $${i}`);
      params.push(filters.isKeyAccount);
      i++;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // Count + page in one round-trip.
    const countSql = `SELECT count(*)::bigint AS total FROM accounts ${whereSql}`;
    const listSql = `
      SELECT id, org_id, name, industry, website, phone, email, address,
             city, state, country, postal_code, gstin, health_score,
             is_key_account, annual_revenue, employee_count, owner_id,
             created_at, updated_at, deleted_at
        FROM accounts
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<AccountRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToAccount),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Account | null> {
    const { rows } = await client.query<AccountRow>(
      `SELECT id, org_id, name, industry, website, phone, email, address,
              city, state, country, postal_code, gstin, health_score,
              is_key_account, annual_revenue, employee_count, owner_id,
              created_at, updated_at, deleted_at
         FROM accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToAccount(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateAccount
  ): Promise<Account> {
    const { rows } = await client.query<AccountRow>(
      `INSERT INTO accounts (
         org_id, name, industry, website, phone, email, address, city,
         state, country, postal_code, gstin, health_score, is_key_account,
         annual_revenue, employee_count, owner_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, org_id, name, industry, website, phone, email, address,
                 city, state, country, postal_code, gstin, health_score,
                 is_key_account, annual_revenue, employee_count, owner_id,
                 created_at, updated_at, deleted_at`,
      [
        orgId,
        input.name,
        input.industry ?? null,
        input.website ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.address ?? null,
        input.city ?? null,
        input.state ?? null,
        input.country ?? "IN",
        input.postalCode ?? null,
        input.gstin ?? null,
        input.healthScore ?? 50,
        input.isKeyAccount ?? false,
        input.annualRevenue ?? null,
        input.employeeCount ?? null,
        input.ownerId ?? null,
      ]
    );
    return rowToAccount(rows[0]!);
  },

  async update(
    client: PoolClient,
    id: string,
    input: UpdateAccount
  ): Promise<Account | null> {
    // Build a partial UPDATE — only set the columns actually supplied.
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.name !== undefined) col("name", input.name);
    if (input.industry !== undefined) col("industry", input.industry);
    if (input.website !== undefined) col("website", input.website);
    if (input.phone !== undefined) col("phone", input.phone);
    if (input.email !== undefined) col("email", input.email);
    if (input.address !== undefined) col("address", input.address);
    if (input.city !== undefined) col("city", input.city);
    if (input.state !== undefined) col("state", input.state);
    if (input.country !== undefined) col("country", input.country);
    if (input.postalCode !== undefined) col("postal_code", input.postalCode);
    if (input.gstin !== undefined) col("gstin", input.gstin);
    if (input.healthScore !== undefined) col("health_score", input.healthScore);
    if (input.isKeyAccount !== undefined)
      col("is_key_account", input.isKeyAccount);
    if (input.annualRevenue !== undefined)
      col("annual_revenue", input.annualRevenue);
    if (input.employeeCount !== undefined)
      col("employee_count", input.employeeCount);
    if (input.ownerId !== undefined) col("owner_id", input.ownerId);

    if (sets.length === 0) {
      // Nothing to update — return current row.
      return accountsRepo.getById(client, id);
    }
    params.push(id);
    const { rows } = await client.query<AccountRow>(
      `UPDATE accounts SET ${sets.join(", ")}
        WHERE id = $${i} AND deleted_at IS NULL
        RETURNING id, org_id, name, industry, website, phone, email, address,
                  city, state, country, postal_code, gstin, health_score,
                  is_key_account, annual_revenue, employee_count, owner_id,
                  created_at, updated_at, deleted_at`,
      params
    );
    return rows[0] ? rowToAccount(rows[0]) : null;
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE accounts SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },
};
