/**
 * Contacts repository. Mirrors accounts.repository.ts structure.
 *
 * Contacts always belong to an account; the account_id FK is NOT NULL.
 * Listing + getById scope by org automatically via RLS on the pool client.
 */

import type { PoolClient } from "pg";
import type {
  Contact,
  CreateContact,
  UpdateContact,
} from "@instigenie/contracts";
import type { PaginationPlan } from "../shared/pagination.js";

interface ContactRow {
  id: string;
  org_id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  department: string | null;
  is_primary: boolean;
  linkedin_url: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToContact(r: ContactRow): Contact {
  return {
    id: r.id,
    orgId: r.org_id,
    accountId: r.account_id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    designation: r.designation,
    department: r.department,
    isPrimary: r.is_primary,
    linkedinUrl: r.linkedin_url,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
  };
}

const SELECT_COLS = `id, org_id, account_id, first_name, last_name, email,
                     phone, designation, department, is_primary, linkedin_url,
                     created_at, updated_at, deleted_at`;

export interface ContactListFilters {
  accountId?: string;
  search?: string;
}

export const contactsRepo = {
  async list(
    client: PoolClient,
    filters: ContactListFilters,
    plan: PaginationPlan
  ): Promise<{ data: Contact[]; total: number }> {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    let i = 1;
    if (filters.accountId) {
      where.push(`account_id = $${i}`);
      params.push(filters.accountId);
      i++;
    }
    if (filters.search) {
      where.push(
        `(first_name ILIKE $${i} OR last_name ILIKE $${i} OR email ILIKE $${i})`
      );
      params.push(`%${filters.search}%`);
      i++;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const countSql = `SELECT count(*)::bigint AS total FROM contacts ${whereSql}`;
    const listSql = `
      SELECT ${SELECT_COLS}
        FROM contacts
       ${whereSql}
       ORDER BY ${plan.orderBy}
       LIMIT ${plan.limit} OFFSET ${plan.offset}
    `;
    const [countRes, listRes] = await Promise.all([
      client.query<{ total: string }>(countSql, params),
      client.query<ContactRow>(listSql, params),
    ]);
    return {
      data: listRes.rows.map(rowToContact),
      total: Number(countRes.rows[0]!.total),
    };
  },

  async getById(client: PoolClient, id: string): Promise<Contact | null> {
    const { rows } = await client.query<ContactRow>(
      `SELECT ${SELECT_COLS} FROM contacts
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? rowToContact(rows[0]) : null;
  },

  async create(
    client: PoolClient,
    orgId: string,
    input: CreateContact
  ): Promise<Contact> {
    const { rows } = await client.query<ContactRow>(
      `INSERT INTO contacts (
         org_id, account_id, first_name, last_name, email, phone,
         designation, department, is_primary, linkedin_url
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING ${SELECT_COLS}`,
      [
        orgId,
        input.accountId,
        input.firstName,
        input.lastName,
        input.email ?? null,
        input.phone ?? null,
        input.designation ?? null,
        input.department ?? null,
        input.isPrimary ?? false,
        input.linkedinUrl ?? null,
      ]
    );
    return rowToContact(rows[0]!);
  },

  async update(
    client: PoolClient,
    id: string,
    input: UpdateContact
  ): Promise<Contact | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const col = (name: string, value: unknown): void => {
      sets.push(`${name} = $${i++}`);
      params.push(value);
    };
    if (input.accountId !== undefined) col("account_id", input.accountId);
    if (input.firstName !== undefined) col("first_name", input.firstName);
    if (input.lastName !== undefined) col("last_name", input.lastName);
    if (input.email !== undefined) col("email", input.email);
    if (input.phone !== undefined) col("phone", input.phone);
    if (input.designation !== undefined) col("designation", input.designation);
    if (input.department !== undefined) col("department", input.department);
    if (input.isPrimary !== undefined) col("is_primary", input.isPrimary);
    if (input.linkedinUrl !== undefined)
      col("linkedin_url", input.linkedinUrl);
    if (sets.length === 0) return contactsRepo.getById(client, id);
    params.push(id);
    const { rows } = await client.query<ContactRow>(
      `UPDATE contacts SET ${sets.join(", ")}
        WHERE id = $${i} AND deleted_at IS NULL
        RETURNING ${SELECT_COLS}`,
      params
    );
    return rows[0] ? rowToContact(rows[0]) : null;
  },

  async softDelete(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE contacts SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  },
};
