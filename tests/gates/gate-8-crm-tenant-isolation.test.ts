/**
 * Gate 8 — Cross-tenant isolation for CRM tables.
 *
 * For every CRM tenant-scoped table, inserts under one org must be invisible
 * under another org. Repeats the gate-5 pattern across the full CRM surface:
 * accounts, contacts, leads, lead_activities, deals, deal_line_items,
 * tickets, ticket_comments, quotations, quotation_line_items, sales_orders,
 * sales_order_line_items, crm_number_sequences.
 *
 * This is the ARCHITECTURE.md §9.2 / §13.1 contract — if any table here
 * leaks, the whole CRM module is unsafe to ship.
 *
 * NOTE: gate-12 is the *catalog-level* companion — it asserts every org_id
 * table has RLS enabled+forced with a sane policy. This gate goes further
 * by inserting a row under one org and proving zero rows surface under
 * another. The two together protect against both wiring mistakes (gate-12)
 * and subtle policy misconfigurations (gate-8).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

const OTHER_ORG_ID = "00000000-0000-0000-0000-0000000000c1";

// Stable UUIDs for the "other org" rows so re-running the gate is idempotent.
const OTHER_ACCOUNT_ID      = "00000000-0000-0000-0000-0000000000c2";
const OTHER_CONTACT_ID      = "00000000-0000-0000-0000-0000000000c3";
const OTHER_LEAD_ID         = "00000000-0000-0000-0000-0000000000c4";
const OTHER_ACTIVITY_ID     = "00000000-0000-0000-0000-0000000000c5";
const OTHER_DEAL_ID         = "00000000-0000-0000-0000-0000000000c6";
const OTHER_TICKET_ID       = "00000000-0000-0000-0000-0000000000c7";
const OTHER_COMMENT_ID      = "00000000-0000-0000-0000-0000000000c8";
const OTHER_DEAL_LINE_ID    = "00000000-0000-0000-0000-0000000000c9";
const OTHER_QUOTATION_ID    = "00000000-0000-0000-0000-0000000000ca";
const OTHER_QUOTE_LINE_ID   = "00000000-0000-0000-0000-0000000000cb";
const OTHER_SO_ID           = "00000000-0000-0000-0000-0000000000cc";
const OTHER_SO_LINE_ID      = "00000000-0000-0000-0000-0000000000cd";

const TENANT_TABLES = [
  "accounts",
  "contacts",
  "leads",
  "lead_activities",
  "deals",
  "deal_line_items",
  "tickets",
  "ticket_comments",
  "quotations",
  "quotation_line_items",
  "sales_orders",
  "sales_order_line_items",
  "crm_number_sequences",
] as const;

describe("gate-8: CRM cross-tenant isolation", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);

    // Seed OTHER org + one row in every CRM table — all under RLS context.
    await withOrg(pool, OTHER_ORG_ID, async (client) => {
      await client.query(
        `INSERT INTO organizations (id, name) VALUES ($1, 'CRM Other Tenant')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO accounts (id, org_id, name, country)
         VALUES ($1, $2, 'Other Account', 'IN')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ACCOUNT_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO contacts (id, org_id, account_id, first_name, last_name)
         VALUES ($1, $2, $3, 'Other', 'Contact')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_CONTACT_ID, OTHER_ORG_ID, OTHER_ACCOUNT_ID]
      );
      await client.query(
        `INSERT INTO leads (id, org_id, name, company, email, phone)
         VALUES ($1, $2, 'Other Lead', 'Other Co', 'other-lead@other.local', '+99-00000')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_LEAD_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO lead_activities (id, org_id, lead_id, type, content)
         VALUES ($1, $2, $3, 'NOTE', 'Other tenant activity')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_ACTIVITY_ID, OTHER_ORG_ID, OTHER_LEAD_ID]
      );
      await client.query(
        `INSERT INTO deals (id, org_id, deal_number, title, company, contact_name, value)
         VALUES ($1, $2, 'OTHER-DEAL-0001', 'Other deal', 'Other Co', 'Other Contact', '0')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_DEAL_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO tickets (
           id, org_id, ticket_number, subject, description, category, priority
         ) VALUES ($1, $2, 'OTHER-TK-0001', 'Other ticket',
                   'Other ticket body', 'GENERAL_INQUIRY', 'LOW')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_TICKET_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO ticket_comments (
           id, org_id, ticket_id, visibility, content
         ) VALUES ($1, $2, $3, 'INTERNAL', 'Other tenant comment')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_COMMENT_ID, OTHER_ORG_ID, OTHER_TICKET_ID]
      );
      // Deal line item — depends on the deal created above.
      await client.query(
        `INSERT INTO deal_line_items (
           id, org_id, deal_id, product_code, product_name,
           quantity, unit_price, line_total
         ) VALUES ($1, $2, $3, 'SKU-OTHER', 'Other SKU',
                   1, '100.00', '100.00')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_DEAL_LINE_ID, OTHER_ORG_ID, OTHER_DEAL_ID]
      );
      // Quotation + one line item. Minimum set of columns; totals stay at
      // the table's numeric defaults so we don't have to recompute them.
      await client.query(
        `INSERT INTO quotations (
           id, org_id, quotation_number, company, contact_name, status
         ) VALUES ($1, $2, 'OTHER-Q-0001', 'Other Co', 'Other Contact', 'DRAFT')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_QUOTATION_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO quotation_line_items (
           id, org_id, quotation_id, product_code, product_name,
           quantity, unit_price, line_total
         ) VALUES ($1, $2, $3, 'SKU-OTHER', 'Other SKU',
                   1, '100.00', '100.00')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_QUOTE_LINE_ID, OTHER_ORG_ID, OTHER_QUOTATION_ID]
      );
      // Sales order + one line item. Same pattern as quotations.
      await client.query(
        `INSERT INTO sales_orders (
           id, org_id, order_number, company, contact_name, status
         ) VALUES ($1, $2, 'OTHER-SO-0001', 'Other Co', 'Other Contact', 'DRAFT')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_SO_ID, OTHER_ORG_ID]
      );
      await client.query(
        `INSERT INTO sales_order_line_items (
           id, org_id, order_id, product_code, product_name,
           quantity, unit_price, line_total
         ) VALUES ($1, $2, $3, 'SKU-OTHER', 'Other SKU',
                   1, '100.00', '100.00')
         ON CONFLICT (id) DO NOTHING`,
        [OTHER_SO_LINE_ID, OTHER_ORG_ID, OTHER_SO_ID]
      );
      // Number sequence — composite PK (org_id, kind, year), no `id` col.
      await client.query(
        `INSERT INTO crm_number_sequences (org_id, kind, year, last_seq)
         VALUES ($1, 'QUOTATION', 2026, 1)
         ON CONFLICT (org_id, kind, year) DO NOTHING`,
        [OTHER_ORG_ID]
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("every CRM tenant table enforces RLS under DEV org — no other-org rows leak", async () => {
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

  it("every CRM tenant table returns only its own rows under OTHER org", async () => {
    await withOrg(pool, OTHER_ORG_ID, async (client) => {
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ org_id: string }>(
          `SELECT DISTINCT org_id FROM ${table}`
        );
        // If the table has any rows at all, they must all be OTHER_ORG.
        for (const row of rows) {
          expect(
            row.org_id,
            `${table} under OTHER_ORG returned a foreign org_id ${row.org_id}`
          ).toBe(OTHER_ORG_ID);
        }
      }
    });
  });

  it("every CRM tenant table returns zero rows when app.current_org is unset", async () => {
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

  it("RLS on the CRM tables is FORCE'd (relrowsecurity + relforcerowsecurity)", async () => {
    // forcerowsecurity lives on pg_class (as relforcerowsecurity), not on
    // the pg_tables view — query the catalog directly.
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
