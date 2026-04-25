/**
 * Forward-migration runner for ops/sql/migrations/.
 *
 * Algorithm
 * ─────────
 *   1. Acquire pg_advisory_lock(<stable hash>) so two concurrent runners
 *      cannot trample each other (e.g. CI + a manual operator).
 *   2. CREATE TABLE IF NOT EXISTS schema_migrations — works on databases
 *      that never went through the docker-entrypoint bootstrap.
 *   3. List ops/sql/migrations/*.sql, sort lex. Sha-256 each file body.
 *   4. SELECT every row from schema_migrations.
 *   5. For each on-disk file:
 *        - applied + checksum matches              → skip.
 *        - applied + checksum differs              → DRIFT, abort.
 *        - not applied + version < max applied     → OUT-OF-ORDER, abort.
 *        - not applied                             → BEGIN; execute;
 *                                                    INSERT ledger row;
 *                                                    COMMIT.
 *   6. Verify no orphan ledger rows (rows whose version no longer exists
 *      on disk). Orphans are aborted in `up`/`status` because they
 *      indicate someone deleted a migration after it was applied — that
 *      breaks reproducibility.
 *   7. Release advisory lock (or let it auto-release on session close).
 *
 * Transaction model
 * ─────────────────
 *   Each migration runs in its OWN transaction. We do not wrap the whole
 *   batch — partial application is preferable to all-or-nothing if a
 *   late migration fails: every preceding migration is durably recorded
 *   so retrying picks up at the failed file. Statements that cannot run
 *   inside a transaction (CREATE INDEX CONCURRENTLY, ALTER TYPE … ADD
 *   VALUE) must live in their own dedicated migration and the author
 *   must be aware that BEGIN/COMMIT will reject them; we do not silently
 *   strip the transaction wrapper.
 *
 * Privileges
 * ──────────
 *   Migrations need DDL grants. The runtime app role `instigenie_app`
 *   is NOBYPASSRLS and lacks DDL — pass MIGRATIONS_DATABASE_URL or
 *   DATABASE_URL pointing at the cluster owner / migration role.
 *
 * Output
 * ──────
 *   The runner prints structured plain-text events (one line per state
 *   change) suitable for CI logs. No third-party log libraries — pg is
 *   the only runtime dep here, deliberately.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import pg from "pg";

const { Client } = pg;

// ── Public types ───────────────────────────────────────────────────────────

export interface RunnerOptions {
  /** Postgres connection string. */
  databaseUrl: string;
  /** Absolute path to ops/sql/migrations/. */
  migrationsDir: string;
  /** Optional logger; defaults to console.log. */
  log?: (line: string) => void;
}

export interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
  applied_by: string;
}

export interface OnDiskMigration {
  version: string;
  name: string;
  filename: string;
  body: string;
  checksum: string;
}

export type StatusEntry =
  | { state: "applied"; version: string; name: string; appliedAt: Date }
  | { state: "pending"; version: string; name: string }
  | { state: "drift"; version: string; name: string; recorded: string; current: string }
  | { state: "orphan"; version: string; name: string; appliedAt: Date };

export interface StatusReport {
  applied: number;
  pending: number;
  drift: number;
  orphan: number;
  entries: StatusEntry[];
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

// Stable 31-bit advisory-lock key derived from a fixed namespace string.
// pg_advisory_lock(bigint) — we collapse the SHA-256 hex digest into a
// single int and pass it. The choice of bytes is arbitrary as long as
// it is stable across processes.
const ADVISORY_LOCK_KEY = (() => {
  const digest = createHash("sha256").update("instigenie_migrations").digest();
  // Top 4 bytes → unsigned 32-bit, then OR into a JS number range.
  // pg_advisory_lock accepts bigint; we send int4 + int4 form to stay safe.
  const hi = digest.readInt32BE(0);
  const lo = digest.readInt32BE(4);
  return { hi, lo };
})();

const VERSION_RE = /^(\d{4})_([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$/;

const ENSURE_LEDGER_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text PRIMARY KEY,
    name        text NOT NULL,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    applied_by  text NOT NULL DEFAULT current_user
  );
`;

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function nameFromVersion(versionWithDescription: string): string {
  // "0001_add_outbox_dlq" → "add outbox dlq"
  const idx = versionWithDescription.indexOf("_");
  if (idx === -1) return versionWithDescription;
  return versionWithDescription.slice(idx + 1).replace(/_/g, " ");
}

async function listOnDisk(dir: string): Promise<OnDiskMigration[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MigrationError(
        `migrations directory not found: ${dir} — create ops/sql/migrations/ before running`,
      );
    }
    throw err;
  }
  const sql = entries.filter((f) => f.endsWith(".sql")).sort();
  const out: OnDiskMigration[] = [];
  for (const filename of sql) {
    const m = VERSION_RE.exec(filename);
    if (!m) {
      throw new MigrationError(
        `migration filename does not match NNNN_<description>.sql: ${filename}`,
      );
    }
    const versionStem = filename.slice(0, -4); // strip .sql
    const fullPath = path.join(dir, filename);
    const body = await fs.readFile(fullPath, "utf8");
    out.push({
      version: versionStem,
      name: nameFromVersion(versionStem),
      filename,
      body,
      checksum: sha256Hex(body),
    });
  }
  return out;
}

async function loadApplied(client: pg.Client): Promise<Map<string, AppliedRow>> {
  const { rows } = await client.query<AppliedRow>(
    `SELECT version, name, checksum, applied_at, applied_by
       FROM schema_migrations
       ORDER BY version ASC`,
  );
  const map = new Map<string, AppliedRow>();
  for (const r of rows) map.set(r.version, r);
  return map;
}

async function withAdvisoryLock<T>(
  client: pg.Client,
  fn: () => Promise<T>,
): Promise<T> {
  const { hi, lo } = ADVISORY_LOCK_KEY;
  // pg_try_advisory_lock(hi, lo) — non-blocking, returns boolean.
  const { rows } = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1, $2) AS locked`,
    [hi, lo],
  );
  if (!rows[0]?.locked) {
    throw new MigrationError(
      "another migration run is in progress (pg_advisory_lock held). Retry once it completes.",
    );
  }
  try {
    return await fn();
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1, $2)`, [hi, lo]);
  }
}

interface PlanEntry {
  migration: OnDiskMigration;
  state: "applied" | "pending" | "drift";
  recorded?: AppliedRow;
}

function buildPlan(
  onDisk: OnDiskMigration[],
  applied: Map<string, AppliedRow>,
): { entries: PlanEntry[]; orphans: AppliedRow[] } {
  const seen = new Set<string>();
  const entries: PlanEntry[] = onDisk.map((mig) => {
    seen.add(mig.version);
    const a = applied.get(mig.version);
    if (!a) return { migration: mig, state: "pending" as const };
    if (a.checksum !== mig.checksum) {
      return { migration: mig, state: "drift" as const, recorded: a };
    }
    return { migration: mig, state: "applied" as const, recorded: a };
  });
  const orphans = [...applied.values()].filter((a) => !seen.has(a.version));
  return { entries, orphans };
}

function assertOrder(plan: PlanEntry[]): void {
  // Once we encounter a pending, all later entries must also be pending or
  // drift — never applied. Otherwise there is a "hole" (someone applied
  // 0003 without applying 0002), which compromises reproducibility.
  let sawPending = false;
  for (const e of plan) {
    if (e.state === "pending") {
      sawPending = true;
    } else if (e.state === "applied" && sawPending) {
      throw new MigrationError(
        `out-of-order ledger: ${e.migration.version} is applied but an earlier migration is still pending. Resolve before running again.`,
      );
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function status(opts: RunnerOptions): Promise<StatusReport> {
  const log = opts.log ?? ((line) => console.log(line));
  const client = new Client({ connectionString: opts.databaseUrl });
  await client.connect();
  try {
    await client.query(ENSURE_LEDGER_SQL);
    const onDisk = await listOnDisk(opts.migrationsDir);
    const applied = await loadApplied(client);
    const { entries, orphans } = buildPlan(onDisk, applied);

    const out: StatusEntry[] = [];
    let countApplied = 0;
    let countPending = 0;
    let countDrift = 0;

    for (const e of entries) {
      if (e.state === "applied" && e.recorded) {
        out.push({
          state: "applied",
          version: e.migration.version,
          name: e.migration.name,
          appliedAt: e.recorded.applied_at,
        });
        countApplied++;
      } else if (e.state === "drift" && e.recorded) {
        out.push({
          state: "drift",
          version: e.migration.version,
          name: e.migration.name,
          recorded: e.recorded.checksum,
          current: e.migration.checksum,
        });
        countDrift++;
      } else {
        out.push({
          state: "pending",
          version: e.migration.version,
          name: e.migration.name,
        });
        countPending++;
      }
    }
    for (const o of orphans) {
      out.push({
        state: "orphan",
        version: o.version,
        name: o.name,
        appliedAt: o.applied_at,
      });
    }

    log(
      `[migrate] status: ${countApplied} applied, ${countPending} pending, ${countDrift} drift, ${orphans.length} orphan`,
    );
    for (const e of out) {
      switch (e.state) {
        case "applied":
          log(`  ✓ ${e.version}  (${e.name})  applied=${e.appliedAt.toISOString()}`);
          break;
        case "pending":
          log(`  · ${e.version}  (${e.name})  PENDING`);
          break;
        case "drift":
          log(
            `  ! ${e.version}  (${e.name})  DRIFT  recorded=${e.recorded.slice(0, 12)}…  current=${e.current.slice(0, 12)}…`,
          );
          break;
        case "orphan":
          log(
            `  ? ${e.version}  (${e.name})  ORPHAN — ledger row exists but file is missing on disk`,
          );
          break;
      }
    }

    return {
      applied: countApplied,
      pending: countPending,
      drift: countDrift,
      orphan: orphans.length,
      entries: out,
    };
  } finally {
    await client.end();
  }
}

export interface UpResult {
  applied: { version: string; name: string }[];
  skipped: { version: string; name: string }[];
}

export async function up(opts: RunnerOptions): Promise<UpResult> {
  const log = opts.log ?? ((line) => console.log(line));
  const client = new Client({ connectionString: opts.databaseUrl });
  await client.connect();
  try {
    await client.query(ENSURE_LEDGER_SQL);

    return await withAdvisoryLock(client, async () => {
      const onDisk = await listOnDisk(opts.migrationsDir);
      const applied = await loadApplied(client);
      const { entries, orphans } = buildPlan(onDisk, applied);

      // Hard-fail conditions BEFORE we mutate anything.
      const drifted = entries.filter((e) => e.state === "drift");
      if (drifted.length > 0) {
        const list = drifted.map((d) => `  - ${d.migration.version} (${d.migration.name})`).join("\n");
        throw new MigrationError(
          `drift detected — ${drifted.length} migration(s) have changed since apply:\n${list}\n` +
            `Migrations are immutable. Add a new file to fix the schema instead of editing existing ones.`,
        );
      }
      if (orphans.length > 0) {
        const list = orphans.map((o) => `  - ${o.version} (${o.name})`).join("\n");
        throw new MigrationError(
          `orphan ledger rows — ${orphans.length} version(s) recorded as applied but missing on disk:\n${list}\n` +
            `Restore the file or open a fix-forward migration that explicitly cleans up.`,
        );
      }
      assertOrder(entries);

      const skipped: { version: string; name: string }[] = [];
      const ran: { version: string; name: string }[] = [];

      for (const e of entries) {
        if (e.state === "applied") {
          skipped.push({ version: e.migration.version, name: e.migration.name });
          continue;
        }
        // pending — execute inside its own transaction.
        log(`[migrate] applying ${e.migration.version}  (${e.migration.name})`);
        try {
          await client.query("BEGIN");
          await client.query(e.migration.body);
          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum)
             VALUES ($1, $2, $3)`,
            [e.migration.version, e.migration.name, e.migration.checksum],
          );
          await client.query("COMMIT");
          ran.push({ version: e.migration.version, name: e.migration.name });
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {
            /* swallow rollback errors — the original is the real signal */
          });
          throw new MigrationError(
            `failed to apply ${e.migration.version} (${e.migration.name}): ${(err as Error).message}`,
          );
        }
      }

      log(
        `[migrate] up: applied ${ran.length}, skipped ${skipped.length} already-current`,
      );
      return { applied: ran, skipped };
    });
  } finally {
    await client.end();
  }
}
