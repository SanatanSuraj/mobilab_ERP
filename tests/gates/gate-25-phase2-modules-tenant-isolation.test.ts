/**
 * Gate 25 — Cross-tenant isolation for the Phase 2 modules.
 *
 * Runtime data-leak sibling of gate-8. Seeds one row per table under an
 * OTHER_ORG, then verifies:
 *
 *   1. Under DEV_ORG, `SELECT ... WHERE org_id = OTHER_ORG` returns 0 rows
 *      (the whole point of RLS — even asking about the other tenant fails).
 *   2. Under OTHER_ORG, every row we read is tagged with OTHER_ORG (no
 *      silent cross-org spillover in the happy path).
 *   3. With no `app.current_org` set, the tables return 0 rows instead of
 *      leaking (policy refuses to match when the GUC is empty).
 *   4. Every table has `relrowsecurity = true` AND `relforcerowsecurity =
 *      true` (so table owners can't bypass RLS either).
 *
 * Gate-12 already enforces (4) at the catalog level for every org_id
 * table. This gate is the runtime proof for the inventory, procurement,
 * production, QC, finance, and notifications modules — complementing
 * gate-8 (which covers CRM).
 *
 * If any table here is added to the codebase without a matching RLS
 * policy, this gate fails loudly before the module can ship.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

// Distinct from gate-5's `...b1`, gate-8's `...c1`. Stable UUIDs so
// re-runs stay idempotent.
const OTHER_ORG_ID      = "00000000-0000-0000-0000-0000000000d1";
const OTHER_IDENTITY_ID = "00000000-0000-0000-0000-0000000000d2";
const OTHER_USER_ID     = "00000000-0000-0000-0000-0000000000d3";
const OTHER_ACCOUNT_ID  = "00000000-0000-0000-0000-0000000000d4";

// Inventory
const OTHER_WAREHOUSE_ID  = "00000000-0000-0000-0000-00000000d101";
const OTHER_ITEM_ID       = "00000000-0000-0000-0000-00000000d102";
const OTHER_BINDING_ID    = "00000000-0000-0000-0000-00000000d103";
const OTHER_LEDGER_ID     = "00000000-0000-0000-0000-00000000d104";

// Procurement
const OTHER_VENDOR_ID     = "00000000-0000-0000-0000-00000000d201";
const OTHER_INDENT_ID     = "00000000-0000-0000-0000-00000000d202";
const OTHER_INDENT_LN_ID  = "00000000-0000-0000-0000-00000000d203";
const OTHER_PO_ID         = "00000000-0000-0000-0000-00000000d204";
const OTHER_PO_LINE_ID    = "00000000-0000-0000-0000-00000000d205";
const OTHER_GRN_ID        = "00000000-0000-0000-0000-00000000d206";
const OTHER_GRN_LINE_ID   = "00000000-0000-0000-0000-00000000d207";

// Production
const OTHER_PRODUCT_ID    = "00000000-0000-0000-0000-00000000d301";
const OTHER_BOM_ID        = "00000000-0000-0000-0000-00000000d302";
const OTHER_BOM_LINE_ID   = "00000000-0000-0000-0000-00000000d303";
const OTHER_WIP_TMPL_ID   = "00000000-0000-0000-0000-00000000d304";
const OTHER_WO_ID         = "00000000-0000-0000-0000-00000000d305";
const OTHER_WIP_STAGE_ID  = "00000000-0000-0000-0000-00000000d306";

// QC
const OTHER_INSP_TMPL_ID  = "00000000-0000-0000-0000-00000000d401";
const OTHER_INSP_PARAM_ID = "00000000-0000-0000-0000-00000000d402";
const OTHER_INSP_ID       = "00000000-0000-0000-0000-00000000d403";
const OTHER_FINDING_ID    = "00000000-0000-0000-0000-00000000d404";
const OTHER_CERT_ID       = "00000000-0000-0000-0000-00000000d405";

// Finance
const OTHER_SI_ID         = "00000000-0000-0000-0000-00000000d501";
const OTHER_SI_LINE_ID    = "00000000-0000-0000-0000-00000000d502";
const OTHER_PI_ID         = "00000000-0000-0000-0000-00000000d503";
const OTHER_PI_LINE_ID    = "00000000-0000-0000-0000-00000000d504";
const OTHER_CL_ID         = "00000000-0000-0000-0000-00000000d505";
const OTHER_VL_ID         = "00000000-0000-0000-0000-00000000d506";
const OTHER_PAYMENT_ID    = "00000000-0000-0000-0000-00000000d507";

// Notifications
const OTHER_NOTIF_TMPL_ID = "00000000-0000-0000-0000-00000000d601";
const OTHER_NOTIF_ID      = "00000000-0000-0000-0000-00000000d602";

/**
 * The full set of tenant-scoped tables owned by Phase-2 modules.
 *
 * Kept as a literal list rather than a catalog query because this gate
 * also doubles as *documentation* — anyone adding a Phase-2 table should
 * see it listed here (and fail the build until they do).
 */
const TENANT_TABLES = [
  // Inventory
  "warehouses",
  "items",
  "item_warehouse_bindings",
  "stock_ledger",
  "stock_summary",
  // Procurement
  "vendors",
  "procurement_number_sequences",
  "indents",
  "indent_lines",
  "purchase_orders",
  "po_lines",
  "grns",
  "grn_lines",
  // Production
  "products",
  "production_number_sequences",
  "bom_versions",
  "bom_lines",
  "wip_stage_templates",
  "work_orders",
  "wip_stages",
  // QC
  "qc_number_sequences",
  "inspection_templates",
  "inspection_parameters",
  "qc_inspections",
  "qc_findings",
  "qc_certs",
  // Finance
  "finance_number_sequences",
  "sales_invoices",
  "sales_invoice_lines",
  "purchase_invoices",
  "purchase_invoice_lines",
  "customer_ledger",
  "vendor_ledger",
  "payments",
  // Notifications
  "notification_templates",
  "notifications",
] as const;

describe("gate-25: Phase-2 modules cross-tenant isolation", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    // user_identities is GLOBAL (no RLS) — seed outside withOrg.
    const bootstrap = await pool.connect();
    try {
      await bootstrap.query(
        `INSERT INTO user_identities (id, email, password_hash)
         VALUES ($1, 'phase2-other@other.local', '$2b$10$stub')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_IDENTITY_ID]
      );
    } finally {
      bootstrap.release();
    }

    // Everything tenant-scoped goes through withOrg so RLS sees our INSERTs.
    await withOrg(pool, OTHER_ORG_ID, async (client) => {
      // ── organization + user + account (base for later FKs) ──────────────
      await client.query(
        `INSERT INTO organizations (id, name) VALUES ($1, 'Phase-2 Other Tenant')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO users (id, org_id, identity_id, email, name)
         VALUES ($1, $2, $3, 'phase2-other@other.local', 'Phase-2 Other User')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_USER_ID, OTHER_ORG_ID, OTHER_IDENTITY_ID]
      );
      await client.query(
        `INSERT INTO accounts (id, org_id, name, country)
         VALUES ($1, $2, 'Phase-2 Other Account', 'IN')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ACCOUNT_ID, OTHER_ORG_ID]
      );

      // ── Inventory ──────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO warehouses (id, org_id, code, name)
         VALUES ($1, $2, 'WH-OTHER', 'Other Warehouse')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WAREHOUSE_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO items (id, org_id, sku, name, uom)
         VALUES ($1, $2, 'ITEM-OTHER', 'Other Item', 'EA')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ITEM_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO item_warehouse_bindings (id, org_id, item_id, warehouse_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_BINDING_ID, OTHER_ORG_ID, OTHER_ITEM_ID, OTHER_WAREHOUSE_ID]
      );
      // The stock_ledger insert fires tg_stock_summary_from_ledger which
      // upserts the matching stock_summary row, so we don't need to seed
      // stock_summary by hand.
      await client.query(
        `INSERT INTO stock_ledger (
           id, org_id, item_id, warehouse_id, quantity, uom, txn_type
         ) VALUES ($1, $2, $3, $4, 1.000, 'EA', 'OPENING_BALANCE')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_LEDGER_ID, OTHER_ORG_ID, OTHER_ITEM_ID, OTHER_WAREHOUSE_ID]
      );

      // ── Procurement ────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO vendors (id, org_id, code, name)
         VALUES ($1, $2, 'VEND-OTHER', 'Other Vendor')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_VENDOR_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO procurement_number_sequences (org_id, kind, year, last_seq)
         VALUES ($1, 'PO', 2026, 1)
         ON CONFLICT (org_id, kind, year) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO indents (id, org_id, indent_number)
         VALUES ($1, $2, 'IND-OTHER-0001')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_INDENT_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO indent_lines (
           id, org_id, indent_id, line_no, item_id, quantity, uom
         ) VALUES ($1, $2, $3, 1, $4, 1.000, 'EA')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_INDENT_LN_ID, OTHER_ORG_ID, OTHER_INDENT_ID, OTHER_ITEM_ID]
      );
      await client.query(
        `INSERT INTO purchase_orders (
           id, org_id, po_number, vendor_id
         ) VALUES ($1, $2, 'PO-OTHER-0001', $3)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_PO_ID, OTHER_ORG_ID, OTHER_VENDOR_ID]
      );
      await client.query(
        `INSERT INTO po_lines (
           id, org_id, po_id, line_no, item_id,
           quantity, uom, unit_price
         ) VALUES ($1, $2, $3, 1, $4, 1.000, 'EA', '10.00')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_PO_LINE_ID, OTHER_ORG_ID, OTHER_PO_ID, OTHER_ITEM_ID]
      );
      await client.query(
        `INSERT INTO grns (
           id, org_id, grn_number, po_id, vendor_id, warehouse_id
         ) VALUES ($1, $2, 'GRN-OTHER-0001', $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_GRN_ID, OTHER_ORG_ID, OTHER_PO_ID, OTHER_VENDOR_ID, OTHER_WAREHOUSE_ID]
      );
      await client.query(
        `INSERT INTO grn_lines (
           id, org_id, grn_id, po_line_id, line_no, item_id,
           quantity, uom
         ) VALUES ($1, $2, $3, $4, 1, $5, 1.000, 'EA')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_GRN_LINE_ID, OTHER_ORG_ID, OTHER_GRN_ID, OTHER_PO_LINE_ID, OTHER_ITEM_ID]
      );

      // ── Production ─────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO products (
           id, org_id, product_code, name, family
         ) VALUES ($1, $2, 'PROD-OTHER', 'Other Product', 'INSTRUMENT')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_PRODUCT_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO production_number_sequences (org_id, kind, year, last_seq)
         VALUES ($1, 'WO', 2026, 1)
         ON CONFLICT (org_id, kind, year) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO bom_versions (
           id, org_id, product_id, version_label
         ) VALUES ($1, $2, $3, 'v1')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_BOM_ID, OTHER_ORG_ID, OTHER_PRODUCT_ID]
      );
      await client.query(
        `INSERT INTO bom_lines (
           id, org_id, bom_id, line_no, component_item_id,
           qty_per_unit, uom
         ) VALUES ($1, $2, $3, 1, $4, 1.000, 'EA')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_BOM_LINE_ID, OTHER_ORG_ID, OTHER_BOM_ID, OTHER_ITEM_ID]
      );
      await client.query(
        `INSERT INTO wip_stage_templates (
           id, org_id, product_family, sequence_number, stage_name
         ) VALUES ($1, $2, 'INSTRUMENT', 1, 'Assembly')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WIP_TMPL_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO work_orders (
           id, org_id, pid, product_id, bom_id, bom_version_label, quantity
         ) VALUES ($1, $2, 'PID-OTHER-0001', $3, $4, 'v1', 1.000)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WO_ID, OTHER_ORG_ID, OTHER_PRODUCT_ID, OTHER_BOM_ID]
      );
      await client.query(
        `INSERT INTO wip_stages (
           id, org_id, wo_id, sequence_number, stage_name
         ) VALUES ($1, $2, $3, 1, 'Assembly')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_WIP_STAGE_ID, OTHER_ORG_ID, OTHER_WO_ID]
      );

      // ── QC ─────────────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO qc_number_sequences (org_id, kind, year, last_seq)
         VALUES ($1, 'QC', 2026, 1)
         ON CONFLICT (org_id, kind, year) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO inspection_templates (
           id, org_id, code, name, kind
         ) VALUES ($1, $2, 'QCT-OTHER', 'Other IQC Template', 'IQC')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_INSP_TMPL_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO inspection_parameters (
           id, org_id, template_id, sequence_number, name, parameter_type
         ) VALUES ($1, $2, $3, 1, 'Visual Check', 'TEXT')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_INSP_PARAM_ID, OTHER_ORG_ID, OTHER_INSP_TMPL_ID]
      );
      // qc_inspections.source_id is required (NOT NULL) but not a real FK,
      // so we point it at the GRN line we created above.
      await client.query(
        `INSERT INTO qc_inspections (
           id, org_id, inspection_number, kind, source_type, source_id
         ) VALUES ($1, $2, 'QC-OTHER-0001', 'IQC', 'GRN_LINE', $3)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_INSP_ID, OTHER_ORG_ID, OTHER_GRN_LINE_ID]
      );
      await client.query(
        `INSERT INTO qc_findings (
           id, org_id, inspection_id, sequence_number,
           parameter_name, parameter_type
         ) VALUES ($1, $2, $3, 1, 'Visual Check', 'TEXT')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_FINDING_ID, OTHER_ORG_ID, OTHER_INSP_ID]
      );
      await client.query(
        `INSERT INTO qc_certs (
           id, org_id, cert_number, inspection_id
         ) VALUES ($1, $2, 'QCC-OTHER-0001', $3)
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_CERT_ID, OTHER_ORG_ID, OTHER_INSP_ID]
      );

      // ── Finance ────────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO finance_number_sequences (org_id, kind, year, last_seq)
         VALUES ($1, 'SI', 2026, 1)
         ON CONFLICT (org_id, kind, year) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO sales_invoices (id, org_id, invoice_number)
         VALUES ($1, $2, 'SI-OTHER-0001')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_SI_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO sales_invoice_lines (
           id, org_id, invoice_id, sequence_number,
           description, quantity, unit_price
         ) VALUES ($1, $2, $3, 1, 'Other line', 1, '10.0000')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_SI_LINE_ID, OTHER_ORG_ID, OTHER_SI_ID]
      );
      await client.query(
        `INSERT INTO purchase_invoices (id, org_id, invoice_number)
         VALUES ($1, $2, 'PI-OTHER-0001')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_PI_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO purchase_invoice_lines (
           id, org_id, invoice_id, sequence_number,
           description, quantity, unit_price
         ) VALUES ($1, $2, $3, 1, 'Other line', 1, '10.0000')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_PI_LINE_ID, OTHER_ORG_ID, OTHER_PI_ID]
      );
      await client.query(
        `INSERT INTO customer_ledger (
           id, org_id, customer_id, entry_type,
           debit, credit, reference_type
         ) VALUES ($1, $2, $3, 'INVOICE', '10.0000', 0, 'SALES_INVOICE')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_CL_ID, OTHER_ORG_ID, OTHER_ACCOUNT_ID]
      );
      await client.query(
        `INSERT INTO vendor_ledger (
           id, org_id, vendor_id, entry_type,
           debit, credit, reference_type
         ) VALUES ($1, $2, $3, 'BILL', '10.0000', 0, 'PURCHASE_INVOICE')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_VL_ID, OTHER_ORG_ID, OTHER_VENDOR_ID]
      );
      await client.query(
        `INSERT INTO payments (
           id, org_id, payment_number, payment_type,
           amount, mode
         ) VALUES ($1, $2, 'PAY-OTHER-0001', 'CUSTOMER_RECEIPT',
                   '10.0000', 'BANK_TRANSFER')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_PAYMENT_ID, OTHER_ORG_ID]
      );

      // ── Notifications ──────────────────────────────────────────────────
      await client.query(
        `INSERT INTO notification_templates (
           id, org_id, event_type, channel, name, body_template
         ) VALUES ($1, $2, 'other.event', 'IN_APP', 'Other template',
                   'Body {{var}}')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_NOTIF_TMPL_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO notifications (
           id, org_id, user_id, event_type, title, body
         ) VALUES ($1, $2, $3, 'other.event', 'Other title', 'Other body')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_NOTIF_ID, OTHER_ORG_ID, OTHER_USER_ID]
      );
    });
  });

  afterAll(async () => {
    // Leave seeds in place — cheap and stable between runs.
    await pool.end();
  });

  it("every Phase-2 tenant table enforces RLS under DEV org — no other-org rows leak", async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM ${table} WHERE org_id = $1`,
          [OTHER_ORG_ID]
        );
        expect(
          rows[0]!.c,
          `${table} leaked rows from OTHER_ORG when RLS set to DEV_ORG`
        ).toBe("0");
      }
    });
  });

  it("every Phase-2 tenant table returns only its own rows under OTHER org", async () => {
    await withOrg(pool, OTHER_ORG_ID, async (client) => {
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ org_id: string }>(
          `SELECT DISTINCT org_id FROM ${table}`
        );
        for (const row of rows) {
          expect(
            row.org_id,
            `${table} under OTHER_ORG returned a foreign org_id ${row.org_id}`
          ).toBe(OTHER_ORG_ID);
        }
      }
    });
  });

  it("every Phase-2 tenant table returns zero rows when app.current_org is unset", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM ${table}`
        );
        expect(
          rows[0]!.c,
          `${table} returned rows with no RLS GUC set — policy missing?`
        ).toBe("0");
      }
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("RLS on the Phase-2 tables is FORCE'd (relrowsecurity + relforcerowsecurity)", async () => {
    // Duplicates part of gate-12's coverage intentionally — this gate is
    // self-contained so a partial test run still catches the full contract
    // for its scope.
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname,
              c.relrowsecurity,
              c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])`,
      [TENANT_TABLES as unknown as string[]]
    );
    const byName = new Map(rows.map((r) => [r.relname, r]));
    for (const table of TENANT_TABLES) {
      const row = byName.get(table);
      expect(row, `${table} not found in pg_class`).toBeDefined();
      expect(
        row!.relrowsecurity,
        `${table} does not have RLS enabled`
      ).toBe(true);
      expect(
        row!.relforcerowsecurity,
        `${table} does not FORCE RLS — superuser bypass possible`
      ).toBe(true);
    }
  });
});
