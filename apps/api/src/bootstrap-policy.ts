/**
 * API bootstrap policy. Mirrors apps/worker/src/bootstrap-policy.ts
 *
 * Runs once during buildApp() before the listener binds. Refuses to
 * accept traffic if any of these invariants is broken:
 *   1. NUMERIC type parser is installed (decimals must arrive as strings).
 *   2. RLS is enabled on every tenant-scoped table — without this the
 *      `app.org_id` GUC is decorative and a tenant query could return
 *      another tenant's rows.
 *   3. We're not running in production with the dev-seed org present
 *      (a stray `pnpm db:seed` against prod would create a known-id
 *      tenant attackers can target).
 *
 * Why duplicate this in the API on top of the worker:
 *   - The worker enforces it on its own boot, but the API may come up
 *     first and start serving requests before any worker pod runs.
 *   - The original audit flagged "RLS deployment fragility" — having the
 *     API itself fail-fast removes the risk that someone forgets to
 *     apply rls/ during a manual deploy.
 *
 * The table list is intentionally a curated set rather than every public
 * table — adding new tables to RLS still requires a migration; this
 * runtime check catches accidental drift, not policy authoring mistakes.
 */

import pg from "pg";
import {
  installNumericTypeParser,
  isNumericParserInstalled,
} from "@instigenie/db";
import type { Logger } from "@instigenie/observability";

/**
 * Tables that MUST have RLS enabled. The list is hand-curated to cover
 * one representative table per tenant-scoped domain so a missing
 * policy in any module trips the check.
 */
const TENANT_TABLES = [
  // Core auth
  "users",
  "user_roles",
  "refresh_tokens",
  "organizations",
  // CRM
  "accounts",
  "leads",
  "deals",
  "quotations",
  "tickets",
  // Inventory
  "items",
  "stock_ledger",
  // Procurement
  "purchase_orders",
  "grns",
  // Production
  "work_orders",
  "wip_stages",
  // QC
  "qc_inspections",
  "qc_certs",
  // Finance
  "sales_invoices",
  "purchase_invoices",
  "payments",
  // Approvals
  "approval_requests",
  "approval_steps",
  "workflow_transitions",
  // Notifications + audit
  "notifications",
  "audit_log",
  // Portal
  "account_portal_users",
];

const DEV_ORG_ID = "00000000-0000-0000-0000-00000000a001";

export async function runBootstrapPolicy(
  pool: pg.Pool,
  log: Logger,
): Promise<void> {
  // 1. NUMERIC parser.
  if (!isNumericParserInstalled()) {
    installNumericTypeParser();
    if (!isNumericParserInstalled()) {
      throw new Error("bootstrap: NUMERIC type parser not installed");
    }
  }

  // 2. RLS enabled on every curated tenant table.
  const rls = await pool.query<{
    table_name: string;
    rowsecurity: boolean;
  }>(
    `SELECT c.relname AS table_name, c.relrowsecurity AS rowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [TENANT_TABLES],
  );
  const seen = new Set(rls.rows.map((r) => r.table_name));
  for (const row of rls.rows) {
    if (!row.rowsecurity) {
      throw new Error(
        `bootstrap: RLS not enabled on ${row.table_name} — refusing to start (apply ops/sql/rls/)`,
      );
    }
  }
  // A missing table in pg_class means the schema is out of sync with the
  // contract — treat as fatal.
  for (const t of TENANT_TABLES) {
    if (!seen.has(t)) {
      throw new Error(
        `bootstrap: tenant-scoped table "${t}" missing from schema — apply ops/sql/init/`,
      );
    }
  }

  // 3. Dev-seed org must not exist in production.
  if (process.env.NODE_ENV === "production") {
    const devOrg = await pool.query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1`,
      [DEV_ORG_ID],
    );
    if (devOrg.rows.length > 0) {
      throw new Error(
        `bootstrap: dev-seed organization ${DEV_ORG_ID} present in production — refuse to start`,
      );
    }
  }

  log.info({ checks: TENANT_TABLES.length }, "bootstrap policy passed");
}
