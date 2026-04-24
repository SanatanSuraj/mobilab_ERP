/**
 * Static lint: no Number() or parseFloat() allowed on money columns.
 *
 * Money in this codebase is NUMERIC(18, 4) (or 18, 2 in a few older CRM
 * tables) on the DB side and `@instigenie/money` Decimal strings on the
 * wire and in the handlers. The one way to turn a money Decimal into a
 * JS number is `Number(value)` or `parseFloat(value)` — and that silently
 * loses precision above 2⁵³ paise and introduces float drift on values
 * like 0.1 + 0.2. Gate 71 already proves the invariants hold under
 * property testing; THIS gate prevents the coercion from being
 * reintroduced by a well-meaning refactor.
 *
 * Shape of the check:
 *
 *   1. Enumerate money-bearing column identifiers from the Drizzle
 *      schema — both the DB snake_case name and the JS camelCase key.
 *      A column is "money" if it's `PgNumeric` with scale 2 or 4 AND
 *      its name is not a percent/rate/quantity (those are unitless
 *      numerics that can be `Number()`-ed safely).
 *
 *   2. Walk the production source trees (apps/api/src, apps/worker/src,
 *      packages/... /src) for .ts / .tsx files. Skip tests, dist, and
 *      declaration files.
 *
 *   3. For every line, match /\b(Number|parseFloat)\s*\(/ and peek ahead
 *      in the line: if the argument contains `.{moneyId}\b`, it's a
 *      violation. Bare variables (Number(amount)) are NOT flagged —
 *      too many false positives on `amount` and `balance` — but every
 *      hit on a dotted money field path is flagged.
 *
 *   4. An allowlist of {file, line, fragment, reason} triples can opt
 *      out individual call sites (none today). The test ALSO fails if
 *      an allowlist entry no longer matches — drift-detecting rot —
 *      so stale exemptions can't outlive the line they were defending.
 *
 *   5. A negative control plants a synthetic violation in a string and
 *      asserts the scanner flags it. If the regex is weakened in the
 *      future, this test breaks loudly.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, isTable } from "drizzle-orm";
import * as schema from "@instigenie/db/schema";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../..");

// Directories the lint walks. Production TS only — test code is allowed
// to Number() money for expectation assertions in controlled cases.
const SCAN_ROOTS = [
  "apps/api/src",
  "apps/worker/src",
  "packages",
];

// Inside packages/, only look at src/. Everything under dist/ or .next/
// etc. is generated, tests are out of scope, .d.ts files are declarations.
const PATH_EXCLUDE = [
  /[\\/]node_modules[\\/]/,
  /[\\/]dist[\\/]/,
  /[\\/]build[\\/]/,
  /[\\/]\.next[\\/]/,
  /[\\/]__tests__[\\/]/,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\.d\.ts$/,
];

// Column-name substrings that mean "this numeric is NOT money" — percents,
// tax rates, and physical quantities don't carry precision-sensitive
// monetary value and can be Number()-coerced without harm.
const NON_MONEY_NAME = /(^|_)(pct|percent|rate|qty|quantity)($|_)/i;

function isMoneyColumn(col: {
  columnType?: string;
  scale?: number;
  name?: string;
}): boolean {
  if (col.columnType !== "PgNumeric") return false;
  if (col.scale !== 2 && col.scale !== 4) return false;
  if (!col.name) return false;
  if (NON_MONEY_NAME.test(col.name)) return false;
  return true;
}

/**
 * Finance tables (sales_invoices, purchase_invoices, payments,
 * customer_ledger, vendor_ledger, and their line items) live only in
 * SQL migrations today — they haven't been migrated into the Drizzle
 * schema barrel (packages/db/src/schema/). Until they are, supplement
 * the auto-derived set with their money column identifiers so the scan
 * doesn't miss them. Both snake_case and camelCase forms listed.
 */
const FINANCE_MONEY_COLS = [
  // Invoice headers (sales_invoices, purchase_invoices)
  "subtotal",
  "tax_total",
  "taxTotal",
  "discount_total",
  "discountTotal",
  "grand_total",
  "grandTotal",
  "amount_paid",
  "amountPaid",
  // Invoice line items
  "line_subtotal",
  "lineSubtotal",
  "line_tax",
  "lineTax",
  "line_total",
  "lineTotal",
  "unit_price",
  "unitPrice",
  "tax_amount",
  "taxAmount",
  // Payments
  "amount",
  // Ledgers
  "debit",
  "credit",
  "running_balance",
  "runningBalance",
];

/**
 * Collect money identifiers from every Drizzle table. Returns both the
 * DB column name (`grand_total`) and its JS access key (`grandTotal`)
 * so the regex catches either `row.grand_total` or `row.grandTotal`.
 * Unioned with FINANCE_MONEY_COLS and de-duped.
 */
function collectMoneyIdentifiers(): string[] {
  const ids = new Set<string>(FINANCE_MONEY_COLS);
  for (const [, maybe] of Object.entries(schema)) {
    if (!isTable(maybe)) continue;
    const cols = getTableColumns(maybe);
    for (const [jsKey, col] of Object.entries(cols)) {
      const c = col as {
        columnType?: string;
        scale?: number;
        name?: string;
      };
      if (!isMoneyColumn(c)) continue;
      ids.add(jsKey);
      if (c.name) ids.add(c.name);
    }
  }
  return Array.from(ids).sort();
}

function listTypescriptFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir);
    } catch {
      // Directory missing (e.g. apps/worker/src before it's built out):
      // silently skip — the roots array is forward-looking.
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (PATH_EXCLUDE.some((r) => r.test(full))) continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!/\.tsx?$/.test(name)) continue;
      out.push(full);
    }
  };
  for (const root of SCAN_ROOTS) {
    walk(resolve(REPO_ROOT, root));
  }
  return out;
}

interface Violation {
  file: string; // repo-relative
  line: number;
  fn: "Number" | "parseFloat";
  moneyId: string;
  text: string;
}

interface AllowlistEntry {
  /** Repo-relative path */
  file: string;
  /** 1-based line number */
  line: number;
  /** Literal substring of that line — forces drift detection if the line is renumbered/edited */
  fragment: string;
  /** Human reason — required, must not be empty */
  reason: string;
}

// No legitimate money-coercion exists in production code today.
// If one shows up, add it here with a reason explaining why it's safe.
const ALLOWLIST: AllowlistEntry[] = [];

/**
 * Scan a single file's text for money-coercion violations. Returns one
 * entry per match. The regex is deliberately greedy within a single line:
 * we look for `(Number|parseFloat)(` and then check the ~200 chars after
 * the opening paren for `.moneyId\b`. Multi-line call sites are rare in
 * practice and the one-line heuristic keeps the scanner fast & simple.
 */
function scanFile(
  relPath: string,
  text: string,
  moneyIdRe: RegExp
): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split(/\r?\n/);
  const callRe = /\b(Number|parseFloat)\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    callRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(line)) !== null) {
      // Window starts right after the opening paren; bounded so we don't
      // walk into a sibling call on the same line.
      const after = line.slice(m.index + m[0].length, m.index + m[0].length + 200);
      const hit = moneyIdRe.exec(after);
      if (!hit) continue;
      violations.push({
        file: relPath,
        line: i + 1,
        fn: m[1] as "Number" | "parseFloat",
        moneyId: hit[1]!,
        text: line.trim(),
      });
    }
  }
  return violations;
}

describe("finance-money-lint: no Number() / parseFloat() on money columns", () => {
  const moneyIds = collectMoneyIdentifiers();

  // Regex matches `.<moneyId>` where <moneyId> is a whole-word access.
  // Escape special chars just in case a column ever has them (shouldn't,
  // but Drizzle names are user-defined so we play safe).
  const escaped = moneyIds.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const moneyIdRe = new RegExp(`\\.(${escaped.join("|")})\\b`);

  it("discovered a non-trivial set of money columns", () => {
    // Sanity: if the Drizzle filter broke and we're checking against an
    // empty allowlist of identifiers, the main test below would pass
    // vacuously. Guard against that.
    expect(moneyIds.length).toBeGreaterThan(20);
    // Spot-check a few columns we know exist.
    for (const id of ["grand_total", "grandTotal", "debit", "credit", "amount"]) {
      expect(moneyIds, `missing money column: ${id}`).toContain(id);
    }
  });

  it("no production file coerces a money column via Number() or parseFloat()", () => {
    const files = listTypescriptFiles();
    // The scan touches ~1000 files but each is a small regex pass —
    // should complete in well under a second.
    expect(files.length).toBeGreaterThan(50);

    const allViolations: Violation[] = [];
    for (const abs of files) {
      const rel = relative(REPO_ROOT, abs);
      let text: string;
      try {
        text = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const hits = scanFile(rel, text, moneyIdRe);
      if (hits.length > 0) allViolations.push(...hits);
    }

    // Match each violation against the allowlist. A violation is
    // "suppressed" if a row (file, line, fragment) matches — fragment
    // must appear in the offending line exactly, which means a rename
    // or re-indent also re-opens the exemption.
    const suppressedKey = (v: { file: string; line: number }) =>
      `${v.file}:${v.line}`;
    const allowUsed = new Set<number>();
    const remaining: Violation[] = [];
    for (const v of allViolations) {
      const hit = ALLOWLIST.findIndex(
        (a, i) =>
          !allowUsed.has(i) &&
          a.file === v.file &&
          a.line === v.line &&
          v.text.includes(a.fragment)
      );
      if (hit === -1) remaining.push(v);
      else allowUsed.add(hit);
    }

    const unused = ALLOWLIST.filter((_, i) => !allowUsed.has(i));

    // Format the failure as a checklist so the dev sees exactly what to fix.
    const lines = remaining.map(
      (v) =>
        `  ${v.file}:${v.line}  ${v.fn}(...) on .${v.moneyId} — ${v.text}`
    );
    expect(
      remaining,
      [
        `Found ${remaining.length} money-coercion violation(s). ` +
          `Use \`m(value)\` or \`moneyFromPg(value)\` from @instigenie/money ` +
          `to preserve precision; Number()/parseFloat() drop precision above 2^53 ` +
          `paise and introduce float drift (0.1 + 0.2 = 0.30000000000000004).`,
        ...lines,
      ].join("\n")
    ).toEqual([]);

    // Allowlist rot: if an entry no longer matches, either the line was
    // already fixed (remove the exemption) or it was renumbered (update
    // it). Either way the allowlist shouldn't silently cover nothing.
    const unusedLines = unused.map(
      (a) => `  ${a.file}:${a.line}  "${a.fragment}" — reason: ${a.reason}`
    );
    expect(
      unused,
      `Stale allowlist entries (no matching violation):\n${unusedLines.join("\n")}`
    ).toEqual([]);
  });

  // Negative controls — prove the scanner catches the two canonical
  // coercion shapes. If someone weakens the regex or swaps money-id
  // discovery for something that returns an empty set, these break.

  it("scanner flags Number(row.grandTotal)", () => {
    const src = `const x = Number(row.grandTotal);\n`;
    const hits = scanFile("synthetic.ts", src, moneyIdRe);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fn).toBe("Number");
    expect(hits[0]!.moneyId).toBe("grandTotal");
  });

  it("scanner flags parseFloat(invoice.amount_paid)", () => {
    const src = `const x = parseFloat(invoice.amount_paid);\n`;
    const hits = scanFile("synthetic.ts", src, moneyIdRe);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fn).toBe("parseFloat");
    expect(hits[0]!.moneyId).toBe("amount_paid");
  });

  it("scanner does NOT flag Number(line.quantity) — quantity is not money", () => {
    const src = `const x = Number(line.quantity);\n`;
    const hits = scanFile("synthetic.ts", src, moneyIdRe);
    expect(hits).toHaveLength(0);
  });

  it("scanner does NOT flag Number(line.discountPct) — percents are not money", () => {
    const src = `const x = Number(line.discountPct);\n`;
    const hits = scanFile("synthetic.ts", src, moneyIdRe);
    expect(hits).toHaveLength(0);
  });

  it("scanner does NOT flag Number(countRes.total) — count aggregates have no .<moneyId>", () => {
    const src = `const x = Number(countRes.total);\n`;
    const hits = scanFile("synthetic.ts", src, moneyIdRe);
    expect(hits).toHaveLength(0);
  });
});
