/**
 * PG type parser hookup. ARCHITECTURE.md Rule #1.
 *
 * PostgreSQL NUMERIC is arbitrary precision; the default node-postgres type
 * parser casts it to JS Number — silently corrupting values like
 * `0.100000000000000005`. We override it to ALWAYS return the raw string.
 *
 * Call `installNumericTypeParser()` exactly once, as early in bootstrap as
 * possible — BEFORE any Pool is constructed. Otherwise pool workers will
 * have already captured the old parser.
 *
 * See Phase 1 Gate 2 (tests/gates/gate-2-decimal.test.ts) which inserts
 * `"0.100000000000000005"` and asserts perfect round-trip.
 */

import pgTypes from "pg";

// OID for NUMERIC in PostgreSQL is 1700. It's frozen since forever.
const NUMERIC_OID = 1700;
// pg also has a NUMERIC[] — OID 1231. We handle that via the default array
// parser pointing at our scalar parser.
const NUMERIC_ARRAY_OID = 1231;

let installed = false;

export function installNumericTypeParser(): void {
  if (installed) return;

  const identity = (val: string): string => val;

  pgTypes.types.setTypeParser(NUMERIC_OID, identity);

  // For NUMERIC[], decompose using pg's built-in array parser. `arrayParser`
  // is a function `(source, transform) => any[]`; passing `identity` as the
  // transform gives us a string[] instead of the default number[].
  // OID 1231 (NUMERIC[]) isn't a member of pg-types' TypeId enum, so we cast.
  const parseArray = pgTypes.types.arrayParser;
  if (typeof parseArray === "function") {
    pgTypes.types.setTypeParser(
      NUMERIC_ARRAY_OID as unknown as Parameters<
        typeof pgTypes.types.setTypeParser
      >[0],
      (val: string) => parseArray(val, identity)
    );
  }

  installed = true;
}

/**
 * Confirm the override is in place — useful in tests / bootstrap guards.
 */
export function isNumericParserInstalled(): boolean {
  return installed;
}
