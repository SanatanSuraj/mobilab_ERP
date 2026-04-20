/**
 * Unit tests for @mobilab/money.
 *
 * Relates to Phase 1 Gate 2 — Decimal integrity.
 * The full integration version of the gate is in tests/gates/gate-2-decimal.test.ts
 * and exercises the PG round-trip.
 */

import { describe, it, expect } from "vitest";
import { m, moneyFromPg, moneyToPg, MoneyTypeError, ZERO, ONE, Decimal } from "./index.js";

describe("@mobilab/money", () => {
  describe("m() construction", () => {
    it("accepts string", () => {
      expect(m("100.50").toFixed()).toBe("100.5");
    });

    it("accepts Decimal", () => {
      const d = new Decimal("42.5");
      expect(m(d)).toBe(d);
    });

    it("REFUSES number (the Rule #1 ban)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => m(100.5 as any)).toThrow(MoneyTypeError);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => m(100.5 as any)).toThrow(/refusing to construct from Number/);
    });

    it("refuses empty string", () => {
      expect(() => m("")).toThrow(MoneyTypeError);
      expect(() => m("  ")).toThrow(MoneyTypeError);
    });

    it("refuses non-numeric strings", () => {
      expect(() => m("abc")).toThrow(MoneyTypeError);
    });

    it("accepts negative values", () => {
      expect(m("-42.5").toFixed()).toBe("-42.5");
    });

    it("accepts many decimal places", () => {
      const v = "0.100000000000000005";
      expect(m(v).toFixed()).toBe(v);
    });
  });

  describe("PG round-trip", () => {
    it("moneyToPg returns string", () => {
      expect(moneyToPg(m("42.5"))).toBe("42.5");
    });

    it("moneyFromPg(null) returns null", () => {
      expect(moneyFromPg(null)).toBeNull();
    });

    it("preserves extreme precision through round-trip", () => {
      // The canary string from Gate 2: 18 decimal digits.
      const v = "0.100000000000000005";
      const parsed = moneyFromPg(v);
      expect(parsed).not.toBeNull();
      expect(moneyToPg(parsed!)).toBe(v);
    });
  });

  describe("constants", () => {
    it("ZERO and ONE are correct", () => {
      expect(ZERO.toFixed()).toBe("0");
      expect(ONE.toFixed()).toBe("1");
    });
  });
});
