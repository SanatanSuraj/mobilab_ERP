/**
 * Gate 60 — Ledger & audit append-only at the service contract layer.
 *
 * TESTING_PLAN.md §3.25 / §6 priority gap:
 *   "No UPDATE or DELETE on Ledger/Audit rows after posted ... explicit
 *    gate missing"
 *
 * ARCHITECTURE.md §9.5 and the repeated `append-only` comments in
 *   ops/sql/init/03-inventory.sql:139
 *   ops/sql/init/07-finance.sql:240
 *   ops/sql/init/07-finance.sql:279
 *   ops/sql/init/01-schemas.sql:5    (audit schema)
 * document the invariant but do NOT enforce it at the DB level:
 *   • RLS only scopes by org_id (ops/sql/rls/04-inventory-rls.sql,
 *     ops/sql/rls/08-finance-rls.sql).
 *   • There is no BEFORE UPDATE/DELETE trigger that RAISE's on these
 *     tables (audit.tg_log is AFTER-only; it records the mutation, it
 *     does not prevent it).
 *   • instigenie_app STILL carries UPDATE and DELETE grants on the
 *     ledger tables (verified against pg_catalog), because the gate
 *     suites themselves DELETE ledger rows in teardown.
 *
 * So the only real defense is the service layer — repositories/services
 * in `apps/api/src/modules/**` must never issue UPDATE or DELETE against
 * the append-only tables. That is what this gate pins.
 *
 * Scope
 * -----
 *   - Scans every .ts / .sql source file under apps/ and packages/
 *     (excluding dist, node_modules, .next, .turbo, coverage). The
 *     tests/ tree is out-of-scope on purpose — gate teardowns are
 *     allowed to DELETE from ledger tables.
 *   - Flags any `UPDATE <table>` or `DELETE FROM <table>` SQL fragment
 *     referencing the append-only tables.
 *
 * Tables guarded
 *   • public.stock_ledger      — inventory: every stock movement.
 *   • public.stock_ledger_archive — Phase 4 pg_cron hot/cold split; archived
 *     rows are even MORE append-only than live ledger.
 *   • public.customer_ledger   — finance: AR open item.
 *   • public.vendor_ledger     — finance: AP open item.
 *   • audit.audit_log          — trigger-written forensic log.
 *
 * Allowed
 *   • INSERT, SELECT, COPY TO (read-only).
 *   • UPDATE/DELETE inside this tests/ tree are fine — they're teardown,
 *     not runtime.
 *
 * If this gate fails
 *   A service-layer code path has been added that mutates an append-only
 *   row after it was posted. That violates ARCHITECTURE.md §9.5 even if
 *   a linked-list compensating entry would have been the correct fix.
 *   Either:
 *     (a) rewrite the change to INSERT a compensating entry, or
 *     (b) if the mutation is genuinely required (e.g. a one-shot
 *         migration back-fill), gate it on a migration file under
 *         ops/sql/init/ — not a runtime module.
 */

import { describe, it, expect } from "vitest";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, relative, sep } from "node:path";

// ──────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────

/** Repo root, resolved from this file's location. */
const REPO_ROOT = resolve(__dirname, "..", "..");

/** Source trees we scan. Anything outside these is ignored. */
const SOURCE_TREES = ["apps", "packages"] as const;

/** Directories to skip inside a source tree. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "out",
]);

/** File extensions we scan (covers service code and inline raw SQL). */
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql"] as const;

/**
 * Tables whose rows must never be mutated from service code.
 * Key: canonical table name (with schema when it is NOT `public`).
 * Value: the regex used to spot its mutation SQL. We look for
 *        `UPDATE <name>` or `DELETE FROM <name>` at word boundaries,
 *        case-insensitive, tolerating the optional `public.` prefix for
 *        the default-schema tables.
 */
const GUARDED_TABLES: ReadonlyArray<{ name: string; patterns: RegExp[] }> = [
  {
    name: "public.stock_ledger",
    patterns: [
      /\bUPDATE\s+(?:public\.)?stock_ledger\b/i,
      /\bDELETE\s+FROM\s+(?:public\.)?stock_ledger\b/i,
    ],
  },
  {
    name: "public.stock_ledger_archive",
    patterns: [
      /\bUPDATE\s+(?:public\.)?stock_ledger_archive\b/i,
      /\bDELETE\s+FROM\s+(?:public\.)?stock_ledger_archive\b/i,
    ],
  },
  {
    name: "public.customer_ledger",
    patterns: [
      /\bUPDATE\s+(?:public\.)?customer_ledger\b/i,
      /\bDELETE\s+FROM\s+(?:public\.)?customer_ledger\b/i,
    ],
  },
  {
    name: "public.vendor_ledger",
    patterns: [
      /\bUPDATE\s+(?:public\.)?vendor_ledger\b/i,
      /\bDELETE\s+FROM\s+(?:public\.)?vendor_ledger\b/i,
    ],
  },
  {
    name: "audit.audit_log",
    patterns: [
      /\bUPDATE\s+audit\.audit_log\b/i,
      /\bDELETE\s+FROM\s+audit\.audit_log\b/i,
    ],
  },
];

/**
 * Source files that ARE allowed to contain the trigger creation DDL
 * (which naturally names the guarded tables but issues no UPDATE/DELETE).
 * We don't actually need an allowlist because the DDL text is
 * `AFTER INSERT OR UPDATE OR DELETE ON <table>` — it doesn't match
 * `UPDATE <table>` at a word boundary. But we keep this allowlist
 * around for forward-compatible exceptions (e.g. a one-off backfill
 * migration).
 */
const ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Reserved for future opt-outs; must be a repo-root-relative path with
  // forward-slash separators, e.g. "ops/sql/init/99-one-off-backfill.sql".
]);

// ──────────────────────────────────────────────────────────────────────
// Walker
// ──────────────────────────────────────────────────────────────────────

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function toRepoRel(abs: string): string {
  return relative(REPO_ROOT, abs).split(sep).join("/");
}

// ──────────────────────────────────────────────────────────────────────
// Scan
// ──────────────────────────────────────────────────────────────────────

interface Violation {
  file: string;          // repo-root-relative, forward-slash form
  table: string;         // canonical guarded-table name
  line: number;          // 1-based
  snippet: string;       // the offending line, trimmed
}

async function scanAll(): Promise<Violation[]> {
  const hits: Violation[] = [];
  for (const tree of SOURCE_TREES) {
    const root = resolve(REPO_ROOT, tree);
    if (!(await isDir(root))) continue;
    for await (const file of walk(root)) {
      const ext = EXTENSIONS.find((e) => file.endsWith(e));
      if (!ext) continue;
      const rel = toRepoRel(file);
      if (ALLOWLIST.has(rel)) continue;

      const text = await readFile(file, "utf8");
      const lines = text.split(/\r?\n/);
      for (const guarded of GUARDED_TABLES) {
        for (const pattern of guarded.patterns) {
          if (!pattern.test(text)) continue;
          // Only pay the per-line walk when we know there's at least
          // one match in the whole file.
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i]!)) {
              hits.push({
                file: rel,
                table: guarded.name,
                line: i + 1,
                snippet: lines[i]!.trim().slice(0, 200),
              });
            }
          }
        }
      }
    }
  }
  return hits;
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

describe("gate-60: ledger + audit append-only at the service layer", () => {
  // Single scan shared by both tests — scanning ~1k files is already fast
  // (<300ms on a warm cache) but there's no reason to do it twice.
  let allViolations: Violation[] = [];

  it("scans all source files (sanity — the walker must actually walk something)", async () => {
    // If SOURCE_TREES or REPO_ROOT drifts, the scan will silently pass
    // with zero violations for the wrong reason. Assert we touched a
    // realistic number of files before trusting a green result.
    let fileCount = 0;
    for (const tree of SOURCE_TREES) {
      const root = resolve(REPO_ROOT, tree);
      if (!(await isDir(root))) continue;
      for await (const _f of walk(root)) {
        void _f;
        fileCount++;
      }
    }
    // apps/ + packages/ have hundreds of .ts/.sql files; 100 is a floor.
    expect(fileCount).toBeGreaterThan(100);
    // Run the real scan ONCE, reuse in the next test.
    allViolations = await scanAll();
  });

  it("no service/library source issues UPDATE or DELETE against an append-only ledger", () => {
    if (allViolations.length === 0) return;
    // Build a readable summary — first 20 violations so the failure
    // message doesn't explode the terminal.
    const lines = allViolations
      .slice(0, 20)
      .map(
        (v) =>
          `  ${v.file}:${v.line}  (${v.table})\n    ${v.snippet}`,
      );
    const more =
      allViolations.length > 20
        ? `\n  ... and ${allViolations.length - 20} more`
        : "";
    throw new Error(
      `Gate 60 FAIL — ${allViolations.length} forbidden mutation(s) found against append-only tables:\n${lines.join(
        "\n",
      )}${more}\n\nAppend-only tables may only be INSERTed to, never UPDATEd or DELETEd, from service code.`,
    );
  });
});
