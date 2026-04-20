/**
 * Gate 1 — Number ban.
 *
 * ARCHITECTURE.md Rule #1: money(n) with n:number must throw.
 * This is a unit gate — runs offline, no DB needed.
 */

import { describe, it, expect } from "vitest";
import { m, MoneyTypeError } from "@mobilab/money";

describe("gate-1: Number ban on m()", () => {
  it("throws MoneyTypeError when called with a number", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => m(1000.5 as any)).toThrow(MoneyTypeError);
  });

  it("error message names the offender", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => m(0 as any)).toThrow(/refusing to construct from Number/);
  });

  it("accepts strings that look like 0.1 + 0.2", () => {
    expect(m("0.3").toFixed()).toBe("0.3");
  });

  it("binary float rounding is visibly refused (0.1 + 0.2 ≠ 0.3 in IEEE 754)", () => {
    const drift = 0.1 + 0.2; // 0.30000000000000004
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => m(drift as any)).toThrow(MoneyTypeError);
  });
});
