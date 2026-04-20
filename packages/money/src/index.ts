/**
 * @mobilab/money — decimal.js pipeline for money, quantities, tax, ledger.
 *
 * ARCHITECTURE.md Rule #1 (non-negotiable):
 *   - All money, quantity, tax, and ledger amounts use decimal.js.
 *   - NUMERIC columns are parsed as strings via pg type parser.
 *   - Native `Number` for financial math is forbidden at construction time.
 *
 * This module enforces the Number ban at runtime. A CI lint rule (to be added)
 * also forbids `Number(...)` / `parseFloat(...)` in files that import Money.
 */

import Decimal from "decimal.js";

// ─── Precision configuration ──────────────────────────────────────────────────

// Configure decimal.js for financial accuracy. These settings apply to all
// Decimal instances created in this process.
// - precision: max significant digits (38 is comfortable for Indian finance:
//              GST can produce long decimal trails; we need room.)
// - rounding:  banker's rounding (ROUND_HALF_EVEN) — matches IEEE 754 and avoids
//              positive bias. ARCHITECTURE.md §5.3.
Decimal.set({
  precision: 38,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -30,
  toExpPos: 30,
});

// ─── Type brand ───────────────────────────────────────────────────────────────

/**
 * Money is a Decimal. We could brand it structurally to prevent accidental
 * `number + Money` arithmetic, but decimal.js already requires explicit
 * method calls (.plus, .times) so the ergonomics are fine without branding.
 */
export type Money = Decimal;

// ─── Constructors ─────────────────────────────────────────────────────────────

/**
 * Construct Money from a string or an existing Decimal.
 *
 * REFUSES to construct from `number`. Numbers lose precision at run-time
 * (0.1 + 0.2 !== 0.3) and Number/string coercion silently loses trailing zeros
 * that matter for ledger rows. PG NUMERIC must round-trip exactly.
 *
 * @example
 *   m("1000.50")        // ok
 *   m(new Decimal(1))   // ok
 *   m(1000.50)          // throws MoneyTypeError
 */
export function m(v: string | Decimal): Money {
  if (typeof v === "number") {
    throw new MoneyTypeError(
      "money(): refusing to construct from Number. Pass a string literal " +
        "(e.g. \"1000.50\") or an existing Decimal. NUMERIC columns must " +
        "round-trip exactly; Number cannot guarantee that."
    );
  }
  if (v instanceof Decimal) return v;
  if (typeof v !== "string") {
    throw new MoneyTypeError(
      `money(): expected string or Decimal, got ${typeof v}`
    );
  }
  // Validate format — accepts "123", "-1.5", "0.1", "1e-3" (decimal.js parses).
  // Reject empty strings and whitespace-only.
  const trimmed = v.trim();
  if (trimmed === "") {
    throw new MoneyTypeError("money(): empty string is not a valid amount");
  }
  try {
    return new Decimal(trimmed);
  } catch (err) {
    throw new MoneyTypeError(
      `money(): cannot parse "${v}" as a decimal number`,
      { cause: err }
    );
  }
}

// ─── Database bridges ─────────────────────────────────────────────────────────

/**
 * Convert a Money to a string suitable for INSERT / UPDATE on a NUMERIC column.
 * Always use this on the way into PG — never `String(m)` or `${m}` templates,
 * which can produce scientific notation for very large/small values.
 */
export function moneyToPg(v: Money): string {
  return v.toFixed();
}

/**
 * Parse a NUMERIC value coming from PG (as a string — see packages/db/src/types.ts)
 * into a Money. This is the entry point from the database into application code.
 */
export function moneyFromPg(v: string | null): Money | null {
  if (v === null || v === undefined) return null;
  return m(v);
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class MoneyTypeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MoneyTypeError";
  }
}

// ─── Re-export Decimal for callers who need the full API ──────────────────────

export { Decimal };

// ─── Constants ────────────────────────────────────────────────────────────────

export const ZERO: Money = new Decimal(0);
export const ONE: Money = new Decimal(1);
