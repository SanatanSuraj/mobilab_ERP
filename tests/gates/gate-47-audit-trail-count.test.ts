/**
 * Gate 47 — Audit-trail per-mutation count gate (historic Gate 11 intent,
 * ARCHITECTURE.md §15.4 open gap #2 / §11 audit actor / §4.2 trace-id).
 *
 * Invariant under test: **every mutating DB statement against an
 * org-scoped, audited table produces EXACTLY ONE row in `audit.log`
 * carrying:**
 *
 *   - `actor       = current_setting('app.current_user')::uuid`
 *   - `org_id      = current_setting('app.current_org')::uuid`
 *   - `trace_id    = current_setting('app.current_trace_id')` (non-null
 *                    whenever the caller set the GUC)
 *   - `action      = TG_OP` (INSERT / UPDATE / DELETE)
 *   - `table_name  = schema.table`
 *
 * The generic `audit.tg_log()` trigger in ops/sql/triggers/03-audit.sql
 * (extended for trace-id by ops/sql/init/19-phase4-audit-trace-id.sql)
 * is supposed to fire on every audited table. Earlier phases tested the
 * primitive in isolation; this gate proves the trigger is actually
 * attached to every representative production CRUD table and that each
 * round-trip yields a tight row-count delta — catching silent gaps where
 * the trigger was forgotten (historic Gate 11 intent).
 *
 * Coverage picks one representative table per major module rather than
 * every table in §13:
 *
 *   1. crm.leads
 *   2. crm.deals
 *   3. public.items                (inventory module)
 *   4. public.purchase_orders      (procurement module)
 *   5. public.work_orders          (production module)
 *   6. public.qc_inspections       (qc module)
 *   7. public.sales_invoices       (finance module)
 *
 * For each table the gate drives one INSERT → one UPDATE → one DELETE
 * against the real dev Postgres, wrapping each mutation in a
 * `withOrg(...)` block that also sets `app.current_user` and
 * `app.current_trace_id` — mirroring the behaviour of the api-side
 * `withRequest()` helper in apps/api/src/modules/shared/with-request.ts.
 *
 * Assertions per operation:
 *
 *   a. Baseline `SELECT count(*) FROM audit.log WHERE actor=USER AND
 *      changed_at >= GATE_START AND table_name = '<module>.<table>'`
 *      advances by exactly 1.
 *   b. The most recent row for that (actor, table_name) carries the
 *      expected action (INSERT / UPDATE / DELETE) and row_id.
 *   c. `trace_id` is non-null and equals the test-supplied value.
 *
 * The assertions are filtered by `actor = USER_ID` AND `changed_at >=
 * GATE_START` so parallel gates writing audit rows (gate-22, gate-35,
 * gate-46) cannot perturb the delta.
 *
 * Isolation: reuses ORG_PRIMARY (the dev org, `a001`) + the admin user
 * (`b001`) from seed/03-dev-org-users.sql. All rows this gate creates
 * are tagged with fixture prefixes ("gate-47-*") and hard-deleted in
 * `afterAll` so the shared dev DB stays tidy.
 *
 * If a representative table's trigger is missing (expected delta=1 but
 * actual=0) the gate fails loudly with the table name so the compliance
 * owner can reattach the audit trigger — this is the WHOLE POINT of the
 * gate.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import pg from "pg";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";
import { createLogger } from "@instigenie/observability";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

// ── Fixtures ─────────────────────────────────────────────────────────────
// Dev Admin — has no role-specific permissions here but that doesn't
// matter: the gate talks directly to the tables (bypassing service
// perm checks that live on the HTTP route). The admin uuid is set as
// `app.current_user` so every audit row carries it as `actor`.
const USER_ID = "00000000-0000-0000-0000-00000000b001";

// Seeded references (08-inventory, 09-procurement, 10-production,
// 12-finance seeds). We read these rather than creating them so the
// gate doesn't double-count expected audit deltas.
const VENDOR_ID = "00000000-0000-0000-0000-000000fe0001"; // Elcon Mart
const PRODUCT_ECG_ID = "00000000-0000-0000-0000-000000fc0001"; // ECG v2
const BOM_ECG_V3_ID = "00000000-0000-0000-0000-000000fc0101"; // ACTIVE BOM
const WAREHOUSE_MAIN_ID = "00000000-0000-0000-0000-000000fa0001";
const CUSTOMER_APOLLO_ID = "00000000-0000-0000-0000-0000000ac001";

/**
 * Trace-id carried on every audit row this gate generates. Random per
 * run so we can assert that the GUC propagated through the trigger
 * without depending on request.id plumbing. Matches the W3C
 * 32-hex-char shape that withRequest() would pass.
 */
const TRACE_ID = randomUUID().replace(/-/g, "");

const log = createLogger({ service: "gate-47", level: "silent" });

interface AuditRow {
  id: string;
  org_id: string;
  table_name: string;
  row_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor: string | null;
  trace_id: string | null;
  changed_at: Date;
}

/**
 * Schema-driven audit column discovery — the gate is NOT allowed to
 * hardcode column names it "remembers"; instead it introspects the
 * live `audit.log` table up-front and FAILS LOUDLY if any committed
 * column is missing. Two migration generations are required:
 *   - `ops/sql/init/01-schemas.sql` → core columns.
 *   - `ops/sql/init/19-phase4-audit-trace-id.sql` → `trace_id`.
 * Migration 19 is now required everywhere (Phase 4 go-live). If the
 * column is absent the gate refuses to run — a silent skip would
 * mask the §4.2 trace-id compliance surface the gate exists to prove.
 */
interface AuditSchema {
  columns: Set<string>;
}

async function discoverAuditSchema(pool: pg.Pool): Promise<AuditSchema> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'audit'
        AND table_name   = 'log'`,
  );
  const cols = new Set(rows.map((r) => r.column_name));
  const required = [
    "id",
    "org_id",
    "table_name",
    "row_id",
    "action",
    "actor",
    "before",
    "after",
    "changed_at",
    // Phase 4 §4.2 — migration 19 adds this; strict from 2026-04-23 on.
    "trace_id",
  ];
  for (const c of required) {
    if (!cols.has(c)) {
      throw new Error(
        `Gate 47 FAIL — audit.log is missing the committed column '${c}'. ` +
          `Expected column set per ops/sql/init/01-schemas.sql + ` +
          `ops/sql/init/19-phase4-audit-trace-id.sql. ` +
          `Got: [${[...cols].sort().join(", ")}]. ` +
          `If this is a fresh dev DB, run: ` +
          `docker exec -i instigenie-postgres psql -U instigenie -d instigenie ` +
          `< ops/sql/init/19-phase4-audit-trace-id.sql`,
      );
    }
  }
  return { columns: cols };
}

/**
 * Run `fn` inside a tenant-scoped txn with audit actor + trace-id
 * GUCs set — the same three GUCs apps/api/src/modules/shared/with-request.ts
 * sets on every mutating route. Mirroring it here proves the gate
 * covers the same invariant the production helper enforces.
 */
async function withAuditContext<T>(
  pool: pg.Pool,
  userId: string,
  traceId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [
      userId,
    ]);
    await client.query(
      `SELECT set_config('app.current_trace_id', $1, true)`,
      [traceId],
    );
    return fn(client);
  });
}

/**
 * Tight-delta count of audit rows attributable to this gate run.
 * Filtering by `actor` + `changed_at >= GATE_START` + `table_name`
 * keeps us insensitive to rows from other gates / background jobs.
 */
async function countAuditRows(
  pool: pg.Pool,
  filter: {
    tableName: string;
    gateStart: Date;
    actor?: string;
  },
): Promise<number> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::bigint AS count
         FROM audit.log
        WHERE table_name = $1
          AND changed_at >= $2
          AND actor = $3`,
      [filter.tableName, filter.gateStart, filter.actor ?? USER_ID],
    );
    return Number(rows[0]!.count);
  });
}

/**
 * Read the most recent audit row this gate produced for `tableName`.
 * Used to assert action / row_id / trace_id on each mutation. Now
 * strict: `trace_id` is always projected because migration 19 is
 * required (see discoverAuditSchema()).
 */
async function latestAuditRow(
  pool: pg.Pool,
  _schema: AuditSchema,
  tableName: string,
  gateStart: Date,
  rowId: string,
): Promise<AuditRow | null> {
  return withOrg(pool, DEV_ORG_ID, async (client) => {
    const { rows } = await client.query<AuditRow>(
      `SELECT id, org_id, table_name, row_id, action, actor,
              trace_id, changed_at
         FROM audit.log
        WHERE table_name = $1
          AND changed_at >= $2
          AND actor = $3
          AND row_id = $4
        ORDER BY changed_at DESC
        LIMIT 1`,
      [tableName, gateStart, USER_ID, rowId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Opinionated assertion bundle: each mutating round-trip bumps the
 * count by exactly 1 and the newest row carries the expected action +
 * non-null trace_id matching our supplied GUC. Fails loudly (naming
 * the table) when the trigger didn't fire, because that's a real
 * compliance gap — the §15.4 wipeout scenario.
 */
async function expectMutationProduces(
  pool: pg.Pool,
  schema: AuditSchema,
  args: {
    tableName: string; // e.g. 'public.leads'
    gateStart: Date;
    priorCount: number;
    action: "INSERT" | "UPDATE" | "DELETE";
    rowId: string;
    label: string;
  },
): Promise<number> {
  const next = await countAuditRows(pool, {
    tableName: args.tableName,
    gateStart: args.gateStart,
  });
  if (next !== args.priorCount + 1) {
    throw new Error(
      `Gate 47 FAIL — ${args.label}: expected audit.log count to advance by 1 ` +
        `on ${args.action} ${args.tableName}, got delta=${next - args.priorCount}. ` +
        `Likely missing audit trigger on ${args.tableName}.`,
    );
  }
  const row = await latestAuditRow(
    pool,
    schema,
    args.tableName,
    args.gateStart,
    args.rowId,
  );
  expect(row).not.toBeNull();
  expect(row!.action).toBe(args.action);
  expect(row!.actor).toBe(USER_ID);
  expect(row!.org_id).toBe(DEV_ORG_ID);
  // trace_id is strict: migration 19 is required everywhere (Phase 4
  // §4.2 go-live). discoverAuditSchema() refuses to run if the column
  // is missing — by the time we're here, the trigger MUST have stamped
  // the GUC-supplied trace_id onto the row.
  expect(row!.trace_id).not.toBeNull();
  expect(row!.trace_id).toBe(TRACE_ID);
  void schema;
  return next;
}

describe("gate-47: audit-trail per-mutation count gate (ARCHITECTURE.md §15.4 #2)", () => {
  let pool: pg.Pool;
  let auditSchema: AuditSchema;
  // Timestamp pinned BEFORE any mutation in this gate. All audit rows
  // we care about have changed_at >= GATE_START, so the count delta is
  // insensitive to rows written by other gates or seeds.
  let gateStart: Date;

  // Fixture ids we create + must delete in afterAll. Captured per-module
  // so the teardown can hard-delete even if assertions mid-run fail.
  const createdIds: Array<{ table: string; id: string; hardDeleted?: boolean }> =
    [];

  beforeAll(async () => {
    installNumericTypeParser();
    pool = makeTestPool();
    await waitForPg(pool);
    auditSchema = await discoverAuditSchema(pool);
    // Round to the nearest second boundary so Postgres comparisons are
    // robust against microsecond drift between JS Date.now() and
    // Postgres now().
    gateStart = new Date(Date.now() - 1_000);
    // trace_id is required post-migration-19 so we no longer log its
    // presence — `discoverAuditSchema` throws if the column is missing,
    // so reaching this point implies hasTraceId === true.
    log.debug({ gateStart, traceId: TRACE_ID }, "gate-47 start");
    void auditSchema;
  });

  afterAll(async () => {
    // Teardown is best-effort: anything that was hard-deleted during a
    // test already has `hardDeleted = true` so we skip it. For soft-
    // deleted rows we still hard-delete so repeat runs start clean.
    if (pool) {
      try {
        await withAuditContext(pool, USER_ID, TRACE_ID, async (client) => {
          for (const rec of createdIds) {
            if (rec.hardDeleted) continue;
            try {
              await client.query(
                `DELETE FROM ${rec.table} WHERE id = $1`,
                [rec.id],
              );
            } catch {
              // swallow — teardown is opportunistic.
            }
          }
        });
      } finally {
        await pool.end();
      }
    }
  });

  // ─── 1. crm.leads ────────────────────────────────────────────────────────
  it("crm.leads — INSERT + UPDATE + DELETE each produce exactly one audit row", async () => {
    const TABLE = "public.leads";
    const suffix = randomUUID().slice(0, 8);
    let prior = await countAuditRows(pool, {
      tableName: TABLE,
      gateStart,
    });

    // INSERT
    const leadId = await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO leads (org_id, name, company, email, phone)
           VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          DEV_ORG_ID,
          `gate-47-lead-${suffix}`,
          `gate-47 company ${suffix}`,
          `gate-47-${suffix}@instigenie.local`,
          `+91-99999-${suffix.slice(0, 5).replace(/[a-f]/gi, "0")}`,
        ],
      );
      return rows[0]!.id;
    });
    createdIds.push({ table: "leads", id: leadId });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "INSERT",
      rowId: leadId,
      label: "crm.leads INSERT",
    });

    // UPDATE
    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(
        `UPDATE leads SET estimated_value = $2 WHERE id = $1`,
        [leadId, "42000.00"],
      );
    });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "UPDATE",
      rowId: leadId,
      label: "crm.leads UPDATE",
    });

    // DELETE (hard-delete to keep the teardown simple + to exercise the
    // DELETE branch of the trigger)
    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      // lead_activities FK-cascades; no stray audit rows for them
      // because lead_activities only audits INSERT/DELETE and we
      // haven't inserted any.
      await c.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    });
    await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "DELETE",
      rowId: leadId,
      label: "crm.leads DELETE",
    });
    createdIds.find((r) => r.id === leadId)!.hardDeleted = true;
  });

  // ─── 2. crm.deals ────────────────────────────────────────────────────────
  it("crm.deals — INSERT + UPDATE + DELETE each produce exactly one audit row", async () => {
    const TABLE = "public.deals";
    const suffix = randomUUID().slice(0, 8);
    let prior = await countAuditRows(pool, {
      tableName: TABLE,
      gateStart,
    });

    const dealId = await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO deals
           (org_id, deal_number, title, company, contact_name,
            stage, value, probability)
         VALUES ($1, $2, $3, $4, $5, 'DISCOVERY', '0', 20)
         RETURNING id`,
        [
          DEV_ORG_ID,
          `GATE-47-DEAL-${suffix}`,
          `gate-47 deal ${suffix}`,
          `gate-47 co ${suffix}`,
          `Gate 47 Contact`,
        ],
      );
      return rows[0]!.id;
    });
    createdIds.push({ table: "deals", id: dealId });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "INSERT",
      rowId: dealId,
      label: "crm.deals INSERT",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(
        `UPDATE deals SET value = $2 WHERE id = $1`,
        [dealId, "12345.67"],
      );
    });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "UPDATE",
      rowId: dealId,
      label: "crm.deals UPDATE",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(`DELETE FROM deals WHERE id = $1`, [dealId]);
    });
    await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "DELETE",
      rowId: dealId,
      label: "crm.deals DELETE",
    });
    createdIds.find((r) => r.id === dealId)!.hardDeleted = true;
  });

  // ─── 3. inventory.items ──────────────────────────────────────────────────
  it("inventory.items — INSERT + UPDATE + DELETE each produce exactly one audit row", async () => {
    const TABLE = "public.items";
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    let prior = await countAuditRows(pool, {
      tableName: TABLE,
      gateStart,
    });

    const itemId = await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO items (org_id, sku, name, category, uom, unit_cost)
           VALUES ($1, $2, $3, 'CONSUMABLE', 'EA', '1.00')
         RETURNING id`,
        [DEV_ORG_ID, `GATE47-${suffix}`, `gate-47 item ${suffix}`],
      );
      return rows[0]!.id;
    });
    createdIds.push({ table: "items", id: itemId });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "INSERT",
      rowId: itemId,
      label: "inventory.items INSERT",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(
        `UPDATE items SET unit_cost = $2 WHERE id = $1`,
        [itemId, "2.50"],
      );
    });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "UPDATE",
      rowId: itemId,
      label: "inventory.items UPDATE",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(`DELETE FROM items WHERE id = $1`, [itemId]);
    });
    await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "DELETE",
      rowId: itemId,
      label: "inventory.items DELETE",
    });
    createdIds.find((r) => r.id === itemId)!.hardDeleted = true;
  });

  // ─── 4. procurement.purchase_orders ──────────────────────────────────────
  it("procurement.purchase_orders — INSERT + UPDATE + DELETE each produce exactly one audit row", async () => {
    const TABLE = "public.purchase_orders";
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    let prior = await countAuditRows(pool, {
      tableName: TABLE,
      gateStart,
    });

    const poId = await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO purchase_orders
           (org_id, po_number, vendor_id, status, currency,
            delivery_warehouse_id, payment_terms_days, created_by)
         VALUES ($1, $2, $3, 'DRAFT', 'INR', $4, 30, $5)
         RETURNING id`,
        [
          DEV_ORG_ID,
          `GATE-47-PO-${suffix}`,
          VENDOR_ID,
          WAREHOUSE_MAIN_ID,
          USER_ID,
        ],
      );
      return rows[0]!.id;
    });
    createdIds.push({ table: "purchase_orders", id: poId });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "INSERT",
      rowId: poId,
      label: "procurement.purchase_orders INSERT",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(
        `UPDATE purchase_orders SET notes = $2 WHERE id = $1`,
        [poId, "gate-47 updated"],
      );
    });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "UPDATE",
      rowId: poId,
      label: "procurement.purchase_orders UPDATE",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(`DELETE FROM purchase_orders WHERE id = $1`, [poId]);
    });
    await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "DELETE",
      rowId: poId,
      label: "procurement.purchase_orders DELETE",
    });
    createdIds.find((r) => r.id === poId)!.hardDeleted = true;
  });

  // ─── 5. production.work_orders ───────────────────────────────────────────
  it("production.work_orders — INSERT + UPDATE + DELETE each produce exactly one audit row", async () => {
    const TABLE = "public.work_orders";
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    let prior = await countAuditRows(pool, {
      tableName: TABLE,
      gateStart,
    });

    const woId = await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO work_orders
           (org_id, pid, product_id, bom_id, bom_version_label,
            quantity, status, priority, created_by)
         VALUES ($1, $2, $3, $4, 'v3', 1, 'PLANNED', 'NORMAL', $5)
         RETURNING id`,
        [
          DEV_ORG_ID,
          `GATE-47-WO-${suffix}`,
          PRODUCT_ECG_ID,
          BOM_ECG_V3_ID,
          USER_ID,
        ],
      );
      return rows[0]!.id;
    });
    createdIds.push({ table: "work_orders", id: woId });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "INSERT",
      rowId: woId,
      label: "production.work_orders INSERT",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(
        `UPDATE work_orders SET notes = $2 WHERE id = $1`,
        [woId, "gate-47 wo notes"],
      );
    });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "UPDATE",
      rowId: woId,
      label: "production.work_orders UPDATE",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(`DELETE FROM work_orders WHERE id = $1`, [woId]);
    });
    await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "DELETE",
      rowId: woId,
      label: "production.work_orders DELETE",
    });
    createdIds.find((r) => r.id === woId)!.hardDeleted = true;
  });

  // ─── 6. qc.qc_inspections ────────────────────────────────────────────────
  it("qc.qc_inspections — INSERT + UPDATE + DELETE each produce exactly one audit row", async () => {
    const TABLE = "public.qc_inspections";
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    let prior = await countAuditRows(pool, {
      tableName: TABLE,
      gateStart,
    });

    // We need a valid source_id (required NOT NULL). An arbitrary uuid
    // is acceptable for source_type=WO since source_id is not FK
    // enforced at DB level for the polymorphic union column — only the
    // dedicated work_order_id FK is. Pick a random uuid so we never
    // collide with an existing source.
    const sourceId = randomUUID();
    const inspectionId = await withAuditContext(
      pool,
      USER_ID,
      TRACE_ID,
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO qc_inspections
             (org_id, inspection_number, kind, status, source_type,
              source_id, created_by)
           VALUES ($1, $2, 'FINAL_QC', 'DRAFT', 'WO', $3, $4)
           RETURNING id`,
          [DEV_ORG_ID, `GATE-47-QCI-${suffix}`, sourceId, USER_ID],
        );
        return rows[0]!.id;
      },
    );
    createdIds.push({ table: "qc_inspections", id: inspectionId });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "INSERT",
      rowId: inspectionId,
      label: "qc.qc_inspections INSERT",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(
        `UPDATE qc_inspections SET notes = $2 WHERE id = $1`,
        [inspectionId, "gate-47 qc notes"],
      );
    });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "UPDATE",
      rowId: inspectionId,
      label: "qc.qc_inspections UPDATE",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(`DELETE FROM qc_inspections WHERE id = $1`, [inspectionId]);
    });
    await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "DELETE",
      rowId: inspectionId,
      label: "qc.qc_inspections DELETE",
    });
    createdIds.find((r) => r.id === inspectionId)!.hardDeleted = true;
  });

  // ─── 7. finance.sales_invoices ───────────────────────────────────────────
  it("finance.sales_invoices — INSERT + UPDATE + DELETE each produce exactly one audit row", async () => {
    const TABLE = "public.sales_invoices";
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    let prior = await countAuditRows(pool, {
      tableName: TABLE,
      gateStart,
    });

    const invoiceId = await withAuditContext(
      pool,
      USER_ID,
      TRACE_ID,
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO sales_invoices
             (org_id, invoice_number, status, customer_id,
              customer_name, invoice_date, currency, created_by)
           VALUES ($1, $2, 'DRAFT', $3, 'Gate 47 Customer',
                   current_date, 'INR', $4)
           RETURNING id`,
          [
            DEV_ORG_ID,
            `GATE-47-SI-${suffix}`,
            CUSTOMER_APOLLO_ID,
            USER_ID,
          ],
        );
        return rows[0]!.id;
      },
    );
    createdIds.push({ table: "sales_invoices", id: invoiceId });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "INSERT",
      rowId: invoiceId,
      label: "finance.sales_invoices INSERT",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(
        `UPDATE sales_invoices SET notes = $2 WHERE id = $1`,
        [invoiceId, "gate-47 si notes"],
      );
    });
    prior = await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "UPDATE",
      rowId: invoiceId,
      label: "finance.sales_invoices UPDATE",
    });

    await withAuditContext(pool, USER_ID, TRACE_ID, async (c) => {
      await c.query(`DELETE FROM sales_invoices WHERE id = $1`, [invoiceId]);
    });
    await expectMutationProduces(pool, auditSchema, {
      tableName: TABLE,
      gateStart,
      priorCount: prior,
      action: "DELETE",
      rowId: invoiceId,
      label: "finance.sales_invoices DELETE",
    });
    createdIds.find((r) => r.id === invoiceId)!.hardDeleted = true;
  });
});
