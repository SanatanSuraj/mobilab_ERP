/**
 * Gate 6 — RBAC catalog consistency.
 *
 * ARCHITECTURE.md §9.4. The permission catalog must be identical in
 * three places:
 *   - code:     packages/contracts/src/permissions.ts (PERMISSIONS, ROLE_PERMISSIONS)
 *   - db seed:  ops/sql/seed/01-permissions.sql, 02-role-permissions.sql
 *   - runtime:  the permissions / role_permissions tables
 *
 * This gate asserts code ↔ DB runtime are in sync.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  validatePermissionMap,
} from "@instigenie/contracts";
import { makeTestPool, waitForPg } from "./_helpers.js";

describe("gate-6: RBAC catalog sync", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("code-side map is self-consistent", () => {
    expect(() => validatePermissionMap()).not.toThrow();
  });

  it("every code permission exists in the DB", async () => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM permissions`);
    const dbIds = new Set(rows.map((r) => r.id));
    for (const p of PERMISSIONS) {
      expect(dbIds.has(p)).toBe(true);
    }
  });

  it("every DB permission is declared in code", async () => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM permissions`);
    const codeIds = new Set<string>(PERMISSIONS);
    for (const { id } of rows) {
      expect(codeIds.has(id)).toBe(true);
    }
  });

  it("every code role exists in the DB", async () => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM roles`);
    const dbRoles = new Set(rows.map((r) => r.id));
    for (const r of ROLES) {
      expect(dbRoles.has(r)).toBe(true);
    }
  });

  it("role→permission edges match byte-for-byte", async () => {
    const { rows } = await pool.query<{
      role_id: string;
      permission_id: string;
    }>(`SELECT role_id, permission_id FROM role_permissions`);
    const dbByRole = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!dbByRole.has(r.role_id)) dbByRole.set(r.role_id, new Set());
      dbByRole.get(r.role_id)!.add(r.permission_id);
    }

    for (const role of ROLES) {
      const codeSet = new Set<string>(ROLE_PERMISSIONS[role]);
      const dbSet = dbByRole.get(role) ?? new Set<string>();

      // Every code perm must be in DB.
      for (const p of codeSet) {
        expect(
          dbSet.has(p),
          `${role} should grant ${p} per code but doesn't in DB`
        ).toBe(true);
      }
      // Every DB perm must be in code.
      for (const p of dbSet) {
        expect(
          codeSet.has(p),
          `${role} grants ${p} in DB but not in code`
        ).toBe(true);
      }
    }
  });
});
