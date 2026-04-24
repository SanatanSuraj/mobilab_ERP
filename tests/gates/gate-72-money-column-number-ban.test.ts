/**
 * Gate 72 — Static ban on `Number(...)` / `parseFloat(...)` touching money
 * columns in finance-critical code.
 *
 * ─── What this gate proves ──────────────────────────────────────────────
 *
 *   Every money value in this system is a NUMERIC(18,4) decimal string.
 *   Converting one to a JS number via `Number(x)` or `parseFloat(x)` loses
 *   the last digits of precision — and once a money value is a JS number,
 *   every subsequent arithmetic step is a property-test failure waiting to
 *   happen (see gate-71 invariant (c): no "10.00000000004" drift).
 *
 *   Gate 1 (gate-1-number-ban) enforces the contract at runtime by making
 *   `m(n)` throw when `n` is a `number`. But `m()` is only invoked when
 *   the author reached for it. This gate closes the loophole statically:
 *   it walks the finance modules + money packages and fails CI if any
 *   call site does `Number(x)` or `parseFloat(x)` where `x` references a
 *   money-typed identifier.
 *
 * ─── What counts as a violation ─────────────────────────────────────────
 *
 *   The scanner looks at lines of the form
 *
 *       Number( <expr> )          parseFloat( <expr> )
 *
 *   and flags the call site if <expr> contains ANY identifier whose name
 *   matches one of the canonical money field names in
 *   packages/contracts/src/finance.ts — `amount`, `amountPaid`, `balance`,
 *   `grandTotal`, `runningBalance`, `lineTax`, etc. See MONEY_IDENTIFIERS
 *   below for the full list (it mirrors the money-typed fields in the
 *   finance contract).
 *
 *   Known-safe patterns that do NOT fire:
 *     - `Number(countRes.rows[0]!.total)` — pagination row count; `total`
 *       is intentionally NOT in the money-ident list (it's too ambiguous
 *       and in finance contracts we spell money totals as `grandTotal`,
 *       `lineTotal`, `subtotal`, etc.).
 *     - `Number(si.draft)`, `Number(si.posted)`, `Number(pay.recorded)`
 *       in overview.service.ts — these are document counts (COUNT(*)
 *       aliases), not money.
 *     - Matches inside comments or string literals are stripped before
 *       scanning.
 *
 * ─── Scope ──────────────────────────────────────────────────────────────
 *
 *   - apps/api/src/modules/finance/**         (every .ts except tests)
 *   - packages/contracts/src/finance.ts       (zod schemas + types)
 *   - packages/money/src/**                   (the Money primitive itself)
 *
 *   Adding a new finance sub-module? Add the path to SCAN_ROOTS below.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// tests/gates/<file> → tests/gates → tests → repo root
const REPO_ROOT = resolve(__dirname, "..", "..");

// ─── Scan configuration ────────────────────────────────────────────────────

const SCAN_ROOTS = [
  "apps/api/src/modules/finance",
  "packages/contracts/src/finance.ts",
  "packages/money/src",
];

/**
 * Money-typed identifiers from packages/contracts/src/finance.ts (and the
 * SQL schema's snake_case equivalents). A hit on any of these INSIDE a
 * Number(...) or parseFloat(...) argument fails the gate.
 *
 * Deliberately excluded:
 *   - `total` — too ambiguous (pagination total vs money total); finance
 *     money totals are always compound (`grandTotal`, `lineTotal`, etc.).
 *   - `value` — too generic, collides with many DOM/enum usages.
 *   - `draft`, `posted`, `recorded` — these are the existing overview
 *     service COUNT aliases and must not be flagged.
 */
const MONEY_IDENTIFIERS = [
  // amount family
  "amount",
  "amountPaid",
  "amount_paid",
  "amountApplied",
  "amount_applied",
  "amountDue",
  "amount_due",
  "amountRefunded",
  "amount_refunded",
  // balance family
  "balance",
  "runningBalance",
  "running_balance",
  // debit/credit
  "debit",
  "credit",
  // payment state
  "paid",
  "due",
  // pricing
  "price",
  "unitPrice",
  "unit_price",
  // quantities (NUMERIC(18,3) — decimal strings, same rule)
  "quantity",
  "qty",
  // totals — only COMPOUND names; bare "total" is reserved for pagination
  "subtotal",
  "lineSubtotal",
  "line_subtotal",
  "grandTotal",
  "grand_total",
  "lineTotal",
  "line_total",
  // taxes
  "tax",
  "taxTotal",
  "tax_total",
  "lineTax",
  "line_tax",
  "taxRate",
  "tax_rate",
  "taxRatePercent",
  "tax_rate_percent",
  // discounts
  "discount",
  "discountTotal",
  "discount_total",
  "discountPercent",
  "discount_percent",
  // AR/AP aging
  "outstanding",
  "arOutstanding",
  "ar_outstanding",
  "apOutstanding",
  "ap_outstanding",
  "overdue30",
  "overdue60",
  "overdue90",
  "arOverdue30",
  "ar_overdue30",
  "arOverdue60",
  "ar_overdue60",
  "arOverdue90",
  "ar_overdue90",
  "apOverdue30",
  "ap_overdue30",
  "apOverdue60",
  "ap_overdue60",
  "apOverdue90",
  "ap_overdue90",
  // MTD / P&L
  "mtdRevenue",
  "mtd_revenue",
  "mtdExpenses",
  "mtd_expenses",
  "revenue",
  "expense",
  "expenses",
  // advances + refunds
  "advance",
  "advanceAmount",
  "advance_amount",
  "refund",
  "refunded",
  "refundAmount",
  "refund_amount",
  // net / gross
  "netAmount",
  "net_amount",
  "grossAmount",
  "gross_amount",
  "invoiced",
];

/**
 * Match a money identifier that is bordered on the left by a non-word
 * char or start-of-string, and on the right by a word boundary. This
 * prevents false positives like `accountBalance` matching `balance`
 * (no word boundary between `t` and `B`), while still catching
 * `.balance`, `_balance`, ` balance `, etc.
 */
const MONEY_TOKEN_RE = new RegExp(
  `(?:^|[^A-Za-z0-9_])(${MONEY_IDENTIFIERS.join("|")})\\b`,
  "i",
);

const NUMBER_CALL_RE = /\b(?:Number|parseFloat)\s*\(/g;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Strip `/* ... *\/` block comments AND `//` line comments. Preserves
 * newlines so line numbers in the scan report stay accurate.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * Replace the CONTENTS of string literals with an empty body, so a
 * `"Number(amount)"` inside an error message can't trip the scanner.
 * We keep the quotes so shape (and column offsets) survive.
 *
 * Template strings with `${...}` substitutions are left as-is inside
 * `\`` backticks — by design, an `${Number(row.amount)}` interpolation
 * SHOULD be flagged, since it's a real call site.
 */
function stripStringLiterals(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`([^`$\\]|\\.|\$(?!\{))*`/g, "``");
}

/**
 * Given a string that starts immediately AFTER the `(` of a `Number(` /
 * `parseFloat(` call, extract the argument expression by walking until
 * the matching `)`. Handles nested parens but not escape sequences
 * across the call (strings are already stripped by the caller).
 */
function extractArgument(after: string): string {
  let depth = 1;
  let out = "";
  for (const c of after) {
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return out;
    }
    out += c;
  }
  // Unterminated — return what we have. Edge case; regex still reports it.
  return out;
}

/**
 * Recursively collect every `.ts` file under `start`, skipping test files
 * and generated artefacts. `start` can itself be a file path.
 */
function collectTsFiles(start: string, out: string[]): void {
  let st;
  try {
    st = statSync(start);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (
      start.endsWith(".ts") &&
      !start.endsWith(".test.ts") &&
      !start.endsWith(".spec.ts") &&
      !start.endsWith(".d.ts")
    ) {
      out.push(start);
    }
    return;
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(start)) {
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === "coverage" ||
        entry.startsWith(".")
      )
        continue;
      collectTsFiles(join(start, entry), out);
    }
  }
}

interface Violation {
  file: string;
  line: number;
  col: number;
  text: string;
  token: string;
  callee: "Number" | "parseFloat";
}

function scanFile(abs: string): Violation[] {
  const violations: Violation[] = [];
  const raw = readFileSync(abs, "utf8");
  const noComments = stripComments(raw);
  const cleanLines = noComments.split(/\n/);
  const rawLines = raw.split(/\n/);
  const relPath = relative(REPO_ROOT, abs);

  for (let i = 0; i < cleanLines.length; i++) {
    const line = stripStringLiterals(cleanLines[i] ?? "");
    NUMBER_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUMBER_CALL_RE.exec(line)) !== null) {
      const callee = m[0].startsWith("Number") ? "Number" : "parseFloat";
      const after = line.slice(m.index + m[0].length);
      const arg = extractArgument(after);
      const hit = arg.match(MONEY_TOKEN_RE);
      if (hit) {
        violations.push({
          file: relPath,
          line: i + 1,
          col: m.index + 1,
          text: (rawLines[i] ?? "").trim(),
          token: hit[1] ?? hit[0],
          callee,
        });
      }
    }
  }

  return violations;
}

// ─── The gate itself ───────────────────────────────────────────────────────

describe("gate-72: ban Number()/parseFloat() on money columns", () => {
  it("finds no banned money-column coercions in finance-critical code", () => {
    const files: string[] = [];
    for (const p of SCAN_ROOTS) {
      const abs = resolve(REPO_ROOT, p);
      collectTsFiles(abs, files);
    }

    // Sanity: if path typos hide the real scope, fail loudly rather than
    // silently passing a zero-file audit.
    expect(files.length, "scan matched zero files — check SCAN_ROOTS paths").toBeGreaterThan(5);

    const all: Violation[] = [];
    for (const f of files) all.push(...scanFile(f));

    if (all.length > 0) {
      const report = all
        .map(
          (v) =>
            `  ${v.file}:${v.line}:${v.col}  ${v.callee}(…${v.token}…)  →  ${v.text}`,
        )
        .join("\n");
      throw new Error(
        `Number()/parseFloat() on money columns is FORBIDDEN — use m(x) from @instigenie/money.\n` +
          `${all.length} violation(s):\n${report}\n\n` +
          `If this is a legitimate non-money coercion (e.g. a row count),\n` +
          `rename the local so it doesn't match the money identifier list,\n` +
          `or add it to the MONEY_IDENTIFIERS exclude discussion in this file.`,
      );
    }

    expect(all).toEqual([]);
  });

  // ── Scanner sanity checks (positive + negative controls) ───────────────

  it("scanner flags a synthetic Number(row.grand_total) call", () => {
    const src = "const n = Number(row.grand_total);\n";
    const violations: Violation[] = [];
    const clean = stripStringLiterals(stripComments(src));
    for (const line of clean.split(/\n/)) {
      NUMBER_CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NUMBER_CALL_RE.exec(line)) !== null) {
        const arg = extractArgument(line.slice(m.index + m[0].length));
        const hit = arg.match(MONEY_TOKEN_RE);
        if (hit)
          violations.push({
            file: "<synthetic>",
            line: 1,
            col: 0,
            text: line,
            token: hit[1] ?? hit[0],
            callee: "Number",
          });
      }
    }
    expect(violations).toHaveLength(1);
    expect(violations[0]!.token.toLowerCase()).toBe("grand_total");
  });

  it("scanner flags parseFloat(invoice.amountPaid)", () => {
    const src = "const n = parseFloat(invoice.amountPaid);";
    const line = stripStringLiterals(stripComments(src));
    NUMBER_CALL_RE.lastIndex = 0;
    const m = NUMBER_CALL_RE.exec(line)!;
    const arg = extractArgument(line.slice(m.index + m[0].length));
    expect(arg).toBe("invoice.amountPaid");
    const hit = arg.match(MONEY_TOKEN_RE);
    expect(hit).not.toBeNull();
    expect((hit![1] ?? "").toLowerCase()).toBe("amountpaid");
  });

  it("scanner flags Number(row.lineTax) and Number(row.discountPercent)", () => {
    for (const [expr, expected] of [
      ["row.lineTax", "linetax"],
      ["row.discountPercent", "discountpercent"],
      ["row.runningBalance", "runningbalance"],
      ["row.arOverdue60", "aroverdue60"],
      ["receipt.amountApplied", "amountapplied"],
    ] as const) {
      const src = `Number(${expr});`;
      NUMBER_CALL_RE.lastIndex = 0;
      const m = NUMBER_CALL_RE.exec(src)!;
      const arg = extractArgument(src.slice(m.index + m[0].length));
      const hit = arg.match(MONEY_TOKEN_RE);
      expect(hit, `expected ${expr} to flag`).not.toBeNull();
      expect((hit![1] ?? "").toLowerCase()).toBe(expected);
    }
  });

  it("scanner ALLOWS Number(countRes.rows[0]!.total) — pagination count", () => {
    const line = "total: Number(countRes.rows[0]!.total),";
    NUMBER_CALL_RE.lastIndex = 0;
    const m = NUMBER_CALL_RE.exec(line)!;
    const arg = extractArgument(line.slice(m.index + m[0].length));
    expect(arg).toBe("countRes.rows[0]!.total");
    expect(arg).not.toMatch(MONEY_TOKEN_RE);
  });

  it("scanner ALLOWS Number(si.draft) / Number(si.posted) / Number(pay.recorded)", () => {
    for (const expr of ["si.draft", "si.posted", "pi.draft", "pi.posted", "pay.recorded"]) {
      const src = `Number(${expr})`;
      NUMBER_CALL_RE.lastIndex = 0;
      const m = NUMBER_CALL_RE.exec(src)!;
      const arg = extractArgument(src.slice(m.index + m[0].length));
      expect(arg).toBe(expr);
      expect(arg, `${expr} should not flag (it's a document count)`).not.toMatch(
        MONEY_TOKEN_RE,
      );
    }
  });

  it("scanner IGNORES matches inside // and /* */ comments", () => {
    const src = [
      "// Never call Number(row.amount) — use m() instead",
      "/* Nor parseFloat(invoice.grandTotal). */",
      "const ok = 1;",
    ].join("\n");
    const noComments = stripComments(src);
    const cleaned = noComments
      .split(/\n/)
      .map((l) => stripStringLiterals(l))
      .join("\n");
    NUMBER_CALL_RE.lastIndex = 0;
    expect(NUMBER_CALL_RE.exec(cleaned)).toBeNull();
  });

  it("scanner IGNORES matches inside string literals", () => {
    const src = `throw new Error("do not call Number(row.amount)");`;
    const cleaned = stripStringLiterals(stripComments(src));
    NUMBER_CALL_RE.lastIndex = 0;
    expect(NUMBER_CALL_RE.exec(cleaned)).toBeNull();
  });

  it("scanner correctly handles a realistic pagination line AND a money hit on the same file", () => {
    const src = [
      "export function foo() {",
      "  const out = {",
      "    total: Number(countRes.rows[0]!.total),", // allowed
      "    grand: Number(row.grand_total),", // flagged
      "  };",
      "  return out;",
      "}",
    ].join("\n");

    const lines = stripComments(src).split(/\n/);
    const hits: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = stripStringLiterals(lines[i]!);
      NUMBER_CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NUMBER_CALL_RE.exec(line)) !== null) {
        const arg = extractArgument(line.slice(m.index + m[0].length));
        if (arg.match(MONEY_TOKEN_RE)) hits.push(arg);
      }
    }
    expect(hits).toEqual(["row.grand_total"]);
  });
});
