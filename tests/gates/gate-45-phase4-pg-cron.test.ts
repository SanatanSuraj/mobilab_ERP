/**
 * Gate 45 — Phase 4 §4.2 pg_cron compliance & archive.
 *
 * ARCHITECTURE.md §4.2 delegates two scheduled sweeps to pg_cron:
 *
 *   phase4_archive_audit_old_rows  (daily 03:00)  — move audit.log +
 *        stock_ledger rows older than 90 days into *_archive tables.
 *   phase4_watchdog_hashchain      (hourly)       — if the BullMQ
 *        audit-hashchain scheduler has missed its slot (MAX(completed_at)
 *        older than 26h, or no COMPLETED row at all), write a synthetic
 *        FAILED row into qc_cert_chain_audit_runs so the admin audit
 *        dashboard + Prometheus alert can react.
 *
 * This gate:
 *
 *   (45.1) The pg_cron extension is installed and both jobs are scheduled
 *          with the correct cron expressions + function targets. Proves
 *          the postgres image (ops/postgres/Dockerfile) loaded pg_cron
 *          and that 18-phase4-pg-cron.sql applied cleanly.
 *
 *   (45.2) phase4_archive_audit_old_rows actually moves rows: seed an old
 *          audit.log row + an old stock_ledger row + fresh rows, call
 *          the proc, assert hot tables only retain fresh rows and cold
 *          tables received the old ones. archive_runs gets a COMPLETED
 *          row with the correct row counts.
 *
 *   (45.3) phase4_watchdog_hashchain is a no-op when a recent (< 26h)
 *          COMPLETED qc_cert_chain_audit_runs row exists.
 *
 *   (45.4) phase4_watchdog_hashchain inserts a synthetic FAILED row when
 *          the latest COMPLETED row is > 26h old (simulating a stalled
 *          BullMQ scheduler).
 *
 * The functions are SECURITY DEFINER so they work when invoked from the
 * NOBYPASSRLS `instigenie_app` test pool — matches how pg_cron will call
 * them in prod (where the cron.schedule rows were created by the
 * migration superuser).
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://instigenie_app:instigenie_dev@localhost:5434/instigenie";

// Use a fresh per-run org id for seeding so concurrent test runs (or
// rerunning this file repeatedly) don't collide on the audit.log /
// stock_ledger rows we insert. audit.log.org_id has no FK — we can use
// any uuid. stock_ledger does FK to organizations, so we'll seed rows
// against the dev seed org and use a unique ref_doc_id to disambiguate.
const DEV_ORG_ID = "00000000-0000-0000-0000-00000000a001";
const WAREHOUSE_ID = "00000000-0000-0000-0000-000000fa0001"; // Main Plant Store
const ITEM_ID      = "00000000-0000-0000-0000-000000fb0001"; // Resistor 1k

let pool: pg.Pool;

beforeAll(async () => {
  installNumericTypeParser();
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 6,
    application_name: "gate-45",
  });
});

afterAll(async () => {
  await pool.end();
});

// ─── Gate 45.1 — pg_cron is installed and jobs are scheduled ────────────

describe("Gate 45.1 — pg_cron schedule", () => {
  test("pg_cron extension is loaded", async () => {
    const { rows } = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = 'pg_cron'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.extname).toBe("pg_cron");
  });

  test("phase4_archive_audit_old_rows is scheduled daily at 03:00", async () => {
    const { rows } = await pool.query<{
      jobname: string;
      schedule: string;
      command: string;
      active: boolean;
    }>(
      `SELECT jobname, schedule, command, active
         FROM cron.job
        WHERE jobname = 'phase4_archive_audit_old_rows'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.schedule).toBe("0 3 * * *");
    expect(rows[0]!.command.toLowerCase()).toContain(
      "phase4_archive_audit_old_rows",
    );
    expect(rows[0]!.active).toBe(true);
  });

  test("phase4_watchdog_hashchain is scheduled hourly", async () => {
    const { rows } = await pool.query<{
      jobname: string;
      schedule: string;
      command: string;
      active: boolean;
    }>(
      `SELECT jobname, schedule, command, active
         FROM cron.job
        WHERE jobname = 'phase4_watchdog_hashchain'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.schedule).toBe("0 * * * *");
    expect(rows[0]!.command.toLowerCase()).toContain(
      "phase4_watchdog_hashchain",
    );
    expect(rows[0]!.active).toBe(true);
  });
});

// ─── Gate 45.2 — phase4_archive_audit_old_rows moves old rows ───────────

describe("Gate 45.2 — phase4_archive_audit_old_rows", () => {
  test("moves rows older than 90d, leaves fresh rows, logs archive_runs", async () => {
    const testOrgId = randomUUID();
    const oldAuditId = randomUUID();
    const freshAuditId = randomUUID();
    const oldLedgerRefId = randomUUID();
    const freshLedgerRefId = randomUUID();

    // ── Seed ──
    // audit.log has RLS — we INSERT under withOrg so the policy check passes.
    await withOrg(pool, testOrgId, async (c) => {
      await c.query(
        `INSERT INTO audit.log
           (id, org_id, table_name, row_id, action, before, after, changed_at)
         VALUES
           ($1, $2, 'gate45_probe', $1, 'INSERT', NULL,
            '{"marker":"old"}'::jsonb, now() - interval '100 days'),
           ($3, $2, 'gate45_probe', $3, 'INSERT', NULL,
            '{"marker":"fresh"}'::jsonb, now())`,
        [oldAuditId, testOrgId, freshAuditId],
      );
    });

    // stock_ledger inserts go under the dev org (real FK targets). Use a
    // unique ref_doc_id pair to find our fixtures after the sweep. We
    // insert with posted_at in the past by UPDATE (posted_at has a DEFAULT
    // now() but is also writable).
    const oldLedgerId = randomUUID();
    const freshLedgerId = randomUUID();
    await withOrg(pool, DEV_ORG_ID, async (c) => {
      await c.query(
        `INSERT INTO stock_ledger
           (id, org_id, item_id, warehouse_id,
            quantity, uom, txn_type, ref_doc_type, ref_doc_id, posted_at)
         VALUES
           ($1, $2, $3, $4,
            '1.000', 'EA', 'ADJUSTMENT', 'GATE45_PROBE', $5,
            now() - interval '100 days'),
           ($6, $2, $3, $4,
            '2.000', 'EA', 'ADJUSTMENT', 'GATE45_PROBE', $7,
            now())`,
        [
          oldLedgerId,
          DEV_ORG_ID,
          ITEM_ID,
          WAREHOUSE_ID,
          oldLedgerRefId,
          freshLedgerId,
          freshLedgerRefId,
        ],
      );
    });

    // ── Call the proc ──
    // SECURITY DEFINER, so RLS is bypassed — affects rows in ANY tenant
    // (that's the intent: this is a maintenance sweep).
    const runCountBefore = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM audit.archive_runs`,
    );
    await pool.query(`SELECT public.phase4_archive_audit_old_rows()`);
    const runCountAfter = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM audit.archive_runs`,
    );
    // Exactly one new archive_runs row appended.
    expect(Number(runCountAfter.rows[0]!.c)).toBe(
      Number(runCountBefore.rows[0]!.c) + 1,
    );

    // ── Assert: audit.log hot row is gone, archive has it ──
    const { rows: hotAudit } = await withOrg(pool, testOrgId, (c) =>
      c.query<{ id: string }>(
        `SELECT id FROM audit.log
          WHERE table_name = 'gate45_probe' AND org_id = $1`,
        [testOrgId],
      ),
    );
    // Only the fresh row remains in hot.
    expect(hotAudit).toHaveLength(1);
    expect(hotAudit[0]!.id).toBe(freshAuditId);

    const { rows: coldAudit } = await withOrg(pool, testOrgId, (c) =>
      c.query<{ id: string; after: { marker: string } }>(
        `SELECT id, after FROM audit.log_archive
          WHERE table_name = 'gate45_probe' AND org_id = $1`,
        [testOrgId],
      ),
    );
    expect(coldAudit).toHaveLength(1);
    expect(coldAudit[0]!.id).toBe(oldAuditId);
    expect(coldAudit[0]!.after.marker).toBe("old");

    // ── Assert: stock_ledger hot row is gone, archive has it ──
    const { rows: hotLedger } = await withOrg(pool, DEV_ORG_ID, (c) =>
      c.query<{ id: string; ref_doc_id: string }>(
        `SELECT id, ref_doc_id FROM stock_ledger
          WHERE ref_doc_type = 'GATE45_PROBE'
            AND ref_doc_id IN ($1, $2)
          ORDER BY posted_at DESC`,
        [oldLedgerRefId, freshLedgerRefId],
      ),
    );
    // Only fresh survives in hot.
    expect(hotLedger).toHaveLength(1);
    expect(hotLedger[0]!.id).toBe(freshLedgerId);

    const { rows: coldLedger } = await withOrg(pool, DEV_ORG_ID, (c) =>
      c.query<{ id: string; ref_doc_id: string }>(
        `SELECT id, ref_doc_id FROM stock_ledger_archive
          WHERE ref_doc_type = 'GATE45_PROBE'
            AND ref_doc_id = $1`,
        [oldLedgerRefId],
      ),
    );
    expect(coldLedger).toHaveLength(1);
    expect(coldLedger[0]!.id).toBe(oldLedgerId);

    // ── Assert: archive_runs logged a COMPLETED run covering our rows ──
    // audit.archive_runs has no tenant column; read directly.
    const { rows: runs } = await pool.query<{
      status: string;
      audit_rows_moved: string;
      ledger_rows_moved: string;
      error: string | null;
    }>(
      `SELECT status,
              audit_rows_moved::text  AS audit_rows_moved,
              ledger_rows_moved::text AS ledger_rows_moved,
              error
         FROM audit.archive_runs
        ORDER BY started_at DESC
        LIMIT 1`,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("COMPLETED");
    expect(runs[0]!.error).toBeNull();
    // The sweep is cluster-wide, so other tenants' old rows (if any) are
    // also archived. Our only hard guarantee: at LEAST our 2 rows moved.
    expect(Number(runs[0]!.audit_rows_moved)).toBeGreaterThanOrEqual(1);
    expect(Number(runs[0]!.ledger_rows_moved)).toBeGreaterThanOrEqual(1);

    // ── Cleanup: remove the rows we fabricated so re-runs are clean ──
    await withOrg(pool, testOrgId, (c) =>
      c.query(
        `DELETE FROM audit.log_archive WHERE org_id = $1`,
        [testOrgId],
      ),
    );
    // Hot audit.log uses RLS — instigenie_app lacks DELETE grant on audit.log,
    // so we leave the fresh row in place (orphan row with an unused
    // random org_id causes no harm; future archive sweeps eventually
    // clean it up after 90d).
    await withOrg(pool, DEV_ORG_ID, (c) =>
      c.query(
        `DELETE FROM stock_ledger_archive WHERE ref_doc_type = 'GATE45_PROBE'`,
      ),
    );
    await withOrg(pool, DEV_ORG_ID, (c) =>
      c.query(
        `DELETE FROM stock_ledger WHERE ref_doc_type = 'GATE45_PROBE'`,
      ),
    );
  }, 30_000);
});

// ─── Gate 45.3 — Watchdog is a no-op when recent COMPLETED exists ───────

describe("Gate 45.3 — phase4_watchdog_hashchain: healthy path", () => {
  test("does NOT insert a synthetic FAILED row when last COMPLETED is < 26h old", async () => {
    // Seed a fresh COMPLETED run so MAX(completed_at) > now() - 26h.
    const freshRunId = randomUUID();
    await pool.query(
      `INSERT INTO qc_cert_chain_audit_runs
         (id, trigger, status, started_at, completed_at,
          orgs_total, orgs_ok, orgs_broken, breaks)
       VALUES ($1, 'SCHEDULED', 'COMPLETED',
               now() - interval '5 minutes', now() - interval '4 minutes',
               0, 0, 0, '[]'::jsonb)`,
      [freshRunId],
    );

    try {
      const before = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM qc_cert_chain_audit_runs`,
      );
      await pool.query(`SELECT public.phase4_watchdog_hashchain()`);
      const after = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM qc_cert_chain_audit_runs`,
      );
      // Same row count — watchdog saw a recent COMPLETED row and bailed.
      expect(after.rows[0]!.c).toBe(before.rows[0]!.c);

      // The freshRunId is still there and unchanged.
      const { rows } = await pool.query<{ status: string }>(
        `SELECT status FROM qc_cert_chain_audit_runs WHERE id = $1`,
        [freshRunId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("COMPLETED");
    } finally {
      await pool.query(
        `DELETE FROM qc_cert_chain_audit_runs WHERE id = $1`,
        [freshRunId],
      );
    }
  });
});

// ─── Gate 45.4 — Watchdog fires when last COMPLETED is stale ────────────

describe("Gate 45.4 — phase4_watchdog_hashchain: stale scheduler", () => {
  test("inserts a synthetic FAILED row when last COMPLETED is > 26h old", async () => {
    // Make every existing COMPLETED row look stale so watchdog's
    // MAX(completed_at) > now() - 26h check fails. Save originals so we
    // can restore after the test — cooperatively does not harm Gate 40
    // (which inserts fresh rows each run).
    const snapshot = await pool.query<{ id: string; completed_at: string }>(
      `SELECT id, completed_at::text AS completed_at
         FROM qc_cert_chain_audit_runs
        WHERE status = 'COMPLETED'`,
    );
    await pool.query(
      `UPDATE qc_cert_chain_audit_runs
          SET completed_at = now() - interval '30 hours'
        WHERE status = 'COMPLETED'`,
    );

    try {
      const before = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM qc_cert_chain_audit_runs
          WHERE status = 'FAILED'
            AND error LIKE 'pg_cron watchdog%'`,
      );
      await pool.query(`SELECT public.phase4_watchdog_hashchain()`);
      const after = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM qc_cert_chain_audit_runs
          WHERE status = 'FAILED'
            AND error LIKE 'pg_cron watchdog%'`,
      );
      // Exactly one new watchdog row appeared.
      expect(Number(after.rows[0]!.c)).toBe(
        Number(before.rows[0]!.c) + 1,
      );

      // Inspect the newest watchdog row — trigger + breaks payload shape.
      const { rows: watchdog } = await pool.query<{
        trigger: string;
        status: string;
        orgs_broken: number;
        error: string;
        breaks: Array<{ certNumber: string }>;
      }>(
        `SELECT trigger, status, orgs_broken, error, breaks
           FROM qc_cert_chain_audit_runs
          WHERE status = 'FAILED'
            AND error LIKE 'pg_cron watchdog%'
          ORDER BY started_at DESC
          LIMIT 1`,
      );
      expect(watchdog).toHaveLength(1);
      expect(watchdog[0]!.trigger).toBe("SCHEDULED");
      expect(watchdog[0]!.orgs_broken).toBe(1);
      expect(watchdog[0]!.error).toMatch(/26h/);
      expect(watchdog[0]!.breaks).toHaveLength(1);
      expect(watchdog[0]!.breaks[0]!.certNumber).toMatch(/watchdog/);
    } finally {
      // Restore completed_at on every row we back-dated so Gate 40's next
      // run doesn't fire the watchdog again.
      for (const row of snapshot.rows) {
        await pool.query(
          `UPDATE qc_cert_chain_audit_runs
              SET completed_at = $2::timestamptz
            WHERE id = $1`,
          [row.id, row.completed_at],
        );
      }
      // Delete any watchdog rows we created in this test so the table
      // returns to its pre-test cardinality.
      await pool.query(
        `DELETE FROM qc_cert_chain_audit_runs
          WHERE status = 'FAILED'
            AND error LIKE 'pg_cron watchdog%'
            AND started_at > now() - interval '5 minutes'`,
      );
    }
  }, 30_000);
});

