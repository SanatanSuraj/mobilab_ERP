/**
 * Bootstrap policy guard (Phase 1 Gate 7).
 *
 * On every worker/api start we validate the SECURITY invariants that don't
 * fit in a one-shot migration check:
 *   1. NUMERIC type parser is installed.
 *   2. The permission map in packages/contracts matches what's seeded in PG.
 *   3. RLS is ON for every tenant-scoped table.
 *   4. We're not in production with the dev-seed org present.
 *
 * If any check fails we exit(1) so the supervisor/crashloop signals an
 * operator rather than running in a broken state.
 */

import pg from "pg";
import {
  isNumericParserInstalled,
  installNumericTypeParser,
} from "@mobilab/db";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from "@mobilab/contracts";
import type { Logger } from "@mobilab/observability";

const TENANT_TABLES = [
  "users",
  "user_roles",
  "refresh_tokens",
  "organizations",
];

const DEV_ORG_ID = "00000000-0000-0000-0000-00000000a001";

export async function runBootstrapPolicy(
  pool: pg.Pool,
  log: Logger
): Promise<void> {
  // 1. NUMERIC parser.
  if (!isNumericParserInstalled()) {
    // It's possible the db package hasn't been touched yet — install it
    // and log loudly. If it still fails, bail.
    installNumericTypeParser();
    if (!isNumericParserInstalled()) {
      throw new Error("bootstrap: NUMERIC type parser not installed");
    }
  }

  // 2. Permission map matches DB seed.
  const dbPerms = await pool.query<{ id: string }>(
    `SELECT id FROM permissions`
  );
  const dbPermIds = new Set(dbPerms.rows.map((r) => r.id));
  const codePerms = new Set<string>(PERMISSIONS);
  for (const p of codePerms) {
    if (!dbPermIds.has(p)) {
      throw new Error(
        `bootstrap: permission "${p}" declared in code but missing from DB seed`
      );
    }
  }
  for (const p of dbPermIds) {
    if (!codePerms.has(p)) {
      throw new Error(
        `bootstrap: permission "${p}" present in DB but not declared in code`
      );
    }
  }

  // Spot-check the role→permission join. Exhaustive check is in Gate 6.
  const dbRp = await pool.query<{ role_id: string; permission_id: string }>(
    `SELECT role_id, permission_id FROM role_permissions`
  );
  const byRole = new Map<string, Set<string>>();
  for (const { role_id, permission_id } of dbRp.rows) {
    if (!byRole.has(role_id)) byRole.set(role_id, new Set());
    byRole.get(role_id)!.add(permission_id);
  }
  for (const role of ROLES) {
    const codeSet = new Set<string>(ROLE_PERMISSIONS[role]);
    const dbSet = byRole.get(role) ?? new Set<string>();
    for (const p of codeSet) {
      if (!dbSet.has(p)) {
        throw new Error(
          `bootstrap: role ${role} grants "${p}" in code but not in DB`
        );
      }
    }
  }

  // 3. RLS enabled.
  const rls = await pool.query<{
    table_name: string;
    rowsecurity: boolean;
  }>(
    `SELECT c.relname AS table_name, c.relrowsecurity AS rowsecurity
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [TENANT_TABLES]
  );
  for (const row of rls.rows) {
    if (!row.rowsecurity) {
      throw new Error(`bootstrap: RLS not enabled on ${row.table_name}`);
    }
  }

  // 4. Dev-seed org must not exist in production.
  if (process.env.NODE_ENV === "production") {
    const devOrg = await pool.query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1`,
      [DEV_ORG_ID]
    );
    if (devOrg.rows.length > 0) {
      throw new Error(
        `bootstrap: dev-seed organization ${DEV_ORG_ID} present in production — refuse to start`
      );
    }
  }

  log.info("bootstrap policy passed");
}
